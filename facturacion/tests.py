import io
import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from unittest.mock import patch
from django.db import close_old_connections
from django.http import HttpResponse, JsonResponse
from django.test import SimpleTestCase, TestCase, TransactionTestCase, RequestFactory
from django.utils import timezone
from django.core.management import call_command
from rest_framework.test import APIClient
from . import accounts
from .middleware import SanitizeIdsMiddleware
from .normalizacion import normalizar_nombre
from . import services
from .models import (Categoria, Producto, Cliente, Proveedor, Descuento, Venta, Compra, RequestLog, Sesion, Usuario,
                     Reembolso, DetalleReembolso, Faltante)


class Fixtures:
    """Estas pruebas cubren reglas de negocio/validación, no autenticación
    (esa vive en AuthTests), así que autentican como administrador: ese rol
    tiene todos los permisos que el admin original (sin auth) ejercía aquí."""
    def setUp(self):
        self.client = APIClient()
        self.admin = Usuario(usuario='admin-test', rol='administrador')
        self.admin.set_password('x')
        self.admin.save()
        self.client.force_authenticate(user=self.admin)
        self.category = Categoria.objects.create(nombre='Papelería')
        self.product = Producto.objects.create(codigo='PL-001', nombre='Cuaderno', categoria=self.category,
                                              precio=1000, costo=500, stock=5)
        self.customer = Cliente.objects.create(nombre='Ana')
        self.provider = Proveedor.objects.create(nombre='Proveedor')

    def sale(self, qty=2, **extra):
        return {'fecha': timezone.now().isoformat(), 'estado': 'cerrada', 'clienteId': '',
                'metodoPago': 'Efectivo', 'valorRecibido': 10000,
                'itemsJson': json.dumps([{'productoId': str(self.product.pk), 'cantidad': qty}]), **extra}

    def purchase(self, qty=2):
        return {'fecha': date.today().isoformat(), 'proveedorId': str(self.provider.pk),
                'itemsJson': json.dumps([{'productoId': str(self.product.pk), 'cantidad': qty, 'costo': 600}])}

    def stock(self):
        self.product.refresh_from_db()
        return self.product.stock


class ApiTests(Fixtures, TestCase):
    def test_crud_and_logging_for_every_method(self):
        start = RequestLog.objects.count()
        response = self.client.post('/api/categorias/', {'nombre': 'Nueva'}, format='json')
        self.assertEqual(response.status_code, 201)
        pk = response.json()['data']['id']
        url = f'/api/categorias/{pk}/'
        self.assertEqual(self.client.get(url).status_code, 200)
        self.assertEqual(self.client.put(url, {'nombre': 'Editada'}, format='json').status_code, 200)
        self.assertEqual(self.client.delete(url).status_code, 200)
        self.assertEqual(RequestLog.objects.count(), start + 4)
        self.assertEqual(set(RequestLog.objects.values_list('method', flat=True)), {'GET', 'POST', 'PUT', 'DELETE'})

    def test_invalid_missing_types_email_and_unknown_fields(self):
        for payload in ({}, {'nombre': 12}, {'nombre': 'Ana', 'correo': 'incorrecto'}, {'nombre': 'Ana', 'extra': True}):
            with self.subTest(payload=payload):
                response = self.client.post('/api/clientes/', payload, format='json')
                self.assertEqual(response.status_code, 400)
                self.assertIn('errors', response.json())
        self.assertEqual(Cliente.objects.count(), 1)
        self.assertEqual(RequestLog.objects.count(), 4)

    def test_product_strict_numbers_and_boolean(self):
        data = {'codigo': 'PL-002', 'nombre': 'Lápiz', 'categoriaId': str(self.category.pk),
                'precio': 100, 'costo': 50, 'stock': 2, 'seguimientoInventario': True}
        for field, value in [('precio', True), ('stock', -1), ('precio', '100'), ('costo', 1.5), ('seguimientoInventario', 'true')]:
            with self.subTest(field=field, value=value):
                self.assertEqual(self.client.post('/api/productos/', {**data, field: value}, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/productos/', data, format='json').status_code, 201)

    def test_put_requires_full_data_patch_supports_quick_edit(self):
        url = f'/api/productos/{self.product.pk}/'
        self.assertEqual(self.client.put(url, {'nombre': 'Otro'}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(url, {'nombre': 'Otro'}, format='json').status_code, 200)
        self.assertEqual(self.stock(), 5)

    def test_raw_json_media_type_errors(self):
        self.assertEqual(self.client.post('/api/clientes/', '{', content_type='application/json').status_code, 400)
        self.assertEqual(self.client.post('/api/clientes/', '[]', content_type='application/json').status_code, 400)
        self.assertEqual(self.client.post('/api/clientes/', 'abc', content_type='text/plain').status_code, 415)

    def test_sanitization_real_product_and_nested_demo(self):
        data = self.client.get(f'/api/productos/{self.product.pk}/').json()['data']
        self.assertNotIn('categoria_id', data)
        self.assertEqual(data['categoriaId'], str(self.category.pk))
        data = self.client.get('/api/demo/sanitizacion/').json()['data']
        self.assertNotIn('cliente_id', data)
        self.assertEqual(data['nested'], {'nombre': 'Papel y Luna'})
        self.assertEqual(data['items'], [{'cantidad': 2, 'productoId': 'publico'}])

    def test_middleware_preserves_non_json_and_updates_length(self):
        factory = RequestFactory()
        for payload in ({'a_id': 1, 'id': 2, 'x': [{'b_id': 3, 'ok': True}]}, [{'x_id': 1, 'ok': 2}]):
            response = JsonResponse(payload, safe=isinstance(payload, dict))
            response['Content-Length'] = len(response.content)
            result = SanitizeIdsMiddleware(lambda request: response)(factory.get('/'))
            self.assertEqual(int(result['Content-Length']), len(result.content))
            self.assertNotIn('_id', result.content.decode())
        response = HttpResponse('texto')
        self.assertEqual(SanitizeIdsMiddleware(lambda request: response)(factory.get('/')).content, b'texto')

    def test_sale_server_prices_totals_and_retry_once(self):
        data = self.sale()
        data['itemsJson'] = json.dumps([{'productoId': str(self.product.pk), 'cantidad': 2, 'precio': 1, 'costo': 1}])
        data['total'] = 1
        response = self.client.post('/api/ventas/', data, format='json')
        self.assertEqual(response.status_code, 201)
        record = response.json()['data']
        self.assertEqual(record['total'], 2000)
        self.assertEqual(record['cambio'], 8000)
        self.assertEqual(self.stock(), 3)
        response = self.client.put(f'/api/ventas/{record["id"]}/', record, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.stock(), 3)
        self.assertEqual(self.client.delete(f'/api/ventas/{record["id"]}/').status_code, 409)

    def test_draft_close_delete_and_insufficient_cash(self):
        response = self.client.post('/api/ventas/', self.sale(estado='abierta', valorRecibido=0), format='json')
        pk = response.json()['data']['id']
        self.assertEqual(self.stock(), 5)
        url = f'/api/ventas/{pk}/'
        self.assertEqual(self.client.patch(url, {'estado': 'cerrada'}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(url, {'estado': 'cerrada', 'valorRecibido': 5000}, format='json').status_code, 200)
        self.assertEqual(self.stock(), 3)
        opened = self.client.post('/api/ventas/', self.sale(estado='abierta'), format='json').json()['data']
        self.assertEqual(self.client.delete(f'/api/ventas/{opened["id"]}/').status_code, 200)

    def test_stock_failure_and_write_failure_roll_back_everything(self):
        response = self.client.post('/api/ventas/', self.sale(6), format='json')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.stock(), 5)
        self.assertEqual(Venta.objects.count(), 0)
        with patch('facturacion.services.DetalleVenta.objects.bulk_create', side_effect=RuntimeError('fallo')):
            with self.assertRaises(RuntimeError):
                self.client.post('/api/ventas/', self.sale(), format='json')
        self.assertEqual(self.stock(), 5)
        self.assertEqual(Venta.objects.count(), 0)
        self.assertEqual(RequestLog.objects.count(), 2)

    def test_credit_requires_customer(self):
        self.assertEqual(self.client.post('/api/ventas/', self.sale(metodoPago='Debe'), format='json').status_code, 400)
        response = self.client.post('/api/ventas/', self.sale(metodoPago='Debe', clienteId=str(self.customer.pk)), format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['data']['valorRecibido'], 0)
        self.assertEqual(self.client.delete(f'/api/clientes/{self.customer.pk}/').status_code, 409)

    def test_purchase_increases_stock_once_and_protects_history(self):
        response = self.client.post('/api/compras/', self.purchase(), format='json')
        self.assertEqual(response.status_code, 201)
        record = response.json()['data']
        self.assertEqual(self.stock(), 7)
        self.assertEqual(self.product.costo, 600)
        self.assertEqual(record['total'], 1200)
        self.assertEqual(self.client.post('/api/compras/', record, format='json').status_code, 200)
        self.assertEqual(self.stock(), 7)
        self.assertEqual(self.client.patch(f'/api/compras/{record["id"]}/', {'total': 1}, format='json').status_code, 200)
        self.assertEqual(self.client.patch(f'/api/compras/{record["id"]}/', {'fecha': '2020-01-01'}, format='json').status_code, 409)
        self.assertEqual(self.client.delete(f'/api/compras/{record["id"]}/').status_code, 409)
        self.assertEqual(self.client.delete(f'/api/productos/{self.product.pk}/').status_code, 409)

    def test_bad_duplicate_items_and_references(self):
        for value in ('invalid', '[]', '{}', json.dumps([{'productoId': str(self.product.pk), 'cantidad': True}]),
                      json.dumps([{'productoId': str(self.product.pk), 'cantidad': 1}] * 2)):
            self.assertEqual(self.client.post('/api/ventas/', self.sale(itemsJson=value), format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/ventas/', self.sale(clienteId='no-uuid'), format='json').status_code, 400)

    def test_untracked_product_and_purchase_cost_validation(self):
        self.product.seguimiento_inventario = False
        self.product.stock = 0
        self.product.save()
        response = self.client.post('/api/ventas/', self.sale(100, metodoPago='Nequi'), format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.stock(), 0)
        data = self.purchase()
        data['itemsJson'] = json.dumps([{'productoId': str(self.product.pk), 'cantidad': 1}])
        self.assertEqual(self.client.post('/api/compras/', data, format='json').status_code, 400)
        self.assertEqual(Compra.objects.count(), 0)

    def test_not_found_and_duplicate_case_insensitive(self):
        self.assertEqual(self.client.get('/api/desconocido/').status_code, 404)
        self.assertEqual(self.client.get('/api/productos/00000000-0000-4000-8000-000000000000/').status_code, 404)
        self.assertEqual(self.client.post('/api/categorias/', {'nombre': 'PAPELERÍA'}, format='json').status_code, 409)
        self.assertEqual(self.client.delete(f'/api/categorias/{self.category.pk}/').status_code, 409)

    def test_frontend_assets_and_private_files(self):
        self.assertEqual(self.client.get('/').status_code, 200)
        self.assertEqual(self.client.get('/js/api.js').status_code, 200)
        for path in ('/.env', '/run.py', '/sql/schema.sql', '/js/../run.py', '/js/../.env.example'):
            self.assertIn(self.client.get(path).status_code, (400, 404))

    def test_seed_runs_once_without_resurrecting_deleted_examples(self):
        call_command('seed', verbosity=0)
        seeded = Producto.objects.get(codigo='PL-002')
        seeded.delete()
        call_command('seed', verbosity=0)
        self.assertFalse(Producto.objects.filter(codigo='PL-002').exists())


class DescuentoTests(Fixtures, TestCase):
    def setUp(self):
        super().setUp()
        self.percent = Descuento.objects.create(nombre='10%', tipo='porcentual', valor=10)
        self.fixed = Descuento.objects.create(nombre='Fijo 500', tipo='fijo', valor=500)
        # product: precio=1000, costo=500, stock=5 (ver Fixtures.setUp)

    def test_crud_basico(self):
        response = self.client.post('/api/descuentos/', {'nombre': 'Nuevo', 'tipo': 'fijo', 'valor': 100}, format='json')
        self.assertEqual(response.status_code, 201)
        pk = response.json()['data']['id']
        self.assertEqual(self.client.patch(f'/api/descuentos/{pk}/', {'valor': 200}, format='json').status_code, 200)
        self.assertEqual(self.client.get(f'/api/descuentos/{pk}/').json()['data']['valor'], 200)
        self.assertEqual(self.client.delete(f'/api/descuentos/{pk}/').status_code, 200)

    def test_validaciones_estrictas(self):
        cases = ({'nombre': 'X', 'tipo': 'porcentual', 'valor': 0}, {'nombre': 'X', 'tipo': 'porcentual', 'valor': 101},
                  {'nombre': 'X', 'tipo': 'fijo', 'valor': 0}, {'nombre': 'X', 'tipo': 'otro', 'valor': 10},
                  {'tipo': 'fijo', 'valor': 10}, {'nombre': 'X', 'tipo': 'fijo', 'valor': -5})
        for payload in cases:
            with self.subTest(payload=payload):
                self.assertEqual(self.client.post('/api/descuentos/', payload, format='json').status_code, 400)

    def test_cajero_solo_lee_descuentos(self):
        cajero = Usuario(usuario='cajero-desc', rol='cajero')
        cajero.set_password('x')
        cajero.save()
        client = APIClient()
        client.force_authenticate(user=cajero)
        self.assertEqual(client.get('/api/descuentos/').status_code, 200)
        self.assertEqual(client.post('/api/descuentos/', {'nombre': 'X', 'tipo': 'fijo', 'valor': 10}, format='json').status_code, 403)
        self.assertEqual(client.patch(f'/api/descuentos/{self.percent.pk}/', {'valor': 20}, format='json').status_code, 403)
        self.assertEqual(client.delete(f'/api/descuentos/{self.percent.pk}/').status_code, 403)

    def test_calculo_porcentual_sobre_subtotal(self):
        # 2 x 1000 = 2000 de subtotal; 10% = 200 de descuento; total 1800.
        response = self.client.post('/api/ventas/', self.sale(2, descuentoId=str(self.percent.pk), valorRecibido=1800), format='json')
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()['data']
        self.assertEqual(data['subtotal'], 2000)
        self.assertEqual(data['descuentoNombre'], '10%')
        self.assertEqual(data['descuentoTipo'], 'porcentual')
        self.assertEqual(data['descuentoMonto'], 200)
        self.assertEqual(data['total'], 1800)
        self.assertEqual(data['cambio'], 0)

    def test_calculo_fijo_sobre_subtotal(self):
        response = self.client.post('/api/ventas/', self.sale(2, descuentoId=str(self.fixed.pk), valorRecibido=1500), format='json')
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()['data']
        self.assertEqual(data['descuentoMonto'], 500)
        self.assertEqual(data['total'], 1500)

    def test_fijo_mayor_que_subtotal_rechazado_al_crear(self):
        grande = Descuento.objects.create(nombre='Grande', tipo='fijo', valor=5000)
        response = self.client.post('/api/ventas/', self.sale(1, descuentoId=str(grande.pk)), format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('descuentoId', response.json()['errors'])
        self.assertEqual(Venta.objects.count(), 0)

    def test_fijo_mayor_que_subtotal_rechazado_al_guardar_abierta_y_al_cerrar(self):
        medio = Descuento.objects.create(nombre='Medio', tipo='fijo', valor=1500)
        opened = self.client.post('/api/ventas/', self.sale(2, estado='abierta', valorRecibido=0, descuentoId=str(medio.pk)), format='json')
        self.assertEqual(opened.status_code, 201, opened.content)
        pk = opened.json()['data']['id']
        # Reducir a 1 item: subtotal baja a 1000, menor que el descuento fijo de 1500.
        reducido = json.dumps([{'productoId': str(self.product.pk), 'cantidad': 1}])
        response = self.client.patch(f'/api/ventas/{pk}/', {'itemsJson': reducido}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('descuentoId', response.json()['errors'])
        cierre = self.client.patch(f'/api/ventas/{pk}/', {'itemsJson': reducido, 'estado': 'cerrada', 'valorRecibido': 0}, format='json')
        self.assertEqual(cierre.status_code, 400)

    def test_un_solo_descuento_el_nuevo_reemplaza_al_anterior(self):
        opened = self.client.post('/api/ventas/', self.sale(2, estado='abierta', valorRecibido=0, descuentoId=str(self.percent.pk)), format='json').json()['data']
        response = self.client.patch(f'/api/ventas/{opened["id"]}/', {'descuentoId': str(self.fixed.pk)}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()['data']
        self.assertEqual(data['descuentoNombre'], self.fixed.nombre)
        self.assertEqual(data['descuentoMonto'], 500)

    def test_cierre_con_descuento_descuenta_stock_normalmente(self):
        response = self.client.post('/api/ventas/', self.sale(2, descuentoId=str(self.percent.pk), valorRecibido=1800), format='json')
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(self.stock(), 3)

    def test_stock_no_cambia_por_el_descuento_en_si(self):
        before = self.stock()
        self.client.post('/api/ventas/', self.sale(2, descuentoId=str(self.percent.pk), valorRecibido=1800), format='json')
        self.assertEqual(before - self.stock(), 2)  # exactamente la cantidad vendida, nada mas

    def test_eliminar_descuento_usado_no_altera_la_venta_cerrada_ni_su_factura(self):
        response = self.client.post('/api/ventas/', self.sale(2, descuentoId=str(self.percent.pk), valorRecibido=1800), format='json')
        sale_id = response.json()['data']['id']
        self.assertEqual(self.client.delete(f'/api/descuentos/{self.percent.pk}/').status_code, 200)
        detail = self.client.get(f'/api/ventas/{sale_id}/').json()['data']
        self.assertEqual(detail['descuentoId'], '')
        self.assertEqual(detail['descuentoNombre'], '10%')
        self.assertEqual(detail['descuentoValor'], 10)
        self.assertEqual(detail['descuentoMonto'], 200)
        self.assertEqual(detail['total'], 1800)

    def test_editar_descuento_no_altera_venta_existente(self):
        response = self.client.post('/api/ventas/', self.sale(2, descuentoId=str(self.percent.pk), valorRecibido=1800), format='json')
        sale_id = response.json()['data']['id']
        self.assertEqual(self.client.patch(f'/api/descuentos/{self.percent.pk}/', {'valor': 50}, format='json').status_code, 200)
        detail = self.client.get(f'/api/ventas/{sale_id}/').json()['data']
        self.assertEqual(detail['descuentoValor'], 10)
        self.assertEqual(detail['total'], 1800)

    def test_resave_abierta_usa_copia_congelada_no_el_catalogo_editado(self):
        """Regresion: antes de este cambio, services.save_document releia
        record.descuento (la relacion en vivo) en cada guardado sin importar
        si el descuentoId habia cambiado, asi que reguardar una venta abierta
        aplicaba el valor *actual* del catalogo en vez del congelado."""
        opened = self.client.post('/api/ventas/', self.sale(2, estado='abierta', valorRecibido=0, descuentoId=str(self.percent.pk)), format='json')
        self.assertEqual(opened.status_code, 201, opened.content)
        sale_id = opened.json()['data']['id']
        self.assertEqual(opened.json()['data']['descuentoValor'], 10)
        # Se edita el catalogo DESPUES de aplicarlo a la venta.
        self.assertEqual(self.client.patch(f'/api/descuentos/{self.percent.pk}/', {'valor': 50}, format='json').status_code, 200)
        # Reguardar la MISMA venta abierta reenviando el mismo descuentoId no
        # debe releer el 50% nuevo: sigue siendo el mismo descuento aplicado.
        resend = self.client.patch(f'/api/ventas/{sale_id}/', {'descuentoId': str(self.percent.pk)}, format='json')
        self.assertEqual(resend.status_code, 200, resend.content)
        self.assertEqual(resend.json()['data']['descuentoValor'], 10)
        self.assertEqual(resend.json()['data']['descuentoMonto'], 200)

    def test_cambiar_a_un_descuento_distinto_si_usa_su_valor_vigente(self):
        opened = self.client.post('/api/ventas/', self.sale(2, estado='abierta', valorRecibido=0, descuentoId=str(self.percent.pk)), format='json')
        sale_id = opened.json()['data']['id']
        switched = self.client.patch(f'/api/ventas/{sale_id}/', {'descuentoId': str(self.fixed.pk)}, format='json')
        self.assertEqual(switched.status_code, 200, switched.content)
        self.assertEqual(switched.json()['data']['descuentoNombre'], self.fixed.nombre)
        self.assertEqual(switched.json()['data']['descuentoMonto'], 500)

    def test_venta_abierta_con_descuento_se_guarda_y_se_retoma(self):
        response = self.client.post('/api/ventas/', self.sale(2, estado='abierta', valorRecibido=0, descuentoId=str(self.percent.pk)), format='json')
        self.assertEqual(response.status_code, 201, response.content)
        sale_id = response.json()['data']['id']
        retomada = self.client.get(f'/api/ventas/{sale_id}/').json()['data']
        self.assertEqual(retomada['estado'], 'abierta')
        self.assertEqual(retomada['descuentoNombre'], '10%')
        self.assertEqual(retomada['descuentoMonto'], 200)
        self.assertEqual(retomada['total'], 1800)

    def test_reintento_idempotente_del_cierre_con_descuento_no_duplica(self):
        response = self.client.post('/api/ventas/', self.sale(2, descuentoId=str(self.percent.pk), valorRecibido=1800), format='json')
        record = response.json()['data']
        retry = self.client.put(f'/api/ventas/{record["id"]}/', record, format='json')
        self.assertEqual(retry.status_code, 200, retry.content)
        self.assertEqual(self.stock(), 3)
        self.assertEqual(Venta.objects.count(), 1)


class CorreccionTests(Fixtures, TestCase):
    def setUp(self):
        super().setUp()
        self.product2 = Producto.objects.create(codigo='PL-002', nombre='Lapicero', categoria=self.category,
                                                precio=500, costo=200, stock=10)
        self.untracked = Producto.objects.create(codigo='PL-003', nombre='Servicio', categoria=self.category,
                                                precio=300, costo=100, seguimiento_inventario=False, stock=0)
        # product x2 (1000 c/u) + product2 x3 (500 c/u) = 3500. Efectivo exacto.
        items = json.dumps([{'productoId': str(self.product.pk), 'cantidad': 2}, {'productoId': str(self.product2.pk), 'cantidad': 3}])
        response = self.client.post('/api/ventas/', self.sale(itemsJson=items, valorRecibido=3500), format='json')
        self.assertEqual(response.status_code, 201, response.content)
        self.sale_data = response.json()['data']
        self.sale_id = self.sale_data['id']
        # product: 5-2=3 ; product2: 10-3=7.

    def correct(self, sale_id, items, **extra):
        payload = {'itemsJson': json.dumps(items), 'metodoPago': extra.pop('metodoPago', 'Efectivo'),
                  'valorRecibido': extra.pop('valorRecibido', 0), 'clienteId': extra.pop('clienteId', ''), **extra}
        return self.client.post(f'/api/ventas/{sale_id}/corregir/', payload, format='json')

    def items_base(self, product_qty=2, product2_qty=3):
        items = []
        if product_qty is not None:
            items.append({'productoId': str(self.product.pk), 'cantidad': product_qty})
        if product2_qty is not None:
            items.append({'productoId': str(self.product2.pk), 'cantidad': product2_qty})
        return items

    def test_cajero_403(self):
        cajero = Usuario(usuario='cajero-corr', rol='cajero')
        cajero.set_password('x')
        cajero.save()
        client = APIClient()
        client.force_authenticate(user=cajero)
        payload = {'itemsJson': json.dumps(self.items_base()), 'metodoPago': 'Efectivo', 'valorRecibido': 3500, 'clienteId': ''}
        response = client.post(f'/api/ventas/{self.sale_id}/corregir/', payload, format='json')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.stock(), 3)

    def test_venta_no_cerrada_rechazada(self):
        opened = self.client.post('/api/ventas/', self.sale(1, estado='abierta', valorRecibido=0), format='json').json()['data']
        response = self.correct(opened['id'], [{'productoId': str(self.product.pk), 'cantidad': 1}], valorRecibido=1000)
        self.assertEqual(response.status_code, 400)

    def test_sin_items_rechazado(self):
        response = self.client.post(f'/api/ventas/{self.sale_id}/corregir/',
                                   {'itemsJson': '[]', 'metodoPago': 'Efectivo', 'valorRecibido': 3500, 'clienteId': ''}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.stock(), 3)

    def test_cantidad_hacia_arriba_descuenta_la_diferencia(self):
        response = self.correct(self.sale_id, self.items_base(product_qty=4), valorRecibido=5500)
        self.assertEqual(response.status_code, 200, response.content)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 1)  # 3 - (4-2)

    def test_cantidad_hacia_abajo_restaura_la_diferencia(self):
        response = self.correct(self.sale_id, self.items_base(product2_qty=1), valorRecibido=2500)
        self.assertEqual(response.status_code, 200, response.content)
        self.product2.refresh_from_db()
        self.assertEqual(self.product2.stock, 9)  # 7 + (3-1)

    def test_eliminar_linea_restaura_su_cantidad(self):
        response = self.correct(self.sale_id, self.items_base(product2_qty=None), valorRecibido=2000)
        self.assertEqual(response.status_code, 200, response.content)
        self.product2.refresh_from_db()
        self.assertEqual(self.product2.stock, 10)  # 7 + 3 restaurado
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 3)  # product no cambio

    def test_agregar_producto_descuenta_su_cantidad(self):
        items = self.items_base() + [{'productoId': str(self.untracked.pk), 'cantidad': 1}]
        # untracked no tiene seguimiento; agreguemos uno nuevo CON seguimiento.
        extra = Producto.objects.create(codigo='PL-004', nombre='Agregado', categoria=self.category, precio=200, costo=80, stock=20)
        items = self.items_base() + [{'productoId': str(extra.pk), 'cantidad': 5}]
        response = self.correct(self.sale_id, items, valorRecibido=4500)
        self.assertEqual(response.status_code, 200, response.content)
        extra.refresh_from_db()
        self.assertEqual(extra.stock, 15)  # 20 - 5

    def test_producto_sin_seguimiento_no_mueve_stock(self):
        items = self.items_base() + [{'productoId': str(self.untracked.pk), 'cantidad': 7}]
        response = self.correct(self.sale_id, items, valorRecibido=3500 + 7 * 300)
        self.assertEqual(response.status_code, 200, response.content)
        self.untracked.refresh_from_db()
        self.assertEqual(self.untracked.stock, 0)

    def test_stock_negativo_rechazado_sin_cambios_parciales(self):
        response = self.correct(self.sale_id, self.items_base(product_qty=999), metodoPago='Nequi')
        self.assertEqual(response.status_code, 400)
        self.assertIn('Cuaderno', response.json()['errors']['stock'])
        self.product.refresh_from_db(); self.product2.refresh_from_db()
        self.assertEqual(self.product.stock, 3)
        self.assertEqual(self.product2.stock, 7)
        venta = Venta.objects.get(pk=self.sale_id)
        self.assertEqual(venta.subtotal, 3500)
        self.assertFalse(venta.corregida)

    def test_cambio_de_cliente(self):
        response = self.correct(self.sale_id, self.items_base(), valorRecibido=3500, clienteId=str(self.customer.pk))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['data']['clienteId'], str(self.customer.pk))

    def test_efectivo_a_debe_exige_cliente(self):
        response = self.correct(self.sale_id, self.items_base(), metodoPago='Debe', clienteId='')
        self.assertEqual(response.status_code, 400)

    def test_efectivo_a_debe_con_cliente_ok_y_luego_debe_a_efectivo_exige_valor_recibido(self):
        ok = self.correct(self.sale_id, self.items_base(), metodoPago='Debe', clienteId=str(self.customer.pk))
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertEqual(ok.json()['data']['metodoPago'], 'Debe')
        insuficiente = self.correct(self.sale_id, self.items_base(), metodoPago='Efectivo', valorRecibido=100, clienteId=str(self.customer.pk))
        self.assertEqual(insuficiente.status_code, 400)

    def test_id_se_conserva(self):
        response = self.correct(self.sale_id, self.items_base(product_qty=1), valorRecibido=2500)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['data']['id'], self.sale_id)

    def test_campos_de_trazabilidad(self):
        response = self.correct(self.sale_id, self.items_base(product_qty=1), valorRecibido=2500)
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()['data']
        self.assertTrue(data['corregida'])
        self.assertEqual(data['corregidaPor'], self.admin.usuario)
        self.assertIsNotNone(data['corregidaEn'])

    def test_segunda_correccion_calcula_diferencia_respecto_al_estado_actual(self):
        first = self.correct(self.sale_id, self.items_base(product_qty=4), valorRecibido=5500)
        self.assertEqual(first.status_code, 200, first.content)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 1)  # 3 - (4-2)
        second = self.correct(self.sale_id, self.items_base(product_qty=1), valorRecibido=2500)
        self.assertEqual(second.status_code, 200, second.content)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 4)  # 1 + (4-1), diferencia contra el estado de la 1a correccion

    def test_reenvio_identico_no_duplica_stock(self):
        payload_items = self.items_base(product_qty=4)
        first = self.correct(self.sale_id, payload_items, valorRecibido=5500)
        self.assertEqual(first.status_code, 200, first.content)
        self.product.refresh_from_db()
        stock_after_first = self.product.stock
        second = self.correct(self.sale_id, payload_items, valorRecibido=5500)
        self.assertEqual(second.status_code, 200, second.content)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, stock_after_first)

    def test_precio_unitario_original_se_conserva_en_lineas_existentes(self):
        self.assertEqual(self.client.patch(f'/api/productos/{self.product.pk}/', {'precio': 9999}, format='json').status_code, 200)
        extra = Producto.objects.create(codigo='PL-005', nombre='Nuevo en correccion', categoria=self.category, precio=777, costo=300, stock=10)
        items = self.items_base(product_qty=2) + [{'productoId': str(extra.pk), 'cantidad': 1}]
        response = self.correct(self.sale_id, items, valorRecibido=999999)
        self.assertEqual(response.status_code, 200, response.content)
        lines = {i['productoId']: i['precio'] for i in json.loads(response.json()['data']['itemsJson'])}
        self.assertEqual(lines[str(self.product.pk)], 1000)  # precio original, no el 9999 nuevo
        self.assertEqual(lines[str(extra.pk)], 777)  # agregado: precio vigente

    def test_putpatch_normal_sobre_venta_cerrada_sigue_dando_409(self):
        distinto = {**self.sale_data, 'metodoPago': 'Nequi'}
        self.assertEqual(self.client.put(f'/api/ventas/{self.sale_id}/', distinto, format='json').status_code, 409)
        self.assertEqual(self.client.patch(f'/api/ventas/{self.sale_id}/', {'metodoPago': 'Nequi'}, format='json').status_code, 409)

    def test_descuento_porcentual_se_recalcula_sobre_el_nuevo_subtotal_con_la_copia_congelada(self):
        descuento = Descuento.objects.create(nombre='10%', tipo='porcentual', valor=10)
        # Producto propio con stock amplio, para no depender del que ya gasto el sale_id de setUp.
        libre = Producto.objects.create(codigo='PL-006', nombre='Libre', categoria=self.category, precio=1000, costo=500, stock=20)
        items = json.dumps([{'productoId': str(libre.pk), 'cantidad': 2}])
        venta = self.client.post('/api/ventas/', self.sale(itemsJson=items, descuentoId=str(descuento.pk), valorRecibido=1800), format='json').json()['data']
        # Se edita el catalogo DESPUES: no debe afectar la correccion.
        descuento.valor = 50
        descuento.save(update_fields=['valor'])
        response = self.correct(venta['id'], [{'productoId': str(libre.pk), 'cantidad': 4}], valorRecibido=3600)
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()['data']
        self.assertEqual(data['subtotal'], 4000)
        self.assertEqual(data['descuentoValor'], 10)  # copia congelada, no el 50 editado
        self.assertEqual(data['descuentoMonto'], 400)
        self.assertEqual(data['total'], 3600)

    def test_descuento_fijo_mayor_al_nuevo_subtotal_rechazado(self):
        descuento = Descuento.objects.create(nombre='Fijo 1500', tipo='fijo', valor=1500)
        items = json.dumps([{'productoId': str(self.product.pk), 'cantidad': 2}])
        venta = self.client.post('/api/ventas/', self.sale(itemsJson=items, descuentoId=str(descuento.pk), valorRecibido=500), format='json').json()['data']
        response = self.correct(venta['id'], [{'productoId': str(self.product.pk), 'cantidad': 1}], valorRecibido=0)
        self.assertEqual(response.status_code, 400)
        self.assertIn('descuentoId', response.json()['errors'])

    def test_descuento_eliminado_del_catalogo_no_afecta_la_correccion(self):
        descuento = Descuento.objects.create(nombre='Se borra', tipo='fijo', valor=200)
        items = json.dumps([{'productoId': str(self.product.pk), 'cantidad': 2}])
        venta = self.client.post('/api/ventas/', self.sale(itemsJson=items, descuentoId=str(descuento.pk), valorRecibido=1800), format='json').json()['data']
        self.assertEqual(self.client.delete(f'/api/descuentos/{descuento.pk}/').status_code, 200)
        response = self.correct(venta['id'], [{'productoId': str(self.product.pk), 'cantidad': 3}], valorRecibido=2800)
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()['data']
        self.assertEqual(data['descuentoNombre'], 'Se borra')
        self.assertEqual(data['descuentoMonto'], 200)
        self.assertEqual(data['total'], 2800)

    def test_correccion_bloqueada_con_409_tras_reembolso(self):
        # Antes de cualquier reembolso, corregir funciona normalmente.
        response = self.correct(self.sale_id, self.items_base(product_qty=3), valorRecibido=4500)
        self.assertEqual(response.status_code, 200, response.content)
        refund = self.client.post(f'/api/ventas/{self.sale_id}/reembolsos/',
                                  {'itemsJson': json.dumps([{'productoId': str(self.product.pk), 'cantidad': 1, 'retornaInventario': True}])},
                                  format='json')
        self.assertEqual(refund.status_code, 201, refund.content)
        blocked = self.correct(self.sale_id, self.items_base(product_qty=2), valorRecibido=3500)
        self.assertEqual(blocked.status_code, 409)
        self.assertIn('reembolsos', blocked.json()['message'].lower())


class ReembolsoTests(Fixtures, TestCase):
    def setUp(self):
        super().setUp()
        self.product2 = Producto.objects.create(codigo='PL-002', nombre='Lapicero', categoria=self.category,
                                                precio=500, costo=200, stock=10)
        self.untracked = Producto.objects.create(codigo='PL-003', nombre='Servicio', categoria=self.category,
                                                seguimiento_inventario=False, stock=0, precio=300, costo=100)
        # product x4 (1000 c/u) + product2 x3 (500 c/u) + untracked x1 = 5800. Efectivo exacto.
        items = json.dumps([{'productoId': str(self.product.pk), 'cantidad': 4},
                            {'productoId': str(self.product2.pk), 'cantidad': 3},
                            {'productoId': str(self.untracked.pk), 'cantidad': 1}])
        response = self.client.post('/api/ventas/', self.sale(itemsJson=items, valorRecibido=5800), format='json')
        self.assertEqual(response.status_code, 201, response.content)
        self.sale_data = response.json()['data']
        self.sale_id = self.sale_data['id']
        # product: 5-4=1 ; product2: 10-3=7.

    def refund(self, sale_id=None, items=None, **extra):
        payload = {'itemsJson': json.dumps(items) if items is not None else '[]', **extra}
        return self.client.post(f'/api/ventas/{sale_id or self.sale_id}/reembolsos/', payload, format='json')

    def line(self, producto, cantidad, retorna=True):
        return {'productoId': str(producto.pk), 'cantidad': cantidad, 'retornaInventario': retorna}

    def test_cajero_403(self):
        cajero = Usuario(usuario='cajero-reemb', rol='cajero')
        cajero.set_password('x')
        cajero.save()
        client = APIClient()
        client.force_authenticate(user=cajero)
        response = client.post(f'/api/ventas/{self.sale_id}/reembolsos/', {'itemsJson': json.dumps([self.line(self.product, 1)])}, format='json')
        self.assertEqual(response.status_code, 403)

    def test_venta_no_cerrada_rechazada(self):
        abierta = self.client.post('/api/ventas/', self.sale(estado='abierta', valorRecibido=0), format='json').json()['data']
        response = self.refund(abierta['id'], [self.line(self.product, 1)])
        self.assertEqual(response.status_code, 400)
        self.assertIn('estado', response.json()['errors'])

    def test_sin_lineas_rechazado(self):
        response = self.refund(items=[])
        self.assertEqual(response.status_code, 400)
        self.assertIn('itemsJson', response.json()['errors'])

    def test_lineas_duplicadas_rechazadas(self):
        response = self.refund(items=[self.line(self.product, 1), self.line(self.product, 1)])
        self.assertEqual(response.status_code, 400)
        self.assertIn('itemsJson', response.json()['errors'])

    def test_cantidad_invalida_rechazada(self):
        for cantidad in (0, -1):
            with self.subTest(cantidad=cantidad):
                response = self.refund(items=[{'productoId': str(self.product.pk), 'cantidad': cantidad, 'retornaInventario': True}])
                self.assertEqual(response.status_code, 400)

    def test_total_y_lineas_a_la_vez_rechazado(self):
        response = self.refund(items=[self.line(self.product, 1)], total=True)
        self.assertEqual(response.status_code, 400)
        self.assertIn('itemsJson', response.json()['errors'])

    def test_reembolso_parcial(self):
        response = self.refund(items=[self.line(self.product, 1)])
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()['data']
        self.assertEqual(data['estadoReembolso'], 'parcial')
        self.assertEqual(len(data['reembolsos']), 1)
        self.assertEqual(data['reembolsos'][0]['monto'], 1000)  # sin descuento: 1000 * (5800/5800) = 1000
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 2)  # 1 (tras la venta) + 1 devuelto

    def test_reembolso_total(self):
        response = self.refund(total=True)
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()['data']
        self.assertEqual(data['estadoReembolso'], 'total')
        self.assertEqual(data['totalReembolsado'], 5800)
        self.product.refresh_from_db(); self.product2.refresh_from_db()
        self.assertEqual(self.product.stock, 5)
        self.assertEqual(self.product2.stock, 10)

    def test_reembolso_total_sin_nada_pendiente_rechazado(self):
        self.assertEqual(self.refund(total=True).status_code, 201)
        response = self.refund(total=True)
        self.assertEqual(response.status_code, 400)
        self.assertIn('total', response.json()['errors'])

    def test_cantidad_mayor_a_disponible_incluyendo_previos_rechazada(self):
        self.assertEqual(self.refund(items=[self.line(self.product, 2)]).status_code, 201)
        # Quedan 2 disponibles de 4; pedir 3 mas debe rechazarse.
        response = self.refund(items=[self.line(self.product, 3)])
        self.assertEqual(response.status_code, 400)
        self.assertIn('itemsJson', response.json()['errors'])

    def test_dos_parciales_y_luego_total_sobre_lo_restante(self):
        self.assertEqual(self.refund(items=[self.line(self.product, 1)]).status_code, 201)
        self.assertEqual(self.refund(items=[self.line(self.product2, 1)]).status_code, 201)
        response = self.refund(total=True)
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()['data']
        self.assertEqual(data['estadoReembolso'], 'total')
        self.assertEqual(data['totalReembolsado'], 5800)
        self.product.refresh_from_db(); self.product2.refresh_from_db()
        self.assertEqual(self.product.stock, 5)
        self.assertEqual(self.product2.stock, 10)

    def test_monto_proporcional_con_descuento_porcentual(self):
        descuento = Descuento.objects.create(nombre='10%', tipo='porcentual', valor=10)
        libre = Producto.objects.create(codigo='PL-007', nombre='Libre', categoria=self.category, precio=1000, costo=500, stock=20)
        items = json.dumps([{'productoId': str(libre.pk), 'cantidad': 4}])
        venta = self.client.post('/api/ventas/', self.sale(itemsJson=items, descuentoId=str(descuento.pk), valorRecibido=3600), format='json').json()['data']
        self.assertEqual(venta['subtotal'], 4000)
        self.assertEqual(venta['total'], 3600)
        response = self.refund(venta['id'], [self.line(libre, 2)])
        self.assertEqual(response.status_code, 201, response.content)
        # 2000 * (3600/4000) = 1800.
        self.assertEqual(response.json()['data']['reembolsos'][0]['monto'], 1800)

    def test_monto_proporcional_con_descuento_fijo(self):
        descuento = Descuento.objects.create(nombre='Fijo 400', tipo='fijo', valor=400)
        libre = Producto.objects.create(codigo='PL-008', nombre='Libre2', categoria=self.category, precio=1000, costo=500, stock=20)
        items = json.dumps([{'productoId': str(libre.pk), 'cantidad': 4}])
        venta = self.client.post('/api/ventas/', self.sale(itemsJson=items, descuentoId=str(descuento.pk), valorRecibido=3600), format='json').json()['data']
        self.assertEqual(venta['total'], 3600)
        response = self.refund(venta['id'], [self.line(libre, 2)])
        self.assertEqual(response.status_code, 201, response.content)
        # 2000 * (3600/4000) = 1800.
        self.assertEqual(response.json()['data']['reembolsos'][0]['monto'], 1800)

    def test_suma_exacta_al_total_con_redondeo_incomodo_15_porciento(self):
        descuento = Descuento.objects.create(nombre='15%', tipo='porcentual', valor=15)
        a = Producto.objects.create(codigo='PL-010', nombre='A', categoria=self.category, precio=100, costo=50, stock=5)
        b = Producto.objects.create(codigo='PL-011', nombre='B', categoria=self.category, precio=100, costo=50, stock=5)
        c = Producto.objects.create(codigo='PL-012', nombre='C', categoria=self.category, precio=101, costo=50, stock=5)
        items = json.dumps([{'productoId': str(a.pk), 'cantidad': 1}, {'productoId': str(b.pk), 'cantidad': 1}, {'productoId': str(c.pk), 'cantidad': 1}])
        venta = self.client.post('/api/ventas/', self.sale(itemsJson=items, descuentoId=str(descuento.pk), valorRecibido=256), format='json').json()['data']
        self.assertEqual(venta['subtotal'], 301)
        self.assertEqual(venta['descuentoMonto'], 45)
        self.assertEqual(venta['total'], 256)
        response = self.refund(venta['id'], total=True)
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()['data']
        montos = sorted(i['monto'] for i in data['reembolsos'][0]['items'])
        self.assertEqual(montos, [85, 85, 86])
        self.assertEqual(sum(montos), 256)
        self.assertEqual(data['totalReembolsado'], 256)

    def test_retorna_true_sube_stock_false_no_cambia(self):
        response = self.refund(items=[self.line(self.product, 1, retorna=True), self.line(self.product2, 1, retorna=False)])
        self.assertEqual(response.status_code, 201, response.content)
        self.product.refresh_from_db(); self.product2.refresh_from_db()
        self.assertEqual(self.product.stock, 2)  # 1 + 1 devuelto
        self.assertEqual(self.product2.stock, 7)  # 7 sin cambios: no retorna

    def test_producto_sin_seguimiento_no_mueve_stock(self):
        response = self.refund(items=[self.line(self.untracked, 1, retorna=True)])
        self.assertEqual(response.status_code, 201, response.content)
        self.untracked.refresh_from_db()
        self.assertEqual(self.untracked.stock, 0)

    def test_reenvio_mismo_id_no_duplica_monto_ni_stock(self):
        refund_id = '11111111-1111-1111-1111-111111111111'
        payload = {'id': refund_id, 'itemsJson': json.dumps([self.line(self.product, 1)])}
        first = self.client.post(f'/api/ventas/{self.sale_id}/reembolsos/', payload, format='json')
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(Reembolso.objects.count(), 1)
        second = self.client.post(f'/api/ventas/{self.sale_id}/reembolsos/', payload, format='json')
        self.assertEqual(second.status_code, 200, second.content)
        self.assertEqual(Reembolso.objects.count(), 1)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 2)

    def test_reenvio_mismo_id_total_no_duplica(self):
        refund_id = '22222222-2222-2222-2222-222222222222'
        payload = {'id': refund_id, 'total': True, 'itemsJson': '[]'}
        first = self.client.post(f'/api/ventas/{self.sale_id}/reembolsos/', payload, format='json')
        self.assertEqual(first.status_code, 201, first.content)
        second = self.client.post(f'/api/ventas/{self.sale_id}/reembolsos/', payload, format='json')
        self.assertEqual(second.status_code, 200, second.content)
        self.assertEqual(Reembolso.objects.count(), 1)

    def test_reenvio_mismo_id_con_datos_distintos_rechazado(self):
        refund_id = '33333333-3333-3333-3333-333333333333'
        self.client.post(f'/api/ventas/{self.sale_id}/reembolsos/', {'id': refund_id, 'itemsJson': json.dumps([self.line(self.product, 1)])}, format='json')
        response = self.client.post(f'/api/ventas/{self.sale_id}/reembolsos/', {'id': refund_id, 'itemsJson': json.dumps([self.line(self.product, 2)])}, format='json')
        self.assertEqual(response.status_code, 409)

    def test_rollback_atomico_si_falla_a_mitad(self):
        self.product.refresh_from_db()
        stock_antes = self.product.stock
        with patch('facturacion.services.DetalleReembolso.objects.bulk_create', side_effect=RuntimeError('fallo')):
            with self.assertRaises(RuntimeError):
                self.refund(items=[self.line(self.product, 1)])
        self.assertEqual(Reembolso.objects.count(), 0)
        self.assertEqual(DetalleReembolso.objects.count(), 0)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, stock_antes)

    def test_estado_reembolso_visible_para_cajero(self):
        self.assertEqual(self.refund(items=[self.line(self.product, 1)]).status_code, 201)
        cajero = Usuario(usuario='cajero-ver', rol='cajero')
        cajero.set_password('x')
        cajero.save()
        client = APIClient()
        client.force_authenticate(user=cajero)
        response = client.get(f'/api/ventas/{self.sale_id}/')
        self.assertEqual(response.status_code, 200)
        data = response.json()['data']
        self.assertEqual(data['estadoReembolso'], 'parcial')
        self.assertEqual(len(data['reembolsos']), 1)

    def test_usuario_y_fecha_registrados(self):
        response = self.refund(items=[self.line(self.product, 1)])
        detalle = response.json()['data']['reembolsos'][0]
        self.assertEqual(detalle['usuario'], 'admin-test')
        self.assertTrue(detalle['fecha'])

    def test_putpatch_normal_sobre_venta_cerrada_sigue_dando_409_con_reembolso(self):
        self.assertEqual(self.refund(items=[self.line(self.product, 1)]).status_code, 201)
        response = self.client.patch(f'/api/ventas/{self.sale_id}/', {'metodoPago': 'Nequi'}, format='json')
        self.assertEqual(response.status_code, 409)


class ConcurrencyTests(Fixtures, TransactionTestCase):
    def test_two_buyers_cannot_oversell(self):
        payload = self.sale(4)

        def buy():
            close_old_connections()
            try:
                client = APIClient()
                client.force_authenticate(user=self.admin)
                return client.post('/api/ventas/', payload, format='json').status_code
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(lambda _: buy(), range(2)))
        self.assertEqual(sorted(statuses), [201, 400])
        self.assertEqual(self.stock(), 1)

    def test_correction_and_new_sale_cannot_oversell_together(self):
        # self.product: stock 5. Cierra una venta de 1 unidad (stock -> 4).
        closed = self.client.post('/api/ventas/', self.sale(1, valorRecibido=1000), format='json').json()['data']
        new_sale_payload = self.sale(2, valorRecibido=2000)  # pide 2 de las 4 que quedan

        def correct():
            close_old_connections()
            try:
                client = APIClient()
                client.force_authenticate(user=self.admin)
                # Sube la correccion de 1 a 3 unidades: pide 2 mas de las 4 que quedan.
                payload = {'itemsJson': json.dumps([{'productoId': str(self.product.pk), 'cantidad': 3}]),
                          'metodoPago': 'Efectivo', 'valorRecibido': 3000, 'clienteId': ''}
                return client.post(f'/api/ventas/{closed["id"]}/corregir/', payload, format='json').status_code
            finally:
                close_old_connections()

        def buy():
            close_old_connections()
            try:
                client = APIClient()
                client.force_authenticate(user=self.admin)
                return client.post('/api/ventas/', new_sale_payload, format='json').status_code
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = sorted(pool.map(lambda fn: fn(), [correct, buy]))
        # Entre los dos piden exactamente las 4 unidades disponibles (2 + 2):
        # el candado los serializa, así que ambos caben sin que el stock quede negativo.
        self.assertEqual(statuses, [200, 201])
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 0)

    def test_two_refunds_on_same_line_cannot_exceed_sold(self):
        # self.product: stock 5. Vende 4 (stock -> 1), asi que lo vendido en
        # la linea es 4: dos reembolsos concurrentes de 3 cada uno (6 en
        # total) no pueden caber los dos.
        sale = self.client.post('/api/ventas/', self.sale(4, valorRecibido=4000), format='json').json()['data']
        payload = {'itemsJson': json.dumps([{'productoId': str(self.product.pk), 'cantidad': 3, 'retornaInventario': True}])}

        def refund():
            close_old_connections()
            try:
                client = APIClient()
                client.force_authenticate(user=self.admin)
                return client.post(f'/api/ventas/{sale["id"]}/reembolsos/', payload, format='json').status_code
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = sorted(pool.map(lambda _: refund(), range(2)))
        self.assertEqual(statuses, [201, 400])
        self.product.refresh_from_db()
        # Gano exactamente una de las dos: 1 (tras la venta) + 3 devueltos = 4;
        # nunca se reembolsaron las 6 unidades pedidas entre ambas.
        self.assertEqual(self.product.stock, 4)


class AuthTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = Usuario(usuario='admin', rol='administrador')
        self.admin.set_password('admin123')
        self.admin.save()
        self.cajero = Usuario(usuario='cajero', rol='cajero')
        self.cajero.set_password('cajero123')
        self.cajero.save()
        self.category = Categoria.objects.create(nombre='Papelería')
        self.product = Producto.objects.create(codigo='PL-001', nombre='Cuaderno', categoria=self.category,
                                              precio=1000, costo=500, stock=5)
        self.provider = Proveedor.objects.create(nombre='Proveedor')

    def login(self, usuario, contrasena):
        return self.client.post('/api/auth/login/', {'usuario': usuario, 'contrasena': contrasena}, format='json')

    def token_for(self, usuario_obj):
        return self.login(usuario_obj.usuario, {self.admin: 'admin123', self.cajero: 'cajero123'}[usuario_obj]).json()['data']['token']

    def test_login_success_returns_token_and_role(self):
        response = self.login('admin', 'admin123')
        self.assertEqual(response.status_code, 200)
        data = response.json()['data']
        self.assertTrue(data['token'])
        self.assertEqual(data['usuario'], {'id': str(self.admin.pk), 'usuario': 'admin', 'rol': 'administrador'})

    def test_login_is_case_insensitive_on_username(self):
        self.assertEqual(self.login('ADMIN', 'admin123').status_code, 200)

    def test_login_wrong_password(self):
        self.assertEqual(self.login('admin', 'incorrecta').status_code, 401)

    def test_login_unknown_user(self):
        self.assertEqual(self.login('fantasma', 'x').status_code, 401)

    def test_login_rejects_missing_or_unknown_fields(self):
        self.assertEqual(self.client.post('/api/auth/login/', {'usuario': 'admin'}, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/auth/login/', {'usuario': 'admin', 'contrasena': 'admin123', 'extra': 1}, format='json').status_code, 400)

    def test_no_token_returns_401(self):
        self.assertEqual(self.client.get('/api/productos/').status_code, 401)

    def test_invalid_token_returns_401(self):
        self.client.credentials(HTTP_AUTHORIZATION='Bearer no-existe')
        self.assertEqual(self.client.get('/api/productos/').status_code, 401)

    def test_malformed_header_returns_401(self):
        self.client.credentials(HTTP_AUTHORIZATION='Token abc')
        self.assertEqual(self.client.get('/api/productos/').status_code, 401)

    def test_expired_token_returns_401(self):
        Sesion.objects.create(token='vencido', usuario=self.admin, expira_en=timezone.now() - timedelta(hours=1))
        self.client.credentials(HTTP_AUTHORIZATION='Bearer vencido')
        self.assertEqual(self.client.get('/api/productos/').status_code, 401)

    def test_logout_invalidates_token(self):
        token = self.token_for(self.admin)
        self.client.credentials(HTTP_AUTHORIZATION='Bearer ' + token)
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 200)
        self.assertEqual(self.client.post('/api/auth/logout/', {}, format='json').status_code, 200)
        self.assertEqual(self.client.get('/api/auth/me/').status_code, 401)

    def test_me_reflects_authenticated_user(self):
        self.client.credentials(HTTP_AUTHORIZATION='Bearer ' + self.token_for(self.cajero))
        response = self.client.get('/api/auth/me/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['data']['rol'], 'cajero')

    def test_unknown_resource_is_404_regardless_of_role(self):
        self.client.credentials(HTTP_AUTHORIZATION='Bearer ' + self.token_for(self.cajero))
        self.assertEqual(self.client.get('/api/desconocido/').status_code, 404)

    def test_role_permission_matrix(self):
        """Parametrizado sobre accounts.PERMISSIONS: cada combinacion recurso+
        metodo debe dar 403 para el rol no listado y nunca 403 para el listado
        (el codigo final de negocio puede variar; aqui solo se prueba el rol)."""
        detail = f'{self.product.pk}/'
        cases = [
            ('GET', 'categorias/', accounts.ROLES),
            ('POST', 'categorias/', accounts.ADMIN),
            ('DELETE', 'categorias/' + f'{self.category.pk}/', accounts.ADMIN),
            # El cajero puede LEER proveedores (elegirlos/filtrarlos al registrar un
            # faltante, 3.7); crear, editar y eliminar sigue siendo solo del administrador.
            ('GET', 'proveedores/', accounts.ROLES),
            ('POST', 'proveedores/', accounts.ADMIN),
            ('GET', 'faltantes/', accounts.ROLES),
            ('POST', 'faltantes/', accounts.ROLES),
            ('GET', 'productos/', accounts.ROLES),
            ('POST', 'productos/', accounts.ADMIN),
            ('PATCH', 'productos/' + detail, accounts.ROLES),
            ('PUT', 'productos/' + detail, accounts.ADMIN),
            ('DELETE', 'productos/' + detail, accounts.ADMIN),
            ('GET', 'clientes/', accounts.ROLES),
            ('POST', 'clientes/', accounts.ROLES),
            ('GET', 'ventas/', accounts.ROLES),
            ('POST', 'ventas/', accounts.ROLES),
            ('GET', 'compras/', accounts.ADMIN),
            ('POST', 'compras/', accounts.ADMIN),
        ]
        for method, path, allowed in cases:
            for rol, usuario_obj in (('administrador', self.admin), ('cajero', self.cajero)):
                with self.subTest(method=method, path=path, rol=rol):
                    client = APIClient()
                    client.force_authenticate(user=usuario_obj)
                    response = client.generic(method, '/api/' + path, data=b'{}', content_type='application/json')
                    if rol in allowed:
                        self.assertNotEqual(response.status_code, 403)
                    else:
                        self.assertEqual(response.status_code, 403)

    def test_cajero_cannot_change_stock_via_quick_edit(self):
        client = APIClient()
        client.force_authenticate(user=self.cajero)
        response = client.patch(f'/api/productos/{self.product.pk}/', {'stock': 999}, format='json')
        self.assertEqual(response.status_code, 403)
        self.assertIn('stock', response.json()['message'])
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 5)

    def test_cajero_can_change_price_via_quick_edit(self):
        client = APIClient()
        client.force_authenticate(user=self.cajero)
        response = client.patch(f'/api/productos/{self.product.pk}/', {'precio': 1500}, format='json')
        self.assertEqual(response.status_code, 200)
        self.product.refresh_from_db()
        self.assertEqual(self.product.precio, 1500)

    def test_cajero_solo_puede_cambiar_el_precio_en_edicion_rapida(self):
        client = APIClient()
        client.force_authenticate(user=self.cajero)
        nombre, costo = self.product.nombre, self.product.costo
        for campo, valor in [('nombre', 'Otro nombre'), ('costo', 1), ('categoriaId', str(self.product.categoria_id))]:
            response = client.patch(f'/api/productos/{self.product.pk}/', {campo: valor}, format='json')
            self.assertEqual(response.status_code, 403, campo)
            self.assertIn(campo, response.json()['message'])
        self.product.refresh_from_db()
        self.assertEqual((self.product.nombre, self.product.costo), (nombre, costo))

    def test_admin_can_change_stock(self):
        client = APIClient()
        client.force_authenticate(user=self.admin)
        response = client.patch(f'/api/productos/{self.product.pk}/', {'stock': 42}, format='json')
        self.assertEqual(response.status_code, 200)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 42)

    def test_request_log_records_authenticated_user(self):
        token = self.token_for(self.admin)
        self.client.credentials(HTTP_AUTHORIZATION='Bearer ' + token)
        self.client.get('/api/productos/')
        last = RequestLog.objects.filter(path='/api/productos/').latest('id')
        self.assertEqual(last.usuario_id, self.admin.pk)


class NormalizacionTests(SimpleTestCase):
    """RN-10: minusculas, sin tildes, espacios colapsados y plural simple."""
    def test_ejemplos_de_la_regla(self):
        casos = [('Cofia', 'cofia'), ('cofias', 'cofia'), ('COFÍAS', 'cofia'), ('  Cofía  ', 'cofia'),
                 ('colores', 'color'), ('papeles', 'papel'), ('cuadernos', 'cuaderno'), ('tijeras', 'tijera'),
                 ('Hojas   Blancas', 'hoja blanca'), ('lápiz', 'lapiz'), ('gas', 'gas'), ('', '')]
        for original, esperado in casos:
            with self.subTest(original=original):
                self.assertEqual(normalizar_nombre(original), esperado)
        self.assertEqual(normalizar_nombre(None), '')


class FaltanteTests(Fixtures, TestCase):
    """Faltantes y demanda no atendida (3.7, RF-150..155, RN-09, RN-10)."""
    def setUp(self):
        super().setUp()
        self.cajero = Usuario(usuario='cajero-falt', rol='cajero')
        self.cajero.set_password('x')
        self.cajero.save()
        self.cajero_client = APIClient()
        self.cajero_client.force_authenticate(user=self.cajero)
        self.provider2 = Proveedor.objects.create(nombre='Otro proveedor')

    def register(self, client=None, **extra):
        payload = {'tipo': 'no_registrado', 'nombre': 'Cofias', 'cantidadSolicitada': 3, **extra}
        return (client or self.client).post('/api/faltantes/', payload, format='json')

    def register_id(self, **extra):
        response = self.register(**extra)
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['data']['id']

    def resumen(self, client=None, **params):
        response = (client or self.client).get('/api/faltantes/resumen/', params)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()['data']

    def test_modelos_sin_migraciones_pendientes(self):
        # Evita repetir el caso de un modelo agregado sin su migracion.
        call_command('makemigrations', check=True, dry_run=True, stdout=io.StringIO(), verbosity=0)

    def test_registrar_no_registrado_guarda_usuario_y_nombre_normalizado(self):
        response = self.register(proveedorId=str(self.provider.pk), observacion='Pidieron azules')
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()['data']
        self.assertEqual((data['tipo'], data['nombre'], data['cantidadSolicitada'], data['estado']),
                         ('no_registrado', 'Cofias', 3, 'pendiente'))
        self.assertEqual((data['usuario'], data['proveedorId'], data['proveedorNombre'], data['productoId']),
                         ('admin-test', str(self.provider.pk), 'Proveedor', ''))
        self.assertIsNone(data['resueltoEn'])
        faltante = Faltante.objects.get(pk=data['id'])
        self.assertEqual(faltante.nombre_normalizado, 'cofia')
        # El listado tambien lo expone: el frontend lo usa para resolver los faltantes con el mismo nombre.
        self.assertEqual(data['nombreNormalizado'], 'cofia')
        listado = self.client.get('/api/faltantes/?tipo=no_registrado&estado=pendiente').json()['data']
        self.assertEqual([r['nombreNormalizado'] for r in listado], ['cofia'])
        self.assertEqual(faltante.usuario, self.admin)

    def test_registrar_agotado_copia_el_nombre_del_producto(self):
        response = self.register(tipo='agotado', productoId=str(self.product.pk), nombre='lo que sea', cantidadSolicitada=1)
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()['data']
        self.assertEqual((data['nombre'], data['productoId']), ('Cuaderno', str(self.product.pk)))

    def test_validaciones_rechazadas_sin_guardar_nada(self):
        base = {'tipo': 'no_registrado', 'nombre': 'X', 'cantidadSolicitada': 1}
        casos = [
            {'tipo': 'agotado', 'cantidadSolicitada': 1},                                    # agotado sin producto
            {'tipo': 'agotado', 'productoId': str(uuid.uuid4()), 'cantidadSolicitada': 1},   # producto inexistente
            {'tipo': 'no_registrado', 'cantidadSolicitada': 1},                              # sin nombre
            {**base, 'nombre': '   '},                                                       # nombre en blanco
            {**base, 'nombre': 'N' * 151},                                                   # nombre demasiado largo
            {**base, 'productoId': str(self.product.pk)},                                    # no registrado no lleva producto
            {**base, 'cantidadSolicitada': 0}, {**base, 'cantidadSolicitada': -1},
            {**base, 'cantidadSolicitada': 1.5}, {**base, 'cantidadSolicitada': True},
            {**base, 'cantidadSolicitada': '2'}, {**base, 'cantidadSolicitada': 2147483648},
            {**base, 'tipo': 'otro'},
            {**base, 'proveedorId': str(uuid.uuid4())},                                      # proveedor inexistente
            {**base, 'observacion': 'o' * 301},
            {**base, 'extra': 1},                                                            # campo desconocido
        ]
        for payload in casos:
            with self.subTest(payload=payload):
                self.assertEqual(self.client.post('/api/faltantes/', payload, format='json').status_code, 400)
        self.assertEqual(Faltante.objects.count(), 0)

    def test_registro_es_idempotente_por_id(self):
        faltante_id = str(uuid.uuid4())
        self.assertEqual(self.register(id=faltante_id).status_code, 201)
        second = self.register(id=faltante_id)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()['data']['id'], faltante_id)
        self.assertEqual(Faltante.objects.count(), 1)
        self.assertEqual(self.register(id=faltante_id, cantidadSolicitada=9).status_code, 409)
        self.assertEqual(Faltante.objects.count(), 1)

    def test_sin_autenticacion_401(self):
        client = APIClient()
        self.assertEqual(client.get('/api/faltantes/').status_code, 401)
        self.assertEqual(client.post('/api/faltantes/', {}, format='json').status_code, 401)

    def test_ambos_roles_registran_listan_resumen_y_resuelven(self):
        created = self.register(self.cajero_client)
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(created.json()['data']['usuario'], 'cajero-falt')
        faltante_id = created.json()['data']['id']
        self.assertEqual(self.cajero_client.get('/api/faltantes/').status_code, 200)
        self.assertEqual(len(self.resumen(self.cajero_client)), 1)
        resolved = self.cajero_client.post(f'/api/faltantes/{faltante_id}/resolver/', {}, format='json')
        self.assertEqual(resolved.status_code, 200, resolved.content)
        self.assertEqual(resolved.json()['data']['estado'], 'resuelto')
        self.assertEqual(resolved.json()['data']['resueltoPor'], 'cajero-falt')

    def test_cajero_lee_proveedores_pero_no_los_modifica(self):
        self.assertEqual(self.cajero_client.get('/api/proveedores/').status_code, 200)
        url = f'/api/proveedores/{self.provider.pk}/'
        for method, path in (('post', '/api/proveedores/'), ('put', url), ('patch', url), ('delete', url)):
            with self.subTest(method=method):
                self.assertEqual(getattr(self.cajero_client, method)(path, {'nombre': 'X'}, format='json').status_code, 403)
        self.assertTrue(Proveedor.objects.filter(pk=self.provider.pk).exists())

    def test_faltantes_no_se_editan_ni_se_eliminan(self):
        faltante_id = self.register_id()
        url = f'/api/faltantes/{faltante_id}/'
        for method in ('put', 'patch', 'delete'):
            with self.subTest(method=method):
                self.assertIn(getattr(self.client, method)(url, {'cantidadSolicitada': 9}, format='json').status_code, (404, 405))
        self.assertEqual(Faltante.objects.get(pk=faltante_id).cantidad_solicitada, 3)

    def test_listado_con_filtros_y_orden(self):
        now = timezone.now()
        a = self.register_id(tipo='agotado', productoId=str(self.product.pk), cantidadSolicitada=1, proveedorId=str(self.provider.pk))
        b = self.register_id(nombre='Cofias', proveedorId=str(self.provider2.pk))
        c = self.register_id(nombre='Tijeras')
        Faltante.objects.filter(pk=a).update(fecha=now - timedelta(days=10))
        Faltante.objects.filter(pk=b).update(fecha=now - timedelta(days=3))
        self.assertEqual(self.client.post(f'/api/faltantes/{b}/resolver/', {}, format='json').status_code, 200)

        def listado(**params):
            response = self.client.get('/api/faltantes/', params)
            self.assertEqual(response.status_code, 200, response.content)
            return [row['id'] for row in response.json()['data']]

        def dia(moment):
            return timezone.localtime(moment).date().isoformat()

        self.assertEqual(listado(), [c, b, a])  # mas reciente primero
        self.assertEqual(set(listado(tipo='agotado')), {a})
        self.assertEqual(set(listado(tipo='no_registrado')), {b, c})
        self.assertEqual(set(listado(proveedorId=str(self.provider2.pk))), {b})
        self.assertEqual(set(listado(estado='resuelto')), {b})
        self.assertEqual(set(listado(estado='pendiente')), {a, c})
        self.assertEqual(set(listado(desde=dia(now - timedelta(days=5)))), {b, c})
        self.assertEqual(set(listado(hasta=dia(now - timedelta(days=5)))), {a})
        self.assertEqual(set(listado(desde=dia(now - timedelta(days=3)), hasta=dia(now - timedelta(days=3)))), {b})  # rango de un dia, inclusive
        self.assertEqual(set(listado(tipo='no_registrado', estado='pendiente')), {c})

    def test_filtros_invalidos_son_400(self):
        for params in ({'tipo': 'otro'}, {'estado': 'x'}, {'proveedorId': 'abc'}, {'desde': '2026-13-45'},
                       {'desde': '2026-02-01', 'hasta': '2026-01-01'}, {'extra': '1'}):
            with self.subTest(params=params):
                self.assertEqual(self.client.get('/api/faltantes/', params).status_code, 400)
        self.assertEqual(self.client.get('/api/faltantes/resumen/', {'estado': 'pendiente'}).status_code, 400)

    def test_resolver_registra_quien_y_cuando_y_es_idempotente(self):
        faltante_id = self.register_id()
        first = self.client.post(f'/api/faltantes/{faltante_id}/resolver/', {}, format='json')
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual((first.json()['data']['estado'], first.json()['data']['resueltoPor']), ('resuelto', 'admin-test'))
        self.assertIsNotNone(first.json()['data']['resueltoEn'])
        stamp = Faltante.objects.get(pk=faltante_id).resuelto_en
        second = self.cajero_client.post(f'/api/faltantes/{faltante_id}/resolver/', {}, format='json')
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()['data']['resueltoPor'], 'admin-test')  # no cambia al primero que lo resolvio
        self.assertEqual(Faltante.objects.get(pk=faltante_id).resuelto_en, stamp)

    def test_resolver_inexistente_es_404(self):
        self.assertEqual(self.client.post(f'/api/faltantes/{uuid.uuid4()}/resolver/', {}, format='json').status_code, 404)

    def test_rn09_no_afecta_inventario_ventas_ni_compras(self):
        stock, ventas, compras = self.stock(), Venta.objects.count(), Compra.objects.count()
        faltante_id = self.register_id(tipo='agotado', productoId=str(self.product.pk), cantidadSolicitada=4)
        self.register_id(nombre='Cofias')
        self.assertEqual(self.client.post(f'/api/faltantes/{faltante_id}/resolver/', {}, format='json').status_code, 200)
        self.assertEqual((self.stock(), Venta.objects.count(), Compra.objects.count()), (stock, ventas, compras))

    def test_resumen_agrupa_por_nombre_normalizado(self):
        for nombre, cantidad in (('cofia', 2), ('Cofias', 3), ('COFÍA', 1)):
            self.register_id(nombre=nombre, cantidadSolicitada=cantidad)
        self.register_id(nombre='Tijeras', cantidadSolicitada=7)
        rows = self.resumen()
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]['nombreNormalizado'], 'cofia')  # el mas solicitado primero
        self.assertEqual((rows[0]['vecesSolicitado'], rows[0]['cantidadTotal'], rows[0]['estado']), (3, 6, 'pendiente'))
        ultima = Faltante.objects.filter(nombre_normalizado='cofia').order_by('-fecha').first()
        self.assertEqual(rows[0]['ultimaFecha'], ultima.fecha.isoformat())
        self.assertEqual((rows[1]['nombreNormalizado'], rows[1]['vecesSolicitado'], rows[1]['cantidadTotal']), ('tijera', 1, 7))

    def test_resumen_agrupa_producto_existente_por_id_y_por_proveedor(self):
        pid = str(self.product.pk)
        self.register_id(tipo='agotado', productoId=pid, cantidadSolicitada=1)
        self.register_id(tipo='agotado', productoId=pid, cantidadSolicitada=2)
        self.register_id(tipo='agotado', productoId=pid, cantidadSolicitada=4, proveedorId=str(self.provider.pk))
        rows = self.resumen()
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(r['productoId'] == pid and r['nombre'] == 'Cuaderno' for r in rows))
        sin_proveedor = next(r for r in rows if not r['proveedorId'])
        con_proveedor = next(r for r in rows if r['proveedorId'])
        self.assertEqual((sin_proveedor['vecesSolicitado'], sin_proveedor['cantidadTotal']), (2, 3))
        self.assertEqual((con_proveedor['vecesSolicitado'], con_proveedor['cantidadTotal'], con_proveedor['proveedorNombre']), (1, 4, 'Proveedor'))

    def test_resumen_solo_pendientes_y_con_filtros(self):
        self.register_id(nombre='cofia')
        resuelto = self.register_id(nombre='cofias')
        self.register_id(tipo='agotado', productoId=str(self.product.pk), cantidadSolicitada=1)
        self.client.post(f'/api/faltantes/{resuelto}/resolver/', {}, format='json')
        rows = self.resumen()
        self.assertEqual({r['nombreNormalizado']: r['vecesSolicitado'] for r in rows}, {'cofia': 1, 'cuaderno': 1})
        self.assertEqual([r['nombreNormalizado'] for r in self.resumen(tipo='agotado')], ['cuaderno'])
        self.assertEqual(self.resumen(proveedorId=str(self.provider.pk)), [])
        # El servicio reutilizable (para reportes) tambien puede incluir los resueltos.
        todos = {r['nombreNormalizado']: r for r in services.resumen_faltantes(solo_pendientes=False)}
        self.assertEqual((todos['cofia']['vecesSolicitado'], todos['cofia']['estado']), (2, 'pendiente'))

    def test_eliminar_proveedor_con_faltantes_da_409(self):
        self.register_id(proveedorId=str(self.provider.pk))
        self.assertEqual(self.client.delete(f'/api/proveedores/{self.provider.pk}/').status_code, 409)
        self.assertTrue(Proveedor.objects.filter(pk=self.provider.pk).exists())

    def test_eliminar_producto_con_faltantes_conserva_el_faltante_con_su_nombre(self):
        faltante_id = self.register_id(tipo='agotado', productoId=str(self.product.pk), cantidadSolicitada=2)
        self.assertEqual(self.client.delete(f'/api/productos/{self.product.pk}/').status_code, 200)
        faltante = Faltante.objects.get(pk=faltante_id)
        self.assertIsNone(faltante.producto)
        self.assertEqual(faltante.nombre, 'Cuaderno')
        row = self.client.get('/api/faltantes/').json()['data'][0]
        self.assertEqual((row['nombre'], row['productoId']), ('Cuaderno', ''))
        self.assertEqual(self.resumen()[0]['nombre'], 'Cuaderno')


class ReporteTests(Fixtures, TestCase):
    """Reportes basicos (3.10, RF-160/161): solo administrador, solo lectura."""
    def setUp(self):
        super().setUp()
        Producto.objects.filter(pk=self.product.pk).update(stock=100)
        self.product2 = Producto.objects.create(codigo='PL-002', nombre='Lapicero', categoria=self.category,
                                                precio=500, costo=200, stock=100)
        self.cajero = Usuario(usuario='cajero-rep', rol='cajero')
        self.cajero.set_password('x')
        self.cajero.save()
        self.cajero_client = APIClient()
        self.cajero_client.force_authenticate(user=self.cajero)
        self.today = timezone.localdate()

    def local(self, day, hour=12, minute=0, second=0):
        naive = datetime.combine(day, datetime.min.time()).replace(hour=hour, minute=minute, second=second)
        return timezone.make_aware(naive).isoformat()

    def make_sale(self, qty=2, metodo='Efectivo', product=None, fecha=None, **extra):
        product = product or self.product
        total = qty * product.precio
        payload = {'fecha': fecha or self.local(self.today), 'estado': 'cerrada', 'clienteId': '', 'metodoPago': metodo,
                   'valorRecibido': 0 if metodo == 'Debe' else total,
                   'itemsJson': json.dumps([{'productoId': str(product.pk), 'cantidad': qty}]), **extra}
        if metodo == 'Debe':
            payload['clienteId'] = str(self.customer.pk)
        response = self.client.post('/api/ventas/', payload, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()['data']

    def report(self, name, client=None, **params):
        return (client or self.client).get(f'/api/reportes/{name}/', params)

    def data(self, name, **params):
        response = self.report(name, **params)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()['data']

    def day(self, **kw):
        return {'desde': self.today.isoformat(), 'hasta': self.today.isoformat(), **kw}

    def test_solo_administrador_y_requiere_autenticacion(self):
        for name in ('ventas', 'productos-mas-vendidos', 'compras', 'faltantes'):
            with self.subTest(name=name):
                self.assertEqual(self.report(name, client=self.cajero_client, **self.day()).status_code, 403)
                self.assertEqual(self.report(name, client=APIClient(), **self.day()).status_code, 401)
                self.assertEqual(self.report(name, **self.day()).status_code, 200)

    def test_ventas_totales_por_metodo_y_reembolsos(self):
        efectivo = self.make_sale(2, 'Efectivo')            # 2000
        self.make_sale(1, 'Nequi')                          # 1000
        self.make_sale(1, 'Debe')                           # 1000 (cuenta como vendida)
        self.make_sale(3, 'Efectivo', estado='abierta', valorRecibido=0)  # abierta: no cuenta
        refund = self.client.post(f"/api/ventas/{efectivo['id']}/reembolsos/", {'itemsJson': json.dumps(
            [{'productoId': str(self.product.pk), 'cantidad': 1, 'retornaInventario': True}])}, format='json')
        self.assertEqual(refund.status_code, 201, refund.content)
        data = self.data('ventas', **self.day())
        self.assertEqual((data['numeroVentas'], data['totalVendido'], data['totalReembolsado'], data['totalNeto']), (3, 4000, 1000, 3000))
        by = {row['metodoPago']: row for row in data['porMetodoPago']}
        self.assertEqual([row['metodoPago'] for row in data['porMetodoPago']], ['Efectivo', 'Nequi', 'Debe'])
        self.assertEqual((by['Efectivo']['numeroVentas'], by['Efectivo']['totalVendido'], by['Efectivo']['totalReembolsado'], by['Efectivo']['totalNeto']), (1, 2000, 1000, 1000))
        self.assertEqual((by['Nequi']['totalVendido'], by['Nequi']['totalNeto']), (1000, 1000))
        self.assertEqual((by['Debe']['numeroVentas'], by['Debe']['totalVendido']), (1, 1000))
        self.assertEqual(sum(row['totalNeto'] for row in data['porMetodoPago']), data['totalNeto'])

    def test_ventas_descuentos_se_suman(self):
        discount = Descuento.objects.create(nombre='10%', tipo='porcentual', valor=10)
        self.make_sale(2, 'Efectivo', descuentoId=str(discount.pk), valorRecibido=1800)  # 2000 - 200
        data = self.data('ventas', **self.day())
        self.assertEqual((data['totalVendido'], data['totalDescuentos']), (1800, 200))

    def test_ventas_limites_del_rango_son_dias_locales_inclusive(self):
        ayer, manana = self.today - timedelta(days=1), self.today + timedelta(days=1)
        self.make_sale(1, fecha=self.local(ayer, 23, 59, 59))     # ayer 23:59:59 -> fuera de hoy
        self.make_sale(1, fecha=self.local(self.today, 0, 0, 0))  # hoy 00:00:00 -> dentro
        self.make_sale(1, fecha=self.local(self.today, 23, 59, 59))  # hoy 23:59:59 -> dentro
        self.make_sale(1, fecha=self.local(manana, 0, 0, 0))      # manana 00:00:00 -> fuera
        self.assertEqual(self.data('ventas', **self.day())['numeroVentas'], 2)
        self.assertEqual(self.data('ventas', desde=ayer.isoformat(), hasta=manana.isoformat())['numeroVentas'], 4)
        self.assertEqual(self.data('ventas', desde=ayer.isoformat(), hasta=ayer.isoformat())['numeroVentas'], 1)

    def test_ventas_rango_vacio_devuelve_ceros(self):
        data = self.data('ventas', **self.day())
        self.assertEqual((data['numeroVentas'], data['totalVendido'], data['totalNeto']), (0, 0, 0))
        self.assertEqual(len(data['porMetodoPago']), 3)
        self.assertTrue(all(row['totalVendido'] == 0 for row in data['porMetodoPago']))

    def test_rangos_invalidos_son_400(self):
        hoy = self.today.isoformat()
        casos = [{}, {'desde': hoy}, {'hasta': hoy}, {'desde': 'abc', 'hasta': hoy}, {'desde': '2026-13-45', 'hasta': hoy},
                 {'desde': hoy, 'hasta': (self.today - timedelta(days=1)).isoformat()}, {**self.day(), 'extra': '1'}]
        for name in ('ventas', 'compras', 'productos-mas-vendidos'):
            for params in casos:
                with self.subTest(name=name, params=params):
                    self.assertEqual(self.report(name, **params).status_code, 400)
        self.assertEqual(self.report('ventas', **self.day(limite='5')).status_code, 400)  # ventas no acepta limite

    def test_productos_mas_vendidos_ordena_por_unidades_netas(self):
        self.make_sale(2, product=self.product)       # Cuaderno x2
        big = self.make_sale(1, product=self.product2)  # Lapicero x1
        self.make_sale(4, product=self.product2)      # Lapicero x4 -> 5 en total
        rows = self.data('productos-mas-vendidos', **self.day())['productos']
        self.assertEqual([r['nombre'] for r in rows], ['Lapicero', 'Cuaderno'])
        self.assertEqual((rows[0]['unidadesVendidas'], rows[0]['unidadesNetas'], rows[0]['totalProductos']), (5, 5, 2500))
        self.assertEqual((rows[1]['codigo'], rows[1]['unidadesVendidas'], rows[1]['totalProductos']), ('PL-001', 2, 2000))
        refund = self.client.post(f"/api/ventas/{big['id']}/reembolsos/", {'itemsJson': json.dumps(
            [{'productoId': str(self.product2.pk), 'cantidad': 1, 'retornaInventario': True}])}, format='json')
        self.assertEqual(refund.status_code, 201, refund.content)
        rows = self.data('productos-mas-vendidos', **self.day())['productos']
        self.assertEqual((rows[0]['nombre'], rows[0]['unidadesVendidas'], rows[0]['unidadesReembolsadas'], rows[0]['unidadesNetas']), ('Lapicero', 5, 1, 4))

    def test_productos_totalmente_reembolsados_no_aparecen_y_limite(self):
        sale = self.make_sale(1, product=self.product2)
        self.make_sale(1, product=self.product)
        self.client.post(f"/api/ventas/{sale['id']}/reembolsos/", {'itemsJson': json.dumps(
            [{'productoId': str(self.product2.pk), 'cantidad': 1, 'retornaInventario': True}])}, format='json')
        rows = self.data('productos-mas-vendidos', **self.day())['productos']
        self.assertEqual([r['nombre'] for r in rows], ['Cuaderno'])
        self.make_sale(1, product=self.product2)
        self.assertEqual(len(self.data('productos-mas-vendidos', **self.day(limite='1'))['productos']), 1)
        self.assertEqual(self.data('productos-mas-vendidos', **self.day())['limite'], 10)
        for bad in ('0', '51', 'abc', '-1', '1.5', ''):
            with self.subTest(limite=bad):
                self.assertEqual(self.report('productos-mas-vendidos', **self.day(limite=bad)).status_code, 400)

    def test_productos_mas_vendidos_solo_cuenta_ventas_cerradas_del_rango(self):
        self.make_sale(1, estado='abierta', valorRecibido=0)
        self.make_sale(1, fecha=self.local(self.today - timedelta(days=3)))
        self.assertEqual(self.data('productos-mas-vendidos', **self.day())['productos'], [])

    def test_compras_totales_y_por_proveedor(self):
        other = Proveedor.objects.create(nombre='Otro')
        def buy(provider, fecha, qty, costo):
            response = self.client.post('/api/compras/', {'fecha': fecha.isoformat(), 'proveedorId': str(provider.pk),
                'itemsJson': json.dumps([{'productoId': str(self.product.pk), 'cantidad': qty, 'costo': costo}])}, format='json')
            self.assertEqual(response.status_code, 201, response.content)
        buy(self.provider, self.today, 2, 600)                              # 1200
        buy(self.provider, self.today, 1, 300)                              # 300
        buy(other, self.today, 5, 400)                                      # 2000
        buy(self.provider, self.today - timedelta(days=10), 9, 100)         # fuera del rango
        data = self.data('compras', **self.day())
        self.assertEqual((data['numeroCompras'], data['totalComprado']), (3, 3500))
        self.assertEqual([(g['proveedorNombre'], g['numeroCompras'], g['totalComprado']) for g in data['porProveedor']], [('Otro', 1, 2000), ('Proveedor', 2, 1500)])
        self.assertEqual(len(data['compras']), 3)
        self.assertEqual(self.data('compras', desde=(self.today - timedelta(days=10)).isoformat(), hasta=self.today.isoformat())['numeroCompras'], 4)
        self.assertEqual(self.data('compras', desde=(self.today + timedelta(days=1)).isoformat(), hasta=(self.today + timedelta(days=2)).isoformat())['numeroCompras'], 0)

    def test_faltantes_frecuentes_agrupa_incluye_resueltos_y_no_separa_proveedor(self):
        def falta(nombre, cantidad=1, **extra):
            response = self.client.post('/api/faltantes/', {'tipo': 'no_registrado', 'nombre': nombre, 'cantidadSolicitada': cantidad, **extra}, format='json')
            self.assertEqual(response.status_code, 201, response.content)
            return response.json()['data']['id']
        falta('Cofia', 2, proveedorId=str(self.provider.pk))
        resuelto = falta('cofias', 3)
        falta('COFÍAS', 1, proveedorId=str(self.provider.pk))
        falta('Tijeras', 9)
        self.client.post(f'/api/faltantes/{resuelto}/resolver/', {}, format='json')
        agotado = self.client.post('/api/faltantes/', {'tipo': 'agotado', 'productoId': str(self.product.pk), 'cantidadSolicitada': 1}, format='json')
        self.assertEqual(agotado.status_code, 201)
        rows = self.data('faltantes')['faltantes']
        self.assertEqual([r['nombreNormalizado'] for r in rows], ['cofia', 'cuaderno', 'tijera'])
        cofia = rows[0]
        self.assertEqual((cofia['vecesSolicitado'], cofia['cantidadTotal'], cofia['estado']), (3, 6, 'pendiente'))
        self.assertNotIn('proveedorId', cofia)
        self.assertEqual(len(self.data('faltantes', limite='2')['faltantes']), 2)
        self.assertIsNone(self.data('faltantes')['desde'])
        # con rango: hoy los incluye; el dia anterior no.
        self.assertEqual(len(self.data('faltantes', **self.day())['faltantes']), 3)
        ayer = (self.today - timedelta(days=1)).isoformat()
        self.assertEqual(self.data('faltantes', desde=ayer, hasta=ayer)['faltantes'], [])
        for bad in ({'desde': 'x'}, {'desde': self.today.isoformat(), 'hasta': ayer}, {'limite': '0'}, {'extra': '1'}):
            with self.subTest(params=bad):
                self.assertEqual(self.report('faltantes', **bad).status_code, 400)

    def test_reportes_no_modifican_nada(self):
        self.make_sale(2)
        before = (self.stock(), Venta.objects.count(), Compra.objects.count(), Faltante.objects.count(), Reembolso.objects.count())
        for name in ('ventas', 'productos-mas-vendidos', 'compras', 'faltantes'):
            self.data(name, **self.day())
        self.assertEqual((self.stock(), Venta.objects.count(), Compra.objects.count(), Faltante.objects.count(), Reembolso.objects.count()), before)

    def test_reportes_solo_aceptan_get(self):
        # La matriz de permisos solo tiene fila GET para 'reportes': cualquier otro metodo se rechaza (403).
        for method in ('post', 'put', 'patch', 'delete'):
            with self.subTest(method=method):
                self.assertIn(getattr(self.client, method)('/api/reportes/ventas/', {}, format='json').status_code, (403, 405))

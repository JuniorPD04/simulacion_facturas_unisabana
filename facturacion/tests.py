import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from unittest.mock import patch
from django.db import close_old_connections
from django.http import HttpResponse, JsonResponse
from django.test import TestCase, TransactionTestCase, RequestFactory
from django.utils import timezone
from django.core.management import call_command
from rest_framework.test import APIClient
from .middleware import SanitizeIdsMiddleware
from .models import Categoria, Producto, Cliente, Proveedor, Venta, Compra, RequestLog


class Fixtures:
    def setUp(self):
        self.client = APIClient()
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


class ConcurrencyTests(Fixtures, TransactionTestCase):
    def test_two_buyers_cannot_oversell(self):
        payload = self.sale(4)

        def buy():
            close_old_connections()
            try:
                return APIClient().post('/api/ventas/', payload, format='json').status_code
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(lambda _: buy(), range(2)))
        self.assertEqual(sorted(statuses), [201, 400])
        self.assertEqual(self.stock(), 1)
        self.assertEqual(Venta.objects.count(), 1)

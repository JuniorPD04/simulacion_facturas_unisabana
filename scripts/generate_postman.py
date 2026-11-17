"""Genera la colección local reproducible de la actividad 10 (sin credenciales)."""
import json
from pathlib import Path

items = []


def request(name, method, path, status=200, body=None, tests=(), pre=(), auth=True, token_var='token'):
    events = [{'listen': 'test', 'script': {'type': 'text/javascript', 'exec': [
        f'pm.test("HTTP {status}", () => pm.response.to.have.status({status}));',
        'const result = pm.response.json();', *tests]}}]
    if pre:
        events.insert(0, {'listen': 'prerequest', 'script': {'type': 'text/javascript', 'exec': list(pre)}})
    header = [{'key': 'Authorization', 'value': 'Bearer {{' + token_var + '}}'}] if auth else []
    spec = {'method': method, 'header': header, 'url': '{{baseUrl}}/api/' + path}
    if body is not None:
        spec['header'] = header + [{'key': 'Content-Type', 'value': 'application/json'}]
        spec['body'] = {'mode': 'raw', 'raw': json.dumps(body, ensure_ascii=False), 'options': {'raw': {'language': 'json'}}}
    items.append({'name': name, 'request': spec, 'event': events})


# Todas las demas solicitudes son de administrador (crean proveedores, compras,
# etc.); por eso el login inicial usa ese rol. AuthTests en facturacion/tests.py
# cubre la matriz de roles con mas detalle.
request('00 Login administrador', 'POST', 'auth/login/', body={'usuario': 'admin', 'contrasena': 'admin123'}, auth=False, tests=[
    'pm.test("Devuelve token y rol", () => { pm.expect(result.data.token).to.be.a("string"); pm.expect(result.data.usuario.rol).to.equal("administrador"); });',
    'pm.collectionVariables.set("token", result.data.token);'])
request('00b Sin token es 401', 'GET', 'productos/', 401, auth=False)
request('01 Salud PostgreSQL 18', 'GET', 'health/', tests=[
    r'pm.test("PostgreSQL 18", () => pm.expect(result.data.version).to.match(/^18\./));'])
request('02 GET productos sin campos _id', 'GET', 'productos/', tests=[
    'function check(value) { if (Array.isArray(value)) value.forEach(check); else if (value && typeof value === "object") Object.entries(value).forEach(([k,v]) => { pm.expect(k.endsWith("_id")).to.equal(false); check(v); }); }',
    'pm.test("Sanitizacion recursiva", () => check(result));'])
request('03 Crear categoria', 'POST', 'categorias/', 201, {'nombre': 'Postman {{runId}}'}, tests=[
    'pm.collectionVariables.set("categoryId", result.data.id);'], pre=[
    'pm.collectionVariables.set("runId", pm.variables.replaceIn("{{$guid}}"));'])
request('04 Validator campo faltante', 'POST', 'clientes/', 400, {}, tests=[
    'pm.test("Error por campo", () => pm.expect(result.errors).to.have.property("nombre"));'])
request('05 Validator tipo incorrecto', 'POST', 'clientes/', 400, {'nombre': 123})
request('06 Validator correo', 'POST', 'clientes/', 400, {'nombre': 'Ana', 'correo': 'invalido'})
product = {'nombre': 'Cuaderno Postman', 'codigo': 'PM-{{runId}}', 'categoriaId': '{{categoryId}}',
           'precio': 1000, 'costo': 500, 'stock': 10, 'seguimientoInventario': True}
request('07 Crear producto', 'POST', 'productos/', 201, product, tests=[
    'pm.collectionVariables.set("productId", result.data.id);',
    'pm.test("Relacion publica conservada", () => pm.expect(result.data.categoriaId).to.equal(pm.collectionVariables.get("categoryId")));',
    'pm.test("Relacion interna eliminada", () => pm.expect(result.data).not.to.have.property("categoria_id"));'])
request('08 PUT invalido', 'PUT', 'productos/{{productId}}/', 400, {**product, 'precio': True})
request('09 PUT valido', 'PUT', 'productos/{{productId}}/', 200, product)
request('10 Crear proveedor', 'POST', 'proveedores/', 201, {'nombre': 'Proveedor {{runId}}'}, tests=[
    'pm.collectionVariables.set("providerId", result.data.id);'])
request('10a Crear descuento porcentual', 'POST', 'descuentos/', 201, {'nombre': 'Postman {{runId}}', 'tipo': 'porcentual', 'valor': 10}, tests=[
    'pm.collectionVariables.set("discountId", result.data.id);',
    'pm.test("Tipo y valor guardados", () => { pm.expect(result.data.tipo).to.equal("porcentual"); pm.expect(result.data.valor).to.equal(10); });'])
request('10b Validator descuento porcentual > 100', 'POST', 'descuentos/', 400, {'nombre': 'X', 'tipo': 'porcentual', 'valor': 150})
request('10c Validator descuento fijo <= 0', 'POST', 'descuentos/', 400, {'nombre': 'X', 'tipo': 'fijo', 'valor': 0})
request('10d PATCH descuento (cajero vera solo GET; aqui admin)', 'PATCH', 'descuentos/{{discountId}}/', 200, {'valor': 15}, tests=[
    'pm.test("Valor actualizado", () => pm.expect(result.data.valor).to.equal(15));'])
lines = json.dumps([{'productoId': '{{productId}}', 'cantidad': 2}])
sale = {'fecha': '{{saleDate}}', 'estado': 'abierta', 'metodoPago': 'Efectivo', 'valorRecibido': 5000,
        'clienteId': '', 'descuentoId': '{{discountId}}', 'itemsJson': lines}
request('11 Venta abierta con descuento', 'POST', 'ventas/', 201, sale, tests=[
    'pm.collectionVariables.set("saleId", result.data.id);',
    'pm.test("Descuento ya calculado en el borrador", () => { pm.expect(result.data.subtotal).to.equal(2000); pm.expect(result.data.descuentoMonto).to.equal(300); pm.expect(result.data.total).to.equal(1700); });'], pre=[
    'pm.collectionVariables.set("saleDate", new Date().toISOString());'])
request('12 Stock intacto en borrador', 'GET', 'productos/{{productId}}/', tests=[
    'pm.test("Stock 10", () => pm.expect(result.data.stock).to.equal(10));'])
request('13 PUT cerrar venta (RF-18/RN-08: aplicar+cerrar en un solo paso)', 'PUT', 'ventas/{{saleId}}/', body={**sale, 'estado': 'cerrada'}, tests=[
    'pm.test("Total con descuento calculado en servidor", () => { pm.expect(result.data.subtotal).to.equal(2000); pm.expect(result.data.descuentoNombre).to.be.a("string").and.not.empty; pm.expect(result.data.descuentoMonto).to.equal(300); pm.expect(result.data.total).to.equal(1700); });'])
request('14 Stock descontado (el descuento no toca stock)', 'GET', 'productos/{{productId}}/', tests=[
    'pm.test("Stock 8", () => pm.expect(result.data.stock).to.equal(8));'])
request('15 Reintentar mismo cierre', 'PUT', 'ventas/{{saleId}}/', body={**sale, 'estado': 'cerrada'})
request('16 Reintento no duplica stock', 'GET', 'productos/{{productId}}/', tests=[
    'pm.test("Stock sigue en 8", () => pm.expect(result.data.stock).to.equal(8));'])
request('16a DELETE descuento usado no esta bloqueado (3.9: excepcion a la regla de 409)', 'DELETE', 'descuentos/{{discountId}}/', 200)
request('16b La venta cerrada conserva su copia del descuento tras eliminarlo', 'GET', 'ventas/{{saleId}}/', tests=[
    'pm.test("Copia intacta, FK en null", () => { pm.expect(result.data.descuentoId).to.equal(""); pm.expect(result.data.descuentoMonto).to.equal(300); pm.expect(result.data.total).to.equal(1700); });'])
request('17 Compra repone stock', 'POST', 'compras/', 201, {
    'fecha': '{{purchaseDate}}', 'proveedorId': '{{providerId}}',
    'itemsJson': json.dumps([{'productoId': '{{productId}}', 'cantidad': 3, 'costo': 600}])}, pre=[
    'pm.collectionVariables.set("purchaseDate", new Date().toISOString().slice(0,10));'])
request('18 Inventario tras compra', 'GET', 'productos/{{productId}}/', tests=[
    'pm.test("Stock 11 y costo 600", () => { pm.expect(result.data.stock).to.equal(11); pm.expect(result.data.costo).to.equal(600); });'])
request('19 Sanitizacion anidada', 'GET', 'demo/sanitizacion/', tests=[
    'pm.test("Elimina *_id", () => { pm.expect(result.data).not.to.have.property("cliente_id"); pm.expect(result.data.nested).to.deep.equal({nombre:"Papel y Luna"}); pm.expect(result.data.items[0]).to.deep.equal({cantidad:2,productoId:"publico"}); });'])
request('20 DELETE protege venta cerrada', 'DELETE', 'ventas/{{saleId}}/', 409)

# Correccion de ventas cerradas (3.4/3.9, RF-26/31/43/50/51/52, RN-02/06/07).
request('20a Login cajero', 'POST', 'auth/login/', body={'usuario': 'cajero', 'contrasena': 'cajero123'}, auth=False, tests=[
    'pm.collectionVariables.set("cajeroToken", result.data.token);'])
request('20b Cajero no puede corregir (403)', 'POST', 'ventas/{{saleId}}/corregir/', 403, {
    'itemsJson': json.dumps([{'productoId': '{{productId}}', 'cantidad': 4}]), 'clienteId': '', 'metodoPago': 'Nequi', 'valorRecibido': 0},
    token_var='cajeroToken')
request('20c Crear cliente para la correccion', 'POST', 'clientes/', 201, {'nombre': 'Correccion {{runId}}'}, tests=[
    'pm.collectionVariables.set("correctionClientId", result.data.id);'])
correction_payload = {'itemsJson': json.dumps([{'productoId': '{{productId}}', 'cantidad': 4}]),
                       'clienteId': '{{correctionClientId}}', 'metodoPago': 'Nequi', 'valorRecibido': 0}
request('20d Admin corrige cantidad y cliente (descuento ya eliminado del catalogo en 16a)', 'POST', 'ventas/{{saleId}}/corregir/', 200, correction_payload, tests=[
    'pm.test("Usa la copia congelada del descuento (15%, no el 10% original ni el catalogo que ya no existe)", () => { pm.expect(result.data.subtotal).to.equal(4000); pm.expect(result.data.descuentoMonto).to.equal(600); pm.expect(result.data.total).to.equal(3400); });',
    'pm.test("Trazabilidad", () => { pm.expect(result.data.corregida).to.equal(true); pm.expect(result.data.corregidaPor).to.equal("admin"); });',
    'pm.test("Cliente actualizado y id conservado", () => { pm.expect(result.data.clienteId).to.equal(pm.collectionVariables.get("correctionClientId")); pm.expect(result.data.id).to.equal(pm.collectionVariables.get("saleId")); });'])
request('20e Stock ajustado por la diferencia (+2 de la correccion)', 'GET', 'productos/{{productId}}/', tests=[
    'pm.test("Stock 9 (11 - 2)", () => pm.expect(result.data.stock).to.equal(9));'])
request('20f Stock insuficiente rechaza toda la correccion (sin cambios parciales)', 'POST', 'ventas/{{saleId}}/corregir/', 400, {
    **correction_payload, 'itemsJson': json.dumps([{'productoId': '{{productId}}', 'cantidad': 999999}])}, tests=[
    'pm.test("Nombra el producto sin stock", () => pm.expect(result.errors.stock).to.include("Cuaderno Postman"));'])
request('20g Rechazo anterior no dejo cambios parciales', 'GET', 'productos/{{productId}}/', tests=[
    'pm.test("Stock sigue en 9", () => pm.expect(result.data.stock).to.equal(9));'])
request('20h Reenvio identico no duplica el movimiento de stock', 'POST', 'ventas/{{saleId}}/corregir/', 200, correction_payload)
request('20i Reenvio identico: stock sin cambios', 'GET', 'productos/{{productId}}/', tests=[
    'pm.test("Stock sigue en 9 (diferencia 0)", () => pm.expect(result.data.stock).to.equal(9));'])
request('20j El PUT/PATCH normal sigue bloqueado tras corregir', 'PUT', 'ventas/{{saleId}}/', 409, {**sale, 'estado': 'cerrada', 'descuentoId': ''})

# Reembolsos (3.5/3.9, RF-60..65): productos y descuento propios para que el
# ejemplo de "redondeo incomodo" (15%, 3 lineas) sea reproducible sin depender
# del estado que dejaron las pruebas de correccion.
request('30a Crear productos para reembolso (A, B, C)', 'POST', 'productos/', 201,
       {'nombre': 'Reembolso A', 'codigo': 'RB-A-{{runId}}', 'categoriaId': '{{categoryId}}', 'precio': 100, 'costo': 50, 'stock': 5, 'seguimientoInventario': True},
       tests=['pm.collectionVariables.set("refundProductA", result.data.id);'])
request('30b Crear producto B', 'POST', 'productos/', 201,
       {'nombre': 'Reembolso B', 'codigo': 'RB-B-{{runId}}', 'categoriaId': '{{categoryId}}', 'precio': 100, 'costo': 50, 'stock': 5, 'seguimientoInventario': True},
       tests=['pm.collectionVariables.set("refundProductB", result.data.id);'])
request('30c Crear producto C', 'POST', 'productos/', 201,
       {'nombre': 'Reembolso C', 'codigo': 'RB-C-{{runId}}', 'categoriaId': '{{categoryId}}', 'precio': 101, 'costo': 50, 'stock': 5, 'seguimientoInventario': True},
       tests=['pm.collectionVariables.set("refundProductC", result.data.id);'])
request('30d Crear descuento 15% para reembolso', 'POST', 'descuentos/', 201,
       {'nombre': 'Reembolso 15% {{runId}}', 'tipo': 'porcentual', 'valor': 15},
       tests=['pm.collectionVariables.set("refundDiscountId", result.data.id);'])
refund_items = json.dumps([{'productoId': '{{refundProductA}}', 'cantidad': 1}, {'productoId': '{{refundProductB}}', 'cantidad': 1}, {'productoId': '{{refundProductC}}', 'cantidad': 1}])
request('30e Crear venta cerrada: A+B+C con 15% (subtotal 301, total 256)', 'POST', 'ventas/', 201,
       {'fecha': '{{refundSaleDate}}', 'estado': 'cerrada', 'metodoPago': 'Nequi', 'valorRecibido': 0, 'clienteId': '', 'descuentoId': '{{refundDiscountId}}', 'itemsJson': refund_items},
       tests=['pm.collectionVariables.set("refundSaleId", result.data.id);',
              'pm.test("subtotal 301, descuento 45, total 256", () => { pm.expect(result.data.subtotal).to.equal(301); pm.expect(result.data.descuentoMonto).to.equal(45); pm.expect(result.data.total).to.equal(256); });'],
       pre=['pm.collectionVariables.set("refundSaleDate", new Date().toISOString());'])
request('30f Cajero no puede reembolsar (403)', 'POST', 'ventas/{{refundSaleId}}/reembolsos/', 403,
       {'itemsJson': json.dumps([{'productoId': '{{refundProductA}}', 'cantidad': 1, 'retornaInventario': True}])}, token_var='cajeroToken')
request('30g Reembolso parcial de A (monto proporcional: 100 * 256/301 = 85)', 'POST', 'ventas/{{refundSaleId}}/reembolsos/', 201,
       {'itemsJson': json.dumps([{'productoId': '{{refundProductA}}', 'cantidad': 1, 'retornaInventario': True}])},
       tests=['pm.test("Estado parcial y monto 85", () => { pm.expect(result.data.estadoReembolso).to.equal("parcial"); pm.expect(result.data.reembolsos[0].monto).to.equal(85); });'])
request('30h Pedir de nuevo A (ya no queda disponible) rechazado', 'POST', 'ventas/{{refundSaleId}}/reembolsos/', 400,
       {'itemsJson': json.dumps([{'productoId': '{{refundProductA}}', 'cantidad': 1, 'retornaInventario': True}])})
request('30i Reembolso total de lo restante (B+C): suma exacta al total (256)', 'POST', 'ventas/{{refundSaleId}}/reembolsos/', 201,
       {'total': True, 'itemsJson': '[]'},
       tests=['pm.test("Estado total y suma exacta sin deriva de redondeo", () => { pm.expect(result.data.estadoReembolso).to.equal("total"); pm.expect(result.data.totalReembolsado).to.equal(256); });'])
request('30j Corregir queda bloqueada (409) tras el reembolso', 'POST', 'ventas/{{refundSaleId}}/corregir/', 409,
       {'itemsJson': refund_items, 'metodoPago': 'Nequi', 'valorRecibido': 0, 'clienteId': ''})

# Faltantes (3.7, RF-150..155): se usa un nombre unico por corrida para que el
# resumen agrupado sea reproducible aunque queden faltantes de corridas previas.
request('31a Registrar faltante no registrado (Cofias)', 'POST', 'faltantes/', 201,
       {'tipo': 'no_registrado', 'nombre': 'Cofias {{runId}}', 'cantidadSolicitada': 3, 'observacion': 'Pidieron azules'}, tests=[
    'pm.collectionVariables.set("faltanteId", result.data.id);',
    'pm.test("Queda pendiente y guarda el usuario", () => { pm.expect(result.data.estado).to.equal("pendiente"); pm.expect(result.data.usuario).to.equal("admin"); });'])
request('31b Registrar de nuevo el mismo nombre con otra forma (cofia, tilde y plural)', 'POST', 'faltantes/', 201,
       {'tipo': 'no_registrado', 'nombre': 'COF\u00cdA {{runId}}', 'cantidadSolicitada': 2})
request('31c Registrar agotado de un producto existente', 'POST', 'faltantes/', 201,
       {'tipo': 'agotado', 'productoId': '{{productId}}', 'cantidadSolicitada': 1, 'proveedorId': '{{providerId}}'}, tests=[
    'pm.test("Copia el nombre del producto", () => pm.expect(result.data.nombre).to.equal("Cuaderno Postman"));'])
request('31d Agotado sin producto rechazado (400)', 'POST', 'faltantes/', 400, {'tipo': 'agotado', 'cantidadSolicitada': 1})
request('31e Cantidad cero rechazada (400)', 'POST', 'faltantes/', 400, {'tipo': 'no_registrado', 'nombre': 'X', 'cantidadSolicitada': 0})
request('31f Cajero puede registrar un faltante', 'POST', 'faltantes/', 201,
       {'tipo': 'no_registrado', 'nombre': 'Tijeras {{runId}}', 'cantidadSolicitada': 1}, token_var='cajeroToken')
request('31g Listar con filtro por tipo', 'GET', 'faltantes/?tipo=no_registrado', tests=[
    'pm.test("Solo no registrados", () => result.data.forEach(row => pm.expect(row.tipo).to.equal("no_registrado")));'])
request('31h Filtro invalido rechazado (400)', 'GET', 'faltantes/?tipo=otro', 400)
request('31i Resumen para compras agrupa Cofias/COF\u00cdA como un solo producto', 'GET', 'faltantes/resumen/', tests=[
    'const grupo = result.data.find(row => row.nombreNormalizado === "cofia " + pm.collectionVariables.get("runId"));',
    'pm.test("Agrupado: 2 veces, 5 unidades", () => { pm.expect(grupo).to.exist; pm.expect(grupo.vecesSolicitado).to.equal(2); pm.expect(grupo.cantidadTotal).to.equal(5); });'])
request('31j Resolver faltante (registra quien y cuando)', 'POST', 'faltantes/{{faltanteId}}/resolver/', 200, {}, tests=[
    'pm.test("Resuelto con usuario y fecha", () => { pm.expect(result.data.estado).to.equal("resuelto"); pm.expect(result.data.resueltoPor).to.equal("admin"); pm.expect(result.data.resueltoEn).to.be.a("string"); });'])
request('31k Resolver otra vez es seguro', 'POST', 'faltantes/{{faltanteId}}/resolver/', 200, {})
request('31l Faltantes no se pueden eliminar', 'DELETE', 'faltantes/{{faltanteId}}/', 404)

request('21 DELETE protege categoria referenciada', 'DELETE', 'categorias/{{categoryId}}/', 409)
request('22 Crear cliente temporal', 'POST', 'clientes/', 201, {'nombre': 'Temporal {{runId}}'}, tests=[
    'pm.collectionVariables.set("clientId", result.data.id);'])
request('23 PUT cliente invalido', 'PUT', 'clientes/{{clientId}}/', 400, {'nombre': False})
request('24 PUT cliente valido', 'PUT', 'clientes/{{clientId}}/', body={'nombre': 'Editado'})
request('25 DELETE cliente', 'DELETE', 'clientes/{{clientId}}/')
request('26 GET confirma eliminacion', 'GET', 'clientes/{{clientId}}/', 404)
request('27 Logging registra GET POST PUT DELETE', 'GET', 'request-logs/', tests=[
    'pm.test("Metodos registrados", () => { const methods = result.data.map(row => row.method); ["GET","POST","PUT","DELETE"].forEach(m => pm.expect(methods).to.include(m)); });',
    'pm.test("Solicitud actual registrada antes del controlador", () => pm.expect(result.data[0].path).to.equal("/api/request-logs/"));',
    'pm.test("Log incluye IP y fecha", () => { pm.expect(result.data[0]).to.have.property("ip"); pm.expect(result.data[0]).to.have.property("called_at"); });'])

collection = {'info': {'name': 'Papel y Luna - Actividad 10',
                      'description': 'API local Django/PostgreSQL 18. Ejecutar en orden. Crea datos de demostración y documentos contables que se conservan; usar una base de pruebas. Requiere los usuarios sembrados por "manage.py seed" (admin/admin123 por defecto).',
                      'schema': 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'},
              'variable': [{'key': 'baseUrl', 'value': 'http://127.0.0.1:8000'}, {'key': 'token', 'value': ''}],
              'item': items}
destination = Path(__file__).resolve().parent.parent / 'postman' / 'actividad_10.postman_collection.json'
destination.parent.mkdir(exist_ok=True)
destination.write_text(json.dumps(collection, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'{len(items)} solicitudes: {destination}')

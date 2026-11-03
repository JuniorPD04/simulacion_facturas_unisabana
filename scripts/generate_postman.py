"""Genera la colección local reproducible de la actividad 10 (sin credenciales)."""
import json
from pathlib import Path

items = []


def request(name, method, path, status=200, body=None, tests=(), pre=()):
    events = [{'listen': 'test', 'script': {'type': 'text/javascript', 'exec': [
        f'pm.test("HTTP {status}", () => pm.response.to.have.status({status}));',
        'const result = pm.response.json();', *tests]}}]
    if pre:
        events.insert(0, {'listen': 'prerequest', 'script': {'type': 'text/javascript', 'exec': list(pre)}})
    spec = {'method': method, 'header': [], 'url': '{{baseUrl}}/api/' + path}
    if body is not None:
        spec['header'] = [{'key': 'Content-Type', 'value': 'application/json'}]
        spec['body'] = {'mode': 'raw', 'raw': json.dumps(body, ensure_ascii=False), 'options': {'raw': {'language': 'json'}}}
    items.append({'name': name, 'request': spec, 'event': events})


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
lines = json.dumps([{'productoId': '{{productId}}', 'cantidad': 2}])
sale = {'fecha': '{{saleDate}}', 'estado': 'abierta', 'metodoPago': 'Efectivo', 'valorRecibido': 5000,
        'clienteId': '', 'itemsJson': lines}
request('11 Venta abierta', 'POST', 'ventas/', 201, sale, tests=[
    'pm.collectionVariables.set("saleId", result.data.id);'], pre=[
    'pm.collectionVariables.set("saleDate", new Date().toISOString());'])
request('12 Stock intacto en borrador', 'GET', 'productos/{{productId}}/', tests=[
    'pm.test("Stock 10", () => pm.expect(result.data.stock).to.equal(10));'])
request('13 PUT cerrar venta', 'PUT', 'ventas/{{saleId}}/', body={**sale, 'estado': 'cerrada'}, tests=[
    'pm.test("Total calculado en servidor", () => pm.expect(result.data.total).to.equal(2000));'])
request('14 Stock descontado', 'GET', 'productos/{{productId}}/', tests=[
    'pm.test("Stock 8", () => pm.expect(result.data.stock).to.equal(8));'])
request('15 Reintentar mismo cierre', 'PUT', 'ventas/{{saleId}}/', body={**sale, 'estado': 'cerrada'})
request('16 Reintento no duplica descuento', 'GET', 'productos/{{productId}}/', tests=[
    'pm.test("Stock sigue en 8", () => pm.expect(result.data.stock).to.equal(8));'])
request('17 Compra repone stock', 'POST', 'compras/', 201, {
    'fecha': '{{purchaseDate}}', 'proveedorId': '{{providerId}}',
    'itemsJson': json.dumps([{'productoId': '{{productId}}', 'cantidad': 3, 'costo': 600}])}, pre=[
    'pm.collectionVariables.set("purchaseDate", new Date().toISOString().slice(0,10));'])
request('18 Inventario tras compra', 'GET', 'productos/{{productId}}/', tests=[
    'pm.test("Stock 11 y costo 600", () => { pm.expect(result.data.stock).to.equal(11); pm.expect(result.data.costo).to.equal(600); });'])
request('19 Sanitizacion anidada', 'GET', 'demo/sanitizacion/', tests=[
    'pm.test("Elimina *_id", () => { pm.expect(result.data).not.to.have.property("cliente_id"); pm.expect(result.data.nested).to.deep.equal({nombre:"Papel y Luna"}); pm.expect(result.data.items[0]).to.deep.equal({cantidad:2,productoId:"publico"}); });'])
request('20 DELETE protege venta cerrada', 'DELETE', 'ventas/{{saleId}}/', 409)
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
                      'description': 'API local Django/PostgreSQL 18. Ejecutar en orden. Crea datos de demostración y documentos contables que se conservan; usar una base de pruebas.',
                      'schema': 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'},
              'variable': [{'key': 'baseUrl', 'value': 'http://127.0.0.1:8000'}], 'item': items}
destination = Path(__file__).resolve().parent.parent / 'postman' / 'actividad_10.postman_collection.json'
destination.parent.mkdir(exist_ok=True)
destination.write_text(json.dumps(collection, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'{len(items)} solicitudes: {destination}')

// Ejecutar sólo contra una base de pruebas: registra documentos contables.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const base = process.env.TEST_API_URL;
if (!base) throw new Error('Define TEST_API_URL apuntando a un servicio con base de pruebas.');
const context = vm.createContext({window: {}, crypto, console, fetch: (url, options) => fetch(new URL(url, base), options)});
for (const file of ['config.js', 'api.js', 'store.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), context);
}

(async () => {
  const {store, api} = context.window.PYL;
  await store.init();
  const category = await store.saveEntity('categorias', {nombre: 'Integracion ' + crypto.randomUUID()});
  const client = await store.saveEntity('clientes', {nombre: 'Cliente integración', correo: 'demo@example.com'});
  const provider = await store.saveEntity('proveedores', {nombre: 'Proveedor integración'});
  const product = await store.saveProduct({nombre: 'Producto integración', codigo: crypto.randomUUID(), categoriaId: category.id, precio: 1200, costo: 600, seguimientoInventario: true, stock: 10});
  store.addItem(product.id, 2);
  store.setSaleField('clienteId', client.id);
  const draft = await store.saveDraft();
  assert.equal(draft.record.estado, 'abierta');
  assert.equal(store.getProduct(product.id).stock, 10);
  await store.resumeDraft(draft.record.id);
  store.setSaleField('metodoPago', 'Efectivo');
  store.setSaleField('valorRecibido', 5000);
  const closed = await store.closeSale();
  assert.equal(closed.record.total, 2400);
  assert.equal(closed.record.cambio, 2600);
  assert.equal(store.getProduct(product.id).stock, 8);
  const persisted = (await api.apiGet('ventas')).find(row => row.id === closed.record.id);
  await api.apiPost('ventas', 'update', persisted);
  await store.reload();
  assert.equal(store.getProduct(product.id).stock, 8);
  const purchase = await store.createPurchase({id: crypto.randomUUID(), fecha: '2026-11-03', proveedorId: provider.id,
    items: [{productoId: product.id, cantidad: 3, costo: 700}]});
  assert.equal(purchase.record.total, 2100);
  assert.equal(store.getProduct(product.id).stock, 11);
  assert.equal(store.getProduct(product.id).costo, 700);
  const disposable = await store.saveEntity('clientes', {nombre: 'Eliminar'});
  await store.deleteRecord('clientes', disposable.id);
  assert.equal(store.get('clientes', disposable.id), null);
  console.log('Integración HTTP del frontend con Django/PostgreSQL: CRUD, venta abierta, cierre, reintento y compra OK.');
})().catch(error => { console.error(error); process.exitCode = 1; });

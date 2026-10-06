const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createBackend, createStore, seed, root } = require("./helpers.cjs");

test("hojas vacias, CRUD parcial, ids inexistentes y referencias", async () => {
  const backend = createBackend(), { store } = createStore(backend);
  await store.init();
  assert.equal(store.getProducts().length, 0);
  assert.equal(backend.get("desconocido").success, false);
  seed(backend);
  const updated = backend.post("clientes", "update", { id: "client", nombre: "Nuevo nombre" });
  assert.equal(updated.data.correo, "cliente@example.com");
  assert.equal(backend.post("clientes", "update", { id: "missing", nombre: "X" }).success, false);
  assert.equal(backend.post("clientes", "delete", {}).success, false);
  assert.equal(backend.post("clientes", "delete", { id: "missing" }).success, false);
  assert.match(backend.post("categorias", "delete", { id: "cat" }).message, /asociados/);
  assert.equal(backend.post("clientes", "delete", { id: "client" }).data.id, "client");
  assert.equal(backend.post("productos", "update", { id: "product", stock: -1 }).success, false);
});

test("venta abierta persiste, se retoma, Debe requiere cliente, cierre descuenta una sola vez", async () => {
  const backend = createBackend(); seed(backend);
  const { store, calls } = createStore(backend); await store.init();
  store.addItem("product", 2); store.setSaleField("metodoPago", "Debe");
  const opened = await store.saveDraft();
  assert.equal(opened.record.estado, "abierta");
  assert.equal(backend.get("productos").data[0].stock, 5);
  await store.resumeDraft(opened.record.id);
  await assert.rejects(store.closeSale(), /cliente/);
  store.setSaleField("clienteId", "client");
  const closed = await store.closeSale();
  assert.equal(closed.record.estado, "cerrada");
  assert.equal(store.getProduct("product").stock, 3);
  const last = calls.at(-1);
  assert.equal(last.action, "update");
  assert.equal(backend.post("ventas", "update", last.data).success, true);
  assert.equal(backend.get("productos").data[0].stock, 3);
  assert.match(backend.post("clientes", "delete", { id: "client" }).message, /asociadas/);
  assert.equal(backend.post("ventas", "delete", { id: closed.record.id }).success, false);
  assert.equal(backend.post("ventas", "update", { id: closed.record.id, total: 1 }).success, false);
});

test("inventario fresco del servicio prevalece sobre el navegador; fallos conservan ticket", async () => {
  const backend = createBackend(); seed(backend);
  const { store } = createStore(backend); await store.init();
  store.addItem("product", 4); store.setSaleField("metodoPago", "Nequi");
  backend.post("productos", "update", { id: "product", stock: 1 });
  await assert.rejects(store.closeSale(), /Stock insuficiente.*Producto/);
  assert.equal(store.getCurrentSale().items.length, 1);
  assert.equal(backend.get("ventas").data.length, 0);
  backend.post("productos", "update", { id: "product", stock: 5 });
  backend.failOnce((name, row) => name === "productos" && row > 1);
  await assert.rejects(store.closeSale(), /Fallo de escritura/);
  assert.equal(backend.get("ventas").data.length, 0);
  assert.equal(backend.get("productos").data[0].stock, 5);
  assert.equal(store.getCurrentSale().items[0].cantidad, 4);
});

test("compra aumenta stock, actualiza costo, respeta servicios e idempotencia", async () => {
  const backend = createBackend(); seed(backend);
  const { store, calls } = createStore(backend); await store.init();
  const purchase = { id: "purchase", fecha: "2026-10-05", proveedorId: "provider", items: [
    { productoId: "product", codigo: "P-001", nombre: "Producto de prueba", cantidad: 3, costo: 45 },
    { productoId: "service", codigo: "S-001", nombre: "Servicio de prueba", cantidad: 2, costo: 15 }
  ] };
  const saved = await store.createPurchase(purchase);
  assert.equal(saved.record.total, 165);
  assert.equal(store.getProduct("product").stock, 8);
  assert.equal(store.getProduct("product").costo, 45);
  assert.equal(store.getProduct("service").stock, 0);
  assert.equal(store.getProduct("service").costo, 15);
  assert.equal(backend.post("compras", "create", calls.at(-1).data).success, true);
  assert.equal(backend.get("productos").data[0].stock, 8);
  assert.match(backend.post("proveedores", "delete", { id: "provider" }).message, /asociadas/);
});

test("edicion rapida cambia ticket y conserva stock; facturas mantienen instantanea", async () => {
  const backend = createBackend(); seed(backend);
  const { store } = createStore(backend); await store.init();
  store.addItem("product", 1);
  await store.saveProduct({ nombre: "Editado", categoriaId: "cat", precio: 120, costo: 55, stock: 99 }, "product", true);
  assert.equal(store.getProduct("product").stock, 5);
  assert.equal(store.currentTotal(), 120);
  store.setSaleField("metodoPago", "Efectivo");
  store.setSaleField("valorRecibido", 150);
  const closed = await store.closeSale();
  assert.equal(closed.record.cambio, 30);
  await store.saveProduct({ nombre: "Otro nombre", categoriaId: "cat", precio: 200, costo: 60 }, "product", true);
  assert.equal(store.getSale(closed.record.id).items[0].nombre, "Editado");
  assert.equal(store.getSale(closed.record.id).items[0].precio, 120);
});

test("bloqueo de doble envio y fallo al recargar despues de confirmar", async () => {
  const backend = createBackend(); seed(backend);
  const { store, api } = createStore(backend); await store.init();
  store.addItem("product", 1); store.setSaleField("metodoPago", "Nequi");
  const originalPost = api.apiPost;
  let finish;
  api.apiPost = (...args) => new Promise(resolve => { finish = async () => resolve(await originalPost(...args)); });
  const first = store.closeSale();
  await assert.rejects(store.closeSale(), /operacion en curso/);
  api.apiGet = async () => { throw new Error("Desconexion"); };
  await finish();
  const result = await first;
  assert.match(result.warning, /Venta registrada/);
  assert.equal(store.getCurrentSale().items.length, 0);
  store.addItem("product", 1);
  await assert.rejects(store.closeSale(), /Actualiza los datos/);
});

test("migracion convierte categorias e items sin descontar otra vez las ventas MVP1", () => {
  const backend = createBackend();
  backend.context.migrarMVP1({ products: [{ id: "old", codigoInterno: "OLD-001", nombre: "Viejo", categoria: "Arte", precio: 100, costo: 20, seguimientoInventario: true, stock: 7 }], sales: [{ id: "old-sale", estado: "cerrada", cliente: "Ana", metodoPago: "debe", items: [{ productId: "old", codigoInterno: "OLD-001", nombre: "Viejo", precio: 80, cantidad: 2 }] }] });
  assert.equal(backend.get("productos").data[0].stock, 7);
  const sale = backend.get("ventas").data[0];
  assert.equal(sale.metodoPago, "Debe");
  assert.equal(JSON.parse(sale.itemsJson)[0].precio, 80);
  assert.equal(backend.get("categorias").data[0].nombre, "Arte");
});

test("cliente API usa fetch JSON, text/plain y propaga errores", async () => {
  const requests = [];
  let response = { success: true, data: [] };
  const context = vm.createContext({ window: {}, URL, fetch: async (url, options) => {
    requests.push({ url, options }); return { ok: true, json: async () => response };
  } });
  vm.runInContext(fs.readFileSync(root + "/js/api.js", "utf8").replace('var API_URL = "";', 'var API_URL = "https://example.com/exec";'), context);
  const api = context.window.PYL.api;
  await api.apiGet("productos"); await api.apiPost("clientes", "create", { id: "1", nombre: "Test" });
  assert.equal(requests[1].options.headers["Content-Type"], "text/plain;charset=utf-8");
  assert.equal(JSON.parse(requests[1].options.body).action, "create");
  response = { success: false, message: "Rechazado" };
  await assert.rejects(api.apiGet("productos"), /Rechazado/);
});

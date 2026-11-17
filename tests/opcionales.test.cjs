// Pruebas de los opcionales del MVP 3: alta rapida de producto (RF-94, RF-157) y de proveedor (RF-92).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const j = (v) => JSON.parse(JSON.stringify(v));

const data = {
  productos: [{ id: "p1", codigo: "PL-007", nombre: "Cuaderno", categoriaId: "c1", precio: 1000, costo: 500, seguimientoInventario: true, stock: 4 }],
  categorias: [{ id: "c1", nombre: "Papeleria" }],
  proveedores: [{ id: "prov1", nombre: "Proveedor Uno", telefono: "", correo: "" }]
};

function load(files, { isAdmin = true, extra = {}, apiOverrides = {} } = {}) {
  const posts = [];
  const context = vm.createContext(Object.assign({ window: {}, crypto: crypto.webcrypto, console, URLSearchParams }, extra));
  context.window.PYL = {
    auth: { isAdmin: () => isAdmin, authHeader: () => ({}), clearSession() {} },
    api: Object.assign({
      resources: ["productos", "ventas", "compras", "clientes", "proveedores", "categorias", "descuentos"],
      async apiGet(resource) { return j(data[resource] || []); },
      async apiPost(resource, action, value) { posts.push({ resource, action, value: j(value) }); return j(value); },
      async apiFaltantes() { return []; }
    }, apiOverrides)
  };
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, "js", f), "utf8"), context));
  return { PYL: context.window.PYL, posts };
}

test("createQuickProduct crea con codigo sugerido, control de inventario y stock 0", async () => {
  const { PYL, posts } = load(["utils.js", "store.js"]);
  await PYL.store.init();
  const p = await PYL.store.createQuickProduct({ nombre: "  Cofias  ", categoriaId: "c1", precio: "1500", costo: "700" });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].resource, "productos"); assert.equal(posts[0].action, "create");
  assert.equal(posts[0].value.codigo, "PL-008");        // siguiente al mayor existente (PL-007)
  assert.equal(posts[0].value.nombre, "Cofias");
  assert.equal(posts[0].value.stock, 0); assert.equal(posts[0].value.seguimientoInventario, true);
  assert.equal(posts[0].value.precio, 1500); assert.equal(posts[0].value.costo, 700);
  assert.equal(p.codigo, "PL-008");
  assert.equal(PYL.store.getProducts().length, 2);       // quedo disponible en el catalogo
});

test("createQuickProduct valida y no manda nada si los datos son invalidos", async () => {
  const { PYL, posts } = load(["utils.js", "store.js"]);
  await PYL.store.init();
  const ok = { nombre: "Cofias", categoriaId: "c1", precio: "1500", costo: "700" };
  for (const [over, re] of [[{ nombre: " " }, /nombre/i], [{ categoriaId: "x" }, /categoria/i], [{ precio: "" }, /precio|costo|entero/i], [{ costo: "1.5" }, /entero|costo/i], [{ precio: "-1" }, /entero|precio/i]]) {
    await assert.rejects(() => PYL.store.createQuickProduct({ ...ok, ...over }), re);
  }
  assert.equal(posts.length, 0);
});

function faltantesEnv(opts = {}) {
  const box = { innerHTML: "" };
  const opened = [], toasts = [];
  const extra = { FormData: function (form) { return form.entries; }, location: { hash: "#faltantes" }, document: { getElementById: (id) => (id === "faltantes-list" ? box : null) } };
  const env = load(["utils.js", "store.js", "views-common.js", "views-faltantes.js"], Object.assign({ extra }, opts));
  env.PYL.ui = { open: (o) => opened.push(o), toast: (m) => toasts.push(m), closeModal() {} };
  env.PYL.app = { run: async (fn) => fn(), refresh() {} };
  return Object.assign(env, { box, opened, toasts });
}
const f = (over) => Object.assign({ id: "f1", tipo: "no_registrado", productoId: "", nombre: "Cofias", cantidadSolicitada: 2, fecha: "2026-11-16T15:00:00Z", proveedorId: "", proveedorNombre: "", observacion: "", estado: "pendiente", usuario: "admin" }, over);

test("RF-157: 'Crear producto' solo aparece para el admin y solo en faltantes 'No registrado' pendientes", async () => {
  const lista = [f(), f({ id: "f2", tipo: "agotado", productoId: "p1", nombre: "Cuaderno" }), f({ id: "f3", estado: "resuelto", resueltoPor: "admin", resueltoEn: "2026-11-16T16:00:00Z" })];
  const admin = faltantesEnv({ apiOverrides: { apiFaltantes: async () => lista } });
  await admin.PYL.store.init(); admin.PYL.views.faltantes.render(); await admin.PYL.views.faltantes.afterRender();
  assert.equal((admin.box.innerHTML.match(/data-action="create-product-from-faltante"/g) || []).length, 1);
  const cajero = faltantesEnv({ isAdmin: false, apiOverrides: { apiFaltantes: async () => lista } });
  await cajero.PYL.store.init(); cajero.PYL.views.faltantes.render(); await cajero.PYL.views.faltantes.afterRender();
  assert.ok(!cajero.box.innerHTML.includes("create-product-from-faltante"));
});

test("RF-157: crear el producto resuelve los faltantes pendientes con el mismo nombre normalizado", async () => {
  const resueltos = [];
  const lista = [
    f({ id: "f1", nombre: "COFIAS <b>", nombreNormalizado: "cofia" }),
    f({ id: "f2", nombre: "cofias", nombreNormalizado: "cofia" }),
    f({ id: "f3", nombre: "Tijera", nombreNormalizado: "tijera" })
  ];
  const env = faltantesEnv({ apiOverrides: {
    apiFaltantes: async (filtros) => { env.filtros = filtros; return lista; },
    apiResolveFaltante: async (id) => { resueltos.push(id); return { id, estado: "resuelto" }; } } });
  await env.PYL.store.init();
  const click = { type: "click", target: { closest: (s) => (s === "[data-action]" ? { dataset: { action: "create-product-from-faltante", name: "COFIAS <b>", normalized: "cofia" } } : null) } };
  assert.equal(await env.PYL.faltantes.handle(click), true);
  assert.equal(env.opened.length, 1);
  assert.match(env.opened[0].html, /value="COFIAS &lt;b&gt;"/);    // nombre como base, escapado
  assert.match(env.opened[0].html, /data-form="faltante-product"/);
  const form = { dataset: {}, entries: [["nombre", "Cofias"], ["categoriaId", "c1"], ["precio", "1500"], ["costo", "700"]] };
  const submit = { type: "submit", preventDefault() {}, target: { closest: (s) => (s === '[data-form="faltante-product"]' ? form : null) } };
  assert.equal(await env.PYL.faltantes.handle(submit), true);
  const created = env.posts.filter((p) => p.resource === "productos");
  assert.equal(created.length, 1); assert.equal(created[0].value.stock, 0); assert.equal(created[0].value.nombre, "Cofias");
  assert.deepEqual(j(env.filtros), { tipo: "no_registrado", estado: "pendiente" });
  assert.deepEqual(j(resueltos), ["f1", "f2"], "solo los del mismo nombre; Tijera sigue pendiente");
  assert.match(env.toasts.at(-1), /2 faltantes marcados como resueltos/);
});

test("RF-157: si falla al resolver, el producto igual queda creado y se avisa", async () => {
  const env = faltantesEnv({ apiOverrides: {
    apiFaltantes: async () => [f({ nombreNormalizado: "cofia" })],
    apiResolveFaltante: async () => { throw new Error("sin conexion"); } } });
  await env.PYL.store.init();
  await env.PYL.faltantes.handle({ type: "click", target: { closest: () => ({ dataset: { action: "create-product-from-faltante", name: "Cofias", normalized: "cofia" } }) } });
  const form = { dataset: {}, entries: [["nombre", "Cofias"], ["categoriaId", "c1"], ["precio", "1500"], ["costo", "700"]] };
  await env.PYL.faltantes.handle({ type: "submit", preventDefault() {}, target: { closest: (s) => (s === '[data-form="faltante-product"]' ? form : null) } });
  assert.equal(env.posts.filter((p) => p.resource === "productos").length, 1);
  assert.ok(env.toasts.some((m) => /no se pudieron resolver/.test(m)));
});

test("RF-157: el cajero no puede abrir el formulario aunque dispare la accion", async () => {
  const env = faltantesEnv({ isAdmin: false });
  await env.PYL.store.init();
  const click = { type: "click", target: { closest: () => ({ dataset: { action: "create-product-from-faltante", name: "X" } }) } };
  await env.PYL.faltantes.handle(click);
  assert.equal(env.opened.length, 0);
});

function comprasEnv() {
  // DOM minimo: cualquier elemento existe y acepta lecturas/escrituras; solo el buscador trae texto.
  const stub = (over) => Object.assign({ value: "", textContent: "", innerHTML: "", hidden: false, disabled: false, classList: { add() {} }, addEventListener() {}, focus() {}, closest: () => stub() }, over);
  const search = stub({ value: "  Cofias nuevas " });
  const extra = { FormData: function (form) { return form.entries; }, document: { getElementById: (id) => (id === "purchase-product-search" ? search : stub()), querySelector: () => stub(), querySelectorAll: () => [] } };
  const env = load(["utils.js", "store.js", "views-common.js", "views-compras.js"], { extra });
  const opened = [], toasts = [];
  env.PYL.ui = { open: (o) => opened.push(o), toast: (m) => toasts.push(m), closeModal() { const cb = opened.at(-1) && opened.at(-1).onClose; if (cb) cb(); } };
  env.PYL.app = { run: async (fn) => fn(), refresh() {}, isBusy: () => false };
  return Object.assign(env, { opened, toasts });
}
const act = (action) => ({ type: "click", target: { closest: (s) => (s === "[data-action]" ? { dataset: { action } } : null) } });
const submitForm = (name, entries) => ({ type: "submit", preventDefault() {}, target: { dataset: { form: name }, entries, closest: () => null } });

test("RF-92: proveedor nuevo desde la compra se crea, queda seleccionado y se vuelve a la compra", async () => {
  const env = comprasEnv();
  await env.PYL.store.init();
  // Se abre la compra para que exista el borrador; los helpers del DOM se anulan en este mock.
  try { await env.PYL.views.compras.handle(act("new-purchase")); } catch (e) { /* el DOM simulado no llega a pintar la compra */ }
  const draftOpen = env.opened.length;
  await env.PYL.views.compras.handle(act("purchase-new-provider"));
  assert.match(env.opened.at(-1).html, /data-form="purchase-quick-provider"/);
  await env.PYL.views.compras.handle(submitForm("purchase-quick-provider", [["nombre", "Nuevo Prov"], ["telefono", ""], ["correo", ""]]));
  const created = env.posts.filter((p) => p.resource === "proveedores");
  assert.equal(created.length, 1); assert.equal(created[0].value.nombre, "Nuevo Prov");
  assert.match(env.toasts.at(-1), /Proveedor creado/);
  assert.ok(env.opened.length > draftOpen + 1, "al cerrar vuelve a abrir la compra");
});

test("RF-94: producto nuevo desde la compra usa lo escrito en el buscador y se agrega a la compra", async () => {
  const env = comprasEnv();
  await env.PYL.store.init();
  try { await env.PYL.views.compras.handle(act("new-purchase")); } catch (e) { /* idem */ }
  await env.PYL.views.compras.handle(act("purchase-new-product"));
  assert.match(env.opened.at(-1).html, /value="Cofias nuevas"/);
  assert.match(env.opened.at(-1).html, /data-form="purchase-quick-product"/);
  await env.PYL.views.compras.handle(submitForm("purchase-quick-product", [["nombre", "Cofias nuevas"], ["categoriaId", "c1"], ["precio", "1500"], ["costo", "700"]]));
  const created = env.posts.filter((p) => p.resource === "productos");
  assert.equal(created.length, 1); assert.equal(created[0].value.stock, 0);
  assert.match(env.toasts.at(-1), /agregado a la compra/);
});

test("RF-85: getProductProviders agrupa los proveedores que ya vendieron el producto", async () => {
  const compras = [
    { id: "a", fecha: "2026-11-01", proveedorId: "prov1", items: [{ productoId: "p1", cantidad: 2, costo: 400 }] },
    { id: "b", fecha: "2026-11-10", proveedorId: "prov1", items: [{ productoId: "p1", cantidad: 1, costo: 450 }, { productoId: "otro", cantidad: 1, costo: 9 }] },
    { id: "c", fecha: "2026-11-05", proveedorId: "prov2", items: [{ productoId: "p1", cantidad: 1, costo: 500 }] },
    { id: "d", fecha: "2026-11-12", proveedorId: "prov2", items: [{ productoId: "otro", cantidad: 1, costo: 1 }] }
  ];
  const { PYL } = load(["utils.js", "store.js"], { apiOverrides: { async apiGet(r) { return j(r === "compras" ? compras.map((c) => ({ ...c, total: 0, itemsJson: JSON.stringify(c.items) })) : data[r] || []); } } });
  await PYL.store.init();
  const rows = j(PYL.store.getProductProviders("p1"));
  assert.deepEqual(rows, [
    { proveedorId: "prov1", compras: 2, ultimaFecha: "2026-11-10", ultimoCosto: 450 },
    { proveedorId: "prov2", compras: 1, ultimaFecha: "2026-11-05", ultimoCosto: 500 }
  ]);
  assert.deepEqual(j(PYL.store.getProductProviders("nadie")), []);
});

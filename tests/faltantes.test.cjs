// Pruebas del frontend de Faltantes (3.7): store, cliente de la API y vista.
// No usan navegador: cargan los archivos de js/ en un contexto vm con mocks minimos.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");

const productos = [
  { id: "p-stock", codigo: "P-1", nombre: "Cuaderno", categoriaId: "c", precio: 1000, costo: 500, seguimientoInventario: true, stock: 4 },
  { id: "p-agotado", codigo: "P-2", nombre: "Regla", categoriaId: "c", precio: 500, costo: 200, seguimientoInventario: true, stock: 0 }
];
const proveedores = [{ id: "prov", nombre: "Proveedor Uno", telefono: "", correo: "" }];

function load(files, { isAdmin = true, apiOverrides = {}, extra = {} } = {}) {
  const gets = [], posts = [];
  const context = vm.createContext(Object.assign({ window: {}, crypto: crypto.webcrypto, console, URLSearchParams }, extra));
  context.window.PYL = {
    auth: { isAdmin: () => isAdmin, authHeader: () => ({ Authorization: "Bearer t" }), clearSession() {} },
    api: Object.assign({
      resources: ["productos", "ventas", "compras", "clientes", "proveedores", "categorias", "descuentos"],
      async apiGet(resource) { gets.push(resource); return { productos, proveedores }[resource] || []; },
      async apiCreateFaltante(data) { posts.push(data); return Object.assign({ estado: "pendiente" }, data); },
      async apiResolveFaltante(id) { posts.push({ resolver: id }); return { id, estado: "resuelto" }; },
      async apiFaltantes() { return []; }
    }, apiOverrides)
  };
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, "js", f), "utf8"), context));
  return { PYL: context.window.PYL, gets, posts, context };
}

test("el cajero carga proveedores (para elegirlos) pero no compras", async () => {
  const cajero = load(["utils.js", "store.js"], { isAdmin: false });
  await cajero.PYL.store.init();
  assert.ok(cajero.gets.includes("proveedores"));
  assert.ok(!cajero.gets.includes("compras"));
  assert.equal(cajero.PYL.store.list("proveedores").length, 1);
  const admin = load(["utils.js", "store.js"]);
  await admin.PYL.store.init();
  assert.ok(admin.gets.includes("compras"));
});

test("createFaltante valida antes de enviar y no manda nada si es invalido", async () => {
  const { PYL, posts } = load(["utils.js", "store.js"]);
  await PYL.store.init();
  const base = { tipo: "no_registrado", nombre: "Cofias", cantidadSolicitada: "2" };
  const casos = [
    [{ ...base, tipo: "otro" }, /tipo/i],
    [{ tipo: "agotado", cantidadSolicitada: 1 }, /producto agotado/i],
    [{ tipo: "agotado", productoId: "no-existe", cantidadSolicitada: 1 }, /ya no existe/i],
    [{ ...base, nombre: "   " }, /nombre/i],
    [{ ...base, nombre: "x".repeat(151) }, /150/],
    [{ ...base, cantidadSolicitada: "" }, /cantidad/i],
    [{ ...base, cantidadSolicitada: "0" }, /cantidad/i],
    [{ ...base, cantidadSolicitada: "-3" }, /cantidad/i],
    [{ ...base, cantidadSolicitada: "1.5" }, /cantidad/i],
    [{ ...base, proveedorId: "fantasma" }, /proveedor/i],
    [{ ...base, observacion: "o".repeat(301) }, /300/]
  ];
  for (const [data, pattern] of casos) await assert.rejects(PYL.store.createFaltante(data), pattern);
  assert.equal(posts.length, 0);
});

test("createFaltante arma el payload correcto y conserva el id en reintentos", async () => {
  const { PYL, posts } = load(["utils.js", "store.js"]);
  await PYL.store.init();
  await PYL.store.createFaltante({ id: "id-fijo", tipo: "no_registrado", nombre: "  Cofias  ", cantidadSolicitada: "3", productoId: "p-stock", proveedorId: "prov", observacion: "  " });
  await PYL.store.createFaltante({ id: "id-fijo", tipo: "no_registrado", nombre: "Cofias", cantidadSolicitada: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(posts[0])), { id: "id-fijo", tipo: "no_registrado", nombre: "Cofias", cantidadSolicitada: 3, proveedorId: "prov" });
  assert.equal(posts[1].id, "id-fijo");
  await PYL.store.createFaltante({ tipo: "agotado", productoId: "p-agotado", nombre: "ignorado", cantidadSolicitada: 1, observacion: "Pidieron 2" });
  assert.deepEqual(Object.keys(posts[2]).sort(), ["cantidadSolicitada", "id", "observacion", "productoId", "tipo"]);
  assert.match(posts[2].id, /^[0-9a-f-]{36}$/);
});

test("un faltante no modifica el inventario del store (RN-09)", async () => {
  const { PYL } = load(["utils.js", "store.js"]);
  await PYL.store.init();
  await PYL.store.createFaltante({ tipo: "agotado", productoId: "p-stock", cantidadSolicitada: 3 });
  assert.equal(PYL.store.getProduct("p-stock").stock, 4);
  assert.equal(PYL.store.getSales().length, 0);
});

test("apiFaltantes arma la URL con filtros y omite los vacios", async () => {
  const urls = [];
  const fetch = async (url, options) => { urls.push({ url, method: options.method }); return { status: 200, ok: true, json: async () => ({ success: true, data: [] }) }; };
  const { PYL } = load(["api.js"], { extra: { fetch } });
  PYL.config = { apiBaseUrl: "/api/" };
  await PYL.api.apiFaltantes({ tipo: "agotado", estado: "", proveedorId: "a b", desde: "2026-01-01" }, false);
  await PYL.api.apiFaltantes({}, true);
  await PYL.api.apiResolveFaltante("x/y");
  assert.equal(urls[0].url, "/api/faltantes/?tipo=agotado&proveedorId=a%20b&desde=2026-01-01");
  assert.equal(urls[1].url, "/api/faltantes/resumen/");
  assert.equal(urls[2].url, "/api/faltantes/x%2Fy/resolver/");
  assert.equal(urls[2].method, "POST");
});

function viewContext(opts = {}) {
  const box = { innerHTML: "" };
  const opened = [];
  const extra = { location: { hash: "#faltantes" }, document: { getElementById: (id) => (id === "faltantes-list" ? box : null) } };
  const env = load(["utils.js", "store.js", "views-common.js", "views-faltantes.js"], Object.assign({ extra }, opts));
  env.PYL.ui = { open: (o) => opened.push(o), toast() {}, closeModal() {} };
  env.PYL.app = { run: async (fn) => fn(), refresh() {} };
  return Object.assign(env, { box, opened });
}
const row = (over) => Object.assign({ id: "f1", tipo: "no_registrado", productoId: "", nombre: "Cofias", cantidadSolicitada: 3, fecha: "2026-11-16T15:00:00Z", proveedorId: "", proveedorNombre: "", observacion: "", estado: "pendiente", usuario: "admin", resueltoEn: null, resueltoPor: null }, over);

test("la vista Registro muestra pendientes con accion, resueltos sin accion y escapa HTML", async () => {
  const env = viewContext({ apiOverrides: { apiFaltantes: async () => [
    row({ nombre: "<img src=x onerror=alert(1)>", observacion: "<b>hola</b>" }),
    row({ id: "f2", estado: "resuelto", resueltoPor: "cajero", resueltoEn: "2026-11-16T16:00:00Z" })
  ] } });
  await env.PYL.store.init();
  const html = env.PYL.views.faltantes.render();
  assert.match(html, /Registro/); assert.match(html, /Para compras/); assert.match(html, /Registrar faltante/);
  await env.PYL.views.faltantes.afterRender();
  assert.ok(!env.box.innerHTML.includes("<img"), "el nombre debe escaparse");
  assert.ok(!env.box.innerHTML.includes("<b>hola"), "la observacion debe escaparse");
  assert.equal((env.box.innerHTML.match(/data-action="resolve-faltante"/g) || []).length, 1);
  assert.match(env.box.innerHTML, /Resuelto por cajero/);
});

test("insignia 'Ya hay stock' solo en pendientes de un producto que ya tiene existencias", async () => {
  const env = viewContext({ apiOverrides: { apiFaltantes: async () => [
    row({ id: "a", tipo: "agotado", productoId: "p-stock", nombre: "Cuaderno" }),
    row({ id: "b", tipo: "agotado", productoId: "p-agotado", nombre: "Regla" }),
    row({ id: "c", tipo: "agotado", productoId: "p-stock", nombre: "Cuaderno", estado: "resuelto" }),
    row({ id: "d", productoId: "", nombre: "Cofias" })
  ] } });
  await env.PYL.store.init();
  env.PYL.views.faltantes.render();
  await env.PYL.views.faltantes.afterRender();
  assert.equal((env.box.innerHTML.match(/Ya hay stock/g) || []).length, 1);
  assert.match(env.box.innerHTML, /Ya hay stock \(4\)/);
});

test("Para compras muestra los grupos del resumen; un error de la API se muestra con Reintentar", async () => {
  let fail = false;
  const env = viewContext({ apiOverrides: { apiFaltantes: async (f, resumen) => {
    if (fail) throw new Error("Datos invalidos.");
    return resumen ? [{ productoId: "", nombre: "Cofia", nombreNormalizado: "cofia", proveedorId: "", proveedorNombre: "", vecesSolicitado: 3, cantidadTotal: 6, ultimaFecha: "2026-11-16T15:00:00Z", estado: "pendiente" }] : [];
  } } });
  await env.PYL.store.init();
  await env.PYL.faltantes.handle({ type: "click", target: { closest: (s) => (s === "[data-action]" ? { dataset: { action: "faltantes-tab", tab: "compras" } } : null) } });
  env.PYL.views.faltantes.render();
  await env.PYL.views.faltantes.afterRender();
  assert.match(env.box.innerHTML, /Solicitado 3 veces/); assert.match(env.box.innerHTML, /Cantidad total: 6/); assert.match(env.box.innerHTML, /Sin proveedor/);
  fail = true;
  await env.PYL.views.faltantes.afterRender();
  assert.match(env.box.innerHTML, /Datos invalidos/); assert.match(env.box.innerHTML, /faltantes-retry/);
});

test("abrir el formulario desde la venta lo deja relleno segun el caso", async () => {
  const env = viewContext();
  await env.PYL.store.init();
  const click = (dataset) => env.PYL.faltantes.handle({ type: "click", target: { closest: (s) => (s === "[data-action]" ? { dataset: Object.assign({ action: "report-shortage" }, dataset) } : null) } });
  assert.equal(await click({ name: "Cofias \"azul\"" }), true);
  let html = env.opened.at(-1).html;
  assert.match(html, /value="no_registrado" checked/); assert.match(html, /value="Cofias &quot;azul&quot;"/);
  assert.equal(await click({ productId: "p-agotado" }), true);
  html = env.opened.at(-1).html;
  assert.match(html, /value="agotado" checked/); assert.match(html, /<option value="p-agotado" selected>Regla \(stock 0\)<\/option>/);
  assert.match(html, /data-id="[0-9a-f-]{36}"/);
});

test("la vista ignora eventos que no son suyos y alterna las secciones del formulario", async () => {
  const env = viewContext();
  await env.PYL.store.init();
  assert.equal(await env.PYL.faltantes.handle({ type: "click", target: { closest: () => null } }), false);
  assert.equal(await env.PYL.faltantes.handle({ type: "click", target: { closest: (s) => (s === "[data-action]" ? { dataset: { action: "otra-cosa" } } : null) } }), false);
  const sections = [{ dataset: { faltanteSection: "agotado" }, hidden: false }, { dataset: { faltanteSection: "no_registrado" }, hidden: true }];
  const form = { querySelectorAll: () => sections };
  const handled = await env.PYL.faltantes.handle({ type: "change", target: { name: "tipo", value: "no_registrado", closest: (s) => (s === '[data-form="faltante"]' ? form : null) } });
  assert.equal(handled, true);
  assert.deepEqual(sections.map((s) => s.hidden), [true, false]);
});

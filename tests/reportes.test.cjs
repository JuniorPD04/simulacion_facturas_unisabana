// Pruebas del frontend de Reportes (3.10): store, cliente de la API y vista.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");

function load(files, { apiOverrides = {}, extra = {} } = {}) {
  const calls = [];
  const context = vm.createContext(Object.assign({ window: {}, crypto: crypto.webcrypto, console }, extra));
  context.window.PYL = {
    config: { apiBaseUrl: "/api/" },
    auth: { isAdmin: () => true, authHeader: () => ({ Authorization: "Bearer t" }), clearSession() {} },
    api: Object.assign({
      resources: ["productos", "ventas", "compras", "clientes", "proveedores", "categorias", "descuentos"],
      async apiGet() { return []; },
      async apiReporte(name, params) { calls.push({ name, params: JSON.parse(JSON.stringify(params)) }); return {}; }
    }, apiOverrides)
  };
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, "js", f), "utf8"), context));
  return { PYL: context.window.PYL, calls };
}
const j = (v) => JSON.parse(JSON.stringify(v));

test("getReporte valida el rango antes de pedir y no llama a la API si es invalido", async () => {
  const { PYL, calls } = load(["utils.js", "store.js"]);
  const ok = { desde: "2026-11-01", hasta: "2026-11-16" };
  assert.throws(() => PYL.store.getReporte("inventario", ok), /desconocido/i);
  for (const name of ["ventas", "compras", "productos-mas-vendidos"]) {
    assert.throws(() => PYL.store.getReporte(name, {}), /fecha inicial y la final/);
    assert.throws(() => PYL.store.getReporte(name, { desde: "2026-11-01" }), /fecha inicial y la final/);
    assert.throws(() => PYL.store.getReporte(name, { desde: "x", hasta: "2026-11-01" }), /no son validas/);
    assert.throws(() => PYL.store.getReporte(name, { desde: "2026-13-45", hasta: "2026-11-01" }), /no son validas/);
    assert.throws(() => PYL.store.getReporte(name, { desde: "2026-11-02", hasta: "2026-11-01" }), /posterior/);
  }
  assert.equal(calls.length, 0);
  await PYL.store.getReporte("ventas", { desde: "2026-11-16", hasta: "2026-11-16" }); // rango de un dia: valido
  await PYL.store.getReporte("faltantes", {});                                           // el rango de faltantes es opcional
  assert.equal(calls.length, 2);
});

test("apiReporte arma la URL con el nombre y omite filtros vacios", async () => {
  const urls = [];
  const fetch = async (url, options) => { urls.push({ url, method: options.method }); return { status: 200, ok: true, json: async () => ({ success: true, data: {} }) }; };
  const { PYL } = load(["api.js"], { extra: { fetch } });
  await PYL.api.apiReporte("productos-mas-vendidos", { desde: "2026-11-01", hasta: "2026-11-16", limite: "5" });
  await PYL.api.apiReporte("faltantes", { desde: "", hasta: "", limite: "10" });
  assert.equal(urls[0].url, "/api/reportes/productos-mas-vendidos/?desde=2026-11-01&hasta=2026-11-16&limite=5");
  assert.equal(urls[1].url, "/api/reportes/faltantes/?limite=10");
  assert.equal(urls[0].method, "GET");
});

function viewContext(responses) {
  const box = { innerHTML: "" };
  const extra = { document: { getElementById: (id) => (id === "report-result" ? box : null) } };
  const env = load(["utils.js", "store.js", "views-reportes.js"], { extra, apiOverrides: { async apiReporte(name, params) { env.calls.push({ name, params: j(params) }); const r = responses[name]; if (r instanceof Error) throw r; return r; } } });
  env.PYL.app = { refresh() {} };
  env.box = box;
  return env;
}
const click = (dataset) => ({ type: "click", target: { closest: (s) => (s === "[data-action]" ? { dataset } : null) } });
const change = (field, value) => ({ type: "change", target: { closest: (s) => (s === "[data-report-field]" ? { dataset: { reportField: field }, value } : null) } });

test("Ventas muestra totales, desglose por metodo y la nota de reglas", async () => {
  const env = viewContext({ ventas: { numeroVentas: 3, totalVendido: 4000, totalDescuentos: 0, totalReembolsado: 1000, totalNeto: 3000,
    porMetodoPago: [{ metodoPago: "Efectivo", numeroVentas: 1, totalVendido: 2000, totalReembolsado: 1000, totalNeto: 1000 }, { metodoPago: "Nequi", numeroVentas: 1, totalVendido: 1000, totalReembolsado: 0, totalNeto: 1000 }, { metodoPago: "Debe", numeroVentas: 1, totalVendido: 1000, totalReembolsado: 0, totalNeto: 1000 }] } });
  const html = env.PYL.views.reportes.render();
  assert.match(html, /Ventas/); assert.match(html, /Productos mas vendidos/); assert.match(html, /Faltantes frecuentes/);
  await env.PYL.views.reportes.afterRender();
  assert.match(env.box.innerHTML, /Total vendido/); assert.match(env.box.innerHTML, /Neto/);
  assert.equal((env.box.innerHTML.match(/<tr>/g) || []).length, 4); // encabezado + 3 metodos
  assert.match(env.box.innerHTML, /Debe/); assert.match(env.box.innerHTML, /aun no se haya cobrado/);
  const today = new Date(); const key = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  assert.deepEqual(env.calls[0], { name: "ventas", params: { desde: key, hasta: key } }); // por defecto: hoy
});

test("Productos mas vendidos escapa HTML y pide el top elegido", async () => {
  const env = viewContext({ "productos-mas-vendidos": { productos: [{ productoId: "1", codigo: "P-1", nombre: "<img src=x onerror=alert(1)>", unidadesVendidas: 5, unidadesReembolsadas: 1, unidadesNetas: 4, totalProductos: 2500 }] } });
  await env.PYL.views.reportes.handle(click({ action: "report-tab", tab: "productos-mas-vendidos" }));
  env.PYL.views.reportes.render();
  await env.PYL.views.reportes.afterRender();
  assert.ok(!env.box.innerHTML.includes("<img"), "el nombre debe escaparse");
  assert.match(env.box.innerHTML, /P-1/); assert.match(env.box.innerHTML, /antes del descuento/);
  await env.PYL.views.reportes.handle(change("limite", "5"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(env.calls.at(-1).params.limite, "5");
  assert.equal(env.calls.at(-1).name, "productos-mas-vendidos");
});

test("Compras y Faltantes frecuentes se muestran; faltantes empieza sin rango (todo el historial)", async () => {
  const env = viewContext({
    compras: { numeroCompras: 2, totalComprado: 3500, porProveedor: [{ proveedorId: "a", proveedorNombre: "Proveedor", numeroCompras: 2, totalComprado: 3500 }], compras: [{ id: "1", fecha: "2026-11-16", proveedorNombre: "Proveedor", total: 1500 }, { id: "2", fecha: "2026-11-15", proveedorNombre: "Proveedor", total: 2000 }] },
    faltantes: { faltantes: [{ productoId: "", nombre: "Cofia", nombreNormalizado: "cofia", vecesSolicitado: 3, cantidadTotal: 6, ultimaFecha: "2026-11-16T15:00:00Z", estado: "pendiente" }] } });
  await env.PYL.views.reportes.handle(click({ action: "report-tab", tab: "compras" }));
  env.PYL.views.reportes.render(); await env.PYL.views.reportes.afterRender();
  assert.match(env.box.innerHTML, /Total comprado/); assert.equal((env.box.innerHTML.match(/<tr>/g) || []).length, 1 + 1 + 1 + 2); // por proveedor + registradas
  await env.PYL.views.reportes.handle(click({ action: "report-tab", tab: "faltantes" }));
  const html = env.PYL.views.reportes.render();
  assert.match(html, /Todo el historial/); assert.match(html, /data-report-field="desde" value=""/);
  await env.PYL.views.reportes.afterRender();
  assert.deepEqual(env.calls.at(-1), { name: "faltantes", params: { desde: "", hasta: "", limite: "10" } });
  assert.match(env.box.innerHTML, /Cofia/); assert.match(env.box.innerHTML, /Pendiente/);
});

test("los atajos de fechas calculan hoy, ultimos 7 dias, este mes y todo el historial", async () => {
  const env = viewContext({ ventas: {} });
  const read = () => { const h = env.PYL.views.reportes.render(); return [h.match(/data-report-field="desde" value="([^"]*)"/)[1], h.match(/data-report-field="hasta" value="([^"]*)"/)[1]]; };
  const today = new Date(), pad = (n) => String(n).padStart(2, "0"), fmt = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const t = fmt(today), six = new Date(today); six.setDate(six.getDate() - 6);
  await env.PYL.views.reportes.handle(click({ action: "report-preset", preset: "7dias" }));
  assert.deepEqual(read(), [fmt(six), t]);
  await env.PYL.views.reportes.handle(click({ action: "report-preset", preset: "mes" }));
  assert.deepEqual(read(), [t.slice(0, 8) + "01", t]);
  await env.PYL.views.reportes.handle(click({ action: "report-preset", preset: "hoy" }));
  assert.deepEqual(read(), [t, t]);
  await env.PYL.views.reportes.handle(click({ action: "report-tab", tab: "faltantes" }));
  await env.PYL.views.reportes.handle(click({ action: "report-preset", preset: "7dias" }));
  await env.PYL.views.reportes.handle(click({ action: "report-preset", preset: "todo" }));
  assert.deepEqual(read(), ["", ""]);
});

test("un rango invalido o un error de la API se muestra con Reintentar y no rompe la vista", async () => {
  const env = viewContext({ ventas: new Error("Datos invalidos.") });
  env.PYL.views.reportes.render();
  await env.PYL.views.reportes.afterRender();
  assert.match(env.box.innerHTML, /Datos invalidos/); assert.match(env.box.innerHTML, /report-retry/);
  await env.PYL.views.reportes.handle(change("desde", "2999-01-01"));
  await new Promise((r) => setTimeout(r, 0));
  assert.match(env.box.innerHTML, /posterior a la final/);
  assert.equal(env.calls.filter((c) => c.params.desde === "2999-01-01").length, 0); // no se pidio al backend
});

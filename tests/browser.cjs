const { chromium } = require("playwright");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createBackend, root } = require("./helpers.cjs");

(async () => {
  const backend = createBackend();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/test-api") {
      const resource = url.searchParams.get("resource");
      if (req.method === "GET") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(backend.get(resource))); }
      else {
        let body = "";
        req.on("data", chunk => { body += chunk; });
        req.on("end", () => { const b = JSON.parse(body); res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(backend.post(resource, b.action, b.data))); });
      }
      return;
    }
    const target = path.resolve(root, "." + (url.pathname === "/" ? "/index.html" : url.pathname));
    if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) { res.statusCode = 404; res.end(); return; }
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
    res.setHeader("Content-Type", types[path.extname(target)] || "application/octet-stream");
    let content = fs.readFileSync(target);
    if (url.pathname === "/js/api.js") content = content.toString().replace('var API_URL = "";', 'var API_URL = location.origin + "/test-api";');
    res.end(content);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = "http://127.0.0.1:" + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(address);
    await page.getByRole("heading", { name: "Nueva venta", exact: true }).waitFor();
    assert.match(await page.locator("#catalog-grid").innerText(), /No hay productos/);
    const nav = async name => { await page.locator("nav").getByRole("link", { name, exact: true }).click(); await page.waitForTimeout(60); };
    const saved = async () => { await page.locator("#modal-root form").getByRole("button", { name: "Guardar", exact: true }).click(); await page.locator("#modal-root form").waitFor({ state: "detached" }); };
    await nav("Entidades");
    await page.getByRole("button", { name: "Nuevo registro" }).click();
    await page.getByLabel("Nombre", { exact: true }).fill("Papeleria de prueba"); await saved();
    await page.getByRole("tab", { name: "Clientes", exact: true }).click();
    await page.getByRole("button", { name: "Nuevo registro" }).click();
    await page.getByLabel("Nombre", { exact: true }).fill("Ana de prueba");
    await page.getByLabel("Telefono").fill("3001234567"); await page.getByLabel("Correo").fill("ana@example.com"); await saved();
    await page.getByRole("tab", { name: "Proveedores", exact: true }).click();
    await page.getByRole("button", { name: "Nuevo registro" }).click();
    await page.getByLabel("Nombre", { exact: true }).fill("Proveedor de prueba"); await saved();
    await nav("Productos");
    await page.getByRole("button", { name: "Nuevo producto" }).click();
    await page.getByLabel("Codigo", { exact: true }).fill("TEST-001");
    await page.getByLabel("Nombre", { exact: true }).fill("Cuaderno de prueba");
    await page.getByLabel("Categoria", { exact: true }).selectOption({ label: "Papeleria de prueba" });
    await page.getByLabel("Precio de venta").fill("100"); await page.getByLabel("Costo", { exact: true }).fill("40"); await page.getByLabel("Stock", { exact: true }).fill("5"); await saved();
    await nav("Nueva venta");
    await page.getByRole("button", { name: "Agregar", exact: true }).click();
    await page.getByRole("button", { name: "Editar Cuaderno de prueba", exact: true }).click();
    assert.equal(await page.locator('[data-form="product"] [name="stock"]').count(), 0);
    await page.getByLabel("Precio de venta").fill("120"); await saved();
    assert.match(await page.locator("#ticket-root").innerText(), /120/);
    await page.getByRole("button", { name: "Guardar abierta", exact: true }).click();
    await page.waitForFunction(() => window.PYL.store.getCurrentSale().items.length === 0);
    await page.reload(); await page.getByRole("heading", { name: "Nueva venta", exact: true }).waitFor();
    await nav("Ventas"); await page.getByRole("button", { name: "Retomar venta", exact: true }).click();
    await page.waitForURL("**/#venta"); await page.getByRole("button", { name: "Cobrar", exact: true }).click();
    await page.getByRole("radio", { name: "Debe", exact: true }).check();
    await page.getByRole("button", { name: "Confirmar venta" }).click();
    await page.locator("#toast-root").getByText("Selecciona un cliente para el pago Debe.").waitFor();
    await page.getByLabel("Cliente", { exact: true }).selectOption({ label: "Ana de prueba" });
    await page.getByRole("button", { name: "Confirmar venta" }).click();
    await page.getByRole("heading", { name: "Venta registrada", exact: true }).waitFor();
    assert.equal(backend.get("productos").data[0].stock, 4);
    await page.getByRole("link", { name: "Ver factura", exact: true }).click();
    await page.getByRole("button", { name: "Imprimir / PDF" }).waitFor();
    await page.screenshot({ path: ".tmp-tools/factura-desktop.png", fullPage: true });
    await page.emulateMedia({ media: "print" });
    assert.equal(await page.locator(".nav").isVisible(), false);
    await page.emulateMedia({ media: "screen" });
    await nav("Compras"); await page.getByRole("button", { name: "Nueva compra" }).click();
    await page.getByLabel("Proveedor", { exact: true }).selectOption({ label: "Proveedor de prueba" });
    await page.getByLabel("Producto", { exact: true }).selectOption({ label: "Cuaderno de prueba" });
    await page.getByRole("button", { name: "Agregar", exact: true }).click();
    await page.getByLabel("Cantidad", { exact: true }).fill("3"); await page.getByLabel("Costo unitario").fill("45");
    await page.getByRole("button", { name: "Registrar compra", exact: true }).click();
    await page.locator("#modal-root form").waitFor({ state: "detached" });
    assert.equal(backend.get("productos").data[0].stock, 7);
    assert.equal(backend.get("productos").data[0].costo, 45);
    await nav("Entidades"); await page.getByRole("tab", { name: "Categorias", exact: true }).click();
    await page.getByRole("button", { name: "Eliminar Papeleria de prueba", exact: true }).click();
    await page.locator("[data-modal-ok]").click();
    await page.locator("#toast-root").getByText("La categoria tiene productos asociados.").waitFor();
    await page.locator('[data-action="entity-tab"][data-resource="clientes"]').click();
    await page.getByRole("button", { name: "Editar Ana de prueba", exact: true }).click();
    await page.getByLabel("Telefono").fill("3007654321"); await saved();
    await page.locator("#entity-search").fill("Ana"); assert.equal(await page.locator(".entity-row").count(), 1);
    await page.locator("#entity-search").fill("Sin coincidencias"); assert.equal(await page.locator(".entity-row").count(), 0);
    await page.locator("#entity-search").fill("");
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const name of ["Nueva venta", "Productos", "Ventas", "Compras", "Entidades"]) {
        await nav(name);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        assert.equal(overflow, false, name + " overflow at " + width);
      }
      await nav("Nueva venta");
      await page.screenshot({ path: ".tmp-tools/venta-" + width + ".png", fullPage: true });
      if (width <= 768) {
        await page.getByRole("tab", { name: "Ticket", exact: true }).click();
        assert.equal(await page.locator("#ticket-root").isVisible(), true);
        await page.getByRole("tab", { name: "Catalogo", exact: true }).click();
      }
    }
    assert.deepEqual(errors, []);
    console.log("Browser OK: CRUD, ventas abiertas, Debe, factura, compras, referencias y cuatro anchos sin desbordamiento.");
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

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
    if (url.pathname === "/js/api.js") {
      content = content.toString().replace(/var API_URL = "[^"]*";/, 'var API_URL = location.origin + "/test-api";');
      assert.ok(content.includes('var API_URL = location.origin + "/test-api";'), "Browser tests must use the simulated service.");
    }
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
    // Hold the simulated service so loading states can be inspected deterministically.
    const loadingAction = async (action, message, screenshot) => {
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      const handler = async route => { await gate; await route.continue(); };
      await page.route("**/test-api?*", handler);
      try {
        await action();
        await page.locator("#loading-root").waitFor({ state: "visible" });
        assert.equal(await page.locator("#loading-message").innerText(), message);
        assert.equal(await page.locator("#view").getAttribute("aria-busy"), "true");
        assert.equal(await page.evaluate(() => PYL.app.isBusy() && document.querySelector(".shell").inert && document.getElementById("modal-root").inert), true);
        assert.equal(await page.locator("#view button:enabled, #modal-root button:enabled").count(), 0);
        assert.equal(await page.evaluate(async () => {
          let called = false;
          await PYL.app.run(() => { called = true; });
          return called;
        }), false, "A pending operation must prevent duplicate submissions.");
        await page.keyboard.press("Escape");
        assert.equal(await page.locator("#loading-root").isVisible(), true);
        if (screenshot) await page.screenshot({ path: ".tmp-tools/" + screenshot });
      } finally {
        release();
        try { await page.locator("#loading-root").waitFor({ state: "hidden" }); }
        finally { await page.unroute("**/test-api?*", handler); }
      }
      assert.equal(await page.evaluate(() => PYL.app.isBusy() || document.querySelector(".shell").inert || document.getElementById("modal-root").inert), false);
      assert.equal(await page.locator("#view").getAttribute("aria-busy"), "false");
    };
    await loadingAction(() => page.goto(address), "Cargando datos...");
    await page.getByRole("heading", { name: "Nueva venta", exact: true }).waitFor();
    assert.match(await page.locator("#catalog-grid").innerText(), /No hay productos/);
    const nav = async name => { await page.locator("nav").getByRole("link", { name, exact: true }).click(); await page.waitForTimeout(60); };
    const saveButton = () => page.locator("#modal-root form").getByRole("button", { name: "Guardar", exact: true }).click();
    const saved = async message => { await loadingAction(saveButton, message); await page.locator("#modal-root form").waitFor({ state: "detached" }); };
    await nav("Entidades");
    await page.getByRole("button", { name: "Nuevo registro" }).click();
    await page.getByLabel("Nombre", { exact: true }).fill("Papeleria de prueba"); await saved("Guardando categoria...");
    await page.getByRole("button", { name: "Nuevo registro" }).click();
    await page.getByLabel("Nombre", { exact: true }).fill("Papeleria de prueba");
    await loadingAction(saveButton, "Guardando categoria...");
    await page.locator("[data-form-error]").getByText("Ya existe esa categoria.").waitFor();
    assert.equal(await page.getByLabel("Nombre", { exact: true }).isEnabled(), true);
    assert.equal(await page.locator("#modal-root form").getByRole("button", { name: "Guardar", exact: true }).isEnabled(), true);
    await page.locator('#modal-root [data-modal-cancel][aria-label="Cerrar"]').click();
    await page.getByRole("button", { name: "Nuevo registro" }).click();
    await page.getByLabel("Nombre", { exact: true }).fill("Categoria temporal"); await saved("Guardando categoria...");
    await page.getByRole("button", { name: "Eliminar Categoria temporal", exact: true }).click();
    assert.equal(await page.locator("#loading-root").isVisible(), false, "A confirmation must not show a loader before the user accepts.");
    await loadingAction(() => page.locator("[data-modal-ok]").click(), "Eliminando registro...");
    assert.equal(backend.get("categorias").data.length, 1);
    await page.getByRole("tab", { name: "Clientes", exact: true }).click();
    await page.getByRole("button", { name: "Nuevo registro" }).click();
    await page.getByLabel("Nombre", { exact: true }).fill("Ana de prueba");
    await page.getByLabel("Telefono").fill("3001234567"); await page.getByLabel("Correo").fill("ana@example.com"); await saved("Guardando cliente...");
    await page.getByRole("tab", { name: "Proveedores", exact: true }).click();
    await page.getByRole("button", { name: "Nuevo registro" }).click();
    await page.getByLabel("Nombre", { exact: true }).fill("Proveedor de prueba"); await saved("Guardando proveedor...");
    await nav("Productos");
    await page.getByRole("button", { name: "Nuevo producto" }).click();
    await page.getByLabel("Codigo", { exact: true }).fill("TEST-001");
    await page.getByLabel("Nombre", { exact: true }).fill("Cuaderno de prueba");
    await page.getByLabel("Categoria", { exact: true }).selectOption({ label: "Papeleria de prueba" });
    await page.getByLabel("Precio de venta").fill("100"); await page.getByLabel("Costo", { exact: true }).fill("40"); await page.getByLabel("Stock", { exact: true }).fill("5");
    await loadingAction(saveButton, "Guardando producto...", "loader-producto-desktop.png");
    await page.locator("#modal-root form").waitFor({ state: "detached" });
    await nav("Nueva venta");
    const catalogQty = page.locator("[data-qty-for]");
    await catalogQty.fill("6");
    await page.getByRole("button", { name: "Agregar", exact: true }).click();
    await page.locator("#toast-root").getByText("Stock insuficiente para Cuaderno de prueba. Disponible: 5").waitFor();
    assert.equal(await page.locator("#ticket-root .ticket-line").count(), 0);
    await catalogQty.fill("1");
    await page.getByRole("button", { name: "Agregar", exact: true }).click();
    const ticketQty = page.locator("#ticket-root .ticket-qty");
    assert.equal(await ticketQty.getAttribute("max"), "5");
    assert.equal(await catalogQty.getAttribute("max"), "4");
    await ticketQty.fill("100");
    await page.locator("#toast-root").getByText("Stock insuficiente para Cuaderno de prueba. Disponible: 5").waitFor();
    assert.equal(await ticketQty.inputValue(), "1");
    assert.equal(await page.evaluate(() => PYL.store.currentTotal()), 100);
    await ticketQty.fill("5");
    await page.waitForFunction(() => PYL.store.getCurrentSale().items[0].cantidad === 5);
    assert.equal(await page.getByRole("button", { name: "Agregar", exact: true }).isDisabled(), true);
    await ticketQty.fill("1");
    await page.waitForFunction(() => PYL.store.getCurrentSale().items[0].cantidad === 1);
    assert.equal(await page.getByRole("button", { name: "Agregar", exact: true }).isEnabled(), true);
    await catalogQty.fill("5");
    await page.getByRole("button", { name: "Agregar", exact: true }).click();
    await page.locator("#toast-root").getByText("Stock insuficiente para Cuaderno de prueba. Disponible: 5").waitFor();
    assert.equal(await page.evaluate(() => PYL.store.getCurrentSale().items[0].cantidad), 1);
    await catalogQty.fill("1");
    await page.getByRole("button", { name: "Editar Cuaderno de prueba", exact: true }).click();
    assert.equal(await page.locator('[data-form="product"] [name="stock"]').count(), 0);
    await page.getByLabel("Precio de venta").fill("120"); await saved("Actualizando producto...");
    assert.match(await page.locator("#ticket-root").innerText(), /120/);
    await loadingAction(() => page.getByRole("button", { name: "Guardar abierta", exact: true }).click(), "Guardando venta abierta...");
    await page.waitForFunction(() => window.PYL.store.getCurrentSale().items.length === 0);
    await page.reload(); await page.getByRole("heading", { name: "Nueva venta", exact: true }).waitFor();
    await nav("Ventas"); await page.getByRole("button", { name: "Retomar venta", exact: true }).click();
    await page.waitForURL("**/#venta"); await page.getByRole("button", { name: "Cobrar", exact: true }).click();
    await page.getByRole("radio", { name: "Debe", exact: true }).check();
    await page.getByRole("button", { name: "Confirmar venta" }).click();
    await page.locator("#toast-root").getByText("Selecciona un cliente para el pago Debe.").waitFor();
    await page.getByLabel("Cliente", { exact: true }).selectOption({ label: "Ana de prueba" });
    await loadingAction(() => page.getByRole("button", { name: "Confirmar venta" }).click(), "Registrando venta...");
    await page.getByRole("heading", { name: "Venta registrada", exact: true }).waitFor();
    assert.equal(backend.get("productos").data[0].stock, 4);
    await page.getByRole("link", { name: "Ver factura", exact: true }).click();
    await page.getByRole("button", { name: "Imprimir / PDF" }).waitFor();
    await page.screenshot({ path: ".tmp-tools/factura-desktop.png", fullPage: true });
    await page.emulateMedia({ media: "print" });
    assert.equal(await page.locator(".nav").isVisible(), false);
    await page.emulateMedia({ media: "screen" });
    const categoryId = backend.get("categorias").data[0].id;
    assert.equal(backend.post("productos", "create", { id: "purchase-pen", codigo: "TEST-002", nombre: "Lapicero Azul", categoriaId: categoryId, precio: 20, costo: 10, seguimientoInventario: true, stock: 4 }).success, true);
    assert.equal(backend.post("productos", "create", { id: "purchase-service", codigo: "TEST-003", nombre: "Impresi\u00f3n de prueba", categoriaId: categoryId, precio: 15, costo: 5, seguimientoInventario: false, stock: 0 }).success, true);
    await nav("Compras");
    await loadingAction(() => page.getByRole("button", { name: "Actualizar datos", exact: true }).click(), "Actualizando datos...");
    await page.locator("#toast-root").getByText("Datos actualizados.").waitFor();
    await page.getByRole("button", { name: "Nueva compra" }).click();
    await page.getByLabel("Proveedor", { exact: true }).selectOption({ label: "Proveedor de prueba" });
    const purchaseSearch = page.getByRole("searchbox", { name: "Buscar productos", exact: true });
    const purchaseLine = name => page.locator("#purchase-lines .purchase-line").filter({ hasText: name });
    assert.equal(await page.getByRole("button", { name: "Registrar compra", exact: true }).isDisabled(), true);
    await purchaseSearch.fill("sin coincidencias");
    await page.locator("#purchase-product-results").getByText("No hay productos con ese criterio.").waitFor();
    await purchaseSearch.press("Enter");
    assert.equal(await page.locator('[data-form="purchase"]').count(), 1);
    assert.equal(backend.get("compras").data.length, 0);
    await purchaseSearch.fill("CUADERNO");
    assert.equal(await page.locator("#purchase-product-results .purchase-product-result").count(), 1);
    await page.getByRole("button", { name: "Agregar Cuaderno de prueba", exact: true }).click();
    await purchaseLine("Cuaderno de prueba").getByLabel("Cantidad", { exact: true }).fill("");
    await purchaseSearch.fill("test-002");
    await page.getByRole("button", { name: "Agregar Lapicero Azul", exact: true }).click();
    assert.equal(await page.locator("#purchase-lines .purchase-line").count(), 2);
    assert.equal(await purchaseLine("Cuaderno de prueba").getByLabel("Cantidad", { exact: true }).inputValue(), "");
    await purchaseLine("Cuaderno de prueba").getByLabel("Cantidad", { exact: true }).fill("3");
    await purchaseLine("Cuaderno de prueba").getByLabel("Costo unitario").fill("45");
    await purchaseLine("Lapicero Azul").getByLabel("Cantidad", { exact: true }).fill("2");
    await purchaseLine("Lapicero Azul").getByLabel("Costo unitario").fill("12");
    await purchaseSearch.fill("impresion");
    assert.equal(await page.locator("#purchase-product-results .purchase-product-result").count(), 1);
    await purchaseSearch.press("Enter");
    await page.locator("#purchase-lines-heading").getByText("Productos de la compra (3)").waitFor();
    assert.equal(backend.get("compras").data.length, 0);
    await purchaseLine("Impresi").getByLabel("Costo unitario").fill("8");
    await page.getByRole("button", { name: "Agregar Cuaderno de prueba", exact: true }).click();
    assert.equal(await page.locator("#purchase-lines .purchase-line").count(), 3);
    assert.equal(await purchaseLine("Cuaderno de prueba").getByLabel("Cantidad", { exact: true }).inputValue(), "4");
    assert.equal(await purchaseLine("Cuaderno de prueba").getByLabel("Costo unitario").inputValue(), "45");
    await purchaseLine("Cuaderno de prueba").getByLabel("Cantidad", { exact: true }).fill("3");
    await page.getByRole("button", { name: "Quitar Lapicero Azul", exact: true }).click();
    assert.equal(await page.locator("#purchase-lines .purchase-line").count(), 2);
    await purchaseSearch.fill("azul");
    await page.getByRole("button", { name: "Agregar Lapicero Azul", exact: true }).click();
    await purchaseLine("Lapicero Azul").getByLabel("Cantidad", { exact: true }).fill("2");
    await purchaseLine("Lapicero Azul").getByLabel("Costo unitario").fill("12");
    assert.equal(await page.getByLabel("Proveedor", { exact: true }).inputValue(), backend.get("proveedores").data[0].id);
    assert.match(await page.locator("#purchase-total").innerText(), /167/);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.querySelector(".modal").scrollWidth > document.querySelector(".modal").clientWidth + 1), false, "Purchase modal overflow at " + width);
      const actionBox = await page.getByRole("button", { name: "Registrar compra", exact: true }).boundingBox();
      const modalBox = await page.locator(".modal").boundingBox();
      assert.ok(actionBox.y >= modalBox.y && actionBox.y + actionBox.height <= modalBox.y + modalBox.height, "Purchase save button must remain visible at " + width);
      await page.screenshot({ path: ".tmp-tools/compra-multiple-" + width + ".png", fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('#modal-root [data-modal-cancel][aria-label="Cerrar"]').click();
    await page.getByRole("button", { name: "Nueva compra" }).click();
    assert.equal(await page.locator("#purchase-lines .purchase-line").count(), 3);
    assert.match(await page.locator("#purchase-total").innerText(), /167/);
    await loadingAction(() => page.getByRole("button", { name: "Registrar compra", exact: true }).click(), "Registrando compra...", "loader-compra-desktop.png");
    await page.locator("#modal-root form").waitFor({ state: "detached" });
    const purchases = backend.get("compras").data;
    assert.equal(purchases.length, 1);
    assert.equal(JSON.parse(purchases[0].itemsJson).length, 3);
    assert.equal(purchases[0].total, 167);
    assert.equal(purchases[0].proveedorId, backend.get("proveedores").data[0].id);
    assert.equal(backend.get("productos").data[0].stock, 7);
    assert.equal(backend.get("productos").data[0].costo, 45);
    const pen = backend.get("productos").data.find(p => p.id === "purchase-pen");
    assert.equal(pen.stock, 6); assert.equal(pen.costo, 12);
    const service = backend.get("productos").data.find(p => p.id === "purchase-service");
    assert.equal(service.stock, 0); assert.equal(service.costo, 8);
    await page.getByRole("button", { name: "Ver compra", exact: true }).click();
    assert.equal(await page.locator("#modal-root tbody tr").count(), 3);
    await page.locator('#modal-root [data-modal-cancel][aria-label="Cerrar"]').click();
    await nav("Entidades"); await page.getByRole("tab", { name: "Categorias", exact: true }).click();
    await page.getByRole("button", { name: "Eliminar Papeleria de prueba", exact: true }).click();
    await loadingAction(() => page.locator("[data-modal-ok]").click(), "Eliminando registro...");
    await page.locator("#toast-root").getByText("La categoria tiene productos asociados.").waitFor();
    await page.locator('[data-action="entity-tab"][data-resource="clientes"]').click();
    await page.getByRole("button", { name: "Editar Ana de prueba", exact: true }).click();
    await page.getByLabel("Telefono").fill("3007654321"); await saved("Actualizando cliente...");
    await page.locator("#entity-search").fill("Ana"); assert.equal(await page.locator(".entity-row").count(), 1);
    await page.locator("#entity-search").fill("Sin coincidencias"); assert.equal(await page.locator(".entity-row").count(), 0);
    await page.locator("#entity-search").fill("");
    await page.setViewportSize({ width: 320, height: 700 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await loadingAction(async () => {
      await page.getByRole("button", { name: "Actualizar datos", exact: true }).click();
      assert.equal(await page.locator(".loading-spinner").evaluate(el => getComputedStyle(el).animationName), "none");
    }, "Actualizando datos...", "loader-mobile.png");
    await page.emulateMedia({ reducedMotion: "no-preference" });
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
    console.log("Browser OK: loaders de carga/guardado/edicion/eliminacion, bloqueo de duplicados, recuperacion tras errores, compras multiples, inventario y responsive.");
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

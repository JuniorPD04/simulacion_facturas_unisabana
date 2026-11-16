(function (global) {
  var PYL = global.PYL, u = PYL.utils, s = PYL.store, c = PYL.components;
  var search = "", category = "", pane = "catalog";
  function productCard(p, addAction) {
    return '<article class="product-card"><img src="' + u.categoryImage(p.categoriaId) + '" alt=""><div><div class="product-title"><h3>' + u.escapeHtml(p.nombre) + '</h3>' + (addAction === "add-item" ? c.icon("quick-edit", p.id, "Editar " + p.nombre, u.iconPencil()) : "") + '</div><p class="product-card__meta">' + u.escapeHtml(p.codigo + " / " + s.label("categorias", p.categoriaId)) + '</p><strong>' + u.formatCurrency(p.precio) + '</strong><p class="product-card__stock">' + (p.seguimientoInventario ? "Stock: " + p.stock : "Sin control de inventario") + '</p><div class="qty-add"><input type="number" min="1" step="1" value="1" data-qty-for="' + u.escapeHtml(p.id) + '" aria-label="Cantidad de ' + u.escapeHtml(p.nombre) + '"><button class="button button--primary" data-action="' + addAction + '" data-id="' + u.escapeHtml(p.id) + '">Agregar</button></div></div></article>';
  }
  // RN-08: el descuento se busca y se selecciona como un producto mas, pero se
  // distingue con una insignia y no tiene cantidad ni stock.
  function discountCard(d) {
    return '<article class="product-card product-card--discount"><div><div class="product-title"><h3>' + u.escapeHtml(d.nombre) + '</h3><span class="pill">Descuento</span></div><p class="product-card__meta">' + u.escapeHtml(d.tipo === "porcentual" ? d.valor + "%" : u.formatCurrency(d.valor)) + '</p><button class="button button--primary" data-action="apply-discount" data-id="' + u.escapeHtml(d.id) + '">Aplicar</button></div></article>';
  }
  function filteredProducts() {
    return s.getProducts().filter(function (p) { return (!category || p.categoriaId === category) && (p.nombre + " " + p.codigo).toLowerCase().includes(search.toLowerCase()); });
  }
  function catalog() {
    var list = filteredProducts();
    // Los descuentos no tienen categoria: se filtran solo por texto. No se
    // ofrecen durante una correccion (RF-50: el descuento no es corregible).
    var discounts = s.isCorrecting() ? [] : s.list("descuentos").filter(function (d) { return d.nombre.toLowerCase().includes(search.toLowerCase()); });
    var addAction = s.isCorrecting() ? "correction-add-item" : "add-item";
    document.getElementById("catalog-grid").innerHTML = (list.length + discounts.length) ?
      list.map(function (p) { return productCard(p, addAction); }).join("") + discounts.map(discountCard).join("") : '<p class="empty-note">No hay productos con ese criterio.</p>';
    updateCatalogStock();
  }
  function updateCatalogStock() {
    if (s.isCorrecting()) return; // la correccion no limita por stock disponible: el backend valida la diferencia final.
    document.querySelectorAll("[data-qty-for]").forEach(function (input) {
      var product = s.getProduct(input.dataset.qtyFor);
      var available = s.availableStock(product);
      if (product.seguimientoInventario) input.max = available;
      else input.removeAttribute("max");
      input.disabled = available === 0;
      var button = input.closest(".product-card").querySelector('[data-action="add-item"]');
      button.disabled = available === 0;
      button.title = available === 0 ? "Stock disponible agotado" : "";
    });
  }
  function payment(sale) {
    var received = Number(sale.valorRecibido), change = received - s.currentNetTotal();
    return '<div class="pay-form"><h3>Pago</h3><fieldset class="pay-methods"><legend>Metodo de pago</legend>' + s.payments.map(function (m) {
      return '<label class="check"><input type="radio" name="metodoPago" value="' + m + '" data-action="pay-method"' + (sale.metodoPago === m ? " checked" : "") + '>' + m + '</label>';
    }).join("") + '</fieldset>' + (sale.metodoPago === "Efectivo" ? '<label class="field">Valor recibido<input type="number" min="0" step="1" data-action="received" value="' + u.escapeHtml(sale.valorRecibido) + '"></label><p class="change' + (change < 0 ? " is-bad" : "") + '" id="sale-change">Cambio: ' + u.formatCurrency(change) + '</p>' : "") +
      '<div class="ticket-actions"><button class="button button--ghost" data-action="back-items">Volver</button><button class="button button--primary" data-action="confirm-sale">Confirmar venta</button></div></div>';
  }
  // Vista previa con la formula de store.js; el backend vuelve a calcular todo al guardar.
  function totalsBlock() {
    var descuento = s.getAppliedDiscount(), invalid = s.discountInvalid();
    return '<dl class="totals"><div><dt>Subtotal</dt><dd>' + u.formatCurrency(s.currentTotal()) + '</dd></div>' +
      (descuento ? '<div class="totals__discount"><dt>Descuento (' + u.escapeHtml(descuento.nombre) + ')</dt><dd>-' + u.formatCurrency(s.currentDiscountAmount()) + c.icon("remove-discount", descuento.id, "Quitar descuento", u.iconTrash(), true) + '</dd></div>' : '') +
      '<div><dt>Total</dt><dd' + (invalid ? ' class="is-bad"' : '') + '>' + (invalid ? "—" : u.formatCurrency(s.currentNetTotal())) + '</dd></div></dl>' +
      (invalid ? '<p class="error" role="alert">El descuento "' + u.escapeHtml(descuento.nombre) + '" supera el subtotal. Quitalo o ajusta los productos.</p>' : '');
  }
  function refreshTotals() {
    var sale = s.getCurrentSale(), invalid = s.discountInvalid();
    document.getElementById("ticket-totals").innerHTML = totalsBlock();
    var save = document.querySelector('[data-action="save-sale"]'), pay = document.querySelector('[data-action="start-pay"]');
    if (save) save.disabled = !sale.items.length || invalid;
    if (pay) pay.disabled = !sale.items.length || invalid;
  }
  function quickClientForm() {
    PYL.ui.open({ title: "Nuevo cliente", html:
      '<form data-form="quick-client"><div class="stack">' + c.field("Nombre", "nombre", "", "text", "required maxlength=200") +
      c.field("Telefono", "telefono", "", "tel", "maxlength=80") + c.field("Correo", "correo", "", "email", "maxlength=200") +
      '</div><p class="error" data-form-error role="alert"></p><div class="modal__actions"><button class="button button--ghost" type="button" data-modal-cancel>Cancelar</button><button class="button button--primary" type="submit">Guardar</button></div></form>' });
  }
  function ticket() {
    var sale = s.getCurrentSale(), invalid = s.discountInvalid();
    document.getElementById("ticket-root").innerHTML = '<div class="ticket-head"><h2>Ticket</h2><span class="pill">' + sale.items.length + ' items</span></div>' +
      '<div class="client-row"><label class="field">Cliente<select data-action="client" aria-label="Cliente">' + c.options("clientes", sale.clienteId, "Consumidor final") + '</select></label><button class="button button--ghost" type="button" data-action="quick-client">Nuevo cliente</button></div>' +
      (sale.paso === "pago" ? payment(sale) : '<div class="ticket-list">' + (sale.items.length ? sale.items.map(function (i) {
        var product = s.getProduct(i.productoId);
        var limit = product && product.seguimientoInventario ? ' max="' + product.stock + '"' : "";
        return '<div class="ticket-line"><div><strong>' + u.escapeHtml(i.nombre) + '</strong><span>' + u.formatCurrency(i.precio) + '</span></div><input class="ticket-qty" type="number" min="1" step="1"' + limit + ' data-action="item-qty" data-id="' + u.escapeHtml(i.productoId) + '" value="' + i.cantidad + '" aria-label="Cantidad de ' + u.escapeHtml(i.nombre) + '"><strong class="ticket-sub">' + u.formatCurrency(i.precio * i.cantidad) + '</strong>' + c.icon("remove-item", i.productoId, "Quitar " + i.nombre, u.iconTrash(), true) + '</div>';
      }).join("") : '<p class="empty-note">Ticket vacio.</p>') + '</div><div class="ticket-actions"><button class="button button--ghost" data-action="clear-sale">Limpiar</button><button class="button button--ghost" data-action="save-sale"' + (!sale.items.length || invalid ? " disabled" : "") + '>Guardar abierta</button><button class="button button--primary" data-action="start-pay"' + (!sale.items.length || invalid ? " disabled" : "") + '>Cobrar</button></div>') +
      '<div id="ticket-totals">' + totalsBlock() + '</div>';
    document.getElementById("sale-layout").dataset.pane = sale.paso === "pago" ? "ticket" : pane;
    var count = document.getElementById("ticket-count");
    if (count) count.textContent = String(sale.items.length);
    updateCatalogStock();
    document.querySelectorAll("[data-pane-tab]").forEach(function (el) { var active = el.dataset.paneTab === document.getElementById("sale-layout").dataset.pane; el.classList.toggle("is-active", active); el.setAttribute("aria-selected", String(active)); });
  }
  // --- Modo correccion (3.4/RF-50): mismo layout, otra fuente de datos. ---
  function correctionTotalsBlock() {
    var correction = s.getCorrection(), invalid = s.correctionInvalid();
    return '<dl class="totals"><div><dt>Subtotal</dt><dd>' + u.formatCurrency(s.correctionSubtotal()) + '</dd></div>' +
      (correction.descuento ? '<div class="totals__discount"><dt>Descuento (' + u.escapeHtml(correction.descuento.nombre) + ') — no editable</dt><dd>-' + u.formatCurrency(s.correctionDiscountAmount()) + '</dd></div>' : '') +
      '<div><dt>Total</dt><dd' + (invalid ? ' class="is-bad"' : '') + '>' + (invalid ? "—" : u.formatCurrency(s.correctionNetTotal())) + '</dd></div></dl>' +
      (invalid ? '<p class="error" role="alert">El descuento "' + u.escapeHtml(correction.descuento.nombre) + '" supera el nuevo subtotal. Ajusta los productos.</p>' : '');
  }
  function correctionPayment(correction) {
    var received = Number(correction.valorRecibido), change = received - s.correctionNetTotal();
    return correction.metodoPago === "Efectivo" ? '<label class="field">Valor recibido<input type="number" min="0" step="1" data-action="correction-received" value="' + u.escapeHtml(correction.valorRecibido) + '"></label><p class="change' + (change < 0 ? " is-bad" : "") + '" id="correction-change">Cambio: ' + u.formatCurrency(change) + '</p>' : "";
  }
  function correctionTicket() {
    var correction = s.getCorrection(), invalid = s.correctionInvalid();
    document.getElementById("ticket-root").innerHTML = '<div class="ticket-head"><h2>Correccion</h2><span class="pill">' + correction.items.length + ' items</span></div>' +
      '<div class="client-row"><label class="field">Cliente<select data-action="correction-client" aria-label="Cliente">' + c.options("clientes", correction.clienteId, "Consumidor final") + '</select></label><button class="button button--ghost" type="button" data-action="quick-client">Nuevo cliente</button></div>' +
      '<fieldset class="pay-methods"><legend>Metodo de pago</legend>' + s.payments.map(function (m) {
        return '<label class="check"><input type="radio" name="correccionMetodoPago" value="' + m + '" data-action="correction-pay-method"' + (correction.metodoPago === m ? " checked" : "") + '>' + m + '</label>';
      }).join("") + '</fieldset>' + correctionPayment(correction) +
      '<div class="ticket-list">' + (correction.items.length ? correction.items.map(function (i) {
        return '<div class="ticket-line"><div><strong>' + u.escapeHtml(i.nombre) + '</strong><span>' + u.formatCurrency(i.precio) + '</span></div><input class="ticket-qty" type="number" min="1" step="1" data-action="correction-item-qty" data-id="' + u.escapeHtml(i.productoId) + '" value="' + i.cantidad + '" aria-label="Cantidad de ' + u.escapeHtml(i.nombre) + '"><strong class="ticket-sub">' + u.formatCurrency(i.precio * i.cantidad) + '</strong>' + c.icon("correction-remove-item", i.productoId, "Quitar " + i.nombre, u.iconTrash(), true) + '</div>';
      }).join("") : '<p class="empty-note">Sin productos.</p>') + '</div>' +
      '<div class="ticket-actions"><button class="button button--ghost" data-action="cancel-correction">Cancelar</button><button class="button button--primary" data-action="register-correction"' + (!correction.items.length || invalid ? " disabled" : "") + '>Registrar correccion</button></div>' +
      '<div id="ticket-totals">' + correctionTotalsBlock() + '</div>';
    var count = document.getElementById("ticket-count");
    if (count) count.textContent = String(correction.items.length);
    updateCatalogStock();
  }
  function refreshCorrectionTotals() {
    var correction = s.getCorrection(), invalid = s.correctionInvalid();
    document.getElementById("ticket-totals").innerHTML = correctionTotalsBlock();
    var register = document.querySelector('[data-action="register-correction"]');
    if (register) register.disabled = !correction.items.length || invalid;
  }
  PYL.views.venta = {
    render: function () {
      var correcting = s.isCorrecting();
      var banner = correcting ? '<div class="correction-banner" role="status">Corrigiendo venta #' + u.escapeHtml(s.getCorrection().ventaId.slice(0, 8).toUpperCase()) + '</div>' : '';
      return banner + '<section class="sale-layout" id="sale-layout" data-pane="' + pane + '"><div class="sale-tabs" role="tablist" aria-label="Venta"><button class="sale-tab" role="tab" data-action="sale-pane" data-pane-tab="catalog">Catalogo</button><button class="sale-tab" role="tab" aria-label="Ticket" data-action="sale-pane" data-pane-tab="ticket">Ticket <span id="ticket-count">0</span></button></div><div class="catalog-panel"><div class="panel-head"><h2>' + (correcting ? "Buscar productos" : "Nueva venta") + '</h2></div><div class="toolbar"><label class="search">Buscar<input id="sale-search" type="search" placeholder="Nombre o codigo" value="' + u.escapeHtml(search) + '"></label><select id="sale-category" aria-label="Categoria">' + c.options("categorias", category, "Todas las categorias") + '</select></div><div class="catalog-grid" id="catalog-grid"></div></div><aside class="ticket" id="ticket-root"></aside></section>';
    },
    afterRender: function () { catalog(); if (s.isCorrecting()) correctionTicket(); else ticket(); },
    handle: async function (event) {
      if (event.type === "input" && event.target.id === "sale-search") { search = event.target.value; catalog(); return; }
      if (event.type === "change" && event.target.id === "sale-category") { category = event.target.value; catalog(); return; }
      if (event.type === "submit" && event.target.dataset.form === "quick-client") {
        event.preventDefault();
        var formEl = event.target, clientData = Object.fromEntries(new FormData(formEl));
        await PYL.app.run(async function () {
          var client = await s.saveEntity("clientes", clientData, null);
          if (s.isCorrecting()) s.setCorrectionField("clienteId", client.id); else s.setSaleField("clienteId", client.id);
          PYL.ui.closeModal();
          if (s.isCorrecting()) correctionTicket(); else ticket();
          PYL.ui.toast("Cliente creado y seleccionado.");
        }, "Guardando cliente...");
        return;
      }
      var el = event.target.closest("[data-action]"); if (!el) return;
      var action = el.dataset.action;
      if (s.isCorrecting()) { await this.handleCorrection(event, el, action); return; }
      var sale = s.getCurrentSale();
      if (event.type === "input" && action === "item-qty") {
        var qty = Number(el.value);
        if (el.value === "" || !Number.isInteger(qty) || qty < 1) return;
        var item = sale.items.find(function (i) { return i.productoId === el.dataset.id; });
        try { s.updateItemQty(el.dataset.id, qty); }
        catch (error) { if (item) el.value = item.cantidad; throw error; }
        el.closest(".ticket-line").querySelector(".ticket-sub").textContent = u.formatCurrency(item.precio * item.cantidad);
        refreshTotals();
        updateCatalogStock();
        return;
      }
      if (event.type === "change") {
        if (action === "client") s.setSaleField("clienteId", el.value);
        if (action === "pay-method") { s.setSaleField("metodoPago", el.value); ticket(); }
        if (action === "item-qty") { try { s.updateItemQty(el.dataset.id, el.value); } finally { ticket(); } }
      }
      if (event.type === "input" && action === "received") {
        s.setSaleField("valorRecibido", el.value);
        var change = Number(el.value) - s.currentNetTotal(), target = document.getElementById("sale-change");
        target.textContent = "Cambio: " + u.formatCurrency(change); target.classList.toggle("is-bad", change < 0);
      }
      if (event.type !== "click") return;
      if (action === "quick-edit") c.productForm(el.dataset.id, true);
      if (action === "quick-client") quickClientForm();
      if (action === "add-item") {
        var input = Array.from(document.querySelectorAll("[data-qty-for]")).find(function (input) { return input.dataset.qtyFor === el.dataset.id; });
        s.addItem(el.dataset.id, input.value); input.value = 1; ticket(); PYL.ui.toast("Producto agregado al ticket.");
      }
      if (action === "remove-item") { s.removeItem(el.dataset.id); ticket(); }
      if (action === "apply-discount") {
        var replaced = s.applyDiscount(el.dataset.id);
        ticket();
        PYL.ui.toast(replaced ? 'Se reemplazo el descuento "' + replaced + '" por este.' : "Descuento aplicado al ticket.");
      }
      if (action === "remove-discount") { s.removeDiscount(); ticket(); }
      if (action === "sale-pane") { pane = el.dataset.paneTab; if (pane === "catalog") s.setSaleField("paso", "items"); ticket(); }
      if (action === "clear-sale" && await PYL.ui.confirm({ title: "Limpiar ticket", message: "Se iniciara un ticket nuevo y vacio. Si esta venta ya estaba guardada en Ventas, esa version no se modifica.", confirmLabel: "Limpiar" })) { s.clearSale(); ticket(); }
      if (action === "start-pay") {
        if (!sale.items.length) throw new Error("Agrega al menos un producto.");
        if (s.discountInvalid()) throw new Error("Corrige el descuento antes de cobrar.");
        s.setSaleField("paso", "pago"); ticket();
      }
      if (action === "back-items") { s.setSaleField("paso", "items"); ticket(); }
      if (action === "save-sale") await PYL.app.run(async function () { await s.saveDraft(); PYL.app.refresh(); PYL.ui.toast("Venta abierta guardada."); }, "Guardando venta abierta...");
      if (action === "confirm-sale") await PYL.app.run(async function () {
        var result = await s.closeSale(); pane = "catalog"; location.hash = "#confirmacion/" + result.record.id;
        PYL.ui.toast(result.warning || "Venta registrada.", result.warning ? "error" : "ok");
      }, "Registrando venta...");
    },
    handleCorrection: async function (event, el, action) {
      if (event.type === "input" && action === "correction-item-qty") {
        var qty = Number(el.value);
        if (el.value === "" || !Number.isInteger(qty) || qty < 1) return;
        var items = s.getCorrection().items, item = items.find(function (i) { return i.productoId === el.dataset.id; });
        try { s.correctionUpdateItemQty(el.dataset.id, qty); }
        catch (error) { if (item) el.value = item.cantidad; throw error; }
        el.closest(".ticket-line").querySelector(".ticket-sub").textContent = u.formatCurrency(item.precio * qty);
        refreshCorrectionTotals();
        return;
      }
      if (event.type === "change") {
        if (action === "correction-client") s.setCorrectionField("clienteId", el.value);
        if (action === "correction-pay-method") { s.setCorrectionField("metodoPago", el.value); correctionTicket(); }
        if (action === "correction-item-qty") { try { s.correctionUpdateItemQty(el.dataset.id, el.value); } finally { correctionTicket(); } }
      }
      if (event.type === "input" && action === "correction-received") {
        s.setCorrectionField("valorRecibido", el.value);
        var change = Number(el.value) - s.correctionNetTotal(), target = document.getElementById("correction-change");
        if (target) { target.textContent = "Cambio: " + u.formatCurrency(change); target.classList.toggle("is-bad", change < 0); }
      }
      if (event.type !== "click") return;
      if (action === "quick-client") quickClientForm();
      if (action === "correction-add-item") {
        var input = Array.from(document.querySelectorAll("[data-qty-for]")).find(function (input) { return input.dataset.qtyFor === el.dataset.id; });
        s.correctionAddItem(el.dataset.id, input.value); input.value = 1; correctionTicket(); PYL.ui.toast("Producto agregado a la correccion.");
      }
      if (action === "correction-remove-item") { s.correctionRemoveItem(el.dataset.id); correctionTicket(); }
      if (action === "sale-pane") { pane = el.dataset.paneTab; correctionTicket(); document.getElementById("sale-layout").dataset.pane = pane; }
      if (action === "cancel-correction" && await PYL.ui.confirm({ title: "Cancelar correccion", message: "No se guardara ningun cambio de esta correccion.", confirmLabel: "Cancelar correccion" })) {
        s.cancelCorrection(); PYL.app.refresh();
      }
      if (action === "register-correction") await PYL.app.run(async function () {
        var record = await s.registerCorrection();
        location.hash = "#correccionexitosa/" + record.id;
        PYL.ui.toast("Correccion registrada.");
      }, "Registrando correccion...");
    }
  };
})(window);

(function (global) {
  var PYL = global.PYL, u = PYL.utils, s = PYL.store, c = PYL.components;
  var search = "", category = "", pane = "catalog";
  function catalog() {
    var list = s.getProducts().filter(function (p) { return (!category || p.categoriaId === category) && (p.nombre + " " + p.codigo).toLowerCase().includes(search.toLowerCase()); });
    document.getElementById("catalog-grid").innerHTML = list.length ? list.map(function (p) {
      return '<article class="product-card"><img src="' + u.categoryImage(s.label("categorias", p.categoriaId)) + '" alt=""><div><div class="product-title"><h3>' + u.escapeHtml(p.nombre) + '</h3>' + c.icon("quick-edit", p.id, "Editar " + p.nombre, u.iconPencil()) + '</div><p class="product-card__meta">' + u.escapeHtml(p.codigo + " / " + s.label("categorias", p.categoriaId)) + '</p><strong>' + u.formatCurrency(p.precio) + '</strong><p class="product-card__stock">' + (p.seguimientoInventario ? "Stock: " + p.stock : "Sin control de inventario") + '</p><div class="qty-add"><input type="number" min="1" step="1" value="1" data-qty-for="' + u.escapeHtml(p.id) + '" aria-label="Cantidad de ' + u.escapeHtml(p.nombre) + '"><button class="button button--primary" data-action="add-item" data-id="' + u.escapeHtml(p.id) + '">Agregar</button></div></div></article>';
    }).join("") : '<p class="empty-note">No hay productos con ese criterio.</p>';
  }
  function payment(sale) {
    var received = Number(sale.valorRecibido), change = received - s.currentTotal();
    return '<div class="pay-form"><h3>Pago</h3><fieldset class="pay-methods"><legend>Metodo de pago</legend>' + s.payments.map(function (m) {
      return '<label class="check"><input type="radio" name="metodoPago" value="' + m + '" data-action="pay-method"' + (sale.metodoPago === m ? " checked" : "") + '>' + m + '</label>';
    }).join("") + '</fieldset>' + (sale.metodoPago === "Efectivo" ? '<label class="field">Valor recibido<input type="number" min="0" step="0.01" data-action="received" value="' + u.escapeHtml(sale.valorRecibido) + '"></label><p class="change' + (change < 0 ? " is-bad" : "") + '" id="sale-change">Cambio: ' + u.formatCurrency(change) + '</p>' : "") +
      '<div class="ticket-actions"><button class="button button--ghost" data-action="back-items">Volver</button><button class="button button--primary" data-action="confirm-sale">Confirmar venta</button></div></div>';
  }
  function ticket() {
    var sale = s.getCurrentSale();
    document.getElementById("ticket-root").innerHTML = '<div class="ticket-head"><h2>Ticket</h2><span class="pill">' + sale.items.length + ' items</span></div>' +
      '<label class="field">Cliente<select data-action="client" aria-label="Cliente">' + c.options("clientes", sale.clienteId, "Consumidor final") + '</select></label>' +
      (sale.paso === "pago" ? payment(sale) : '<div class="ticket-list">' + (sale.items.length ? sale.items.map(function (i) {
        return '<div class="ticket-line"><div><strong>' + u.escapeHtml(i.nombre) + '</strong><span>' + u.formatCurrency(i.precio) + '</span></div><input class="ticket-qty" type="number" min="1" step="1" data-action="item-qty" data-id="' + u.escapeHtml(i.productoId) + '" value="' + i.cantidad + '" aria-label="Cantidad de ' + u.escapeHtml(i.nombre) + '"><strong class="ticket-sub">' + u.formatCurrency(i.precio * i.cantidad) + '</strong>' + c.icon("remove-item", i.productoId, "Quitar " + i.nombre, u.iconTrash(), true) + '</div>';
      }).join("") : '<p class="empty-note">Ticket vacio.</p>') + '</div><div class="ticket-actions"><button class="button button--ghost" data-action="clear-sale">Limpiar</button><button class="button button--ghost" data-action="save-sale"' + (!sale.items.length ? " disabled" : "") + '>Guardar abierta</button><button class="button button--primary" data-action="start-pay"' + (!sale.items.length ? " disabled" : "") + '>Cobrar</button></div>') +
      '<dl class="totals"><div><dt>Subtotal</dt><dd>' + u.formatCurrency(s.currentTotal()) + '</dd></div><div><dt>Total</dt><dd>' + u.formatCurrency(s.currentTotal()) + '</dd></div></dl>';
    document.getElementById("sale-layout").dataset.pane = sale.paso === "pago" ? "ticket" : pane;
    var count = document.getElementById("ticket-count");
    if (count) count.textContent = String(sale.items.length);
    document.querySelectorAll("[data-pane-tab]").forEach(function (el) { var active = el.dataset.paneTab === document.getElementById("sale-layout").dataset.pane; el.classList.toggle("is-active", active); el.setAttribute("aria-selected", String(active)); });
  }
  PYL.views.venta = {
    render: function () { return '<section class="sale-layout" id="sale-layout" data-pane="' + pane + '"><div class="sale-tabs" role="tablist" aria-label="Venta"><button class="sale-tab" role="tab" data-action="sale-pane" data-pane-tab="catalog">Catalogo</button><button class="sale-tab" role="tab" aria-label="Ticket" data-action="sale-pane" data-pane-tab="ticket">Ticket <span id="ticket-count">0</span></button></div><div class="catalog-panel"><div class="panel-head"><h2>Nueva venta</h2></div><div class="toolbar"><label class="search">Buscar<input id="sale-search" type="search" placeholder="Nombre o codigo" value="' + u.escapeHtml(search) + '"></label><select id="sale-category" aria-label="Categoria">' + c.options("categorias", category, "Todas las categorias") + '</select></div><div class="catalog-grid" id="catalog-grid"></div></div><aside class="ticket" id="ticket-root"></aside></section>'; },
    afterRender: function () { catalog(); ticket(); },
    handle: async function (event) {
      if (event.type === "input" && event.target.id === "sale-search") { search = event.target.value; catalog(); return; }
      if (event.type === "change" && event.target.id === "sale-category") { category = event.target.value; catalog(); return; }
      var el = event.target.closest("[data-action]"); if (!el) return;
      var action = el.dataset.action, sale = s.getCurrentSale();
      if (event.type === "change") {
        if (action === "client") s.setSaleField("clienteId", el.value);
        if (action === "pay-method") { s.setSaleField("metodoPago", el.value); ticket(); }
        if (action === "item-qty") { try { s.updateItemQty(el.dataset.id, el.value); } finally { ticket(); } }
      }
      if (event.type === "input" && action === "received") {
        s.setSaleField("valorRecibido", el.value);
        var change = Number(el.value) - s.currentTotal(), target = document.getElementById("sale-change");
        target.textContent = "Cambio: " + u.formatCurrency(change); target.classList.toggle("is-bad", change < 0);
      }
      if (event.type !== "click") return;
      if (action === "quick-edit") c.productForm(el.dataset.id, true);
      if (action === "add-item") {
        var input = Array.from(document.querySelectorAll("[data-qty-for]")).find(function (input) { return input.dataset.qtyFor === el.dataset.id; });
        s.addItem(el.dataset.id, input.value); input.value = 1; ticket(); PYL.ui.toast("Producto agregado al ticket.");
      }
      if (action === "remove-item") { s.removeItem(el.dataset.id); ticket(); }
      if (action === "sale-pane") { pane = el.dataset.paneTab; if (pane === "catalog") s.setSaleField("paso", "items"); ticket(); }
      if (action === "clear-sale" && await PYL.ui.confirm({ title: "Limpiar ticket", message: "Se quitaran los productos de este ticket. La version guardada permanecera en Ventas.", confirmLabel: "Limpiar" })) { s.clearSale(); ticket(); }
      if (action === "start-pay") { if (!sale.items.length) throw new Error("Agrega al menos un producto."); s.setSaleField("paso", "pago"); ticket(); }
      if (action === "back-items") { s.setSaleField("paso", "items"); ticket(); }
      if (action === "save-sale") await PYL.app.run(async function () { await s.saveDraft(); PYL.app.refresh(); PYL.ui.toast("Venta abierta guardada."); });
      if (action === "confirm-sale") await PYL.app.run(async function () {
        var result = await s.closeSale(); pane = "catalog"; location.hash = "#confirmacion/" + result.record.id;
        PYL.ui.toast(result.warning || "Venta registrada.", result.warning ? "error" : "ok");
      });
    }
  };
})(window);

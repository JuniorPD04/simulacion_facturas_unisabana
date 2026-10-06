(function (global) {
  var PYL = global.PYL, u = PYL.utils, s = PYL.store, c = PYL.components;
  var draft = null, search = "", provider = "", dateFrom = "", dateTo = "";
  function newDraft() {
    var now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return { id: crypto.randomUUID(), fecha: now.toISOString().slice(0, 10), proveedorId: "", items: [] };
  }
  function purchaseForm() {
    if (!draft) draft = newDraft();
    PYL.ui.open({ title: "Nueva compra", size: "lg", html:
      '<form data-form="purchase"><div class="purchase-form-content"><div class="form-grid"><label class="field">Proveedor<select name="proveedorId" aria-label="Proveedor" data-action="purchase-provider" required>' + c.options("proveedores", draft.proveedorId) + '</select></label>' +
      c.field("Fecha", "fecha", draft.fecha, "date", 'required data-action="purchase-date"') + '</div>' +
      '<section class="purchase-picker" aria-label="Catalogo de productos"><label class="field" for="purchase-product-search">Buscar productos<input id="purchase-product-search" type="search" autocomplete="off" placeholder="Nombre o codigo" aria-controls="purchase-product-results"></label>' +
      '<span class="hint" id="purchase-result-count" role="status"></span><ul class="purchase-product-results" id="purchase-product-results"></ul></section>' +
      '<h4 class="purchase-lines-heading" id="purchase-lines-heading">Productos de la compra</h4><div id="purchase-lines"></div></div><div class="purchase-form-footer"><p class="detail-total" id="purchase-total"></p><p class="error" role="alert" data-form-error></p><div class="modal__actions"><button class="button button--ghost" type="button" data-modal-cancel>Cancelar</button><button class="button button--primary" type="submit">Registrar compra</button></div></div></form>' });
    document.querySelector('[data-form="purchase"]').closest(".modal").classList.add("modal--purchase");
    lines();
    productResults();
    document.getElementById("purchase-product-search").addEventListener("keydown", function (event) {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      if (PYL.app.isBusy()) return;
      var buttons = document.querySelectorAll('#purchase-product-results [data-action="purchase-add"]');
      if (buttons.length === 1) buttons[0].click();
      else if (buttons.length) buttons[0].focus();
    });
  }
  function searchKey(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }
  function productResults() {
    var query = searchKey(document.getElementById("purchase-product-search").value);
    var products = s.getProducts().filter(function (p) { return searchKey(p.nombre + " " + p.codigo).includes(query); });
    document.getElementById("purchase-result-count").textContent = products.length + (products.length === 1 ? " producto" : " productos");
    document.getElementById("purchase-product-results").innerHTML = products.length ? products.map(function (p) {
      var item = draft.items.find(function (i) { return i.productoId === p.id; });
      return '<li class="purchase-product-result" data-product-id="' + u.escapeHtml(p.id) + '"><div><strong>' + u.escapeHtml(p.nombre) + '</strong><span>' + u.escapeHtml(p.codigo) + ' / Costo: ' + u.formatCurrency(p.costo) + '</span>' +
        '<span class="purchase-product-added"' + (item ? "" : " hidden") + '>En compra: ' + (item && Number.isFinite(item.cantidad) ? item.cantidad : "-") + '</span>' +
        '</div><button class="button button--ghost" type="button" data-action="purchase-add" data-id="' + u.escapeHtml(p.id) + '" aria-label="Agregar ' + u.escapeHtml(p.nombre) + '">Agregar</button></li>';
    }).join("") : '<li class="empty-note">' + (s.getProducts().length ? "No hay productos con ese criterio." : "No hay productos registrados.") + '</li>';
  }
  function lines() {
    document.getElementById("purchase-lines-heading").textContent = "Productos de la compra (" + draft.items.length + ")";
    document.querySelector('[data-form="purchase"] [type="submit"]').disabled = !draft.items.length;
    document.getElementById("purchase-lines").innerHTML = draft.items.length ? draft.items.map(function (i) {
      return '<div class="purchase-line" data-product-id="' + u.escapeHtml(i.productoId) + '"><div class="purchase-line-name"><strong>' + u.escapeHtml(i.nombre) + '</strong><span>' + u.escapeHtml(i.codigo) + '</span><span class="purchase-line-subtotal"></span></div><label class="field">Cantidad<input type="number" min="1" step="1" required data-action="purchase-qty" data-id="' + u.escapeHtml(i.productoId) + '" value="' + (Number.isFinite(i.cantidad) ? i.cantidad : "") + '"></label><label class="field">Costo unitario<input type="number" min="0" step="1" required data-action="purchase-cost" data-id="' + u.escapeHtml(i.productoId) + '" value="' + (Number.isFinite(i.costo) ? i.costo : "") + '"></label>' + c.icon("purchase-remove", i.productoId, "Quitar " + i.nombre, u.iconTrash(), true) + '</div>';
    }).join("") : '<p class="empty-note">Sin productos.</p>';
    updateTotal();
  }
  function updateTotal() {
    document.querySelectorAll("#purchase-lines .purchase-line").forEach(function (line) {
      var item = draft.items.find(function (i) { return i.productoId === line.dataset.productId; });
      line.querySelector(".purchase-line-subtotal").textContent = "Subtotal: " + u.formatCurrency((Number(item.costo) || 0) * (Number(item.cantidad) || 0));
    });
    document.getElementById("purchase-total").textContent = "Total: " + u.formatCurrency(draft.items.reduce(function (sum, i) { return sum + (Number(i.costo) || 0) * (Number(i.cantidad) || 0); }, 0));
    document.querySelectorAll("#purchase-product-results .purchase-product-result").forEach(function (row) {
      var item = draft.items.find(function (i) { return i.productoId === row.dataset.productId; });
      var label = row.querySelector(".purchase-product-added");
      label.hidden = !item;
      label.textContent = "En compra: " + (item && Number.isFinite(item.cantidad) ? item.cantidad : "-");
    });
  }
  function rows() {
    var list = s.list("compras").sort(function (a, b) { return b.fecha.localeCompare(a.fecha); }).filter(function (p) {
      var day = p.fecha.slice(0, 10);
      return (!provider || p.proveedorId === provider) && (!dateFrom || day >= dateFrom) && (!dateTo || day <= dateTo) &&
        (p.id + " " + s.label("proveedores", p.proveedorId)).toLowerCase().includes(search.toLowerCase());
    });
    document.getElementById("purchases-list").innerHTML = list.length ? list.map(function (p) {
      return '<article class="record-row"><strong>C-' + u.escapeHtml(p.id.slice(0, 8).toUpperCase()) + '</strong><div>' + u.escapeHtml(s.label("proveedores", p.proveedorId)) + '<p>' + u.escapeHtml(p.fecha.slice(0, 10)) + '</p></div><strong>' + u.formatCurrency(p.total) + '</strong>' + c.icon("purchase-detail", p.id, "Ver compra", u.iconEye()) + '</article>';
    }).join("") : '<p class="empty-note">No hay compras con ese criterio.</p>';
  }
  PYL.views.compras = {
    render: function () { return '<section class="stack"><div class="panel-head"><h2>Compras</h2><button class="button button--primary" data-action="new-purchase">Nueva compra</button></div><div class="history-filters"><label class="search">Buscar<input id="purchase-search" type="search" value="' + u.escapeHtml(search) + '" placeholder="Proveedor o numero"></label>' +
      '<label class="field">Filtrar por proveedor<select id="purchase-filter-provider" aria-label="Filtrar por proveedor">' + c.options("proveedores", provider, "Todos los proveedores") + '</select></label>' +
      '<label class="field">Desde<input id="purchase-filter-from" type="date" aria-label="Desde" value="' + u.escapeHtml(dateFrom) + '"></label>' +
      '<label class="field">Hasta<input id="purchase-filter-to" type="date" aria-label="Hasta" value="' + u.escapeHtml(dateTo) + '"></label>' +
      '</div><div id="purchases-list" class="stack"></div></section>'; },
    afterRender: rows,
    handle: async function (event) {
      if (event.type === "input" && event.target.id === "purchase-product-search") { productResults(); return; }
      if (event.type === "input" && event.target.id === "purchase-search") { search = event.target.value; rows(); }
      if (event.type === "change" && event.target.id === "purchase-filter-provider") { provider = event.target.value; rows(); }
      if (event.type === "change" && event.target.id === "purchase-filter-from") { dateFrom = event.target.value; rows(); }
      if (event.type === "change" && event.target.id === "purchase-filter-to") { dateTo = event.target.value; rows(); }
      var el = event.target.closest("[data-action]"), action = el ? el.dataset.action : "";
      if (event.type === "change" && action === "purchase-provider") draft.proveedorId = el.value;
      if (event.type === "change" && action === "purchase-date") draft.fecha = el.value;
      if ((event.type === "input" || event.type === "change") && (action === "purchase-qty" || action === "purchase-cost")) {
        var item = draft.items.find(function (i) { return i.productoId === el.dataset.id; });
        item[action === "purchase-qty" ? "cantidad" : "costo"] = el.value === "" ? NaN : Number(el.value); updateTotal();
      }
      if (event.type === "submit" && event.target.dataset.form === "purchase") {
        event.preventDefault(); draft.proveedorId = event.target.elements.proveedorId.value; draft.fecha = event.target.elements.fecha.value;
        await PYL.app.run(async function () {
          var result = await s.createPurchase(draft); draft = null; PYL.ui.closeModal(); PYL.app.refresh(); PYL.ui.toast(result.warning || "Compra registrada.", result.warning ? "error" : "ok");
        }, "Registrando compra...");
      }
      if (event.type !== "click") return;
      if (action === "new-purchase") purchaseForm();
      if (action === "purchase-add") {
        var product = s.getProduct(el.dataset.id);
        if (!product) throw new Error("Selecciona un producto.");
        var existing = draft.items.find(function (i) { return i.productoId === product.id; });
        if (existing) existing.cantidad = Number.isInteger(existing.cantidad) && existing.cantidad > 0 ? existing.cantidad + 1 : 1;
        else draft.items.push({ productoId: product.id, codigo: product.codigo, nombre: product.nombre, cantidad: 1, costo: product.costo });
        lines();
        var input = document.getElementById("purchase-product-search");
        input.value = ""; productResults(); input.focus();
      }
      if (action === "purchase-remove") { draft.items = draft.items.filter(function (i) { return i.productoId !== el.dataset.id; }); lines(); productResults(); }
      if (action === "purchase-detail") {
        var p = s.get("compras", el.dataset.id);
        if (!p) throw new Error("Compra no encontrada.");
        PYL.ui.open({ title: "Detalle de compra", size: "lg", html: '<p>' + u.escapeHtml(s.label("proveedores", p.proveedorId) + " / " + p.fecha.slice(0, 10)) + '</p>' + c.lines(p.items, "costo") + '<p class="detail-total">Total: ' + u.formatCurrency(p.total) + '</p>' });
      }
    }
  };
})(window);

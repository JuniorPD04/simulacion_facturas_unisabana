(function (global) {
  var PYL = global.PYL, u = PYL.utils, s = PYL.store, c = PYL.components;
  var draft = null, search = "";
  function newDraft() {
    var now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return { id: crypto.randomUUID(), fecha: now.toISOString().slice(0, 10), proveedorId: "", items: [] };
  }
  function purchaseForm() {
    if (!draft) draft = newDraft();
    PYL.ui.open({ title: "Nueva compra", size: "lg", html:
      '<form data-form="purchase"><div class="form-grid"><label class="field">Proveedor<select name="proveedorId" aria-label="Proveedor" data-action="purchase-provider" required>' + c.options("proveedores", draft.proveedorId) + '</select></label>' +
      c.field("Fecha", "fecha", draft.fecha, "date", 'required data-action="purchase-date"') + '</div>' +
      '<div class="purchase-add"><label class="field">Producto<select id="purchase-product" aria-label="Producto">' + c.options("productos", "", "Seleccionar producto") + '</select></label><button class="button button--ghost" type="button" data-action="purchase-add">Agregar</button></div>' +
      '<div id="purchase-lines"></div><p class="detail-total" id="purchase-total"></p><p class="error" role="alert" data-form-error></p><div class="modal__actions"><button class="button button--ghost" type="button" data-modal-cancel>Cancelar</button><button class="button button--primary" type="submit">Registrar compra</button></div></form>' });
    lines();
  }
  function lines() {
    document.getElementById("purchase-lines").innerHTML = draft.items.length ? draft.items.map(function (i) {
      return '<div class="purchase-line"><strong>' + u.escapeHtml(i.nombre) + '</strong><label class="field">Cantidad<input type="number" min="1" step="1" required data-action="purchase-qty" data-id="' + u.escapeHtml(i.productoId) + '" value="' + i.cantidad + '"></label><label class="field">Costo unitario<input type="number" min="0" step="0.01" required data-action="purchase-cost" data-id="' + u.escapeHtml(i.productoId) + '" value="' + i.costo + '"></label>' + c.icon("purchase-remove", i.productoId, "Quitar " + i.nombre, u.iconTrash(), true) + '</div>';
    }).join("") : '<p class="empty-note">Sin productos.</p>';
    updateTotal();
  }
  function updateTotal() { document.getElementById("purchase-total").textContent = "Total: " + u.formatCurrency(draft.items.reduce(function (sum, i) { return sum + (Number(i.costo) || 0) * (Number(i.cantidad) || 0); }, 0)); }
  function rows() {
    var list = s.list("compras").sort(function (a, b) { return b.fecha.localeCompare(a.fecha); }).filter(function (p) { return (p.id + " " + s.label("proveedores", p.proveedorId)).toLowerCase().includes(search.toLowerCase()); });
    document.getElementById("purchases-list").innerHTML = list.length ? list.map(function (p) {
      return '<article class="record-row"><strong>C-' + u.escapeHtml(p.id.slice(0, 8).toUpperCase()) + '</strong><div>' + u.escapeHtml(s.label("proveedores", p.proveedorId)) + '<p>' + u.escapeHtml(p.fecha.slice(0, 10)) + '</p></div><strong>' + u.formatCurrency(p.total) + '</strong>' + c.icon("purchase-detail", p.id, "Ver compra", u.iconEye()) + '</article>';
    }).join("") : '<p class="empty-note">No hay compras con ese criterio.</p>';
  }
  PYL.views.compras = {
    render: function () { return '<section class="stack"><div class="panel-head"><h2>Compras</h2><button class="button button--primary" data-action="new-purchase">Nueva compra</button></div><label class="search">Buscar<input id="purchase-search" type="search" value="' + u.escapeHtml(search) + '" placeholder="Proveedor o numero"></label><div id="purchases-list" class="stack"></div></section>'; },
    afterRender: rows,
    handle: async function (event) {
      if (event.type === "input" && event.target.id === "purchase-search") { search = event.target.value; rows(); }
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
        });
      }
      if (event.type !== "click") return;
      if (action === "new-purchase") purchaseForm();
      if (action === "purchase-add") {
        var product = s.getProduct(document.getElementById("purchase-product").value);
        if (!product) throw new Error("Selecciona un producto.");
        var existing = draft.items.find(function (i) { return i.productoId === product.id; });
        if (existing) existing.cantidad += 1;
        else draft.items.push({ productoId: product.id, codigo: product.codigo, nombre: product.nombre, cantidad: 1, costo: product.costo });
        lines();
      }
      if (action === "purchase-remove") { draft.items = draft.items.filter(function (i) { return i.productoId !== el.dataset.id; }); lines(); }
      if (action === "purchase-detail") {
        var p = s.get("compras", el.dataset.id);
        if (!p) throw new Error("Compra no encontrada.");
        PYL.ui.open({ title: "Detalle de compra", size: "lg", html: '<p>' + u.escapeHtml(s.label("proveedores", p.proveedorId) + " / " + p.fecha.slice(0, 10)) + '</p>' + c.lines(p.items, "costo") + '<p class="detail-total">Total: ' + u.formatCurrency(p.total) + '</p>' });
      }
    }
  };
})(window);

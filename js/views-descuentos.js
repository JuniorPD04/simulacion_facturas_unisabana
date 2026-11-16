(function (global) {
  var PYL = global.PYL, u = PYL.utils, s = PYL.store, c = PYL.components;
  var search = "";
  function valueLabel(d) { return d.tipo === "porcentual" ? d.valor + "%" : u.formatCurrency(d.valor); }
  function rows() {
    var list = s.list("descuentos").filter(function (row) { return row.nombre.toLowerCase().includes(search.toLowerCase()); });
    document.getElementById("discounts-list").innerHTML = list.length ? list.map(function (row) {
      return '<div class="entity-row"><div><strong>' + u.escapeHtml(row.nombre) + '</strong><p>' + u.escapeHtml((row.tipo === "porcentual" ? "Porcentual" : "Valor fijo") + " / " + valueLabel(row)) + '</p></div><div class="row-actions">' +
        c.icon("edit-discount", row.id, "Editar " + row.nombre, u.iconPencil()) + c.icon("delete-discount", row.id, "Eliminar " + row.nombre, u.iconTrash(), true) + '</div></div>';
    }).join("") : '<p class="empty-note">No hay descuentos con ese criterio.</p>';
  }
  function form(id) {
    var row = id ? s.get("descuentos", id) : { tipo: "porcentual", valor: "" };
    if (!row) throw new Error("El descuento ya no existe.");
    PYL.ui.open({ title: id ? "Editar descuento" : "Nuevo descuento", html:
      '<form data-form="discount" data-id="' + u.escapeHtml(id || "") + '"><div class="stack">' + c.field("Nombre", "nombre", row.nombre, "text", "required maxlength=120") +
      '<fieldset class="pay-methods"><legend>Tipo</legend>' +
      '<label class="check"><input type="radio" name="tipo" value="porcentual"' + (row.tipo === "porcentual" ? " checked" : "") + '> Porcentual (1 a 100%)</label>' +
      '<label class="check"><input type="radio" name="tipo" value="fijo"' + (row.tipo === "fijo" ? " checked" : "") + '> Valor fijo ($)</label>' +
      '</fieldset>' + c.field("Valor", "valor", row.valor, "number", 'required min="1" step="1"') +
      '</div><p class="error" data-form-error role="alert"></p><div class="modal__actions"><button class="button button--ghost" type="button" data-modal-cancel>Cancelar</button><button class="button button--primary" type="submit">Guardar</button></div></form>' });
  }
  PYL.views.descuentos = {
    render: function () {
      return '<section class="stack"><div class="panel-head"><h2>Descuentos</h2><button class="button button--primary" data-action="new-discount">Nuevo descuento</button></div><label class="search">Buscar<input id="discount-search" type="search" value="' + u.escapeHtml(search) + '" placeholder="Nombre"></label><div id="discounts-list" class="stack"></div></section>';
    },
    afterRender: rows,
    handle: async function (event) {
      if (event.type === "input" && event.target.id === "discount-search") { search = event.target.value; rows(); }
      if (event.type === "submit" && event.target.dataset.form === "discount") {
        event.preventDefault();
        var elForm = event.target, data = Object.fromEntries(new FormData(elForm));
        await PYL.app.run(async function () { await s.saveDiscount(data, elForm.dataset.id || null); PYL.ui.closeModal(); PYL.app.refresh(); PYL.ui.toast("Descuento guardado."); }, (elForm.dataset.id ? "Actualizando " : "Guardando ") + "descuento...");
      }
      if (event.type !== "click") return;
      var el = event.target.closest("[data-action]"); if (!el) return;
      if (el.dataset.action === "new-discount") form();
      if (el.dataset.action === "edit-discount") form(el.dataset.id);
      if (el.dataset.action === "delete-discount") await c.remove("descuentos", el.dataset.id);
    }
  };
})(window);

(function (global) {
  var PYL = global.PYL, u = PYL.utils, s = PYL.store, c = PYL.components;
  var resource = "categorias", search = "";
  var titles = { categorias: "Categorias", clientes: "Clientes", proveedores: "Proveedores" };
  function rows() {
    var list = s.list(resource).filter(function (row) { return (row.nombre + " " + (row.telefono || "") + " " + (row.correo || "")).toLowerCase().includes(search.toLowerCase()); });
    document.getElementById("entities-list").innerHTML = list.length ? list.map(function (row) {
      return '<div class="entity-row"><div><strong>' + u.escapeHtml(row.nombre) + '</strong>' + (resource === "categorias" ? "" : '<p>' + u.escapeHtml(row.telefono || "") + '</p><span>' + u.escapeHtml(row.correo || "") + '</span>') + '</div><div class="row-actions">' + c.icon("edit-entity", row.id, "Editar " + row.nombre, u.iconPencil()) + c.icon("delete-entity", row.id, "Eliminar " + row.nombre, u.iconTrash(), true) + '</div></div>';
    }).join("") : '<p class="empty-note">No hay registros con ese criterio.</p>';
  }
  function form(id) {
    var row = id ? s.get(resource, id) : {};
    if (!row) throw new Error("El registro ya no existe.");
    PYL.ui.open({ title: id ? "Editar registro" : "Nuevo registro", html:
      '<form data-form="entity" data-id="' + u.escapeHtml(id || "") + '"><div class="stack">' + c.field("Nombre", "nombre", row.nombre, "text", "required maxlength=200") +
      (resource === "categorias" ? "" : c.field("Telefono", "telefono", row.telefono, "tel", "maxlength=80") + c.field("Correo", "correo", row.correo, "email", "maxlength=200")) +
      '</div><p class="error" data-form-error role="alert"></p><div class="modal__actions"><button class="button button--ghost" type="button" data-modal-cancel>Cancelar</button><button class="button button--primary" type="submit">Guardar</button></div></form>' });
  }
  PYL.views.entidades = {
    render: function () {
      return '<section class="stack"><h2>Entidades</h2><div class="entity-tabs" role="tablist" aria-label="Entidades">' + Object.keys(titles).map(function (r) {
        return '<button class="sale-tab' + (resource === r ? " is-active" : "") + '" role="tab" aria-selected="' + (resource === r) + '" data-action="entity-tab" data-resource="' + r + '">' + titles[r] + '</button>';
      }).join("") + '</div><div class="panel-head"><h3>' + titles[resource] + '</h3><button class="button button--primary" data-action="new-entity">Nuevo registro</button></div><label class="search">Buscar<input id="entity-search" type="search" value="' + u.escapeHtml(search) + '" placeholder="Nombre o contacto"></label><div id="entities-list" class="stack"></div></section>';
    },
    afterRender: rows,
    handle: async function (event) {
      if (event.type === "input" && event.target.id === "entity-search") { search = event.target.value; rows(); }
      if (event.type === "submit" && event.target.dataset.form === "entity") {
        event.preventDefault();
        var elForm = event.target, data = Object.fromEntries(new FormData(elForm));
        var entityName = { categorias: "categoria", clientes: "cliente", proveedores: "proveedor" }[resource];
        await PYL.app.run(async function () { await s.saveEntity(resource, data, elForm.dataset.id || null); PYL.ui.closeModal(); PYL.app.refresh(); PYL.ui.toast("Registro guardado."); }, (elForm.dataset.id ? "Actualizando " : "Guardando ") + entityName + "...");
      }
      if (event.type !== "click") return;
      var el = event.target.closest("[data-action]"); if (!el) return;
      if (el.dataset.action === "entity-tab") { resource = el.dataset.resource; search = ""; PYL.app.refresh(); }
      if (el.dataset.action === "new-entity") form();
      if (el.dataset.action === "edit-entity") form(el.dataset.id);
      if (el.dataset.action === "delete-entity") await c.remove(resource, el.dataset.id);
    }
  };
})(window);

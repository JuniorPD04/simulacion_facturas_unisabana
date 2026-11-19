(function (global) {
  var PYL = global.PYL, u = PYL.utils, s = PYL.store;
  PYL.views = PYL.views || {};
  function options(resource, selected, empty) {
    return '<option value="">' + u.escapeHtml(empty || "Seleccionar") + '</option>' + s.list(resource).map(function (r) {
      return '<option value="' + u.escapeHtml(r.id) + '"' + (r.id === selected ? ' selected' : '') + '>' + u.escapeHtml(r.nombre) + '</option>';
    }).join("");
  }
  function field(label, name, value, type, extra) {
    return '<label class="field">' + u.escapeHtml(label) + '<input name="' + name + '" type="' + (type || "text") + '" value="' + u.escapeHtml(value == null ? "" : value) + '" ' + (extra || "") + '></label>';
  }
  function icon(action, id, label, svg, danger) {
    return '<button type="button" class="icon-btn' + (danger ? ' icon-btn--danger' : '') + '" data-action="' + action + '" data-id="' + u.escapeHtml(id) + '" aria-label="' + u.escapeHtml(label) + '" title="' + u.escapeHtml(label) + '">' + svg + '</button>';
  }
  function lines(items, key) {
    return '<div class="table-wrap"><table><thead><tr><th>Producto</th><th>Cantidad</th><th>' + (key === "costo" ? "Costo" : "Precio") + '</th><th>Subtotal</th></tr></thead><tbody>' + items.map(function (i) {
      return '<tr><td>' + u.escapeHtml(i.nombre) + '</td><td>' + u.escapeHtml(i.cantidad) + '</td><td>' + u.formatCurrency(i[key]) + '</td><td>' + u.formatCurrency(i[key] * i.cantidad) + '</td></tr>';
    }).join("") + '</tbody></table></div>';
  }
  function productForm(id, quick) {
    var p = id ? s.getProduct(id) : { codigo: s.suggestCode(), precio: "", costo: "", stock: 0, seguimientoInventario: true };
    if (!p) throw new Error("El producto ya no existe.");
    // El cajero solo puede ajustar el precio desde la venta (el servidor lo exige igual).
    var priceOnly = Boolean(quick) && !PYL.auth.isAdmin();
    PYL.ui.open({ title: priceOnly ? "Editar precio" : id ? "Editar producto" : "Nuevo producto", size: priceOnly ? "" : "lg", html:
      '<form data-form="product" data-id="' + u.escapeHtml(id || "") + '" data-quick="' + Boolean(quick) + '"' + (priceOnly ? ' data-price-only="true"' : "") + '>' + (priceOnly ? '<p class="hint">' + u.escapeHtml(p.nombre) + '</p>' : "") + '<div class="form-grid">' +
      (quick ? "" : field("Codigo", "codigo", p.codigo, "text", "required maxlength=80")) +
      (priceOnly ? "" : field("Nombre", "nombre", p.nombre, "text", "required maxlength=200") +
      '<label class="field">Categoria<select name="categoriaId" aria-label="Categoria" required>' + options("categorias", p.categoriaId) + '</select></label>') +
      field("Precio de venta", "precio", p.precio, "number", 'required min="0" step="1"') +
      (priceOnly ? "" : field("Costo", "costo", p.costo, "number", 'required min="0" step="1"')) +
      (quick ? "" : '<label class="check"><input type="checkbox" name="seguimientoInventario"' + (p.seguimientoInventario ? " checked" : "") + '> Control de inventario</label>' +
      field("Stock", "stock", p.stock, "number", 'min="0" step="1"' + (p.seguimientoInventario ? " required" : " disabled"))) +
      '</div><p class="error" role="alert" data-form-error></p><div class="modal__actions"><button class="button button--ghost" type="button" data-modal-cancel>Cancelar</button><button class="button button--primary" type="submit">Guardar</button></div></form>' });
  }
  // Formulario corto para crear un producto desde otro flujo (compra o faltante).
  // Quien lo abre se encarga del submit (formName) y de que hacer al cerrar (onClose).
  function quickProductForm(opts) {
    PYL.ui.open({ title: opts.title || "Nuevo producto", onClose: opts.onClose, html:
      '<form data-form="' + opts.formName + '"><div class="form-grid">' +
      field("Nombre", "nombre", opts.nombre || "", "text", "required maxlength=200") +
      '<label class="field">Categoria<select name="categoriaId" aria-label="Categoria" required>' + options("categorias", "") + '</select></label>' +
      field("Precio de venta", "precio", "", "number", 'required min="0" step="1"') +
      field("Costo", "costo", "", "number", 'required min="0" step="1"') +
      '</div><p class="hint">Se crea con stock 0 y control de inventario. El stock entra al registrar la compra.</p>' +
      '<p class="error" role="alert" data-form-error></p><div class="modal__actions"><button class="button button--ghost" type="button" data-modal-cancel>Cancelar</button><button class="button button--primary" type="submit">Guardar</button></div></form>' });
  }
  async function remove(resource, id) {
    var ok = await PYL.ui.confirm({ title: "Eliminar registro", message: "Esta accion eliminara el registro seleccionado.", confirmLabel: "Eliminar", danger: true });
    if (!ok) return;
    await PYL.app.run(async function () { await s.deleteRecord(resource, id); PYL.ui.closeModal(); PYL.app.refresh(); PYL.ui.toast("Registro eliminado."); }, "Eliminando registro...");
  }
  PYL.components = {
    options: options, field: field, icon: icon, lines: lines, productForm: productForm, quickProductForm: quickProductForm, remove: remove,
    handle: async function (event) {
      var form = event.target.closest('[data-form="product"]');
      if (!form) return false;
      if (event.type === "change" && event.target.name === "seguimientoInventario") {
        form.elements.stock.disabled = !event.target.checked;
        form.elements.stock.required = event.target.checked;
        return true;
      }
      if (event.type !== "submit") return false;
      event.preventDefault();
      var data = Object.fromEntries(new FormData(form));
      data.seguimientoInventario = Boolean(form.elements.seguimientoInventario && form.elements.seguimientoInventario.checked);
      await PYL.app.run(async function () {
        await s.saveProduct(data, form.dataset.id || null, form.dataset.quick === "true");
        PYL.ui.closeModal(); PYL.app.refresh(); PYL.ui.toast("Producto guardado.");
      }, form.dataset.id ? "Actualizando producto..." : "Guardando producto...");
      return true;
    }
  };
})(window);

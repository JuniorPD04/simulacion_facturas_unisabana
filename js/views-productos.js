(function (global) {
  var PYL = global.PYL, u = PYL.utils, s = PYL.store, c = PYL.components;
  var search = "";
  function rows() {
    var products = s.getProducts().filter(function (p) {
      return (p.nombre + " " + p.codigo + " " + s.label("categorias", p.categoriaId)).toLowerCase().includes(search.toLowerCase());
    });
    document.getElementById("products-list").innerHTML = products.length ? products.map(function (p) {
      return '<div class="product-row"><div class="product-row__main"><strong>' + u.escapeHtml(p.nombre) + '</strong><span>' + u.escapeHtml(p.codigo + " / " + s.label("categorias", p.categoriaId)) + '</span></div><dl class="product-row__meta"><div><dt>Precio</dt><dd>' + u.formatCurrency(p.precio) + '</dd></div><div><dt>Costo</dt><dd>' + u.formatCurrency(p.costo) + '</dd></div><div><dt>Stock</dt><dd>' + (p.seguimientoInventario ? p.stock : "Sin control") + '</dd></div></dl><div class="row-actions">' +
        c.icon("edit-product", p.id, "Editar " + p.nombre, u.iconPencil()) + c.icon("delete-product", p.id, "Eliminar " + p.nombre, u.iconTrash(), true) + '</div></div>';
    }).join("") : '<p class="empty-note">No hay productos con ese criterio.</p>';
  }
  PYL.views = PYL.views || {};
  PYL.views.productos = {
    render: function () { return '<section class="stack"><div class="panel-head"><h2>Productos</h2><button class="button button--primary" data-action="new-product">Nuevo producto</button></div><label class="search">Buscar<input id="product-search" type="search" value="' + u.escapeHtml(search) + '" placeholder="Nombre, codigo o categoria"></label><div id="products-list" class="product-list"></div></section>'; },
    afterRender: rows,
    handle: async function (event) {
      if (event.type === "input" && event.target.id === "product-search") { search = event.target.value; rows(); return; }
      if (event.type !== "click") return;
      var el = event.target.closest("[data-action]");
      if (!el) return;
      if (el.dataset.action === "new-product") c.productForm();
      if (el.dataset.action === "edit-product") c.productForm(el.dataset.id);
      if (el.dataset.action === "delete-product") await c.remove("productos", el.dataset.id);
    }
  };
})(window);

(function (global) {
  var PYL = global.PYL, u = PYL.utils, s = PYL.store, c = PYL.components;
  var search = "";
  function rows() {
    var products = s.getProducts().filter(function (p) {
      return (p.nombre + " " + p.codigo + " " + s.label("categorias", p.categoriaId)).toLowerCase().includes(search.toLowerCase());
    });
    var canManage = PYL.auth.isAdmin();
    document.getElementById("products-list").innerHTML = products.length ? products.map(function (p) {
      return '<div class="product-row"><div class="product-row__main"><strong>' + u.escapeHtml(p.nombre) + '</strong><span>' + u.escapeHtml(p.codigo + " / " + s.label("categorias", p.categoriaId)) + '</span></div><dl class="product-row__meta"><div><dt>Precio</dt><dd>' + u.formatCurrency(p.precio) + '</dd></div><div><dt>Costo</dt><dd>' + u.formatCurrency(p.costo) + '</dd></div><div><dt>Stock</dt><dd>' + (p.seguimientoInventario ? p.stock : "Sin control") + '</dd></div></dl><div class="row-actions">' +
        (canManage ? '<button type="button" class="button button--ghost" data-action="product-providers" data-id="' + u.escapeHtml(p.id) + '">Proveedores</button>' + c.icon("edit-product", p.id, "Editar " + p.nombre, u.iconPencil()) + c.icon("delete-product", p.id, "Eliminar " + p.nombre, u.iconTrash(), true) : "") + '</div></div>';
    }).join("") : '<p class="empty-note">No hay productos con ese criterio.</p>';
  }
  PYL.views = PYL.views || {};
  PYL.views.productos = {
    // El cajero solo consulta (RF edicion de producto "en caliente" vive en el flujo de venta).
    render: function () { return '<section class="stack"><div class="panel-head"><h2>Productos</h2>' + (PYL.auth.isAdmin() ? '<button class="button button--primary" data-action="new-product">Nuevo producto</button>' : "") + '</div><label class="search">Buscar<input id="product-search" type="search" value="' + u.escapeHtml(search) + '" placeholder="Nombre, codigo o categoria"></label><div id="products-list" class="product-list"></div></section>'; },
    afterRender: rows,
    handle: async function (event) {
      if (event.type === "input" && event.target.id === "product-search") { search = event.target.value; rows(); return; }
      if (event.type !== "click") return;
      var el = event.target.closest("[data-action]");
      if (!el) return;
      if (el.dataset.action === "product-providers") {
        var product = s.getProduct(el.dataset.id);
        if (!product || !PYL.auth.isAdmin()) return;
        var list = s.getProductProviders(product.id);
        PYL.ui.open({ title: "Proveedores de " + product.nombre, html: (list.length ? '<div class="table-wrap"><table><thead><tr><th>Proveedor</th><th class="num">Compras</th><th>Ultima compra</th><th class="num">Ultimo costo</th></tr></thead><tbody>' + list.map(function (r) {
          return '<tr><td>' + u.escapeHtml(s.label("proveedores", r.proveedorId, "Proveedor eliminado")) + '</td><td class="num">' + r.compras + '</td><td>' + u.escapeHtml(String(r.ultimaFecha).slice(0, 10)) + '</td><td class="num">' + u.formatCurrency(r.ultimoCosto) + '</td></tr>';
        }).join("") + '</tbody></table></div>' : '<p class="empty-note">Este producto aun no tiene compras registradas.</p>') + '<div class="modal__actions"><button class="button button--ghost" type="button" data-modal-cancel>Cerrar</button></div>' });
      }
      if (el.dataset.action === "new-product") c.productForm();
      if (el.dataset.action === "edit-product") c.productForm(el.dataset.id);
      if (el.dataset.action === "delete-product") await c.remove("productos", el.dataset.id);
    }
  };
})(window);

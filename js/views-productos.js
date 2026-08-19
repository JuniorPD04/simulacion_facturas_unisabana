(function (global) {
  var PYL = global.PYL || (global.PYL = {});
  var u = PYL.utils;
  var editingId = null;

  function formState() {
    return {
      nombre: document.getElementById("p-nombre").value,
      categoria: document.getElementById("p-categoria").value,
      precio: document.getElementById("p-precio").value,
      costo: document.getElementById("p-costo").value,
      codigoInterno: document.getElementById("p-codigo").value,
      seguimientoInventario: document.getElementById("p-seguimiento").checked,
      stock: document.getElementById("p-stock").value
    };
  }

  function showErrors(errors) {
    PYL.ui.clearErrors(["err-nombre", "err-categoria", "err-precio", "err-costo", "err-codigo", "err-stock"]);
    Object.keys(errors || {}).forEach(function (key) {
      PYL.ui.fieldError("err-" + key, errors[key]);
    });
  }

  function formHtml() {
    var datalist = PYL.store.getCategories().map(function (category) {
      return '<option value="' + u.escapeHtml(category) + '">';
    }).join("");

    return (
      '<form id="product-form">' +
        '<div class="form-grid">' +
          '<label class="field">Nombre' +
            '<input id="p-nombre" type="text" required>' +
            '<small id="err-nombre" class="error"></small>' +
          "</label>" +
          '<label class="field">Categoría' +
            '<input id="p-categoria" type="text" list="category-options" required>' +
            '<datalist id="category-options">' + datalist + "</datalist>" +
            '<small id="err-categoria" class="error"></small>' +
          "</label>" +
          '<label class="field">Precio de venta' +
            '<input id="p-precio" type="number" min="0" step="1" required>' +
            '<small id="err-precio" class="error"></small>' +
          "</label>" +
          '<label class="field">Costo de compra' +
            '<input id="p-costo" type="number" min="0" step="1" required>' +
            '<small id="err-costo" class="error"></small>' +
          "</label>" +
          '<label class="field">Código interno' +
            '<input id="p-codigo" type="text" required>' +
            '<small id="err-codigo" class="error"></small>' +
          "</label>" +
          '<label class="check">' +
            '<input id="p-seguimiento" type="checkbox" data-action="toggle-stock" checked>' +
            "<span>Seguimiento de inventario</span>" +
          "</label>" +
          '<label id="stock-field" class="field">Stock' +
            '<input id="p-stock" type="number" min="0" step="1" value="0">' +
            '<small id="err-stock" class="error"></small>' +
          "</label>" +
        "</div>" +
        '<div class="modal__actions">' +
          '<button class="button button--ghost" type="button" data-action="cancel-product">Cancelar</button>' +
          '<button class="button button--primary" type="submit" data-action="save-product">Guardar producto</button>' +
        "</div>" +
      "</form>"
    );
  }

  function openProductModal(product) {
    PYL.ui.open({
      title: product ? "Editar producto" : "Nuevo producto",
      size: "lg",
      html: formHtml(),
      onClose: function () {
        editingId = null;
      }
    });
    document.getElementById("p-nombre").value = product ? product.nombre : "";
    document.getElementById("p-categoria").value = product ? product.categoria : "";
    document.getElementById("p-precio").value = product ? product.precio : "";
    document.getElementById("p-costo").value = product ? product.costo : "";
    document.getElementById("p-codigo").value = product ? product.codigoInterno : PYL.store.suggestCode();
    document.getElementById("p-seguimiento").checked = product ? Boolean(product.seguimientoInventario) : true;
    document.getElementById("p-stock").value = product && product.seguimientoInventario ? product.stock : 0;
    toggleStock();
    showErrors({});
    document.getElementById("p-nombre").focus();
  }

  function toggleStock() {
    var tracked = document.getElementById("p-seguimiento").checked;
    var stockField = document.getElementById("stock-field");
    if (stockField) stockField.hidden = !tracked;
  }

  function renderList() {
    var list = document.getElementById("products-list");
    var search = (document.getElementById("product-search").value || "").trim().toLowerCase();
    var products = PYL.store.getProducts().filter(function (product) {
      return (
        product.nombre.toLowerCase().includes(search) ||
        product.codigoInterno.toLowerCase().includes(search) ||
        product.categoria.toLowerCase().includes(search)
      );
    });

    document.getElementById("products-count").textContent =
      products.length + (products.length === 1 ? " producto" : " productos");

    if (!products.length) {
      list.innerHTML = '<p class="empty-note">No hay productos para mostrar.</p>';
      return;
    }

    list.innerHTML = products.map(function (product) {
      var stock = product.seguimientoInventario ? String(product.stock) : "No aplica";
      return (
        '<article class="product-row">' +
          '<div class="product-row__main">' +
            "<strong>" + u.escapeHtml(product.nombre) + "</strong>" +
            "<span>" + u.escapeHtml(product.codigoInterno) + " · " + u.escapeHtml(product.categoria) + "</span>" +
          "</div>" +
          '<dl class="product-row__meta">' +
            "<div><dt>Precio</dt><dd>" + u.formatCurrency(product.precio) + "</dd></div>" +
            "<div><dt>Costo</dt><dd>" + u.formatCurrency(product.costo) + "</dd></div>" +
            "<div><dt>Stock</dt><dd>" + u.escapeHtml(stock) + "</dd></div>" +
          "</dl>" +
          '<div class="row-actions">' +
            '<button class="icon-btn" type="button" data-action="edit-product" data-id="' + product.id + '" aria-label="Editar ' + u.escapeHtml(product.nombre) + '">' + u.iconPencil() + "</button>" +
            '<button class="icon-btn icon-btn--danger" type="button" data-action="delete-product" data-id="' + product.id + '" aria-label="Eliminar ' + u.escapeHtml(product.nombre) + '">' + u.iconTrash() + "</button>" +
          "</div>" +
        "</article>"
      );
    }).join("");
  }

  PYL.views = PYL.views || {};
  PYL.views.productos = {
    render: function () {
      return (
        '<section class="stack">' +
          '<div class="panel">' +
            '<div class="panel-head">' +
              "<div><p>Inventario</p><h2>Productos</h2></div>" +
              '<div class="panel-head__tools">' +
                '<span id="products-count" class="pill">0 productos</span>' +
                '<button class="button button--primary" type="button" data-action="new-product">Nuevo</button>' +
              "</div>" +
            "</div>" +
            '<div class="toolbar toolbar--search">' +
              '<label class="search" for="product-search">Buscar' +
                '<input id="product-search" type="search" placeholder="Nombre, código o categoría">' +
              "</label>" +
            "</div>" +
            '<div id="products-list" class="product-list"></div>' +
          "</div>" +
        "</section>"
      );
    },

    afterRender: function () {
      editingId = null;
      renderList();
    },

    handle: function (event) {
      if (event.type === "input" && event.target.id === "product-search") {
        renderList();
        return;
      }

      if (event.type === "submit") {
        event.preventDefault();
        var result = editingId
          ? PYL.store.updateProduct(editingId, formState())
          : PYL.store.createProduct(formState());
        if (!result.ok) {
          showErrors(result.errors);
          PYL.ui.toast(result.errors.general || "Revisa los campos del producto.", "error");
          return;
        }
        editingId = null;
        PYL.ui.closeModal();
        PYL.ui.toast("Producto guardado.", "ok");
        renderList();
        return;
      }

      var actionEl = event.target.closest("[data-action]");
      if (!actionEl) return;
      var action = actionEl.dataset.action;

      if (action === "new-product" && event.type === "click") {
        editingId = null;
        openProductModal(null);
        return;
      }

      if (action === "edit-product" && event.type === "click") {
        editingId = actionEl.dataset.id;
        openProductModal(PYL.store.getProduct(editingId));
        return;
      }

      if (action === "cancel-product" && event.type === "click") {
        PYL.ui.closeModal();
        return;
      }

      if (action === "toggle-stock" && event.type === "change") {
        toggleStock();
        return;
      }

      if (action === "delete-product" && event.type === "click") {
        var product = PYL.store.getProduct(actionEl.dataset.id);
        PYL.ui.confirm({
          title: "Eliminar producto",
          message: 'Se eliminará "' + (product ? product.nombre : "este producto") + '". Esta acción no se puede deshacer.',
          confirmLabel: "Eliminar",
          danger: true
        }).then(function (ok) {
          if (!ok) return;
          var deleted = PYL.store.deleteProduct(actionEl.dataset.id);
          if (!deleted.ok) {
            PYL.ui.toast(deleted.message, "error");
            return;
          }
          PYL.ui.toast("Producto eliminado.", "ok");
          renderList();
        });
      }
    }
  };
})(window);

(function (global) {
  var PYL = global.PYL || (global.PYL = {});
  var u = PYL.utils;

  function catalogQuery() {
    var search = document.getElementById("sale-search");
    var category = document.getElementById("sale-category");
    return {
      search: search ? search.value.trim().toLowerCase() : "",
      category: category ? category.value : "todos"
    };
  }

  function filteredProducts() {
    var query = catalogQuery();
    return PYL.store.getProducts().filter(function (product) {
      var matchesName =
        product.nombre.toLowerCase().includes(query.search) ||
        product.codigoInterno.toLowerCase().includes(query.search);
      var matchesCategory = query.category === "todos" || product.categoria === query.category;
      return matchesName && matchesCategory;
    });
  }

  function renderCatalog() {
    var grid = document.getElementById("catalog-grid");
    var count = document.getElementById("catalog-count");
    if (!grid) return;
    var products = filteredProducts();
    if (count) count.textContent = products.length + (products.length === 1 ? " producto" : " productos");

    if (!products.length) {
      grid.innerHTML = '<p class="empty-note">No hay productos con ese criterio.</p>';
      return;
    }

    grid.innerHTML = products.map(function (product) {
      var available = PYL.store.availableStock(product);
      var stockText = product.seguimientoInventario
        ? (available > 0 ? available + " und." : "Agotado")
        : "Sin control de stock";
      var disabled = product.seguimientoInventario && available <= 0;

      return (
        '<article class="product-card' + (disabled ? " is-disabled" : "") + '">' +
          '<img src="' + u.escapeHtml(product.imagen) + '" alt="' + u.escapeHtml(product.nombre) + '">' +
          "<div>" +
            "<h3>" + u.escapeHtml(product.nombre) + "</h3>" +
            '<p class="product-card__meta">' +
              "<span>" + u.escapeHtml(product.categoria) + "</span>" +
              "<span>" + u.escapeHtml(product.codigoInterno) + "</span>" +
            "</p>" +
            '<p class="product-card__stock">' + u.escapeHtml(stockText) + "</p>" +
            '<div class="product-card__row">' +
              '<strong>' + u.formatCurrency(product.precio) + "</strong>" +
              '<div class="qty-add">' +
                '<input type="number" min="1" value="1" data-qty-for="' + product.id + '" aria-label="Cantidad de ' + u.escapeHtml(product.nombre) + '"' + (disabled ? " disabled" : "") + ">" +
                '<button class="button button--primary" type="button" data-action="add-item" data-id="' + product.id + '"' + (disabled ? " disabled" : "") + ">Agregar</button>" +
              "</div>" +
            "</div>" +
          "</div>" +
        "</article>"
      );
    }).join("");
  }

  function ticketItemsHtml(sale) {
    if (!sale.items.length) {
      return '<div class="empty-note empty-note--ticket"><strong>Venta vacía</strong><span>Busca un producto y agrégalo para iniciar el cobro.</span></div>';
    }

    return sale.items.map(function (item) {
      return (
        '<div class="ticket-line" data-line="' + item.productId + '">' +
          "<div>" +
            "<strong>" + u.escapeHtml(item.nombre) + "</strong>" +
            "<span>" + u.escapeHtml(item.codigoInterno) + " · " + u.formatCurrency(item.precio) + "</span>" +
          "</div>" +
          '<input class="ticket-qty" type="number" min="1" value="' + item.cantidad + '" data-action="item-qty" data-id="' + item.productId + '" aria-label="Cantidad de ' + u.escapeHtml(item.nombre) + '">' +
          '<span class="ticket-sub">' + u.formatCurrency(PYL.store.lineSubtotal(item)) + "</span>" +
          '<button class="icon-button" type="button" data-action="remove-item" data-id="' + item.productId + '" aria-label="Quitar ' + u.escapeHtml(item.nombre) + '">×</button>' +
        "</div>"
      );
    }).join("");
  }

  function changeLabel(recibido, cambio) {
    if (!Number.isFinite(recibido)) return 'Cambio: <strong>' + u.formatCurrency(0) + "</strong>";
    if (cambio < 0) return 'Falta: <strong>' + u.formatCurrency(Math.abs(cambio)) + "</strong>";
    return 'Cambio: <strong>' + u.formatCurrency(cambio) + "</strong>";
  }

  function paymentHtml(sale) {
    var total = PYL.store.currentTotal();
    var recibido = PYL.utils.toNonNegativeNumber(sale.valorRecibido);
    var cambio = Number.isFinite(recibido) ? recibido - total : 0;
    var efectivo = sale.metodoPago === "efectivo";
    var debe = sale.metodoPago === "debe";

    return (
      '<div class="pay-form">' +
        "<h3>Cobro</h3>" +
        '<p class="pay-total">Total a cobrar <strong>' + u.formatCurrency(total) + "</strong></p>" +
        '<fieldset class="pay-methods">' +
          "<legend>Método de pago</legend>" +
          '<label><input type="radio" name="metodo" value="efectivo" data-action="pay-method"' + (sale.metodoPago === "efectivo" ? " checked" : "") + "> Efectivo</label>" +
          '<label><input type="radio" name="metodo" value="nequi" data-action="pay-method"' + (sale.metodoPago === "nequi" ? " checked" : "") + "> Nequi</label>" +
          '<label><input type="radio" name="metodo" value="debe" data-action="pay-method"' + (sale.metodoPago === "debe" ? " checked" : "") + "> Debe</label>" +
        "</fieldset>" +
        '<label class="field">Cliente' +
          '<input id="sale-client" type="text" value="' + u.escapeHtml(sale.cliente || "") + '" data-action="sale-client" placeholder="Nombre del cliente">' +
        "</label>" +
        (efectivo
          ? '<label class="field">Valor recibido' +
              '<input id="sale-received" type="number" min="0" step="1" value="' + u.escapeHtml(sale.valorRecibido) + '" data-action="sale-received">' +
            "</label>" +
            '<p class="change ' + (cambio < 0 ? "is-bad" : "") + '">' + changeLabel(recibido, cambio) + "</p>"
          : "") +
        (debe ? '<p class="hint">La venta quedará cerrada y el saldo quedará asociado al cliente.</p>' : "") +
        '<div class="ticket-actions">' +
          '<button class="button button--ghost" type="button" data-action="back-items">Volver</button>' +
          '<button class="button button--primary" type="button" data-action="confirm-sale">Confirmar venta</button>' +
        "</div>" +
      "</div>"
    );
  }

  var salePane = "catalog";

  function currentPane() {
    var sale = PYL.store.getCurrentSale();
    if (sale && sale.paso === "pago") return "ticket";
    return salePane;
  }

  function updateSaleDock() {
    var sale = PYL.store.getCurrentSale();
    var total = PYL.store.currentTotal();
    var count = sale.items.length;
    var countLabel = count + (count === 1 ? " ítem" : " ítems");
    var tabCount = document.getElementById("tab-ticket-count");
    var dockCount = document.getElementById("dock-count");
    var dockTotal = document.getElementById("dock-total");
    var dockPay = document.getElementById("dock-pay");
    if (tabCount) tabCount.textContent = String(count);
    if (dockCount) dockCount.textContent = countLabel;
    if (dockTotal) dockTotal.textContent = u.formatCurrency(total);
    if (dockPay) dockPay.disabled = count === 0;
  }

  function applySalePane() {
    var layout = document.getElementById("sale-layout");
    if (!layout) return;
    var pane = currentPane();
    layout.dataset.pane = pane;
    document.querySelectorAll(".sale-tab").forEach(function (tab) {
      var active = tab.dataset.paneTab === pane;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    updateSaleDock();
  }

  function setSalePane(pane) {
    salePane = pane === "ticket" ? "ticket" : "catalog";
    applySalePane();
    window.scrollTo(0, 0);
  }

  function flashDock() {
    var dock = document.getElementById("sale-dock");
    if (!dock) return;
    dock.classList.remove("is-flash");
    void dock.offsetWidth;
    dock.classList.add("is-flash");
  }

  function renderTicket() {
    var root = document.getElementById("ticket-root");
    if (!root) return;
    var sale = PYL.store.getCurrentSale();
    var total = PYL.store.currentTotal();
    updateSaleDock();

    if (sale.paso === "pago") {
      root.innerHTML = paymentHtml(sale);
      return;
    }

    root.innerHTML =
      '<div class="ticket-head">' +
        "<div><p>" + (sale.draftNumero ? "Borrador " + u.escapeHtml(sale.draftNumero) : "Venta en curso") + "</p><h2>Ticket</h2></div>" +
        '<span class="pill">' + sale.items.length + (sale.items.length === 1 ? " ítem" : " ítems") + "</span>" +
      "</div>" +
      '<div class="ticket-list">' + ticketItemsHtml(sale) + "</div>" +
      '<dl class="totals">' +
        "<div><dt>Total</dt><dd>" + u.formatCurrency(total) + "</dd></div>" +
      "</dl>" +
      '<div class="ticket-actions">' +
        '<button class="button button--ghost" type="button" data-action="clear-sale">Limpiar</button>' +
        '<button class="button button--ghost" type="button" data-action="save-sale">Guardar</button>' +
        '<button class="button button--primary" type="button" data-action="start-pay">Cobrar</button>' +
      "</div>";
  }

  PYL.views = PYL.views || {};
  PYL.views.venta = {
    render: function () {
      var categories = PYL.store.getCategories();
      var options = ['<option value="todos">Todas las categorías</option>']
        .concat(categories.map(function (category) {
          return '<option value="' + u.escapeHtml(category) + '">' + u.escapeHtml(category) + "</option>";
        }))
        .join("");

      return (
        '<section class="sale-layout" id="sale-layout" data-pane="' + currentPane() + '">' +
          '<div class="sale-tabs" role="tablist" aria-label="Venta">' +
            '<button class="sale-tab is-active" type="button" role="tab" data-action="sale-pane" data-pane-tab="catalog" aria-selected="true">Productos</button>' +
            '<button class="sale-tab" type="button" role="tab" data-action="sale-pane" data-pane-tab="ticket" aria-selected="false">Ticket <span id="tab-ticket-count">0</span></button>' +
          "</div>" +
          '<div class="panel catalog-panel">' +
            '<div class="panel-head">' +
              "<div><p>Catálogo</p><h2>Productos para venta</h2></div>" +
              '<span id="catalog-count" class="pill">0 productos</span>' +
            "</div>" +
            '<div class="toolbar">' +
              '<label class="search" for="sale-search">Buscar' +
                '<input id="sale-search" type="search" placeholder="Nombre o código">' +
              "</label>" +
              '<select id="sale-category" aria-label="Filtrar por categoría">' + options + "</select>" +
            "</div>" +
            '<div id="catalog-grid" class="catalog-grid"></div>' +
          "</div>" +
          '<aside class="ticket" id="ticket-root"></aside>' +
          '<div class="sale-dock" id="sale-dock">' +
            '<div class="sale-dock__info">' +
              '<span id="dock-count">0 ítems</span>' +
              '<strong id="dock-total">$0</strong>' +
            "</div>" +
            '<button class="button button--ghost" type="button" data-action="sale-pane" data-pane-tab="ticket">Ver ticket</button>' +
            '<button class="button button--primary" type="button" id="dock-pay" data-action="start-pay">Cobrar</button>' +
          "</div>" +
        "</section>"
      );
    },

    afterRender: function () {
      renderCatalog();
      renderTicket();
      applySalePane();
    },

    handle: function (event) {
      var actionEl = event.target.closest("[data-action]");
      var action = actionEl ? actionEl.dataset.action : "";

      if (event.type === "input" && (event.target.id === "sale-search")) {
        renderCatalog();
        return;
      }

      if (event.type === "change" && event.target.id === "sale-category") {
        renderCatalog();
        return;
      }

      if (action === "sale-pane" && event.type === "click") {
        if (actionEl.dataset.paneTab === "catalog" && PYL.store.getCurrentSale().paso === "pago") {
          PYL.store.setSaleField("paso", "items");
          renderTicket();
        }
        setSalePane(actionEl.dataset.paneTab);
        return;
      }

      if (action === "add-item" && event.type === "click") {
        var qtyInput = document.querySelector('[data-qty-for="' + actionEl.dataset.id + '"]');
        var result = PYL.store.addItem(actionEl.dataset.id, qtyInput ? qtyInput.value : 1);
        if (!result.ok) {
          PYL.ui.toast(result.message, "error");
          return;
        }
        if (qtyInput) qtyInput.value = 1;
        renderCatalog();
        renderTicket();
        flashDock();
        return;
      }

      if (action === "item-qty" && (event.type === "input" || event.type === "change")) {
        if (event.type === "input" && actionEl.value === "") return;
        var qtyResult = PYL.store.updateItemQty(actionEl.dataset.id, actionEl.value);
        var sale = PYL.store.getCurrentSale();
        var item = sale.items.find(function (entry) { return entry.productId === actionEl.dataset.id; });
        if (!qtyResult.ok) {
          PYL.ui.toast(qtyResult.message, "error");
          if (qtyResult.clamped) actionEl.value = qtyResult.cantidad;
          else if (item) actionEl.value = item.cantidad;
        }
        var line = actionEl.closest(".ticket-line");
        if (line && item) {
          line.querySelector(".ticket-sub").textContent = u.formatCurrency(PYL.store.lineSubtotal(item));
        }
        var totalEl = document.querySelector(".totals dd");
        if (totalEl) totalEl.textContent = u.formatCurrency(PYL.store.currentTotal());
        updateSaleDock();
        renderCatalog();
        return;
      }

      if (action === "remove-item" && event.type === "click") {
        PYL.store.removeItem(actionEl.dataset.id);
        renderCatalog();
        renderTicket();
        return;
      }

      if (action === "clear-sale" && event.type === "click") {
        var current = PYL.store.getCurrentSale();
        var draftNote = current.draftNumero
          ? " El borrador " + current.draftNumero + " se perderá."
          : "";
        PYL.ui.confirm({
          title: "Limpiar venta",
          message: "Se quitarán todos los productos de la venta en curso." + draftNote,
          confirmLabel: "Limpiar",
          danger: true
        }).then(function (ok) {
          if (!ok) return;
          PYL.store.clearSale();
          renderCatalog();
          renderTicket();
        });
        return;
      }

      if (action === "save-sale" && event.type === "click") {
        var saved = PYL.store.saveDraft();
        if (!saved.ok) {
          PYL.ui.toast(saved.message, "error");
          return;
        }
        renderCatalog();
        renderTicket();
        PYL.ui.toast("Borrador " + saved.sale.numero + " guardado en Ventas. Puedes retomarlo cuando quieras.", "ok");
        return;
      }

      if (action === "start-pay" && event.type === "click") {
        if (!PYL.store.getCurrentSale().items.length) {
          PYL.ui.toast("Agrega al menos un producto para cobrar.", "error");
          return;
        }
        salePane = "ticket";
        PYL.store.setSaleField("paso", "pago");
        renderTicket();
        applySalePane();
        return;
      }

      if (action === "back-items" && event.type === "click") {
        PYL.store.setSaleField("paso", "items");
        renderTicket();
        return;
      }

      if (action === "pay-method" && event.type === "change") {
        PYL.store.setSaleField("metodoPago", actionEl.value);
        if (actionEl.value === "debe") {
          var currentClient = PYL.store.getCurrentSale().cliente;
          if (!currentClient || currentClient === "Consumidor final") {
            PYL.store.setSaleField("cliente", "");
          }
        }
        renderTicket();
        return;
      }

      if (action === "sale-client" && event.type === "input") {
        PYL.store.setSaleField("cliente", actionEl.value);
        return;
      }

      if (action === "sale-received" && event.type === "input") {
        PYL.store.setSaleField("valorRecibido", actionEl.value);
        var total = PYL.store.currentTotal();
        var recibido = PYL.utils.toNonNegativeNumber(actionEl.value);
        var cambio = Number.isFinite(recibido) ? recibido - total : 0;
        var changeEl = document.querySelector(".change");
        if (changeEl) {
          changeEl.classList.toggle("is-bad", Number.isFinite(recibido) && cambio < 0);
          changeEl.innerHTML = changeLabel(recibido, cambio);
        }
        return;
      }

      if (action === "confirm-sale" && event.type === "click") {
        var closed = PYL.store.closeSale();
        if (!closed.ok) {
          PYL.ui.toast(closed.message, "error");
          return;
        }
        salePane = "catalog";
        location.hash = "#confirmacion/" + closed.sale.id;
      }
    }
  };
})(window);

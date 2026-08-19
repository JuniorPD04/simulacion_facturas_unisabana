(function (global) {
  var PYL = global.PYL || (global.PYL = {});
  var u = PYL.utils;

  function filteredSales() {
    var method = document.getElementById("sale-filter-method");
    var search = document.getElementById("sale-filter-search");
    var methodValue = method ? method.value : "todos";
    var searchValue = search ? search.value.trim().toLowerCase() : "";

    return PYL.store.getSales().filter(function (sale) {
      if (sale.estado !== "cerrada") return false;
      var matchesMethod = methodValue === "todos" || sale.metodoPago === methodValue;
      var blob = (sale.numero + " " + sale.cliente).toLowerCase();
      var matchesSearch = !searchValue || blob.indexOf(searchValue) !== -1;
      return matchesMethod && matchesSearch;
    });
  }

  function renderRows() {
    var body = document.getElementById("sales-body");
    if (!body) return;
    var sales = filteredSales();
    document.getElementById("sales-count").textContent =
      sales.length + (sales.length === 1 ? " venta" : " ventas");

    if (!sales.length) {
      body.innerHTML = '<tr><td colspan="6" class="empty-note">Aún no hay ventas cerradas.</td></tr>';
      return;
    }

    body.innerHTML = sales.map(function (sale) {
      return (
        "<tr>" +
          '<th class="sticky-col">' + u.escapeHtml(sale.numero) + "</th>" +
          "<td>" + u.escapeHtml(u.formatDateTime(sale.fecha)) + "</td>" +
          "<td>" + u.escapeHtml(sale.cliente) + "</td>" +
          "<td>" + u.escapeHtml(u.paymentLabel(sale.metodoPago)) + "</td>" +
          "<td>" + u.formatCurrency(sale.total) + "</td>" +
          '<td class="sticky-col sticky-col--end">' +
            '<div class="row-actions">' +
              '<button class="button button--ghost" type="button" data-action="open-detail" data-id="' + sale.id + '">Detalle</button>' +
              '<a class="button button--primary" href="#factura/' + sale.id + '">Factura</a>' +
            "</div>" +
          "</td>" +
        "</tr>"
      );
    }).join("");
  }

  function detailHtml(sale) {
    if (!sale) {
      return '<p class="empty-note">No se encontró la venta.</p>';
    }

    var rows = sale.items.map(function (item) {
      return (
        "<tr>" +
          "<td>" + u.escapeHtml(item.nombre) + "</td>" +
          "<td>" + item.cantidad + "</td>" +
          "<td>" + u.formatCurrency(item.precio) + "</td>" +
          "<td>" + u.formatCurrency(item.precio * item.cantidad) + "</td>" +
        "</tr>"
      );
    }).join("");

    return (
      '<div class="detail-card">' +
        "<p>" + u.escapeHtml(u.formatDateTime(sale.fecha)) + " · " + u.escapeHtml(sale.cliente) + "</p>" +
        '<div class="table-wrap"><table>' +
          "<thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>" +
          "<tbody>" + rows + "</tbody>" +
        "</table></div>" +
        '<dl class="totals">' +
          "<div><dt>Método</dt><dd>" + u.escapeHtml(u.paymentLabel(sale.metodoPago)) + "</dd></div>" +
          (sale.metodoPago === "efectivo"
            ? "<div><dt>Recibido</dt><dd>" + u.formatCurrency(sale.valorRecibido) + "</dd></div>" +
              "<div><dt>Cambio</dt><dd>" + u.formatCurrency(sale.cambio) + "</dd></div>"
            : "") +
          "<div><dt>Total</dt><dd>" + u.formatCurrency(sale.total) + "</dd></div>" +
        "</dl>" +
        '<a class="button button--primary" href="#factura/' + sale.id + '">Ver factura</a>' +
      "</div>"
    );
  }

  PYL.views = PYL.views || {};
  PYL.views.historial = {
    render: function () {
      return (
        '<section class="stack">' +
          '<div class="panel">' +
            '<div class="panel-head">' +
              "<div><p>Ventas</p><h2>Historial</h2></div>" +
              '<span id="sales-count" class="pill">0 ventas</span>' +
            "</div>" +
            '<div class="toolbar">' +
              '<label class="search" for="sale-filter-search">Buscar' +
                '<input id="sale-filter-search" type="search" placeholder="Número o cliente">' +
              "</label>" +
              '<select id="sale-filter-method" aria-label="Filtrar por método de pago">' +
                '<option value="todos">Todos los métodos</option>' +
                '<option value="efectivo">Efectivo</option>' +
                '<option value="nequi">Nequi</option>' +
                '<option value="debe">Debe</option>' +
              "</select>" +
            "</div>" +
        '<div class="table-wrap table-wrap--freeze">' +
              '<table class="data-table is-sales">' +
                "<colgroup>" +
                  '<col class="sticky-col">' +
                  '<col class="col-date">' +
                  '<col class="col-cat">' +
                  '<col class="col-pay">' +
                  '<col class="col-total">' +
                  '<col class="sticky-col sticky-col--end">' +
                "</colgroup>" +
                "<thead><tr>" +
                  '<th class="sticky-col">Número</th>' +
                  '<th class="col-date">Fecha</th>' +
                  '<th class="col-cat">Cliente</th>' +
                  '<th class="col-pay">Pago</th>' +
                  '<th class="col-total">Total</th>' +
                  '<th class="sticky-col sticky-col--end"></th>' +
                "</tr></thead>" +
                '<tbody id="sales-body"></tbody>' +
              "</table>" +
            "</div>" +
          "</div>" +
        "</section>"
      );
    },

    afterRender: function () {
      renderRows();
    },

    handle: function (event) {
      if (event.target.id === "sale-filter-search" || event.target.id === "sale-filter-method") {
        renderRows();
        return;
      }

      var actionEl = event.target.closest("[data-action]");
      if (!actionEl) return;
      if (actionEl.dataset.action === "open-detail" && event.type === "click") {
        var sale = PYL.store.getSale(actionEl.dataset.id);
        PYL.ui.open({
          title: sale ? "Venta " + sale.numero : "Detalle de venta",
          size: "lg",
          html: detailHtml(sale)
        });
      }
    }
  };

  function invoiceDocument(sale) {
    var rows = sale.items.map(function (item) {
      return (
        "<tr>" +
          "<td>" + u.escapeHtml(item.codigoInterno) + "</td>" +
          "<td>" + u.escapeHtml(item.nombre) + "</td>" +
          "<td>" + item.cantidad + "</td>" +
          "<td>" + u.formatCurrency(item.precio) + "</td>" +
          "<td>" + u.formatCurrency(item.precio * item.cantidad) + "</td>" +
        "</tr>"
      );
    }).join("");

    return (
      '<article class="invoice" id="invoice-sheet">' +
        '<header class="invoice__head">' +
          '<div class="invoice__brand">' +
            '<img src="assets/logo.svg" alt="Papel y Luna">' +
            "<div><strong>Papel y Luna</strong><span>Papelería y miscelánea</span></div>" +
          "</div>" +
          "<div>" +
            "<p>Comprobante de venta</p>" +
            "<h2>" + u.escapeHtml(sale.numero) + "</h2>" +
          "</div>" +
        "</header>" +
        '<dl class="invoice__meta">' +
          "<div><dt>Fecha</dt><dd>" + u.escapeHtml(u.formatDateTime(sale.fecha)) + "</dd></div>" +
          "<div><dt>Cliente</dt><dd>" + u.escapeHtml(sale.cliente) + "</dd></div>" +
          "<div><dt>Método de pago</dt><dd>" + u.escapeHtml(u.paymentLabel(sale.metodoPago)) + "</dd></div>" +
          "<div><dt>Estado</dt><dd>Cerrada</dd></div>" +
        "</dl>" +
        '<table class="invoice__table">' +
          "<thead><tr><th>Código</th><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>" +
          "<tbody>" + rows + "</tbody>" +
        "</table>" +
        '<section class="invoice__totals">' +
          (sale.metodoPago === "efectivo"
            ? "<p><span>Valor recibido</span><strong>" + u.formatCurrency(sale.valorRecibido) + "</strong></p>" +
              "<p><span>Cambio</span><strong>" + u.formatCurrency(sale.cambio) + "</strong></p>"
            : "") +
          "<p class=\"is-total\"><span>Total</span><strong>" + u.formatCurrency(sale.total) + "</strong></p>" +
        "</section>" +
        '<p class="invoice__foot">Documento de simulación académica. No es una factura electrónica.</p>' +
      "</article>"
    );
  }

  PYL.views.confirmacion = {
    render: function (id) {
      var sale = PYL.store.getSale(id);
      if (!sale) {
        return '<section class="panel"><p class="empty-note">No se encontró la venta confirmada.</p><a class="button button--primary" href="#venta">Ir a nueva venta</a></section>';
      }

      return (
        '<section class="confirm-layout">' +
          '<div class="panel confirm-card">' +
            "<p>Venta cerrada</p>" +
            "<h2>Pago registrado</h2>" +
            "<p>La venta <strong>" + u.escapeHtml(sale.numero) + "</strong> quedó almacenada en el historial.</p>" +
            '<dl class="totals">' +
              "<div><dt>Cliente</dt><dd>" + u.escapeHtml(sale.cliente) + "</dd></div>" +
              "<div><dt>Método</dt><dd>" + u.escapeHtml(u.paymentLabel(sale.metodoPago)) + "</dd></div>" +
              (sale.metodoPago === "efectivo"
                ? "<div><dt>Cambio</dt><dd>" + u.formatCurrency(sale.cambio) + "</dd></div>"
                : "") +
              "<div><dt>Total</dt><dd>" + u.formatCurrency(sale.total) + "</dd></div>" +
            "</dl>" +
            '<div class="ticket-actions">' +
              '<a class="button button--ghost" href="#venta">Nueva venta</a>' +
              '<a class="button button--primary" href="#factura/' + sale.id + '">Ver factura</a>' +
            "</div>" +
          "</div>" +
        "</section>"
      );
    },
    afterRender: function () {},
    handle: function () {}
  };

  PYL.views.factura = {
    render: function (id) {
      var sale = PYL.store.getSale(id);
      if (!sale) {
        return '<section class="panel"><p class="empty-note">No se encontró la factura.</p><a class="button button--primary" href="#historial">Volver al historial</a></section>';
      }

      return (
        '<section class="invoice-layout">' +
          '<div class="invoice-toolbar no-print">' +
            '<a class="button button--ghost" href="#historial">Volver</a>' +
            '<button class="button button--primary" type="button" data-action="print-invoice">Imprimir / Guardar PDF</button>' +
          "</div>" +
          invoiceDocument(sale) +
        "</section>"
      );
    },
    afterRender: function () {},
    handle: function (event) {
      var actionEl = event.target.closest("[data-action]");
      if (actionEl && actionEl.dataset.action === "print-invoice") {
        window.print();
      }
    }
  };
})(window);

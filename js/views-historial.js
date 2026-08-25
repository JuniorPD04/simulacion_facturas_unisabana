(function (global) {
  var PYL = global.PYL || (global.PYL = {});
  var u = PYL.utils;
  var statusFilter = "todos";

  function filteredSales() {
    var method = document.getElementById("sale-filter-method");
    var search = document.getElementById("sale-filter-search");
    var methodValue = method ? method.value : "todos";
    var searchValue = search ? search.value.trim().toLowerCase() : "";

    return PYL.store.getSales().filter(function (sale) {
      var blob = (sale.numero + " " + sale.cliente).toLowerCase();
      var matchesSearch = !searchValue || blob.indexOf(searchValue) !== -1;
      if (!matchesSearch) return false;
      if (statusFilter === "borrador") return sale.estado === "borrador";
      if (statusFilter === "cerrada") {
        return sale.estado === "cerrada" && (methodValue === "todos" || sale.metodoPago === methodValue);
      }
      if (sale.estado === "borrador") return methodValue === "todos";
      if (sale.estado !== "cerrada") return false;
      return methodValue === "todos" || sale.metodoPago === methodValue;
    });
  }

  function countLabel(sales) {
    var total = sales.length;
    var drafts = sales.filter(function (sale) { return sale.estado === "borrador"; }).length;
    var closed = total - drafts;
    if (!total) return "0 ventas";
    if (drafts === total) return total + (total === 1 ? " borrador" : " borradores");
    if (!drafts) return closed + (closed === 1 ? " venta" : " ventas");
    return closed + (closed === 1 ? " venta" : " ventas") + " · " + drafts + (drafts === 1 ? " borrador" : " borradores");
  }

  function saleActions(sale) {
    var numero = u.escapeHtml(sale.numero);
    if (sale.estado === "borrador") {
      return (
        '<div class="row-actions">' +
          '<button class="icon-btn icon-btn--primary" type="button" data-action="resume-draft" data-id="' + sale.id + '" aria-label="Continuar ' + numero + '">' + u.iconPlay() + "</button>" +
          '<button class="icon-btn icon-btn--danger" type="button" data-action="discard-draft" data-id="' + sale.id + '" aria-label="Descartar ' + numero + '">' + u.iconTrash() + "</button>" +
        "</div>"
      );
    }
    return (
      '<div class="row-actions">' +
        '<button class="icon-btn" type="button" data-action="open-detail" data-id="' + sale.id + '" aria-label="Ver detalle de ' + numero + '">' + u.iconEye() + "</button>" +
        '<a class="icon-btn icon-btn--primary" href="#factura/' + sale.id + '" aria-label="Ver factura de ' + numero + '">' + u.iconInvoice() + "</a>" +
      "</div>"
    );
  }

  function emptyMessage() {
    if (statusFilter === "borrador") return "Aún no hay borradores.";
    if (statusFilter === "cerrada") return "Aún no hay ventas cerradas con ese criterio.";
    return "Aún no hay ventas ni borradores con ese criterio.";
  }

  function renderRows() {
    var sales = filteredSales();
    var count = document.getElementById("sales-count");
    if (count) count.textContent = countLabel(sales);
    renderTable(sales);
    renderCards(sales);
  }

  function renderTable(sales) {
    var body = document.getElementById("sales-body");
    if (!body) return;

    if (!sales.length) {
      body.innerHTML = '<tr><td colspan="6" class="empty-note">' + emptyMessage() + "</td></tr>";
      return;
    }

    body.innerHTML = sales.map(function (sale) {
      var draft = sale.estado === "borrador";
      return (
        '<tr' + (draft ? ' class="is-draft"' : "") + ">" +
          '<th class="sticky-col">' +
            u.escapeHtml(sale.numero) +
            (draft ? '<span class="status-chip">Borrador</span>' : "") +
          "</th>" +
          "<td>" + u.escapeHtml(u.formatDateTime(sale.fecha)) + "</td>" +
          "<td>" + u.escapeHtml(sale.cliente) + "</td>" +
          "<td>" + u.escapeHtml(draft ? "Pendiente" : u.paymentLabel(sale.metodoPago)) + "</td>" +
          "<td>" + u.formatCurrency(sale.total) + "</td>" +
          '<td class="sticky-col sticky-col--end">' + saleActions(sale) + "</td>" +
        "</tr>"
      );
    }).join("");
  }

  function renderCards(sales) {
    var list = document.getElementById("sales-cards");
    if (!list) return;

    if (!sales.length) {
      list.innerHTML = '<p class="empty-note">' + emptyMessage() + "</p>";
      return;
    }

    list.innerHTML = sales.map(function (sale) {
      var draft = sale.estado === "borrador";
      var numero = u.escapeHtml(sale.numero);
      return (
        '<button class="sale-card' + (draft ? " is-draft" : "") + '" type="button" data-action="open-detail" data-id="' + sale.id + '" aria-label="Ver detalle de ' + numero + '">' +
          '<span class="sale-card__id">' +
            "<strong>" + numero + "</strong>" +
            (draft ? '<span class="status-chip">Borrador</span>' : "") +
          "</span>" +
          '<span class="sale-card__total">' + u.formatCurrency(sale.total) + "</span>" +
          '<span class="sale-card__more" aria-hidden="true">' + u.iconEye() + "</span>" +
        "</button>"
      );
    }).join("");
  }

  function detailHtml(sale) {
    if (!sale) {
      return '<p class="empty-note">No se encontró la venta.</p>';
    }

    var draft = sale.estado === "borrador";
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

    var footer = draft
      ? '<div class="ticket-actions">' +
          '<button class="button button--ghost" type="button" data-action="discard-draft" data-id="' + sale.id + '">Descartar</button>' +
          '<button class="button button--primary" type="button" data-action="resume-draft" data-id="' + sale.id + '">Continuar</button>' +
        "</div>"
      : '<a class="button button--primary" href="#factura/' + sale.id + '">Ver factura</a>';

    return (
      '<div class="detail-card">' +
        "<p>" + u.escapeHtml(u.formatDateTime(sale.fecha)) + " · " + u.escapeHtml(sale.cliente) + "</p>" +
        '<div class="table-wrap"><table>' +
          "<thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>" +
          "<tbody>" + rows + "</tbody>" +
        "</table></div>" +
        '<dl class="totals">' +
          "<div><dt>Método</dt><dd>" + u.escapeHtml(draft ? "Pendiente" : u.paymentLabel(sale.metodoPago)) + "</dd></div>" +
          (!draft && sale.metodoPago === "efectivo"
            ? "<div><dt>Recibido</dt><dd>" + u.formatCurrency(sale.valorRecibido) + "</dd></div>" +
              "<div><dt>Cambio</dt><dd>" + u.formatCurrency(sale.cambio) + "</dd></div>"
            : "") +
          "<div><dt>Total</dt><dd>" + u.formatCurrency(sale.total) + "</dd></div>" +
        "</dl>" +
        footer +
      "</div>"
    );
  }

  function adjustmentsText(adjustments) {
    return adjustments.map(function (line) {
      return "• " + line;
    }).join("\n");
  }

  function goToSale() {
    if (location.hash.replace(/^#/, "").split("/")[0] === "venta") {
      PYL.app.refresh();
      return;
    }
    location.hash = "#venta";
  }

  function applyResume(id) {
    var result = PYL.store.resumeDraft(id);
    if (!result.ok) {
      PYL.ui.toast(result.message, "error");
      renderRows();
      return;
    }
    goToSale();
    PYL.ui.toast(
      result.adjustments.length
        ? "Borrador retomado. Revisamos el stock y ajustamos el ticket."
        : "Borrador retomado. Puedes continuar la venta.",
      "ok"
    );
  }

  function resumeDraftFlow(id) {
    var preview = PYL.store.previewDraftResume(id);
    if (!preview.ok) {
      PYL.ui.toast(preview.message, "error");
      renderRows();
      return;
    }

    var current = PYL.store.getCurrentSale();
    var parkNote = current.items.length
      ? "El ticket actual se guardará también como borrador.\n\n"
      : "";

    if (preview.empty) {
      PYL.ui.confirm({
        title: "No se puede continuar",
        message: "Ningún producto de este borrador tiene stock suficiente.\n\n" +
          adjustmentsText(preview.adjustments),
        confirmLabel: "Descartar borrador",
        danger: true
      }).then(function (ok) {
        if (!ok) return;
        var discarded = PYL.store.discardDraft(id);
        if (!discarded.ok) {
          PYL.ui.toast(discarded.message, "error");
          return;
        }
        renderRows();
        PYL.ui.toast("Borrador descartado.", "ok");
      });
      return;
    }

    if (preview.adjustments.length) {
      PYL.ui.confirm({
        title: "Continuar borrador",
        message: parkNote +
          "Puedes continuar, pero el stock cambió:\n\n" +
          adjustmentsText(preview.adjustments),
        confirmLabel: "Continuar"
      }).then(function (ok) {
        if (ok) applyResume(id);
      });
      return;
    }

    if (current.items.length) {
      PYL.ui.confirm({
        title: "Continuar borrador",
        message: "Hay una venta en curso. Se guardará como borrador y se cargará " + preview.draft.numero + ".",
        confirmLabel: "Continuar"
      }).then(function (ok) {
        if (ok) applyResume(id);
      });
      return;
    }

    applyResume(id);
  }

  function syncFilterUi() {
    document.querySelectorAll("[data-action='filter-status']").forEach(function (btn) {
      var active = btn.dataset.status === statusFilter;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
    var method = document.getElementById("sale-filter-method");
    if (method) method.disabled = statusFilter === "borrador";
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
            '<div class="toolbar toolbar--sales">' +
              '<label class="search" for="sale-filter-search">Buscar' +
                '<input id="sale-filter-search" type="search" placeholder="Número o cliente">' +
              "</label>" +
              '<div class="status-filter" role="group" aria-label="Filtrar por estado">' +
                '<button class="is-active" type="button" data-action="filter-status" data-status="todos">Todas</button>' +
                '<button type="button" data-action="filter-status" data-status="cerrada">Cerradas</button>' +
                '<button type="button" data-action="filter-status" data-status="borrador">Borradores</button>' +
              "</div>" +
              '<select id="sale-filter-method" aria-label="Filtrar por método de pago">' +
                '<option value="todos">Todos los métodos</option>' +
                '<option value="efectivo">Efectivo</option>' +
                '<option value="nequi">Nequi</option>' +
                '<option value="debe">Debe</option>' +
              "</select>" +
            "</div>" +
            '<div class="table-wrap table-wrap--freeze sales-table">' +
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
            '<div id="sales-cards" class="sales-cards"></div>' +
          "</div>" +
        "</section>"
      );
    },

    afterRender: function () {
      statusFilter = "todos";
      syncFilterUi();
      renderRows();
    },

    handle: function (event) {
      if (event.target.id === "sale-filter-search" || event.target.id === "sale-filter-method") {
        renderRows();
        return;
      }

      var actionEl = event.target.closest("[data-action]");
      if (!actionEl) return;
      var action = actionEl.dataset.action;
      var id = actionEl.dataset.id;

      if (action === "filter-status" && event.type === "click") {
        statusFilter = actionEl.dataset.status || "todos";
        syncFilterUi();
        renderRows();
        return;
      }

      if (action === "open-detail" && event.type === "click") {
        var sale = PYL.store.getSale(id);
        var title = "Detalle de venta";
        if (sale) {
          title = (sale.estado === "borrador" ? "Borrador " : "Venta ") + sale.numero;
        }
        PYL.ui.open({
          title: title,
          size: "lg",
          html: detailHtml(sale)
        });
        return;
      }

      if (action === "discard-draft" && event.type === "click") {
        var draft = PYL.store.getSale(id);
        PYL.ui.confirm({
          title: "Descartar borrador",
          message: draft
            ? "Se eliminará el borrador " + draft.numero + " y no podrás retomarlo."
            : "Se eliminará este borrador.",
          confirmLabel: "Descartar",
          danger: true
        }).then(function (ok) {
          if (!ok) return;
          var result = PYL.store.discardDraft(id);
          if (!result.ok) {
            PYL.ui.toast(result.message, "error");
            return;
          }
          PYL.ui.closeModal();
          renderRows();
          PYL.ui.toast("Borrador descartado.", "ok");
        });
        return;
      }

      if (action === "resume-draft" && event.type === "click") {
        resumeDraftFlow(id);
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
        '<div class="invoice__table-wrap">' +
          '<table class="invoice__table">' +
            "<thead><tr><th>Código</th><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>" +
            "<tbody>" + rows + "</tbody>" +
          "</table>" +
        "</div>" +
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
      if (!sale || sale.estado !== "cerrada") {
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
      if (!sale || sale.estado !== "cerrada") {
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

(function (global) {
  var PYL = global.PYL, u = PYL.utils, s = PYL.store, c = PYL.components;
  var search = "", status = "", method = "", client = "", dateFrom = "", dateTo = "";
  function number(sale) { return (sale.estado === "abierta" ? "A-" : "V-") + sale.id.slice(0, 8).toUpperCase(); }
  function actions(sale) {
    return c.icon("sale-detail", sale.id, "Ver detalle", u.iconEye()) +
      (sale.estado === "abierta" ? c.icon("resume-sale", sale.id, "Retomar venta", u.iconPlay()) + c.icon("delete-sale", sale.id, "Descartar venta abierta", u.iconTrash(), true) :
      '<a class="icon-btn" title="Ver factura" aria-label="Ver factura" href="#factura/' + encodeURIComponent(sale.id) + '">' + u.iconInvoice() + '</a>');
  }
  function rows() {
    var sales = s.getSales().filter(function (sale) {
      var day = u.localDateKey(sale.fecha);
      return (!status || sale.estado === status) && (!method || sale.metodoPago === method) &&
        (!client || sale.clienteId === client) && (!dateFrom || day >= dateFrom) && (!dateTo || day <= dateTo) &&
        (number(sale) + " " + s.label("clientes", sale.clienteId, "Consumidor final")).toLowerCase().includes(search.toLowerCase());
    });
    document.getElementById("sales-list").innerHTML = sales.length ? sales.map(function (sale) {
      return '<article class="record-row"><div><strong>' + u.escapeHtml(number(sale)) + '</strong><span class="status-chip">' + u.escapeHtml(sale.estado) + '</span></div><div><span>' + u.escapeHtml(u.formatDateTime(sale.fecha)) + '</span><p>' + u.escapeHtml(s.label("clientes", sale.clienteId, "Consumidor final")) + ' / ' + u.escapeHtml(sale.metodoPago) + '</p></div><strong>' + u.formatCurrency(sale.total) + '</strong><div class="row-actions">' + actions(sale) + '</div></article>';
    }).join("") : '<p class="empty-note">No hay ventas con ese criterio.</p>';
  }
  function businessInfo() {
    var n = (PYL.config && PYL.config.negocio) || {};
    var lines = [];
    if (n.nit) lines.push("NIT: " + u.escapeHtml(n.nit));
    if (n.direccion) lines.push(u.escapeHtml(n.direccion));
    if (n.telefono) lines.push("Tel: " + u.escapeHtml(n.telefono));
    return lines.length ? '<p class="invoice__business">' + lines.join(" &middot; ") + '</p>' : "";
  }
  function invoice(id) {
    var sale = s.getSale(id);
    var nombreNegocio = (PYL.config && PYL.config.negocio && PYL.config.negocio.nombre) || "Papel y Luna";
    if (!sale || sale.estado !== "cerrada") return '<p class="empty-note">No se encontro una venta cerrada.</p>';
    return '<section class="invoice-layout"><div class="invoice-toolbar no-print"><a class="button button--ghost" href="#historial">Ventas</a><button class="button button--primary" data-action="print-invoice">Imprimir / PDF</button></div><article class="invoice"><header class="invoice__head"><div class="invoice__brand"><img src="assets/logo.svg" alt=""><div><h2>' + u.escapeHtml(nombreNegocio) + '</h2><p>Factura de venta</p>' + businessInfo() + '</div></div><strong>' + u.escapeHtml(number(sale)) + '</strong></header><dl class="invoice__meta"><div><dt>Fecha</dt><dd>' + u.escapeHtml(u.formatDateTime(sale.fecha)) + '</dd></div><div><dt>Cliente</dt><dd>' + u.escapeHtml(s.label("clientes", sale.clienteId, "Consumidor final")) + '</dd></div><div><dt>Pago</dt><dd>' + u.escapeHtml(sale.metodoPago) + '</dd></div><div><dt>Estado</dt><dd>Cerrada</dd></div></dl>' +
      c.lines(sale.items, "precio") + '<div class="invoice__totals"><p><span>Subtotal</span><strong>' + u.formatCurrency(sale.subtotal) + '</strong></p><p class="is-total"><span>Total</span><strong>' + u.formatCurrency(sale.total) + '</strong></p><p><span>Valor recibido</span><strong>' + u.formatCurrency(sale.valorRecibido) + '</strong></p><p><span>Cambio</span><strong>' + u.formatCurrency(sale.cambio) + '</strong></p></div><p class="invoice__foot">Gracias por tu compra.</p></article></section>';
  }
  PYL.views.historial = {
    render: function () {
      return '<section class="stack"><h2>Ventas</h2><div class="history-filters"><label class="search">Buscar<input id="history-search" type="search" value="' + u.escapeHtml(search) + '" placeholder="Numero o cliente"></label><select id="history-state" aria-label="Estado"><option value="">Todos los estados</option><option value="abierta"' + (status === "abierta" ? " selected" : "") + '>Abiertas</option><option value="cerrada"' + (status === "cerrada" ? " selected" : "") + '>Cerradas</option></select><select id="history-method" aria-label="Metodo de pago"><option value="">Todos los pagos</option>' + s.payments.map(function (m) { return '<option' + (method === m ? " selected" : "") + '>' + m + '</option>'; }).join("") + '</select>' +
        '<label class="field">Cliente<select id="history-client" aria-label="Cliente">' + c.options("clientes", client, "Todos los clientes") + '</select></label>' +
        '<label class="field">Desde<input id="history-from" type="date" aria-label="Desde" value="' + u.escapeHtml(dateFrom) + '"></label>' +
        '<label class="field">Hasta<input id="history-to" type="date" aria-label="Hasta" value="' + u.escapeHtml(dateTo) + '"></label>' +
        '</div><div id="sales-list" class="stack"></div></section>';
    },
    afterRender: rows,
    handle: async function (event) {
      if (event.type === "input" && event.target.id === "history-search") { search = event.target.value; rows(); }
      if (event.type === "change" && event.target.id === "history-state") { status = event.target.value; rows(); }
      if (event.type === "change" && event.target.id === "history-method") { method = event.target.value; rows(); }
      if (event.type === "change" && event.target.id === "history-client") { client = event.target.value; rows(); }
      if (event.type === "change" && event.target.id === "history-from") { dateFrom = event.target.value; rows(); }
      if (event.type === "change" && event.target.id === "history-to") { dateTo = event.target.value; rows(); }
      if (event.type !== "click") return;
      var el = event.target.closest("[data-action]"); if (!el) return;
      var sale = s.getSale(el.dataset.id);
      if (el.dataset.action === "sale-detail" && sale) {
        var payInfo = sale.estado === "cerrada" ? '<p>Valor recibido: ' + u.formatCurrency(sale.valorRecibido) + ' / Cambio: ' + u.formatCurrency(sale.cambio) + '</p>' : "";
        PYL.ui.open({ title: "Venta " + number(sale), size: "lg", html:
          '<p>' + u.escapeHtml(u.formatDateTime(sale.fecha)) + ' · ' + u.escapeHtml(sale.estado) + '</p>' +
          '<p>' + u.escapeHtml(s.label("clientes", sale.clienteId, "Consumidor final") + " / " + sale.metodoPago) + '</p>' +
          c.lines(sale.items, "precio") + payInfo +
          '<p class="detail-total">Total: ' + u.formatCurrency(sale.total) + '</p><div class="row-actions">' + actions(sale) + '</div>' });
      }
      if (el.dataset.action === "resume-sale") await PYL.app.run(async function () { await s.resumeDraft(el.dataset.id); PYL.ui.closeModal(); location.hash = "#venta"; PYL.ui.toast("Venta retomada."); });
      if (el.dataset.action === "delete-sale") await c.remove("ventas", el.dataset.id);
    }
  };
  PYL.views.factura = { render: invoice, handle: function (event) { if (event.type === "click" && event.target.closest('[data-action="print-invoice"]')) window.print(); } };
  PYL.views.confirmacion = {
    render: function (id) {
      var sale = s.getSale(id);
      return sale && sale.estado === "cerrada" ? '<section class="confirm-layout"><div class="confirm-card"><h2>Venta registrada</h2><p>' + u.escapeHtml(number(sale)) + '</p><strong>' + u.formatCurrency(sale.total) + '</strong><div class="ticket-actions"><a class="button button--ghost" href="#venta">Nueva venta</a><a class="button button--primary" href="#factura/' + encodeURIComponent(id) + '">Ver factura</a></div></div></section>' : '<p class="empty-note">Venta no encontrada.</p>';
    }
  };
})(window);

(function (global) {
  var PYL = global.PYL, u = PYL.utils, s = PYL.store, c = PYL.components;
  var search = "", status = "", method = "", client = "", dateFrom = "", dateTo = "";
  function number(sale) { return (sale.estado === "abierta" ? "A-" : "V-") + sale.id.slice(0, 8).toUpperCase(); }
  // Marca visible (RF-31/RF-43): las ventas sin corregir no cambian de aspecto.
  function correctedBadge(sale) {
    return sale.corregida ? '<span class="pill pill--corrected" title="Corregida por ' + u.escapeHtml(sale.corregidaPor || "") + ' el ' + u.escapeHtml(u.formatDateTime(sale.corregidaEn)) + '">Corregida</span>' : '';
  }
  function correctedNote(sale) {
    return sale.corregida ? '<p class="corrected-note">Corregida por ' + u.escapeHtml(sale.corregidaPor || "") + ' el ' + u.escapeHtml(u.formatDateTime(sale.corregidaEn)) + '</p>' : '';
  }
  // Marca visible (RF-64): las ventas sin reembolso no cambian de aspecto.
  function refundBadge(sale) {
    if (sale.estadoReembolso === "total") return '<span class="pill pill--refunded" title="Reembolso total">Reembolso total</span>';
    if (sale.estadoReembolso === "parcial") return '<span class="pill pill--refunded" title="Reembolso parcial">Reembolso parcial</span>';
    return '';
  }
  function refundNote(sale) {
    if (!sale.reembolsos || !sale.reembolsos.length) return '';
    var rows = sale.reembolsos.map(function (r) {
      var lines = r.items.map(function (i) {
        return u.escapeHtml(i.nombre) + ' x' + i.cantidad + (i.retornaInventario ? ' (retorna a inventario)' : ' (no retorna)');
      }).join(', ');
      return '<li>' + u.escapeHtml(u.formatDateTime(r.fecha)) + ' · ' + u.escapeHtml(r.usuario || '') + ' · ' + lines + ' · <strong>' + u.formatCurrency(r.monto) + '</strong></li>';
    }).join('');
    return '<div class="refund-note"><p>Reembolsado: <strong>' + u.formatCurrency(sale.totalReembolsado) + '</strong> · Neto: <strong>' + u.formatCurrency(sale.total - sale.totalReembolsado) + '</strong></p><ul>' + rows + '</ul></div>';
  }
  // RF-50 + 3.5: una vez que una venta tiene reembolsos, ya no se puede
  // corregir (services.ensure_sale_has_no_refunds); el boton se deshabilita
  // con una explicacion corta en vez de desaparecer, para que quede claro por
  // que ya no esta disponible.
  function correctionAction(sale) {
    if (!PYL.auth.isAdmin()) return '';
    if (sale.estadoReembolso !== "ninguno") return '<button type="button" class="icon-btn" disabled aria-label="Corregir venta (deshabilitado)" title="Tiene reembolsos registrados; ya no se puede corregir.">' + u.iconPencil() + '</button>';
    return c.icon("start-correction", sale.id, "Corregir venta", u.iconPencil());
  }
  function refundAction(sale) {
    if (!PYL.auth.isAdmin() || sale.estadoReembolso === "total") return '';
    return c.icon("start-refund", sale.id, "Reembolsar venta", u.iconRefund());
  }
  function actions(sale) {
    return c.icon("sale-detail", sale.id, "Ver detalle", u.iconEye()) +
      (sale.estado === "abierta" ? c.icon("resume-sale", sale.id, "Retomar venta", u.iconPlay()) + c.icon("delete-sale", sale.id, "Descartar venta abierta", u.iconTrash(), true) :
      '<a class="icon-btn" title="Ver factura" aria-label="Ver factura" href="#factura/' + encodeURIComponent(sale.id) + '">' + u.iconInvoice() + '</a>' +
      correctionAction(sale) + refundAction(sale));
  }
  function rows() {
    var sales = s.getSales().filter(function (sale) {
      var day = u.localDateKey(sale.fecha);
      return (!status || sale.estado === status) && (!method || sale.metodoPago === method) &&
        (!client || sale.clienteId === client) && (!dateFrom || day >= dateFrom) && (!dateTo || day <= dateTo) &&
        (number(sale) + " " + s.label("clientes", sale.clienteId, "Consumidor final")).toLowerCase().includes(search.toLowerCase());
    });
    document.getElementById("sales-list").innerHTML = sales.length ? sales.map(function (sale) {
      return '<article class="record-row"><div><strong>' + u.escapeHtml(number(sale)) + '</strong><span class="status-chip">' + u.escapeHtml(sale.estado) + '</span>' + correctedBadge(sale) + refundBadge(sale) + '</div><div><span>' + u.escapeHtml(u.formatDateTime(sale.fecha)) + '</span><p>' + u.escapeHtml(s.label("clientes", sale.clienteId, "Consumidor final")) + ' / ' + u.escapeHtml(sale.metodoPago) + '</p></div><strong>' + u.formatCurrency(sale.total) + '</strong><div class="row-actions">' + actions(sale) + '</div></article>';
    }).join("") : '<p class="empty-note">No hay ventas con ese criterio.</p>';
  }
  // Si la venta no tiene descuento, no se agrega nada (RF-18: el aspecto actual no cambia).
  function discountLine(sale) {
    return sale.descuentoNombre ? '<p><span>Descuento (' + u.escapeHtml(sale.descuentoNombre) + ')</span><strong>-' + u.formatCurrency(sale.descuentoMonto) + '</strong></p>' : '';
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
    return '<section class="invoice-layout"><div class="invoice-toolbar no-print"><a class="button button--ghost" href="#historial">Ventas</a><button class="button button--primary" data-action="print-invoice">Imprimir / PDF</button></div><article class="invoice"><header class="invoice__head"><div class="invoice__brand"><img src="assets/logo.svg" alt=""><div><h2>' + u.escapeHtml(nombreNegocio) + '</h2><p>Factura de venta</p>' + businessInfo() + '</div></div><strong>' + u.escapeHtml(number(sale)) + '</strong></header><dl class="invoice__meta"><div><dt>Fecha</dt><dd>' + u.escapeHtml(u.formatDateTime(sale.fecha)) + '</dd></div><div><dt>Cliente</dt><dd>' + u.escapeHtml(s.label("clientes", sale.clienteId, "Consumidor final")) + '</dd></div><div><dt>Pago</dt><dd>' + u.escapeHtml(sale.metodoPago) + '</dd></div><div><dt>Estado</dt><dd>Cerrada</dd></div></dl>' + correctedNote(sale) + refundNote(sale) +
      c.lines(sale.items, "precio") + '<div class="invoice__totals"><p><span>Subtotal</span><strong>' + u.formatCurrency(sale.subtotal) + '</strong></p>' + discountLine(sale) + '<p class="is-total"><span>Total</span><strong>' + u.formatCurrency(sale.total) + '</strong></p><p><span>Valor recibido</span><strong>' + u.formatCurrency(sale.valorRecibido) + '</strong></p><p><span>Cambio</span><strong>' + u.formatCurrency(sale.cambio) + '</strong></p></div><p class="invoice__foot">Gracias por tu compra.</p></article></section>';
  }
  // --- Modal de reembolso (3.5/RF-60..65). ---
  function refundLineRow(l) {
    var disabled = l.disponible === 0;
    return '<tr><td>' + u.escapeHtml(l.nombre) + '</td><td>' + l.vendido + '</td><td>' + l.yaReembolsado + '</td><td>' + l.disponible + '</td>' +
      '<td><div class="qty-stepper"><button type="button" class="icon-btn" data-action="refund-qty-dec" data-id="' + u.escapeHtml(l.productoId) + '"' + (disabled ? ' disabled' : '') + ' aria-label="Restar">-</button>' +
      '<input type="number" min="0" max="' + l.disponible + '" step="1" value="' + l.cantidad + '" data-action="refund-qty" data-id="' + u.escapeHtml(l.productoId) + '" aria-label="Cantidad a reembolsar de ' + u.escapeHtml(l.nombre) + '"' + (disabled ? ' disabled' : '') + '>' +
      '<button type="button" class="icon-btn" data-action="refund-qty-inc" data-id="' + u.escapeHtml(l.productoId) + '"' + (disabled ? ' disabled' : '') + ' aria-label="Sumar">+</button></div></td>' +
      '<td><label class="check" title="Retorna al inventario"><input type="checkbox" data-action="refund-retorna" data-id="' + u.escapeHtml(l.productoId) + '"' + (l.retornaInventario ? ' checked' : '') + (disabled ? ' disabled' : '') + '> Retorna</label></td></tr>';
  }
  function refundModalBody() {
    var r = s.getRefund(), preview = s.refundPreviewTotal();
    var hasPending = r.lines.some(function (l) { return l.disponible > 0; });
    var hasSelection = r.lines.some(function (l) { return l.cantidad > 0; });
    return '<div class="table-wrap"><table class="refund-table"><thead><tr><th>Producto</th><th>Vendido</th><th>Ya reemb.</th><th>Disponible</th><th>Cantidad</th><th title="Retorna al inventario">Retorna</th></tr></thead><tbody>' +
      r.lines.map(refundLineRow).join("") + '</tbody></table></div>' +
      '<div class="refund-preview"><span>Vista previa del monto</span><strong id="refund-preview-amount">' + u.formatCurrency(preview) + '</strong></div>' +
      '<div class="modal__actions"><button class="button button--ghost" type="button" data-action="refund-fill-all"' + (hasPending ? '' : ' disabled') + '>Reembolsar todo</button>' +
      '<button class="button button--ghost" type="button" data-modal-cancel>Cancelar</button>' +
      '<button class="button button--primary" type="button" data-action="refund-submit"' + (hasSelection ? '' : ' disabled') + '>Reembolsar</button></div>';
  }
  function refreshRefundModal() {
    var body = document.getElementById("refund-modal-body");
    if (body) body.innerHTML = refundModalBody();
  }
  function openRefundModal(sale) {
    s.startRefund(sale.id);
    PYL.ui.open({ title: "Reembolsar " + number(sale), size: "lg", html: '<div id="refund-modal-body">' + refundModalBody() + '</div>' });
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
      if (event.type === "input" && event.target.dataset.action === "refund-qty") {
        s.refundSetLineQty(event.target.dataset.id, event.target.value === "" ? 0 : event.target.value);
        refreshRefundModal();
        return;
      }
      if (event.type === "change" && event.target.dataset.action === "refund-retorna") {
        s.refundSetLineRetorna(event.target.dataset.id, event.target.checked);
        return;
      }
      if (event.type !== "click") return;
      var el = event.target.closest("[data-action]"); if (!el) return;
      var sale = s.getSale(el.dataset.id);
      if (el.dataset.action === "start-refund" && sale) { openRefundModal(sale); return; }
      if (el.dataset.action === "refund-fill-all") { s.refundFillAll(); refreshRefundModal(); return; }
      if (el.dataset.action === "refund-qty-inc" || el.dataset.action === "refund-qty-dec") {
        var line = s.getRefund().lines.find(function (l) { return l.productoId === el.dataset.id; });
        var delta = el.dataset.action === "refund-qty-inc" ? 1 : -1;
        s.refundSetLineQty(el.dataset.id, Math.max(0, (line ? line.cantidad : 0) + delta));
        refreshRefundModal();
        return;
      }
      if (el.dataset.action === "refund-submit") {
        var monto = s.refundPreviewTotal();
        if (await PYL.ui.confirm({ title: "Confirmar reembolso", message: "Se registrara un reembolso por " + u.formatCurrency(monto) + " y se ajustara el inventario segun lo marcado. Esta accion no se puede deshacer.", confirmLabel: "Reembolsar" })) {
          await PYL.app.run(async function () {
            var record = await s.registerRefund();
            PYL.ui.closeModal();
            location.hash = "#reembolsoexitoso/" + record.id;
          }, "Registrando reembolso...");
        }
        return;
      }
      if (el.dataset.action === "sale-detail" && sale) {
        var payInfo = sale.estado === "cerrada" ? '<p>Valor recibido: ' + u.formatCurrency(sale.valorRecibido) + ' / Cambio: ' + u.formatCurrency(sale.cambio) + '</p>' : "";
        // Si no hay descuento, no se agrega el subtotal: el aspecto no cambia.
        var discountInfo = sale.descuentoNombre ? '<p>Subtotal: ' + u.formatCurrency(sale.subtotal) + '</p><p>Descuento (' + u.escapeHtml(sale.descuentoNombre) + '): -' + u.formatCurrency(sale.descuentoMonto) + '</p>' : "";
        PYL.ui.open({ title: "Venta " + number(sale), size: "lg", html:
          '<p>' + u.escapeHtml(u.formatDateTime(sale.fecha)) + ' · ' + u.escapeHtml(sale.estado) + '</p>' +
          '<p>' + u.escapeHtml(s.label("clientes", sale.clienteId, "Consumidor final") + " / " + sale.metodoPago) + '</p>' + correctedNote(sale) + refundNote(sale) +
          c.lines(sale.items, "precio") + discountInfo + payInfo +
          '<p class="detail-total">Total: ' + u.formatCurrency(sale.total) + '</p><div class="row-actions">' + actions(sale) + '</div>' });
      }
      if (el.dataset.action === "resume-sale") await PYL.app.run(async function () { await s.resumeDraft(el.dataset.id); PYL.ui.closeModal(); location.hash = "#venta"; PYL.ui.toast("Venta retomada."); }, "Retomando venta...");
      if (el.dataset.action === "delete-sale") await c.remove("ventas", el.dataset.id);
      if (el.dataset.action === "start-correction") { s.startCorrection(el.dataset.id); PYL.ui.closeModal(); location.hash = "#venta"; }
    }
  };
  PYL.views.factura = { render: invoice, handle: function (event) { if (event.type === "click" && event.target.closest('[data-action="print-invoice"]')) window.print(); } };
  PYL.views.confirmacion = {
    render: function (id) {
      var sale = s.getSale(id);
      if (!sale || sale.estado !== "cerrada") return '<p class="empty-note">Venta no encontrada.</p>';
      var breakdown = sale.descuentoNombre ? '<p>Subtotal ' + u.formatCurrency(sale.subtotal) + ' · Descuento (' + u.escapeHtml(sale.descuentoNombre) + ') -' + u.formatCurrency(sale.descuentoMonto) + '</p>' : '';
      return '<section class="confirm-layout"><div class="confirm-card"><h2>Venta registrada</h2><p>' + u.escapeHtml(number(sale)) + '</p>' + breakdown + '<strong>' + u.formatCurrency(sale.total) + '</strong><div class="ticket-actions"><a class="button button--ghost" href="#venta">Nueva venta</a><a class="button button--primary" href="#factura/' + encodeURIComponent(id) + '">Ver factura</a>' +
        (PYL.auth.isAdmin() ? '<button class="button button--ghost" type="button" data-action="start-correction" data-id="' + u.escapeHtml(id) + '">Corregir</button>' : '') +
        '</div></div></section>';
    },
    handle: async function (event) {
      if (event.type !== "click") return;
      var el = event.target.closest('[data-action="start-correction"]'); if (!el) return;
      s.startCorrection(el.dataset.id); location.hash = "#venta";
    }
  };
  PYL.views.correccionexitosa = {
    render: function (id) {
      var sale = s.getSale(id);
      if (!sale || !sale.corregida) return '<p class="empty-note">Correccion no encontrada.</p>';
      return '<section class="confirm-layout"><div class="confirm-card"><h2>Correccion registrada</h2><p>' + u.escapeHtml(number(sale)) + '</p><strong>' + u.formatCurrency(sale.total) + '</strong><div class="ticket-actions"><a class="button button--ghost" href="#historial">Volver al historial</a><a class="button button--primary" href="#factura/' + encodeURIComponent(id) + '">Ver factura actualizada</a><a class="button button--ghost" href="#venta">Nueva venta</a></div></div></section>';
    }
  };
  PYL.views.reembolsoexitoso = {
    render: function (id) {
      var sale = s.getSale(id);
      if (!sale || !sale.reembolsos || !sale.reembolsos.length) return '<p class="empty-note">Reembolso no encontrado.</p>';
      return '<section class="confirm-layout"><div class="confirm-card"><h2>Reembolso registrado</h2><p>' + u.escapeHtml(number(sale)) + '</p><strong>' + u.formatCurrency(sale.totalReembolsado) + ' reembolsado</strong><div class="ticket-actions"><a class="button button--ghost" href="#historial">Volver al historial</a><a class="button button--primary" href="#factura/' + encodeURIComponent(id) + '">Ver factura</a><a class="button button--ghost" href="#venta">Nueva venta</a></div></div></section>';
    }
  };
})(window);

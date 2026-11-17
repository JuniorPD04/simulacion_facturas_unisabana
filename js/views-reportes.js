(function (global) {
  var PYL = global.PYL, u = PYL.utils, s = PYL.store;
  // Reportes basicos (3.10, RF-160/161). Solo administrador (el backend lo exige).
  // La pantalla no calcula nada: pide cada reporte ya armado y lo muestra.
  var tab = "ventas", requestToken = 0;
  var tabs = [["ventas", "Ventas"], ["productos-mas-vendidos", "Productos mas vendidos"], ["compras", "Compras"], ["faltantes", "Faltantes frecuentes"]];
  var today = function () { return u.localDateKey(); };
  var ranges = {};
  function resetRanges() {
    ranges = { ventas: { desde: today(), hasta: today() }, "productos-mas-vendidos": { desde: today(), hasta: today(), limite: "10" },
               compras: { desde: today(), hasta: today() }, faltantes: { desde: "", hasta: "", limite: "10" } };
  }
  resetRanges();
  function addDays(key, days) {
    var d = new Date(key + "T00:00:00"); d.setDate(d.getDate() + days);
    return d.getFullYear() + "-" + u.pad(d.getMonth() + 1, 2) + "-" + u.pad(d.getDate(), 2);
  }
  function applyPreset(preset) {
    var r = ranges[tab], t = today();
    if (preset === "hoy") { r.desde = t; r.hasta = t; }
    if (preset === "7dias") { r.desde = addDays(t, -6); r.hasta = t; }
    if (preset === "mes") { r.desde = t.slice(0, 8) + "01"; r.hasta = t; }
    if (preset === "todo") { r.desde = ""; r.hasta = ""; }
  }
  function money(v) { return u.formatCurrency(v); }
  function card(label, value, bad) { return '<div class="report-card"><span>' + u.escapeHtml(label) + '</span><strong' + (bad ? ' class="is-bad"' : '') + '>' + value + '</strong></div>'; }
  function table(headers, rows, emptyText) {
    if (!rows.length) return '<p class="empty-note">' + u.escapeHtml(emptyText) + '</p>';
    return '<div class="table-wrap"><table><thead><tr>' + headers.map(function (h) { return '<th' + (h[1] ? ' class="num"' : "") + '>' + u.escapeHtml(h[0]) + '</th>'; }).join("") + '</tr></thead><tbody>' +
      rows.map(function (cells) { return '<tr>' + cells.map(function (cell, i) { return '<td' + (headers[i][1] ? ' class="num"' : "") + '>' + cell + '</td>'; }).join("") + '</tr>'; }).join("") + '</tbody></table></div>';
  }
  var e = u.escapeHtml;
  var renderers = {
    ventas: function (d) {
      return '<div class="report-cards">' + card("Ventas cerradas", e(d.numeroVentas)) + card("Total vendido", money(d.totalVendido)) + card("Descuentos", money(d.totalDescuentos)) +
        card("Reembolsado", money(d.totalReembolsado)) + card("Neto", money(d.totalNeto)) + '</div>' +
        '<h3>Por metodo de pago</h3>' + table([["Metodo"], ["Ventas", 1], ["Vendido", 1], ["Reembolsado", 1], ["Neto", 1]],
          d.porMetodoPago.map(function (m) { return [e(u.paymentLabel(m.metodoPago)), e(m.numeroVentas), money(m.totalVendido), money(m.totalReembolsado), money(m.totalNeto)]; }), "Sin ventas.") +
        '<p class="empty-note">Solo ventas cerradas. "Debe" cuenta como vendido aunque aun no se haya cobrado. El reembolsado es el de las ventas de este rango.</p>';
    },
    "productos-mas-vendidos": function (d) {
      return table([["#", 1], ["Producto"], ["Vendidas", 1], ["Reembolsadas", 1], ["Netas", 1], ["Total en productos", 1]],
        d.productos.map(function (p, i) { return [i + 1, '<strong>' + e(p.nombre) + '</strong><br><span class="muted">' + e(p.codigo) + '</span>', e(p.unidadesVendidas), e(p.unidadesReembolsadas), e(p.unidadesNetas), money(p.totalProductos)]; }),
        "No hay ventas cerradas en este rango.") + '<p class="empty-note">Ordenado por unidades netas (vendidas menos reembolsadas). El total es precio x cantidad, antes del descuento de la venta.</p>';
    },
    compras: function (d) {
      return '<div class="report-cards">' + card("Compras", e(d.numeroCompras)) + card("Total comprado", money(d.totalComprado)) + '</div>' +
        '<h3>Por proveedor</h3>' + table([["Proveedor"], ["Compras", 1], ["Total", 1]], d.porProveedor.map(function (g) { return [e(g.proveedorNombre), e(g.numeroCompras), money(g.totalComprado)]; }), "Sin compras en este rango.") +
        '<h3>Compras registradas</h3>' + table([["Fecha"], ["Proveedor"], ["Total", 1]], d.compras.map(function (c) { return [e(c.fecha), e(c.proveedorNombre), money(c.total)]; }), "Sin compras en este rango.");
    },
    faltantes: function (d) {
      return table([["#", 1], ["Producto"], ["Veces solicitado", 1], ["Cantidad total", 1], ["Ultima vez"], ["Estado"]],
        d.faltantes.map(function (f, i) { return [i + 1, '<strong>' + e(f.nombre) + '</strong>', e(f.vecesSolicitado), e(f.cantidadTotal), e(u.formatDateTime(f.ultimaFecha)), f.estado === "pendiente" ? "Pendiente" : "Resuelto"]; }),
        "No hay faltantes registrados en este rango.") + '<p class="empty-note">Incluye pendientes y resueltos. Sin fechas se cuenta todo el historial.</p>';
    }
  };
  function target() { return document.getElementById("report-result"); }
  async function load() {
    var box = target(); if (!box) return;
    var mine = ++requestToken, html;
    box.innerHTML = '<p class="empty-note" role="status">Cargando...</p>';
    try { html = renderers[tab](await s.getReporte(tab, ranges[tab])); }
    catch (error) { html = '<p class="error" role="alert">' + e(error.message) + '</p><button type="button" class="button button--ghost" data-action="report-retry">Reintentar</button>'; }
    if (mine !== requestToken || !target()) return;
    target().innerHTML = html;
  }
  function filterBar() {
    var r = ranges[tab], presets = [["hoy", "Hoy"], ["7dias", "Ultimos 7 dias"], ["mes", "Este mes"]].concat(tab === "faltantes" ? [["todo", "Todo el historial"]] : []);
    return '<div class="faltante-filters"><label class="field">Desde<input type="date" data-report-field="desde" value="' + e(r.desde) + '"></label>' +
      '<label class="field">Hasta<input type="date" data-report-field="hasta" value="' + e(r.hasta) + '"></label>' +
      (r.limite !== undefined ? '<label class="field">Mostrar<select data-report-field="limite">' + ["5", "10", "20", "50"].map(function (n) { return '<option value="' + n + '"' + (r.limite === n ? " selected" : "") + '>Top ' + n + '</option>'; }).join("") + '</select></label>' : "") + '</div>' +
      '<div class="row-actions report-presets">' + presets.map(function (p) { return '<button type="button" class="button button--ghost" data-action="report-preset" data-preset="' + p[0] + '">' + p[1] + '</button>'; }).join("") + '</div>';
  }
  PYL.views = PYL.views || {};
  PYL.views.reportes = {
    render: function () {
      return '<section class="stack"><h2>Reportes</h2><div class="entity-tabs report-tabs" role="tablist" aria-label="Reportes">' + tabs.map(function (t) {
        return '<button class="sale-tab' + (tab === t[0] ? " is-active" : "") + '" role="tab" aria-selected="' + (tab === t[0]) + '" data-action="report-tab" data-tab="' + t[0] + '">' + t[1] + '</button>';
      }).join("") + '</div>' + filterBar() + '<div id="report-result" class="stack"></div></section>';
    },
    afterRender: load,
    handle: async function (event) {
      var field = event.target.closest && event.target.closest("[data-report-field]");
      if (field && event.type === "change") { ranges[tab][field.dataset.reportField] = field.value; load(); return; }
      if (event.type !== "click") return;
      var el = event.target.closest("[data-action]"); if (!el) return;
      if (el.dataset.action === "report-tab") { tab = tabs.some(function (t) { return t[0] === el.dataset.tab; }) ? el.dataset.tab : "ventas"; PYL.app.refresh(); }
      if (el.dataset.action === "report-preset") { applyPreset(el.dataset.preset); PYL.app.refresh(); }
      if (el.dataset.action === "report-retry") load();
    },
    // Solo para pruebas: reinicia el estado del modulo (rangos y pestaña).
    _reset: function () { tab = "ventas"; resetRanges(); }
  };
})(window);

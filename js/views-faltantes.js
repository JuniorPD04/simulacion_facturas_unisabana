(function (global) {
  var PYL = global.PYL, u = PYL.utils, s = PYL.store, c = PYL.components;
  // Faltantes y demanda no atendida (3.7, RF-150..155). Un faltante es solo
  // informativo (RN-09): registrarlo o resolverlo nunca toca inventario ni ventas.
  var tab = "registro";
  var filters = { registro: { tipo: "", estado: "", proveedorId: "", desde: "", hasta: "" }, compras: { tipo: "", proveedorId: "", desde: "", hasta: "" } };
  var requestToken = 0, creatingFor = "";
  var tipoLabel = { agotado: "Agotado", no_registrado: "No registrado" };

  function onFaltantesRoute() { return (location.hash || "").indexOf("#faltantes") === 0; }
  function stockBadge(productoId, pendiente) {
    if (!productoId || !pendiente) return "";
    var p = s.get("productos", productoId);
    if (!p || (p.seguimientoInventario && p.stock < 1)) return "";
    return '<span class="pill pill--tag pill--ok">Ya hay stock' + (p.seguimientoInventario ? " (" + u.escapeHtml(p.stock) + ")" : "") + '</span>';
  }
  // RF-157: solo administrador (el cajero no crea productos) y solo para "No registrado".
  function createProductButton(applies, name, normalized) {
    return applies && PYL.auth.isAdmin() ? '<button type="button" class="button button--ghost" data-action="create-product-from-faltante" data-name="' + u.escapeHtml(name) + '" data-normalized="' + u.escapeHtml(normalized || "") + '">Crear producto</button>' : "";
  }
  function registroRow(f) {
    var pendiente = f.estado === "pendiente";
    var detail = ["Cantidad: " + f.cantidadSolicitada, f.proveedorNombre ? "Proveedor: " + f.proveedorNombre : "", u.formatDateTime(f.fecha), f.usuario ? "Registro: " + f.usuario : ""].filter(Boolean).join(" · ");
    var resolved = pendiente ? "" : '<p>Resuelto por ' + u.escapeHtml(f.resueltoPor || "—") + ' el ' + u.escapeHtml(u.formatDateTime(f.resueltoEn)) + '</p>';
    return '<div class="entity-row"><div><strong>' + u.escapeHtml(f.nombre) + '</strong>' +
      '<span class="pill pill--tag">' + u.escapeHtml(tipoLabel[f.tipo] || f.tipo) + '</span>' +
      '<span class="pill pill--tag ' + (pendiente ? "pill--warn" : "pill--ok") + '">' + (pendiente ? "Pendiente" : "Resuelto") + '</span>' + stockBadge(f.productoId, pendiente) +
      '<p>' + u.escapeHtml(detail) + '</p>' + (f.observacion ? '<p>' + u.escapeHtml(f.observacion) + '</p>' : "") + resolved + '</div>' +
      '<div class="row-actions">' + (pendiente ? '<button type="button" class="button button--ghost" data-action="resolve-faltante" data-id="' + u.escapeHtml(f.id) + '">Marcar resuelto</button>' : "") + createProductButton(pendiente && f.tipo === "no_registrado", f.nombre, f.nombreNormalizado) + '</div></div>';
  }
  function resumenRow(g) {
    var detail = ["Solicitado " + g.vecesSolicitado + (g.vecesSolicitado === 1 ? " vez" : " veces"), "Cantidad total: " + g.cantidadTotal, g.proveedorNombre ? "Proveedor: " + g.proveedorNombre : "Sin proveedor", "Ultima vez: " + u.formatDateTime(g.ultimaFecha)].join(" · ");
    return '<div class="entity-row"><div><strong>' + u.escapeHtml(g.nombre) + '</strong>' +
      '<span class="pill pill--tag ' + (g.estado === "pendiente" ? "pill--warn" : "pill--ok") + '">' + (g.estado === "pendiente" ? "Pendiente" : "Resuelto") + '</span>' + stockBadge(g.productoId, g.estado === "pendiente") +
      '<p>' + u.escapeHtml(detail) + '</p></div>' + '<div class="row-actions">' + createProductButton(!g.productoId && g.estado === "pendiente", g.nombre, g.nombreNormalizado) + '</div></div>';
  }
  function target() { return document.getElementById("faltantes-list"); }
  async function load() {
    var box = target(); if (!box) return;
    var current = filters[tab], mine = ++requestToken;
    if (current.desde && current.hasta && current.desde > current.hasta) { box.innerHTML = '<p class="error" role="alert">La fecha inicial no puede ser posterior a la final.</p>'; return; }
    box.innerHTML = '<p class="empty-note" role="status">Cargando...</p>';
    var html;
    try {
      if (tab === "registro") {
        var rows = await s.getFaltantes(current);
        html = rows.length ? rows.map(registroRow).join("") : '<p class="empty-note">No hay faltantes con ese criterio.</p>';
      } else {
        var groups = await s.getFaltantesResumen(current);
        html = groups.length ? groups.map(resumenRow).join("") : '<p class="empty-note">No hay faltantes pendientes con ese criterio.</p>';
      }
    } catch (error) {
      html = '<p class="error" role="alert">' + u.escapeHtml(error.message) + '</p><button type="button" class="button button--ghost" data-action="faltantes-retry">Reintentar</button>';
    }
    if (mine !== requestToken || !target()) return; // llego tarde: otro filtro o otra vista ya la reemplazo.
    target().innerHTML = html;
  }
  function filterBar() {
    var f = filters[tab];
    function opt(value, label, selected) { return '<option value="' + value + '"' + (selected === value ? " selected" : "") + '>' + label + '</option>'; }
    return '<div class="faltante-filters">' +
      '<label class="field">Tipo<select data-faltante-filter="tipo">' + opt("", "Todos", f.tipo) + opt("agotado", "Agotado", f.tipo) + opt("no_registrado", "No registrado", f.tipo) + '</select></label>' +
      '<label class="field">Proveedor<select data-faltante-filter="proveedorId">' + c.options("proveedores", f.proveedorId, "Todos") + '</select></label>' +
      (tab === "registro" ? '<label class="field">Estado<select data-faltante-filter="estado">' + opt("", "Todos", f.estado) + opt("pendiente", "Pendiente", f.estado) + opt("resuelto", "Resuelto", f.estado) + '</select></label>' : "") +
      '<label class="field">Desde<input type="date" data-faltante-filter="desde" value="' + u.escapeHtml(f.desde) + '"></label>' +
      '<label class="field">Hasta<input type="date" data-faltante-filter="hasta" value="' + u.escapeHtml(f.hasta) + '"></label></div>';
  }
  // preset: { tipo, productoId, nombre } para abrirlo desde la venta ya relleno.
  // El id se genera UNA vez al abrir y viaja en el formulario: si el envio falla
  // o se repite, el backend no duplica el faltante.
  function openForm(preset) {
    preset = preset || {};
    var tipo = preset.tipo === "agotado" ? "agotado" : "no_registrado";
    var products = s.list("productos").sort(function (a, b) { return a.nombre.localeCompare(b.nombre); });
    var productOptions = '<option value="">Seleccionar producto</option>' + products.map(function (p) {
      return '<option value="' + u.escapeHtml(p.id) + '"' + (p.id === preset.productoId ? " selected" : "") + '>' + u.escapeHtml(p.nombre + (p.seguimientoInventario ? " (stock " + p.stock + ")" : "")) + '</option>';
    }).join("");
    PYL.ui.open({ title: "Registrar faltante", html:
      '<form data-form="faltante" data-id="' + crypto.randomUUID() + '"><div class="stack">' +
      '<fieldset class="pay-methods"><legend>Tipo</legend>' +
      '<label class="check"><input type="radio" name="tipo" value="agotado"' + (tipo === "agotado" ? " checked" : "") + '> Producto agotado (ya existe en el catalogo)</label>' +
      '<label class="check"><input type="radio" name="tipo" value="no_registrado"' + (tipo === "no_registrado" ? " checked" : "") + '> Producto no registrado</label></fieldset>' +
      '<label class="field" data-faltante-section="agotado"' + (tipo === "agotado" ? "" : " hidden") + '>Producto<select name="productoId" aria-label="Producto">' + productOptions + '</select></label>' +
      '<div data-faltante-section="no_registrado"' + (tipo === "no_registrado" ? "" : " hidden") + '>' + c.field("Nombre del producto solicitado", "nombre", preset.nombre || "", "text", "maxlength=150") + '</div>' +
      c.field("Cantidad solicitada", "cantidadSolicitada", 1, "number", 'required min="1" step="1"') +
      '<label class="field">Proveedor (opcional)<select name="proveedorId" aria-label="Proveedor">' + c.options("proveedores", "", "Sin proveedor") + '</select></label>' +
      c.field("Observacion (opcional)", "observacion", "", "text", "maxlength=300") +
      '</div><p class="error" role="alert" data-form-error></p><div class="modal__actions"><button class="button button--ghost" type="button" data-modal-cancel>Cancelar</button><button class="button button--primary" type="submit">Guardar</button></div></form>' });
  }
  PYL.faltantes = {
    openForm: openForm,
    // Lo llama app.js para todos los eventos: devuelve true solo si lo consumio.
    handle: async function (event) {
      var form = event.target.closest && event.target.closest('[data-form="faltante"]');
      if (form && event.type === "change" && event.target.name === "tipo") {
        form.querySelectorAll("[data-faltante-section]").forEach(function (el) { el.hidden = el.dataset.faltanteSection !== event.target.value; });
        return true;
      }
      if (form && event.type === "submit") {
        event.preventDefault();
        var data = Object.fromEntries(new FormData(form)); data.id = form.dataset.id;
        await PYL.app.run(async function () {
          await s.createFaltante(data);
          PYL.ui.closeModal();
          if (onFaltantesRoute()) PYL.app.refresh();
          PYL.ui.toast("Faltante registrado.");
        }, "Guardando faltante...");
        return true;
      }
      var productForm = event.target.closest && event.target.closest('[data-form="faltante-product"]');
      if (productForm && event.type === "submit") {
        event.preventDefault();
        var productData = Object.fromEntries(new FormData(productForm));
        // Crear el producto atiende lo que se pidio: se resuelven los faltantes pendientes con ese nombre.
        // No toca inventario ni ventas (RN-09): el producto nace con stock 0.
        await PYL.app.run(async function () {
          await s.createQuickProduct(productData);
          var resueltos = 0;
          try { resueltos = await s.resolveFaltantesNoRegistrados(creatingFor); }
          catch (error) { PYL.ui.toast("Producto creado, pero no se pudieron resolver los faltantes: " + error.message, "error"); }
          PYL.ui.closeModal();
          if (onFaltantesRoute()) PYL.app.refresh();
          if (resueltos) PYL.ui.toast("Producto creado con stock 0. " + resueltos + (resueltos === 1 ? " faltante marcado como resuelto." : " faltantes marcados como resueltos."));
          else PYL.ui.toast("Producto creado con stock 0.");
        }, "Guardando producto...");
        return true;
      }
      var filter = event.target.closest && event.target.closest("[data-faltante-filter]");
      if (filter && event.type === "change") { filters[tab][filter.dataset.faltanteFilter] = filter.value; load(); return true; }
      if (event.type !== "click") return false;
      var el = event.target.closest("[data-action]"); if (!el) return false;
      var action = el.dataset.action;
      if (action === "new-faltante") { openForm({}); return true; }
      if (action === "report-shortage") { openForm(el.dataset.productId ? { tipo: "agotado", productoId: el.dataset.productId } : { tipo: "no_registrado", nombre: el.dataset.name || "" }); return true; }
      if (action === "faltantes-tab") { tab = el.dataset.tab === "compras" ? "compras" : "registro"; PYL.app.refresh(); return true; }
      if (action === "faltantes-retry") { load(); return true; }
      if (action === "create-product-from-faltante") {
        if (!PYL.auth.isAdmin()) return true;
        creatingFor = el.dataset.normalized || "";
        PYL.components.quickProductForm({ title: "Crear producto", formName: "faltante-product", nombre: el.dataset.name || "" });
        return true;
      }
      if (action === "resolve-faltante") {
        await PYL.app.run(async function () { await s.resolveFaltante(el.dataset.id); PYL.ui.toast("Faltante marcado como resuelto."); await load(); }, "Marcando como resuelto...");
        return true;
      }
      return false;
    }
  };
  PYL.views.faltantes = {
    render: function () {
      return '<section class="stack"><div class="panel-head"><h2>Faltantes</h2><button class="button button--primary" data-action="new-faltante">Registrar faltante</button></div>' +
        '<p class="empty-note">Lo que los clientes pidieron y no se pudo vender. Es solo informativo: no cambia el inventario ni las ventas.</p>' +
        '<div class="entity-tabs faltante-tabs" role="tablist" aria-label="Faltantes">' + [["registro", "Registro"], ["compras", "Para compras"]].map(function (t) {
          return '<button class="sale-tab' + (tab === t[0] ? " is-active" : "") + '" role="tab" aria-selected="' + (tab === t[0]) + '" data-action="faltantes-tab" data-tab="' + t[0] + '">' + t[1] + '</button>';
        }).join("") + '</div>' + filterBar() + '<div id="faltantes-list" class="stack"></div></section>';
    },
    afterRender: load
  };
})(window);

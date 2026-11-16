(function (global) {
  var PYL = global.PYL;
  var ready = false, pending = false, loadError = "";
  // Solo UX: el backend (facturacion.accounts.PERMISSIONS) es quien exige el rol.
  var ADMIN_ONLY_ROUTES = { compras: true, descuentos: true };
  function route() {
    var parts = (location.hash || "#venta").slice(1).split("/");
    var name = PYL.views[parts[0]] ? parts[0] : "venta";
    if (ADMIN_ONLY_ROUTES[name] && !PYL.auth.isAdmin()) name = "venta";
    return { name: name, id: parts[1] || "" };
  }
  function renderNav(activeName) {
    document.querySelectorAll("[data-nav]").forEach(function (a) {
      var active = a.dataset.nav === activeName || (activeName === "factura" && a.dataset.nav === "historial") || (activeName === "confirmacion" && a.dataset.nav === "venta") || ((activeName === "correccionexitosa" || activeName === "reembolsoexitoso") && a.dataset.nav === "historial");
      a.classList.toggle("is-active", active);
      if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
      if (ADMIN_ONLY_ROUTES[a.dataset.nav]) a.hidden = !PYL.auth.isAdmin();
    });
  }
  function render() {
    var shell = document.querySelector(".shell");
    if (!PYL.auth.isAuthenticated()) {
      shell.classList.add("is-guest");
      document.getElementById("view").innerHTML = PYL.loginView.render();
      return;
    }
    shell.classList.remove("is-guest");
    var r = route(), mount = document.getElementById("view");
    renderNav(r.name);
    if (!ready) {
      mount.innerHTML = '<section class="connection-state"><h2>' + (loadError ? "Datos no disponibles" : "Cargando datos...") + '</h2>' +
        (loadError ? '<p role="alert">' + PYL.utils.escapeHtml(loadError) + '</p><button class="button button--primary" data-action="reload-data">Reintentar</button>' : '') + '</section>';
      return;
    }
    var view = PYL.views[r.name];
    mount.innerHTML = '<div class="sync-bar no-print"><button class="button button--ghost" data-action="reload-data" title="Actualizar datos">Actualizar datos</button></div>' + view.render(r.id);
    if (view.afterRender) view.afterRender(r.id);
  }
  async function run(fn, message) {
    if (pending) return;
    pending = true;
    var controls = Array.from(document.querySelectorAll("#view button, #view input, #view select, #modal-root button, #modal-root input, #modal-root select"));
    var flags = controls.map(function (el) { return el.disabled; });
    var roots = [document.querySelector(".shell"), document.getElementById("modal-root")];
    var inertFlags = roots.map(function (el) { return el.inert; });
    var focused = document.activeElement;
    controls.forEach(function (el) { el.disabled = true; });
    roots.forEach(function (el) { el.inert = true; });
    document.getElementById("view").setAttribute("aria-busy", "true");
    PYL.ui.showLoading(message);
    try { return await fn(); }
    finally {
      pending = false;
      controls.forEach(function (el, i) { if (el.isConnected) el.disabled = flags[i]; });
      roots.forEach(function (el, i) { el.inert = inertFlags[i]; });
      document.getElementById("view").setAttribute("aria-busy", "false");
      PYL.ui.hideLoading();
      if (focused && focused.isConnected && !focused.disabled) focused.focus({ preventScroll: true });
    }
  }
  async function load() {
    ready = false; loadError = ""; render();
    try { await PYL.store.init(); ready = true; }
    catch (error) { loadError = error.message; }
    render();
  }
  async function handle(event) {
    if (event.type === "submit") event.preventDefault();
    if (pending) { if (event.type === "submit") event.preventDefault(); return; }
    try {
      if (!PYL.auth.isAuthenticated()) { await PYL.loginView.handle(event); return; }
      if (event.type === "click" && event.target.closest('[data-action="logout"]')) {
        await run(async function () { await PYL.auth.logout(); ready = false; render(); }, "Cerrando sesion...");
        return;
      }
      if (event.type === "click" && event.target.closest('[data-action="reload-data"]')) {
        if (!ready) await run(load, "Cargando datos...");
        else await run(async function () { await PYL.store.reload(); render(); PYL.ui.toast("Datos actualizados."); }, "Actualizando datos...");
        return;
      }
      if (!ready) return;
      if (await PYL.components.handle(event)) return;
      var view = PYL.views[route().name];
      if (view.handle) await view.handle(event);
    } catch (error) {
      var formError = document.querySelector("[data-form-error]");
      if (formError) formError.textContent = error.message;
      else PYL.ui.toast(error.message, "error");
    }
  }
  PYL.app = {
    refresh: render, run: run, isBusy: function () { return pending; }, loadData: load,
    start: async function () {
      ["click", "input", "change", "submit"].forEach(function (type) {
        document.getElementById("view").addEventListener(type, handle);
        document.getElementById("modal-root").addEventListener(type, handle);
      });
      document.querySelector(".nav").addEventListener("click", function (event) {
        if (pending) { event.preventDefault(); return; }
        // Los enlaces de navegacion usan el hashchange nativo; "Salir" es una
        // accion, no una ruta, asi que se despacha al manejador central.
        if (event.target.closest('[data-action="logout"]')) handle(event);
      });
      window.addEventListener("hashchange", function () { PYL.ui.closeModal(); render(); });
      window.addEventListener("beforeunload", function (event) {
        if (pending || (ready && (PYL.store.getCurrentSale().items.length || PYL.store.isCorrecting()))) { event.preventDefault(); event.returnValue = ""; }
      });
      await run(async function () { await PYL.auth.restore(); }, "Verificando sesion...");
      if (PYL.auth.isAuthenticated()) await run(load, "Cargando datos...");
      else render();
    }
  };
  document.addEventListener("DOMContentLoaded", PYL.app.start);
})(window);

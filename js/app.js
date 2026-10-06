(function (global) {
  var PYL = global.PYL;
  var ready = false, pending = false, loadError = "";
  function route() {
    var parts = (location.hash || "#venta").slice(1).split("/");
    return { name: PYL.views[parts[0]] ? parts[0] : "venta", id: parts[1] || "" };
  }
  function render() {
    var r = route(), mount = document.getElementById("view");
    document.querySelectorAll("[data-nav]").forEach(function (a) {
      var active = a.dataset.nav === r.name || (r.name === "factura" && a.dataset.nav === "historial") || (r.name === "confirmacion" && a.dataset.nav === "venta");
      a.classList.toggle("is-active", active);
      if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    if (!ready) {
      mount.innerHTML = '<section class="connection-state"><h2>' + (loadError ? "Datos no disponibles" : "Cargando datos...") + '</h2>' +
        (loadError ? '<p role="alert">' + PYL.utils.escapeHtml(loadError) + '</p><button class="button button--primary" data-action="reload-data">Reintentar</button>' : '<progress aria-label="Cargando datos"></progress>') + '</section>';
      return;
    }
    var view = PYL.views[r.name];
    mount.innerHTML = '<div class="sync-bar no-print"><button class="button button--ghost" data-action="reload-data" title="Actualizar datos">Actualizar datos</button><span id="sync-status" role="status"></span></div>' + view.render(r.id);
    if (view.afterRender) view.afterRender(r.id);
  }
  async function run(fn) {
    if (pending) return;
    pending = true;
    var controls = Array.from(document.querySelectorAll("#view button, #view input, #view select, #modal-root button, #modal-root input, #modal-root select"));
    var flags = controls.map(function (el) { return el.disabled; });
    controls.forEach(function (el) { el.disabled = true; });
    document.getElementById("view").setAttribute("aria-busy", "true");
    var status = document.getElementById("sync-status");
    if (status) status.textContent = "Guardando...";
    try { return await fn(); }
    finally {
      pending = false;
      controls.forEach(function (el, i) { if (el.isConnected) el.disabled = flags[i]; });
      document.getElementById("view").setAttribute("aria-busy", "false");
      status = document.getElementById("sync-status");
      if (status) status.textContent = "";
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
      if (event.type === "click" && event.target.closest('[data-action="reload-data"]')) {
        if (!ready) await run(load);
        else await run(async function () { await PYL.store.reload(); render(); PYL.ui.toast("Datos actualizados."); });
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
    refresh: render, run: run, isBusy: function () { return pending; },
    start: async function () {
      ["click", "input", "change", "submit"].forEach(function (type) {
        document.getElementById("view").addEventListener(type, handle);
        document.getElementById("modal-root").addEventListener(type, handle);
      });
      document.querySelector(".nav").addEventListener("click", function (event) {
        if (pending) event.preventDefault();
      });
      window.addEventListener("hashchange", function () { PYL.ui.closeModal(); render(); });
      window.addEventListener("beforeunload", function (event) {
        if (pending || (ready && PYL.store.getCurrentSale().items.length)) { event.preventDefault(); event.returnValue = ""; }
      });
      await load();
    }
  };
  document.addEventListener("DOMContentLoaded", PYL.app.start);
})(window);

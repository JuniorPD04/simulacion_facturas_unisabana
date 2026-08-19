(function (global) {
  var PYL = global.PYL || (global.PYL = {});

  var routes = {
    venta: "venta",
    productos: "productos",
    historial: "historial",
    confirmacion: "confirmacion",
    factura: "factura"
  };

  function parseHash() {
    var raw = (location.hash || "#venta").replace(/^#/, "");
    var parts = raw.split("/");
    var name = routes[parts[0]] ? parts[0] : "venta";
    return { name: name, id: parts[1] || "" };
  }

  function currentView() {
    return PYL.views[parseHash().name];
  }

  function updateNav() {
    var name = parseHash().name;
    document.querySelectorAll("[data-nav]").forEach(function (link) {
      link.classList.toggle("is-active", link.dataset.nav === name || (name === "confirmacion" && link.dataset.nav === "venta") || (name === "factura" && link.dataset.nav === "historial"));
    });
  }

  function render() {
    var route = parseHash();
    var view = PYL.views[route.name] || PYL.views.venta;
    var mount = document.getElementById("view");
    mount.innerHTML = view.render(route.id);
    if (view.afterRender) view.afterRender(route.id);
    updateNav();
  }

  function handleEvent(event) {
    var view = currentView();
    if (view && view.handle) view.handle(event);
  }

  PYL.app = {
    refresh: render,
    start: function () {
      PYL.store.init();
      var viewEl = document.getElementById("view");
      var modalEl = document.getElementById("modal-root");
      ["click", "input", "change", "submit"].forEach(function (type) {
        viewEl.addEventListener(type, handleEvent);
        modalEl.addEventListener(type, handleEvent);
      });
      window.addEventListener("hashchange", function () {
        PYL.ui.closeModal();
        render();
      });
      if (!location.hash) {
        location.hash = "#venta";
      } else {
        render();
      }
    }
  };

  document.addEventListener("DOMContentLoaded", PYL.app.start);
})(window);

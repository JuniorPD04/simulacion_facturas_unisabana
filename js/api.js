(function (global) {
  var PYL = global.PYL || (global.PYL = {});
  // Paste the published Google Apps Script /exec URL here.
  var API_URL = "https://script.google.com/macros/s/AKfycbxP-54sB4X3iHeP1pv13SCh_v_W3wRau9V3qLgfPwge--dia8PrgL6USZsTA-tDTkHl/exec";
  var resources = ["productos", "ventas", "compras", "clientes", "proveedores", "categorias"];
  async function request(resource, options) {
    if (!resources.includes(resource)) throw new Error("Recurso desconocido.");
    if (!API_URL) throw new Error("El servicio de datos aun no esta conectado.");
    var url = new URL(API_URL);
    url.searchParams.set("resource", resource);
    var response;
    try { response = await fetch(url.toString(), options); }
    catch (error) { throw new Error("No se pudo contactar el servicio. Revisa tu conexion. Si estabas guardando, recarga los datos antes de reintentar."); }
    if (!response.ok) throw new Error("El servicio respondio con error " + response.status + ".");
    var result;
    try { result = await response.json(); }
    catch (error) { throw new Error("El servicio no devolvio JSON. Revisa la publicacion y los permisos de Apps Script."); }
    if (!result.success) throw new Error(result.message || "No se pudo completar la operacion.");
    return result.data;
  }
  PYL.api = {
    configured: function () { return Boolean(API_URL); }, resources: resources,
    apiGet: async function (resource) {
      var data = await request(resource, { method: "GET", redirect: "follow" });
      if (!Array.isArray(data)) throw new Error("La lista recibida no es valida.");
      return data;
    },
    apiPost: async function (resource, action, data) {
      return request(resource, { method: "POST", redirect: "follow", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: action, data: data }) });
    }
  };
})(window);

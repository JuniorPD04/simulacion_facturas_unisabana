(function (global) {
  var PYL = global.PYL || (global.PYL = {});
  var resources = ["productos", "ventas", "compras", "clientes", "proveedores", "categorias"];
  async function request(resource, options) {
    if (!resources.includes(resource)) throw new Error("Recurso desconocido.");
    var url = "/api/" + resource + "/";
    if (["PUT", "PATCH", "DELETE"].includes(options.method)) url += encodeURIComponent(options.id) + "/";
    var response;
    try { response = await fetch(url, options); }
    catch (error) { throw new Error("No se pudo contactar el servicio. Revisa tu conexion. Si estabas guardando, recarga los datos antes de reintentar."); }
    var result;
    try { result = await response.json(); }
    catch (error) { throw new Error("El servicio no devolvio JSON. Ejecuta run.py y abre http://127.0.0.1:8000."); }
    if (!response.ok || !result.success) throw new Error((result.message || "Error HTTP " + response.status) + (result.errors ? " " + JSON.stringify(result.errors) : ""));
    return result.data;
  }
  PYL.api = {
    configured: function () { return true; }, resources: resources,
    apiGet: async function (resource) {
      var data = await request(resource, { method: "GET", redirect: "follow" });
      if (!Array.isArray(data)) throw new Error("La lista recibida no es valida.");
      return data;
    },
    apiPost: async function (resource, action, data) {
      var methods = { create: "POST", update: "PATCH", delete: "DELETE" };
      if (!methods[action]) throw new Error("Accion desconocida.");
      return request(resource, { method: methods[action], id: data.id, headers: { "Content-Type": "application/json" }, body: action === "delete" ? undefined : JSON.stringify(data) });
    }
  };
})(window);

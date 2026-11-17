(function (global) {
  var PYL = global.PYL || (global.PYL = {});
  var resources = ["productos", "ventas", "compras", "clientes", "proveedores", "categorias", "descuentos"];
  // Aplana {campo: "mensaje"} o {campo: ["m1","m2"]} (incluso anidado, como la
  // lista por item de itemsJson) a una frase legible, sin llaves ni comillas.
  // El detalle completo (mensaje + errors crudo) siempre queda en consola.
  function flattenErrors(value, acc) {
    acc = acc || [];
    if (value === null || value === undefined || value === "") return acc;
    if (Array.isArray(value)) { value.forEach(function (item) { flattenErrors(item, acc); }); return acc; }
    if (typeof value === "object") { Object.keys(value).forEach(function (key) { flattenErrors(value[key], acc); }); return acc; }
    acc.push(String(value));
    return acc;
  }
  function errorMessage(result, status) {
    var detail = flattenErrors(result.errors);
    return detail.length ? detail.join(" ") : (result.message || "Error HTTP " + status);
  }
  // Los filtros vacios no se mandan; el backend responde 400 si alguno es invalido.
  function queryString(params) {
    return Object.keys(params || {}).filter(function (k) { return params[k] !== "" && params[k] != null; }).map(function (k) {
      return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
    }).join("&");
  }
  async function request(resource, options) {
    var url;
    if (options.path) {
      url = PYL.config.apiBaseUrl + options.path;
    } else {
      if (!resources.includes(resource)) throw new Error("Recurso desconocido.");
      url = PYL.config.apiBaseUrl + resource + "/";
      if (["PUT", "PATCH", "DELETE"].includes(options.method)) url += encodeURIComponent(options.id) + "/";
    }
    options.headers = Object.assign({}, options.headers, PYL.auth.authHeader());
    var response;
    try { response = await fetch(url, options); }
    catch (error) { throw new Error("No se pudo contactar el servicio. Revisa tu conexion. Si estabas guardando, recarga los datos antes de reintentar."); }
    if (response.status === 401) { PYL.auth.clearSession(); throw new Error("Tu sesion expiro o no es valida. Inicia sesion de nuevo."); }
    if (response.status === 403) throw new Error("No tienes permiso para realizar esta accion.");
    var result;
    try { result = await response.json(); }
    catch (error) { throw new Error("El servicio no devolvio una respuesta valida. Verifica que el backend este encendido."); }
    if (!response.ok || !result.success) {
      console.error("Error de API:", result.message, result.errors);
      throw new Error(errorMessage(result, response.status));
    }
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
    },
    apiCorrectSale: async function (ventaId, data) {
      return request("ventas", { method: "POST", path: "ventas/" + encodeURIComponent(ventaId) + "/corregir/", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    },
    // Faltantes (3.7): endpoints propios, no forman parte de "resources".
    // Los filtros vacios no se mandan; el backend responde 400 si alguno es invalido.
    apiFaltantes: async function (params, resumen) {
      var query = queryString(params);
      var data = await request("faltantes", { method: "GET", path: "faltantes/" + (resumen ? "resumen/" : "") + (query ? "?" + query : "") });
      if (!Array.isArray(data)) throw new Error("La lista recibida no es valida.");
      return data;
    },
    // Reportes (3.10): solo lectura y solo administrador; el backend calcula todo.
    apiReporte: async function (name, params) {
      var query = queryString(params);
      return request("reportes", { method: "GET", path: "reportes/" + encodeURIComponent(name) + "/" + (query ? "?" + query : "") });
    },
    apiCreateFaltante: async function (data) {
      return request("faltantes", { method: "POST", path: "faltantes/", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    },
    apiResolveFaltante: async function (id) {
      return request("faltantes", { method: "POST", path: "faltantes/" + encodeURIComponent(id) + "/resolver/", headers: { "Content-Type": "application/json" }, body: "{}" });
    },
    apiCreateRefund: async function (ventaId, data) {
      return request("ventas", { method: "POST", path: "ventas/" + encodeURIComponent(ventaId) + "/reembolsos/", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    }
  };
})(window);

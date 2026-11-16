(function (global) {
  var PYL = global.PYL || (global.PYL = {});
  var TOKEN_KEY = "pyl_token", USER_KEY = "pyl_user";
  var token = null, user = null;
  try { token = localStorage.getItem(TOKEN_KEY); var raw = localStorage.getItem(USER_KEY); user = raw ? JSON.parse(raw) : null; }
  catch (error) { token = null; user = null; }

  function persist() {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY);
      if (user) localStorage.setItem(USER_KEY, JSON.stringify(user)); else localStorage.removeItem(USER_KEY);
    } catch (error) { /* almacenamiento no disponible: la sesion no persiste al recargar. */ }
  }

  function setSession(nextToken, nextUser) {
    token = nextToken; user = nextUser; persist();
  }

  function clearSession() {
    token = null; user = null; persist();
  }

  async function request(path, options) {
    var response;
    try { response = await fetch(path, options); }
    catch (error) { throw new Error("No se pudo contactar el servicio. Revisa tu conexion."); }
    var result;
    try { result = await response.json(); }
    catch (error) { throw new Error("El servicio no devolvio JSON."); }
    if (!response.ok || !result.success) throw new Error(result.message || "Error HTTP " + response.status);
    return result.data;
  }

  PYL.auth = {
    authHeader: function () { return token ? { Authorization: "Bearer " + token } : {}; },
    getToken: function () { return token; },
    getUser: function () { return user; },
    isAuthenticated: function () { return Boolean(token && user); },
    isAdmin: function () { return Boolean(user && user.rol === "administrador"); },
    login: async function (usuario, contrasena) {
      var data = await request(PYL.config.apiBaseUrl + "auth/login/", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario: usuario, contrasena: contrasena })
      });
      setSession(data.token, data.usuario);
      return data.usuario;
    },
    logout: async function () {
      try { await request(PYL.config.apiBaseUrl + "auth/logout/", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, this.authHeader()) }); }
      catch (error) { /* si el token ya no es valido no hay nada que invalidar en el servidor. */ }
      clearSession();
    },
    // Al cargar la app: confirma con el servidor que el token guardado sigue vigente.
    restore: async function () {
      if (!token) return;
      try { user = await request(PYL.config.apiBaseUrl + "auth/me/", { method: "GET", headers: this.authHeader() }); persist(); }
      catch (error) { clearSession(); }
    },
    clearSession: clearSession
  };
})(window);

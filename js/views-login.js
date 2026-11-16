(function (global) {
  var PYL = global.PYL;
  PYL.loginView = {
    render: function () {
      return '<section class="login-screen"><form class="login-card" data-form="login" novalidate>' +
        '<img src="assets/logo.svg" alt="" class="login-logo">' +
        '<h1>Papel y Luna</h1><p class="login-sub">Inicia sesion para continuar</p>' +
        '<label class="field">Usuario<input name="usuario" type="text" autocomplete="username" required></label>' +
        '<label class="field">Contrasena<input name="contrasena" type="password" autocomplete="current-password" required></label>' +
        '<p class="error" role="alert" data-form-error></p>' +
        '<button class="button button--primary" type="submit">Entrar</button>' +
        '</form></section>';
    },
    handle: async function (event) {
      if (event.type !== "submit" || event.target.dataset.form !== "login") return;
      event.preventDefault();
      var form = event.target, data = Object.fromEntries(new FormData(form));
      await PYL.app.run(async function () {
        await PYL.auth.login(data.usuario, data.contrasena);
        await PYL.app.loadData();
      }, "Iniciando sesion...");
    }
  };
})(window);

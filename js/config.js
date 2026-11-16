(function (global) {
  var PYL = global.PYL || (global.PYL = {});
  // Datos del comercio para la factura. Completar nit, direccion y telefono antes de entregar.
  PYL.config = {
    // Unica fuente de la URL base de la API. Al desplegar frontend y backend en
    // dominios distintos, cambia este valor por la URL absoluta del backend.
    apiBaseUrl: "/api/",
    negocio: {
      nombre: "Papel y Luna",
      nit: "890100577-6",
      direccion: "Carrera 7 Este #22-27",
      telefono: "+57 3189687745"
    }
  };
})(window);

(function (global) {
  var PYL = global.PYL || (global.PYL = {});

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatCurrency(value) {
    var amount = Number(value) || 0;
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0
    }).format(amount);
  }

  function formatDateTime(iso) {
    var date = iso ? new Date(iso) : new Date();
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("es-CO", {
      dateStyle: "short",
      timeStyle: "short"
    }).format(date);
  }

  function pad(number, size) {
    var text = String(number);
    while (text.length < size) text = "0" + text;
    return text;
  }

  function toNonNegativeNumber(value) {
    if (value === "" || value == null) return NaN;
    var number = Number(value);
    if (!Number.isFinite(number)) return NaN;
    return number;
  }

  function toNonNegativeInteger(value) {
    var number = toNonNegativeNumber(value);
    if (!Number.isFinite(number)) return NaN;
    if (number < 0) return NaN;
    if (!Number.isInteger(number)) return NaN;
    return number;
  }

  function uid(prefix) {
    return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function paymentLabel(method) {
    if (method === "efectivo") return "Efectivo";
    if (method === "nequi") return "Nequi";
    if (method === "debe") return "Debe";
    return method || "Sin pago";
  }

  function categoryImage(categoria) {
    var map = {
      Cuadernos: "assets/cuadernos.svg",
      Escritura: "assets/escritura.svg",
      Impresion: "assets/impresion.svg",
      Impresión: "assets/impresion.svg",
      Arte: "assets/arte.svg",
      Oficina: "assets/oficina.svg",
      Tecnología: "assets/tecnologia.svg",
      Tecnologia: "assets/tecnologia.svg"
    };
    return map[categoria] || "assets/oficina.svg";
  }

  function iconPencil() {
    return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0 0-3L18.5 4.5a2.1 2.1 0 0 0-3 0L4 16v4zM13.5 6.5l4 4"/></svg>';
  }

  function iconTrash() {
    return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M5 7h14M10 7V5h4v2M8 7l.8 12h6.4L16 7"/></svg>';
  }

  function iconPlay() {
    return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M8 6.2v11.6L18.5 12z"/></svg>';
  }

  function iconEye() {
    return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M2.6 12s3.6-6.4 9.4-6.4S21.4 12 21.4 12s-3.6 6.4-9.4 6.4S2.6 12 2.6 12z"/><circle cx="12" cy="12" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
  }

  function iconInvoice() {
    return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M7 3.5h7.2L19 8.2V20.5H7z"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M14.2 3.5V8H19M9.4 12h5.2M9.4 15.4h5.2"/></svg>';
  }

  PYL.utils = {
    escapeHtml: escapeHtml,
    formatCurrency: formatCurrency,
    formatDateTime: formatDateTime,
    pad: pad,
    toNonNegativeNumber: toNonNegativeNumber,
    toNonNegativeInteger: toNonNegativeInteger,
    uid: uid,
    paymentLabel: paymentLabel,
    categoryImage: categoryImage,
    iconPencil: iconPencil,
    iconTrash: iconTrash,
    iconPlay: iconPlay,
    iconEye: iconEye,
    iconInvoice: iconInvoice
  };
})(window);

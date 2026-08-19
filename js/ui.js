(function (global) {
  var PYL = global.PYL || (global.PYL = {});
  var toastTimer = null;
  var escapeHandler = null;
  var closeCallback = null;

  function toastRoot() {
    return document.getElementById("toast-root");
  }

  function modalRoot() {
    return document.getElementById("modal-root");
  }

  function toast(message, type) {
    var root = toastRoot();
    if (!root) return;
    root.innerHTML = '<div class="toast toast--' + (type || "ok") + '" role="status">' + PYL.utils.escapeHtml(message) + "</div>";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      root.innerHTML = "";
    }, 3200);
  }

  function closeModal() {
    if (escapeHandler) {
      document.removeEventListener("keydown", escapeHandler);
      escapeHandler = null;
    }
    var cb = closeCallback;
    closeCallback = null;
    var root = modalRoot();
    if (root) root.innerHTML = "";
    if (cb) cb();
  }

  function bindDismiss(onCancel) {
    var root = modalRoot();
    function cancel() {
      if (onCancel) onCancel();
      else closeModal();
    }
    escapeHandler = function (event) {
      if (event.key === "Escape") cancel();
    };
    document.addEventListener("keydown", escapeHandler);
    root.querySelectorAll("[data-modal-cancel]").forEach(function (el) {
      el.addEventListener("click", function (event) {
        if (event.target === el) cancel();
      });
    });
  }

  function shell(title, bodyHtml, size) {
    return (
      '<div class="modal-backdrop" data-modal-cancel="true">' +
        '<div class="modal modal--' + (size || "md") + '" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
          '<div class="modal__head">' +
            "<h3 id=\"modal-title\">" + PYL.utils.escapeHtml(title || "") + "</h3>" +
            '<button class="icon-btn" type="button" data-modal-cancel="true" aria-label="Cerrar">×</button>' +
          "</div>" +
          '<div class="modal__body">' + bodyHtml + "</div>" +
        "</div>" +
      "</div>"
    );
  }

  function open(options) {
    var nextClose = options.onClose || null;
    closeModal();
    closeCallback = nextClose;
    modalRoot().innerHTML = shell(options.title, options.html || "", options.size);
    bindDismiss(closeModal);
  }

  function confirm(options) {
    return new Promise(function (resolve) {
      closeModal();
      var root = modalRoot();
      var settled = false;
      root.innerHTML =
        '<div class="modal-backdrop" data-modal-cancel="true">' +
          '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
            '<div class="modal__head">' +
              "<h3 id=\"modal-title\">" + PYL.utils.escapeHtml(options.title || "Confirmar") + "</h3>" +
            "</div>" +
            "<p>" + PYL.utils.escapeHtml(options.message || "") + "</p>" +
            '<div class="modal__actions">' +
              '<button class="button button--ghost" type="button" data-modal-cancel="true">Cancelar</button>' +
              '<button class="button ' + (options.danger ? "button--danger-solid" : "button--primary") + '" type="button" data-modal-ok="true">' +
                PYL.utils.escapeHtml(options.confirmLabel || "Confirmar") +
              "</button>" +
            "</div>" +
          "</div>" +
        "</div>";

      function finish(value) {
        if (settled) return;
        settled = true;
        closeModal();
        resolve(value);
      }

      root.querySelector("[data-modal-ok]").addEventListener("click", function () {
        finish(true);
      });
      bindDismiss(function () {
        finish(false);
      });
    });
  }

  function fieldError(id, message) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = message || "";
  }

  function clearErrors(ids) {
    ids.forEach(function (id) {
      fieldError(id, "");
    });
  }

  PYL.ui = {
    toast: toast,
    confirm: confirm,
    open: open,
    closeModal: closeModal,
    fieldError: fieldError,
    clearErrors: clearErrors
  };
})(window);

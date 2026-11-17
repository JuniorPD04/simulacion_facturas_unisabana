(function (global) {
  var PYL = global.PYL || (global.PYL = {});
  var state = {};
  PYL.api.resources.forEach(function (r) { state[r] = []; });
  var currentSale;
  var busy = false;
  var inventoryFresh = true;
  var payments = ["Efectivo", "Nequi", "Debe"];
  var clone = function (value) { return JSON.parse(JSON.stringify(value)); };
  var total = function (items, key) { return items.reduce(function (sum, i) { return sum + i[key] * i.cantidad; }, 0); };
  function emptySale() {
    return { id: crypto.randomUUID(), fecha: new Date().toISOString(), estado: "abierta", clienteId: "", metodoPago: "Efectivo", valorRecibido: "", descuentoId: "", items: [], paso: "items" };
  }
  // Unica formula de descuento, reutilizada por el store y cubierta por
  // tests/mvp2.test.cjs; el backend vuelve a calcular lo mismo y es quien manda.
  function discountAmount(subtotal, descuento) {
    if (!descuento) return 0;
    return descuento.tipo === "porcentual" ? Math.floor(subtotal * descuento.valor / 100) : descuento.valor;
  }
  function normalize(resource, row) {
    var result = Object.assign({}, row, { id: String(row.id) });
    if (resource === "productos") {
      result.precio = Number(row.precio); result.costo = Number(row.costo); result.stock = Number(row.stock);
      result.seguimientoInventario = row.seguimientoInventario === true || String(row.seguimientoInventario).toLowerCase() === "true";
    }
    if (resource === "ventas" || resource === "compras") {
      try { result.items = JSON.parse(row.itemsJson || "[]"); }
      catch (e) { throw new Error("itemsJson invalido en " + resource + ": " + row.id); }
      if (!Array.isArray(result.items)) throw new Error("Detalle invalido en " + row.id);
      result.total = Number(row.total);
    }
    return result;
  }
  function put(resource, row) {
    var value = normalize(resource, row);
    var index = state[resource].findIndex(function (r) { return r.id === value.id; });
    if (index < 0) state[resource].unshift(value); else state[resource][index] = value;
    return value;
  }
  function get(resource, id) { return state[resource].find(function (r) { return r.id === id; }); }
  async function exclusive(fn) {
    if (busy) throw new Error("Hay una operacion en curso.");
    busy = true;
    try { return await fn(); } finally { busy = false; }
  }
  // El cajero no tiene GET en compras (ver facturacion.accounts.PERMISSIONS);
  // pedirlo igual tumbaria toda la carga por Promise.all. Solo se piden los
  // recursos que el rol puede leer; los demas quedan vacios. Proveedores si los
  // puede leer (para elegirlos al registrar un faltante), pero no modificarlos.
  function readableResources() {
    if (PYL.auth.isAdmin()) return PYL.api.resources;
    return PYL.api.resources.filter(function (r) { return r !== "compras"; });
  }
  // Faltantes (3.7): se validan aqui lo mismo que en el backend para dar el
  // mensaje antes de enviar; el backend vuelve a validar y es quien manda.
  var FALTANTE_TIPOS = ["agotado", "no_registrado"];
  function faltanteData(data) {
    var tipo = data.tipo, qty = Number(data.cantidadSolicitada);
    if (!FALTANTE_TIPOS.includes(tipo)) throw new Error("Selecciona el tipo de faltante.");
    var value = { id: data.id || crypto.randomUUID(), tipo: tipo };
    if (tipo === "agotado") {
      if (!data.productoId) throw new Error("Selecciona el producto agotado.");
      if (!get("productos", data.productoId)) throw new Error("El producto ya no existe.");
      value.productoId = data.productoId;
    } else {
      var nombre = String(data.nombre || "").trim();
      if (!nombre) throw new Error("Escribe el nombre del producto solicitado.");
      if (nombre.length > 150) throw new Error("El nombre no puede superar 150 caracteres.");
      value.nombre = nombre;
    }
    if (data.cantidadSolicitada === "" || data.cantidadSolicitada == null || !Number.isInteger(qty) || qty < 1) throw new Error("La cantidad solicitada debe ser un entero mayor que cero.");
    value.cantidadSolicitada = qty;
    if (data.proveedorId) {
      if (!get("proveedores", data.proveedorId)) throw new Error("El proveedor ya no existe.");
      value.proveedorId = data.proveedorId;
    }
    var observacion = String(data.observacion || "").trim();
    if (observacion.length > 300) throw new Error("La observacion no puede superar 300 caracteres.");
    if (observacion) value.observacion = observacion;
    return value;
  }
  async function load() {
    var readable = readableResources();
    // Commit the snapshot only after every resource has loaded successfully.
    var rows = await Promise.all(readable.map(async function (r) {
      return [r, (await PYL.api.apiGet(r)).map(function (row) { return normalize(r, row); })];
    }));
    rows.forEach(function (pair) { state[pair[0]] = pair[1]; });
    PYL.api.resources.filter(function (r) { return !readable.includes(r); }).forEach(function (r) { state[r] = []; });
    inventoryFresh = true;
  }
  function productData(data, id) {
    var value = {
      id: id || crypto.randomUUID(), codigo: String(data.codigo || "").trim(), nombre: String(data.nombre || "").trim(),
      categoriaId: data.categoriaId, precio: Number(data.precio), costo: Number(data.costo),
      seguimientoInventario: Boolean(data.seguimientoInventario), stock: Number(data.stock)
    };
    if (!value.nombre || !value.codigo) throw new Error("Nombre y codigo son obligatorios.");
    if (!get("categorias", value.categoriaId)) throw new Error("Selecciona una categoria existente.");
    if (data.precio === "" || data.costo === "" || !Number.isInteger(value.precio) || value.precio < 0 || !Number.isInteger(value.costo) || value.costo < 0) throw new Error("Precio y costo deben ser numeros enteros no negativos.");
    if (!value.seguimientoInventario) value.stock = 0;
    if (value.seguimientoInventario && (data.stock === "" || !Number.isInteger(value.stock) || value.stock < 0)) throw new Error("Stock debe ser un entero no negativo.");
    if (state.productos.some(function (p) { return p.id !== id && p.codigo.toLowerCase() === value.codigo.toLowerCase(); })) throw new Error("Ya existe un producto con ese codigo.");
    return value;
  }
  function snapshot(p, qty) { return { productoId: p.id, codigo: p.codigo, nombre: p.nombre, precio: p.precio, costo: p.costo, cantidad: qty }; }
  function validateStock(product, quantity) {
    if (product.seguimientoInventario && quantity > product.stock) throw new Error("Stock insuficiente para " + product.nombre + ". Disponible: " + product.stock);
  }
  function availableStock(product) {
    if (!product.seguimientoInventario) return Infinity;
    var line = currentSale.items.find(function (i) { return i.productoId === product.id; });
    return Math.max(0, product.stock - (line ? line.cantidad : 0));
  }
  function appliedDiscount() {
    return currentSale.descuentoId ? get("descuentos", currentSale.descuentoId) : null;
  }
  // Modo correccion (3.4/RF-50): estado APARTE de currentSale a proposito, para
  // no perder un ticket en curso al entrar a corregir una venta cerrada.
  var correction = null;
  function correctionSubtotalAmount() { return total(correction.items, "precio"); }
  function correctionDiscountAmountValue() { return correction.descuento ? discountAmount(correctionSubtotalAmount(), correction.descuento) : 0; }
  function correctionNetTotalValue() { return correctionSubtotalAmount() - correctionDiscountAmountValue(); }
  // Reembolsos (3.5/RF-60..65): estado APARTE, igual que correction, para no
  // perder un ticket en curso. refundDraft.id se genera UNA vez al abrir y se
  // reutiliza en reintentos del mismo envio, igual que la idempotencia del
  // backend (create_refund).
  var refundDraft = null;
  function refundedByProduct(venta) {
    var totals = {};
    (venta.reembolsos || []).forEach(function (r) {
      r.items.forEach(function (i) { totals[i.productoId] = (totals[i.productoId] || 0) + i.cantidad; });
    });
    return totals;
  }
  // Vista previa informativa: replica la formula del backend (acumulado
  // global de la venta, sin deriva de redondeo). El backend vuelve a
  // calcular todo al guardar y es quien manda.
  function refundPreviewTotal() {
    var venta = get("ventas", refundDraft.ventaId), subtotal = venta.subtotal, netTotal = venta.total;
    var running = refundDraft.lines.reduce(function (sum, l) { return sum + l.precio * l.yaReembolsado; }, 0);
    var floorAmount = function (acc) { return subtotal === 0 ? 0 : Math.floor(acc * netTotal / subtotal); };
    var amount = 0;
    refundDraft.lines.forEach(function (l) {
      if (!l.cantidad) return;
      var before = floorAmount(running);
      running += l.precio * l.cantidad;
      amount += floorAmount(running) - before;
    });
    return amount;
  }
  function saleRecord(status) {
    if (!currentSale.items.length) throw new Error("Agrega al menos un producto.");
    var subtotal = total(currentSale.items, "precio");
    var descuento = appliedDiscount();
    if (currentSale.descuentoId && !descuento) throw new Error("El descuento ya no existe. Quitalo del ticket.");
    var descuentoMonto = discountAmount(subtotal, descuento);
    if (descuento && descuentoMonto > subtotal) throw new Error('El descuento "' + descuento.nombre + '" supera el subtotal. Quitalo o ajusta el ticket.');
    var amount = subtotal - descuentoMonto;
    var received = currentSale.metodoPago === "Efectivo" ? Number(currentSale.valorRecibido) : currentSale.metodoPago === "Nequi" ? amount : 0;
    if (!payments.includes(currentSale.metodoPago)) throw new Error("Selecciona un metodo de pago.");
    if (currentSale.clienteId && !get("clientes", currentSale.clienteId)) throw new Error("El cliente ya no existe.");
    if (status === "cerrada") {
      if (!inventoryFresh) throw new Error("Actualiza los datos antes de cerrar otra venta.");
      if (currentSale.metodoPago === "Debe" && !currentSale.clienteId) throw new Error("Selecciona un cliente para el pago Debe.");
      if (currentSale.metodoPago === "Efectivo" && (currentSale.valorRecibido === "" || !Number.isInteger(received) || received < 0)) throw new Error("El valor recibido debe ser un numero entero no negativo.");
      if (currentSale.metodoPago === "Efectivo" && received < amount) throw new Error("El valor recibido debe cubrir el total.");
      currentSale.items.forEach(function (i) {
        var p = get("productos", i.productoId);
        if (!p) throw new Error("El producto " + i.nombre + " ya no existe.");
        validateStock(p, i.cantidad);
      });
    }
    var record = {
      id: currentSale.id, fecha: currentSale.fecha, estado: status, clienteId: currentSale.clienteId,
      metodoPago: currentSale.metodoPago, subtotal: subtotal, total: amount,
      valorRecibido: Number.isFinite(received) ? received : 0, cambio: status === "cerrada" && currentSale.metodoPago === "Efectivo" ? received - amount : 0,
      itemsJson: JSON.stringify(currentSale.items), actualizadoEn: new Date().toISOString()
    };
    // Solo se manda si hay (o hubo) descuento: una venta sin descuento nunca lo
    // menciona, por compatibilidad con el backend historico simulado que no
    // conoce este campo (ver tests/mvp2.test.cjs y apps-script.gs).
    var saved = get("ventas", currentSale.id);
    if (currentSale.descuentoId || (saved && saved.descuentoId)) record.descuentoId = currentSale.descuentoId;
    return record;
  }
  async function saveSale(status) {
    return exclusive(async function () {
      var record = saleRecord(status);
      var saved = put("ventas", await PYL.api.apiPost("ventas", get("ventas", record.id) ? "update" : "create", record));
      var warning = "";
      if (status === "cerrada") {
        try { state.productos = (await PYL.api.apiGet("productos")).map(function (p) { return normalize("productos", p); }); }
        catch (error) { inventoryFresh = false; warning = "Venta registrada. No se pudo recargar el inventario; actualiza los datos antes de la siguiente operacion."; }
      }
      currentSale = emptySale();
      return { record: clone(saved), warning: warning };
    });
  }
  PYL.store = {
    payments: payments,
    init: async function () { if (!currentSale) currentSale = emptySale(); await load(); },
    reload: function () { return exclusive(load); },
    isBusy: function () { return busy; },
    list: function (r) { return clone(state[r]); },
    get: function (r, id) { var row = get(r, id); return row ? clone(row) : null; },
    label: function (r, id, fallback) { var row = get(r, id); return row ? row.nombre : fallback || "Sin asociar"; },
    getProducts: function () { return this.list("productos"); },
    getProduct: function (id) { return this.get("productos", id); },
    getCategories: function () { return this.list("categorias"); },
    getSales: function () { return this.list("ventas").sort(function (a, b) { return String(b.actualizadoEn || b.fecha).localeCompare(String(a.actualizadoEn || a.fecha)); }); },
    getSale: function (id) { return this.get("ventas", id); },
    getCurrentSale: function () { return currentSale; },
    newSale: function () { currentSale = emptySale(); },
    clearSale: function () { currentSale = emptySale(); },
    setSaleField: function (field, value) { if (["clienteId", "metodoPago", "valorRecibido", "paso", "descuentoId"].includes(field)) currentSale[field] = value; },
    currentTotal: function () { return total(currentSale.items, "precio"); },
    lineSubtotal: function (i) { return i.precio * i.cantidad; },
    discountAmount: discountAmount,
    getAppliedDiscount: function () { var d = appliedDiscount(); return d ? clone(d) : null; },
    currentDiscountAmount: function () { return discountAmount(this.currentTotal(), appliedDiscount()); },
    // Vista previa: el backend vuelve a calcular todo al guardar/cerrar.
    currentNetTotal: function () { return this.currentTotal() - this.currentDiscountAmount(); },
    discountInvalid: function () { return this.currentNetTotal() < 0; },
    applyDiscount: function (id) {
      var descuento = get("descuentos", id);
      if (!descuento) throw new Error("El descuento no existe.");
      var previous = appliedDiscount();
      currentSale.descuentoId = id;
      return previous && previous.id !== id ? previous.nombre : null;
    },
    removeDiscount: function () { currentSale.descuentoId = ""; },
    availableStock: availableStock,
    suggestCode: function () { var max = state.productos.reduce(function (n, p) { var m = p.codigo.match(/(\d+)$/); return Math.max(n, m ? Number(m[1]) : 0); }, 0); return "PL-" + PYL.utils.pad(max + 1, 3); },
    addItem: function (id, quantity) {
      var p = get("productos", id), qty = Number(quantity);
      if (!p) throw new Error("El producto no existe.");
      if (!Number.isInteger(qty) || qty < 1) throw new Error("La cantidad debe ser un entero mayor que cero.");
      var line = currentSale.items.find(function (i) { return i.productoId === id; });
      validateStock(p, qty + (line ? line.cantidad : 0));
      if (line) line.cantidad += qty; else currentSale.items.push(snapshot(p, qty));
    },
    updateItemQty: function (id, quantity) {
      var qty = Number(quantity);
      if (!Number.isInteger(qty) || qty < 1) throw new Error("La cantidad debe ser un entero mayor que cero.");
      var line = currentSale.items.find(function (i) { return i.productoId === id; });
      if (!line) throw new Error("El producto no esta en el ticket.");
      var p = get("productos", id);
      if (!p) throw new Error("El producto ya no existe.");
      validateStock(p, qty);
      line.cantidad = qty;
    },
    removeItem: function (id) { currentSale.items = currentSale.items.filter(function (i) { return i.productoId !== id; }); },
    saveDraft: function () { return saveSale("abierta"); },
    closeSale: function () { return saveSale("cerrada"); },
    resumeDraft: async function (id) {
      if (currentSale.id === id) { currentSale.paso = "items"; return; }
      if (currentSale.items.length) await saveSale("abierta");
      var row = get("ventas", id);
      if (!row || row.estado !== "abierta") throw new Error("La venta abierta ya no existe.");
      currentSale = Object.assign({}, clone(row), { paso: "items" });
      currentSale.items = row.items.map(function (i) { var p = get("productos", i.productoId); return p ? snapshot(p, i.cantidad) : clone(i); });
    },
    saveProduct: function (data, id, quick) {
      return exclusive(async function () {
        var old = get("productos", id);
        if (quick && !old) throw new Error("El producto ya no existe.");
        var value = productData(quick ? Object.assign({}, old, data, { stock: old.stock, seguimientoInventario: old.seguimientoInventario, codigo: old.codigo }) : data, id);
        if (quick) value = { id: id, nombre: value.nombre, categoriaId: value.categoriaId, precio: value.precio, costo: value.costo };
        var p = put("productos", await PYL.api.apiPost("productos", id ? "update" : "create", value));
        currentSale.items = currentSale.items.map(function (i) { return i.productoId === p.id ? snapshot(p, i.cantidad) : i; });
        return clone(p);
      });
    },
    // RF-85: proveedores asociados a un producto = los que ya se lo vendieron en alguna compra.
    getProductProviders: function (productId) {
      var byProvider = {};
      state.compras.forEach(function (purchase) {
        purchase.items.forEach(function (item) {
          if (item.productoId !== productId) return;
          var row = byProvider[purchase.proveedorId] || (byProvider[purchase.proveedorId] = { proveedorId: purchase.proveedorId, compras: 0, ultimaFecha: "", ultimoCosto: 0 });
          row.compras += 1;
          if (String(purchase.fecha) >= row.ultimaFecha) { row.ultimaFecha = String(purchase.fecha); row.ultimoCosto = item.costo; }
        });
      });
      return Object.keys(byProvider).map(function (k) { return byProvider[k]; }).sort(function (a, b) { return b.ultimaFecha.localeCompare(a.ultimaFecha); });
    },
    // Alta rapida (RF-94 y RF-157): codigo sugerido y stock 0; el stock entra con la compra.
    createQuickProduct: function (data) {
      return exclusive(async function () {
        var value = productData({ codigo: PYL.store.suggestCode(), nombre: data.nombre, categoriaId: data.categoriaId, precio: data.precio, costo: data.costo, seguimientoInventario: true, stock: 0 }, null);
        return clone(put("productos", await PYL.api.apiPost("productos", "create", value)));
      });
    },
    saveEntity: function (r, data, id) {
      return exclusive(async function () {
        if (!["categorias", "clientes", "proveedores"].includes(r)) throw new Error("Entidad invalida.");
        var value = { id: id || crypto.randomUUID(), nombre: String(data.nombre || "").trim() };
        if (!value.nombre) throw new Error("El nombre es obligatorio.");
        if (r !== "categorias") { value.telefono = String(data.telefono || "").trim(); value.correo = String(data.correo || "").trim(); }
        return put(r, await PYL.api.apiPost(r, id ? "update" : "create", value));
      });
    },
    saveDiscount: function (data, id) {
      return exclusive(async function () {
        var value = {
          id: id || crypto.randomUUID(), nombre: String(data.nombre || "").trim(),
          tipo: data.tipo, valor: Number(data.valor)
        };
        if (!value.nombre) throw new Error("El nombre es obligatorio.");
        if (!["porcentual", "fijo"].includes(value.tipo)) throw new Error("Selecciona un tipo de descuento valido.");
        if (!Number.isInteger(value.valor) || value.valor <= 0) throw new Error("El valor debe ser un entero mayor que cero.");
        if (value.tipo === "porcentual" && value.valor > 100) throw new Error("El descuento porcentual debe estar entre 1 y 100.");
        return put("descuentos", await PYL.api.apiPost("descuentos", id ? "update" : "create", value));
      });
    },
    deleteRecord: function (r, id) {
      return exclusive(async function () {
        if (r === "productos" && currentSale.items.some(function (i) { return i.productoId === id; })) throw new Error("El producto esta en la venta en curso. Quitalo del ticket primero.");
        if (r === "clientes" && currentSale.clienteId === id) throw new Error("El cliente esta asociado a la venta en curso.");
        if (r === "descuentos" && currentSale.descuentoId === id) throw new Error("El descuento esta aplicado en la venta en curso. Quitalo del ticket primero.");
        await PYL.api.apiPost(r, "delete", { id: id });
        state[r] = state[r].filter(function (row) { return row.id !== id; });
        if (r === "ventas" && currentSale.id === id) currentSale = emptySale();
      });
    },
    startCorrection: function (ventaId) {
      var venta = get("ventas", ventaId);
      if (!venta || venta.estado !== "cerrada") throw new Error("Solo se pueden corregir ventas cerradas.");
      correction = {
        ventaId: ventaId, clienteId: venta.clienteId || "", metodoPago: venta.metodoPago,
        valorRecibido: venta.metodoPago === "Efectivo" ? venta.valorRecibido : "",
        items: clone(venta.items),
        descuento: venta.descuentoNombre ? { nombre: venta.descuentoNombre, tipo: venta.descuentoTipo, valor: venta.descuentoValor } : null
      };
    },
    cancelCorrection: function () { correction = null; },
    isCorrecting: function () { return correction !== null; },
    getCorrection: function () { return correction ? clone(correction) : null; },
    setCorrectionField: function (field, value) { if (["clienteId", "metodoPago", "valorRecibido"].includes(field)) correction[field] = value; },
    correctionSubtotal: correctionSubtotalAmount,
    correctionDiscountAmount: correctionDiscountAmountValue,
    correctionNetTotal: correctionNetTotalValue,
    correctionInvalid: function () { return correctionNetTotalValue() < 0; },
    correctionAddItem: function (id, quantity) {
      var p = get("productos", id), qty = Number(quantity);
      if (!p) throw new Error("El producto no existe.");
      if (!Number.isInteger(qty) || qty < 1) throw new Error("La cantidad debe ser un entero mayor que cero.");
      var line = correction.items.find(function (i) { return i.productoId === id; });
      if (line) line.cantidad += qty; else correction.items.push(snapshot(p, qty));
    },
    correctionUpdateItemQty: function (id, quantity) {
      var qty = Number(quantity);
      if (!Number.isInteger(qty) || qty < 1) throw new Error("La cantidad debe ser un entero mayor que cero.");
      var line = correction.items.find(function (i) { return i.productoId === id; });
      if (!line) throw new Error("El producto no esta en la correccion.");
      line.cantidad = qty;
    },
    correctionRemoveItem: function (id) { correction.items = correction.items.filter(function (i) { return i.productoId !== id; }); },
    registerCorrection: function () {
      return exclusive(async function () {
        if (!correction.items.length) throw new Error("Agrega al menos un producto.");
        if (!payments.includes(correction.metodoPago)) throw new Error("Selecciona un metodo de pago.");
        if (correction.clienteId && !get("clientes", correction.clienteId)) throw new Error("El cliente ya no existe.");
        if (correction.metodoPago === "Debe" && !correction.clienteId) throw new Error("Selecciona un cliente para el pago Debe.");
        if (correctionNetTotalValue() < 0) throw new Error('El descuento "' + correction.descuento.nombre + '" supera el nuevo subtotal. Ajusta los productos.');
        var netTotal = correctionNetTotalValue();
        var received = correction.metodoPago === "Efectivo" ? Number(correction.valorRecibido) : netTotal;
        if (correction.metodoPago === "Efectivo" && (correction.valorRecibido === "" || !Number.isInteger(received) || received < 0)) throw new Error("El valor recibido debe ser un numero entero no negativo.");
        if (correction.metodoPago === "Efectivo" && received < netTotal) throw new Error("El valor recibido debe cubrir el total de la venta.");
        var payload = {
          itemsJson: JSON.stringify(correction.items), clienteId: correction.clienteId,
          metodoPago: correction.metodoPago, valorRecibido: Number.isFinite(received) ? received : 0
        };
        var saved = put("ventas", await PYL.api.apiCorrectSale(correction.ventaId, payload));
        try { state.productos = (await PYL.api.apiGet("productos")).map(function (p) { return normalize("productos", p); }); }
        catch (error) { inventoryFresh = false; }
        correction = null;
        return clone(saved);
      });
    },
    startRefund: function (ventaId) {
      var venta = get("ventas", ventaId);
      if (!venta || venta.estado !== "cerrada") throw new Error("Solo se pueden reembolsar ventas cerradas.");
      var refunded = refundedByProduct(venta);
      refundDraft = {
        ventaId: ventaId, id: crypto.randomUUID(),
        lines: venta.items.map(function (i) {
          var yaReembolsado = refunded[i.productoId] || 0;
          return { productoId: i.productoId, nombre: i.nombre, precio: i.precio, vendido: i.cantidad,
                  yaReembolsado: yaReembolsado, disponible: Math.max(0, i.cantidad - yaReembolsado),
                  cantidad: 0, retornaInventario: true };
        })
      };
    },
    cancelRefund: function () { refundDraft = null; },
    isRefunding: function () { return refundDraft !== null; },
    getRefund: function () { return refundDraft ? clone(refundDraft) : null; },
    refundHasPending: function () { return refundDraft.lines.some(function (l) { return l.disponible > 0; }); },
    refundSetLineQty: function (productoId, quantity) {
      var line = refundDraft.lines.find(function (l) { return l.productoId === productoId; });
      if (!line) throw new Error("El producto no esta en esta venta.");
      var qty = Number(quantity);
      if (!Number.isInteger(qty) || qty < 0) throw new Error("La cantidad debe ser un entero no negativo.");
      line.cantidad = Math.min(qty, line.disponible);
    },
    refundSetLineRetorna: function (productoId, value) {
      var line = refundDraft.lines.find(function (l) { return l.productoId === productoId; });
      if (line) line.retornaInventario = Boolean(value);
    },
    refundFillAll: function () { refundDraft.lines.forEach(function (l) { l.cantidad = l.disponible; }); },
    refundPreviewTotal: refundPreviewTotal,
    registerRefund: function () {
      return exclusive(async function () {
        var selected = refundDraft.lines.filter(function (l) { return l.cantidad > 0; });
        if (!selected.length) throw new Error("Selecciona al menos un producto para reembolsar.");
        var payload = {
          id: refundDraft.id, total: false,
          itemsJson: JSON.stringify(selected.map(function (l) {
            return { productoId: l.productoId, cantidad: l.cantidad, retornaInventario: l.retornaInventario };
          }))
        };
        var saved = put("ventas", await PYL.api.apiCreateRefund(refundDraft.ventaId, payload));
        try { state.productos = (await PYL.api.apiGet("productos")).map(function (p) { return normalize("productos", p); }); }
        catch (error) { inventoryFresh = false; }
        refundDraft = null;
        return clone(saved);
      });
    },
    // Faltantes: no viven en state (se consultan con filtros, siempre frescos).
    // Un faltante es solo informativo (RN-09): no toca inventario ni ventas.
    // data.id se genera al abrir el formulario y se reutiliza en reintentos.
    createFaltante: function (data) {
      return exclusive(async function () { return await PYL.api.apiCreateFaltante(faltanteData(data)); });
    },
    resolveFaltante: function (id) {
      return exclusive(async function () { return await PYL.api.apiResolveFaltante(id); });
    },
    // Tras crear el producto de un faltante "No registrado": se resuelven los pendientes que
    // pidieron lo mismo (mismo nombre normalizado, asi COFIAS y cofias cuentan igual).
    resolveFaltantesNoRegistrados: function (nombreNormalizado) {
      return exclusive(async function () {
        if (!nombreNormalizado) return 0;
        var pendientes = await PYL.api.apiFaltantes({ tipo: "no_registrado", estado: "pendiente" }, false);
        var mismos = pendientes.filter(function (f) { return f.nombreNormalizado === nombreNormalizado; });
        for (var i = 0; i < mismos.length; i++) await PYL.api.apiResolveFaltante(mismos[i].id);
        return mismos.length;
      });
    },
    // Reportes: solo lectura, siempre frescos desde el backend (nada se guarda en state).
    // Se valida el rango antes de pedir para dar el mensaje al instante; el backend vuelve a validar.
    getReporte: function (name, filters) {
      var needsRange = name !== "faltantes", f = filters || {};
      if (!["ventas", "productos-mas-vendidos", "compras", "faltantes"].includes(name)) throw new Error("Reporte desconocido.");
      var isDate = function (v) { return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v + "T00:00:00").getTime()); };
      if (needsRange && (!f.desde || !f.hasta)) throw new Error("Selecciona la fecha inicial y la final.");
      if ((f.desde && !isDate(f.desde)) || (f.hasta && !isDate(f.hasta))) throw new Error("Las fechas no son validas.");
      if (f.desde && f.hasta && f.desde > f.hasta) throw new Error("La fecha inicial no puede ser posterior a la final.");
      return PYL.api.apiReporte(name, f);
    },
    getFaltantes: function (filters) { return PYL.api.apiFaltantes(filters, false); },
    getFaltantesResumen: function (filters) { return PYL.api.apiFaltantes(filters, true); },
    createPurchase: function (purchase) {
      return exclusive(async function () {
        if (!inventoryFresh) throw new Error("Actualiza los datos antes de registrar otra compra.");
        if (!get("proveedores", purchase.proveedorId)) throw new Error("Selecciona un proveedor existente.");
        if (!purchase.items.length) throw new Error("Agrega al menos un producto.");
        purchase.items.forEach(function (i) {
          if (!get("productos", i.productoId)) throw new Error("El producto " + i.nombre + " ya no existe.");
          if (!Number.isInteger(i.cantidad) || i.cantidad < 1 || !Number.isInteger(i.costo) || i.costo < 0) throw new Error("Revisa cantidades y costos de la compra: deben ser numeros enteros no negativos.");
        });
        var saved = put("compras", await PYL.api.apiPost("compras", "create", {
          id: purchase.id, fecha: purchase.fecha, proveedorId: purchase.proveedorId,
          total: total(purchase.items, "costo"), itemsJson: JSON.stringify(purchase.items)
        }));
        var warning = "";
        try { state.productos = (await PYL.api.apiGet("productos")).map(function (p) { return normalize("productos", p); }); }
        catch (error) { inventoryFresh = false; warning = "Compra registrada. Actualiza los datos para consultar el inventario."; }
        return { record: clone(saved), warning: warning };
      });
    }
  };
})(window);

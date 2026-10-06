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
    return { id: crypto.randomUUID(), fecha: new Date().toISOString(), estado: "abierta", clienteId: "", metodoPago: "Efectivo", valorRecibido: "", items: [], paso: "items" };
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
  async function load() {
    // Commit the snapshot only after every resource has loaded successfully.
    var rows = await Promise.all(PYL.api.resources.map(async function (r) {
      return [r, (await PYL.api.apiGet(r)).map(function (row) { return normalize(r, row); })];
    }));
    rows.forEach(function (pair) { state[pair[0]] = pair[1]; });
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
    if (data.precio === "" || data.costo === "" || !Number.isFinite(value.precio) || value.precio < 0 || !Number.isFinite(value.costo) || value.costo < 0) throw new Error("Precio y costo deben ser numeros no negativos.");
    if (!value.seguimientoInventario) value.stock = 0;
    if (value.seguimientoInventario && (data.stock === "" || !Number.isInteger(value.stock) || value.stock < 0)) throw new Error("Stock debe ser un entero no negativo.");
    if (state.productos.some(function (p) { return p.id !== id && p.codigo.toLowerCase() === value.codigo.toLowerCase(); })) throw new Error("Ya existe un producto con ese codigo.");
    return value;
  }
  function snapshot(p, qty) { return { productoId: p.id, codigo: p.codigo, nombre: p.nombre, precio: p.precio, costo: p.costo, cantidad: qty }; }
  function saleRecord(status) {
    if (!currentSale.items.length) throw new Error("Agrega al menos un producto.");
    var amount = total(currentSale.items, "precio");
    var received = currentSale.metodoPago === "Efectivo" ? Number(currentSale.valorRecibido) : currentSale.metodoPago === "Nequi" ? amount : 0;
    if (!payments.includes(currentSale.metodoPago)) throw new Error("Selecciona un metodo de pago.");
    if (currentSale.clienteId && !get("clientes", currentSale.clienteId)) throw new Error("El cliente ya no existe.");
    if (status === "cerrada") {
      if (!inventoryFresh) throw new Error("Actualiza los datos antes de cerrar otra venta.");
      if (currentSale.metodoPago === "Debe" && !currentSale.clienteId) throw new Error("Selecciona un cliente para el pago Debe.");
      if (currentSale.metodoPago === "Efectivo" && (currentSale.valorRecibido === "" || !Number.isFinite(received) || received < amount)) throw new Error("El valor recibido debe cubrir el total.");
      currentSale.items.forEach(function (i) {
        var p = get("productos", i.productoId);
        if (!p) throw new Error("El producto " + i.nombre + " ya no existe.");
        if (p.seguimientoInventario && p.stock < i.cantidad) throw new Error("Stock insuficiente para " + p.nombre + ". Disponible: " + p.stock);
      });
    }
    return {
      id: currentSale.id, fecha: currentSale.fecha, estado: status, clienteId: currentSale.clienteId,
      metodoPago: currentSale.metodoPago, subtotal: amount, total: amount,
      valorRecibido: Number.isFinite(received) ? received : 0, cambio: status === "cerrada" && currentSale.metodoPago === "Efectivo" ? received - amount : 0,
      itemsJson: JSON.stringify(currentSale.items), actualizadoEn: new Date().toISOString()
    };
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
    clearSale: function () { currentSale.items = []; currentSale.paso = "items"; currentSale.valorRecibido = ""; },
    setSaleField: function (field, value) { if (["clienteId", "metodoPago", "valorRecibido", "paso"].includes(field)) currentSale[field] = value; },
    currentTotal: function () { return total(currentSale.items, "precio"); },
    lineSubtotal: function (i) { return i.precio * i.cantidad; },
    suggestCode: function () { var max = state.productos.reduce(function (n, p) { var m = p.codigo.match(/(\d+)$/); return Math.max(n, m ? Number(m[1]) : 0); }, 0); return "PL-" + PYL.utils.pad(max + 1, 3); },
    addItem: function (id, quantity) {
      var p = get("productos", id), qty = Number(quantity);
      if (!p) throw new Error("El producto no existe.");
      if (!Number.isInteger(qty) || qty < 1) throw new Error("La cantidad debe ser un entero mayor que cero.");
      var line = currentSale.items.find(function (i) { return i.productoId === id; });
      if (line) line.cantidad += qty; else currentSale.items.push(snapshot(p, qty));
    },
    updateItemQty: function (id, quantity) {
      var qty = Number(quantity);
      if (!Number.isInteger(qty) || qty < 1) throw new Error("La cantidad debe ser un entero mayor que cero.");
      var line = currentSale.items.find(function (i) { return i.productoId === id; });
      if (line) line.cantidad = qty;
    },
    removeItem: function (id) { currentSale.items = currentSale.items.filter(function (i) { return i.productoId !== id; }); },
    saveDraft: function () { return saveSale("abierta"); },
    closeSale: function () { return saveSale("cerrada"); },
    resumeDraft: async function (id) {
      if (currentSale.items.length && currentSale.id !== id) await saveSale("abierta");
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
    saveEntity: function (r, data, id) {
      return exclusive(async function () {
        if (!["categorias", "clientes", "proveedores"].includes(r)) throw new Error("Entidad invalida.");
        var value = { id: id || crypto.randomUUID(), nombre: String(data.nombre || "").trim() };
        if (!value.nombre) throw new Error("El nombre es obligatorio.");
        if (r !== "categorias") { value.telefono = String(data.telefono || "").trim(); value.correo = String(data.correo || "").trim(); }
        return put(r, await PYL.api.apiPost(r, id ? "update" : "create", value));
      });
    },
    deleteRecord: function (r, id) {
      return exclusive(async function () {
        if (r === "productos" && currentSale.items.some(function (i) { return i.productoId === id; })) throw new Error("El producto esta en la venta en curso. Quitalo del ticket primero.");
        if (r === "clientes" && currentSale.clienteId === id) throw new Error("El cliente esta asociado a la venta en curso.");
        await PYL.api.apiPost(r, "delete", { id: id });
        state[r] = state[r].filter(function (row) { return row.id !== id; });
        if (r === "ventas" && currentSale.id === id) currentSale = emptySale();
      });
    },
    createPurchase: function (purchase) {
      return exclusive(async function () {
        if (!inventoryFresh) throw new Error("Actualiza los datos antes de registrar otra compra.");
        if (!get("proveedores", purchase.proveedorId)) throw new Error("Selecciona un proveedor existente.");
        if (!purchase.items.length) throw new Error("Agrega al menos un producto.");
        purchase.items.forEach(function (i) {
          if (!get("productos", i.productoId)) throw new Error("El producto " + i.nombre + " ya no existe.");
          if (!Number.isInteger(i.cantidad) || i.cantidad < 1 || !Number.isFinite(i.costo) || i.costo < 0) throw new Error("Revisa cantidades y costos de la compra.");
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

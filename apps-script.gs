// Bound script: Extensions > Apps Script, in the destination spreadsheet.
var SCHEMA = {
  productos: ["id", "codigo", "nombre", "categoriaId", "precio", "costo", "seguimientoInventario", "stock"],
  categorias: ["id", "nombre"],
  clientes: ["id", "nombre", "telefono", "correo"],
  proveedores: ["id", "nombre", "telefono", "correo"],
  ventas: ["id", "fecha", "estado", "clienteId", "metodoPago", "subtotal", "total", "valorRecibido", "cambio", "itemsJson", "actualizadoEn"],
  compras: ["id", "fecha", "proveedorId", "total", "itemsJson"]
};

function responder(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
function exigir(test, message) { if (!test) throw new Error(message); }
var cachedBook;
function libro() {
  if (cachedBook) return cachedBook;
  var id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  cachedBook = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  exigir(cachedBook, "Ejecuta prepararHojas desde el editor antes de publicar el servicio.");
  return cachedBook;
}
function hoja(resource) {
  exigir(Object.prototype.hasOwnProperty.call(SCHEMA, resource), "Recurso desconocido.");
  var sheet = libro().getSheetByName(resource);
  exigir(sheet, "Falta la pestana " + resource + ". Ejecuta prepararHojas.");
  var headers = sheet.getRange(1, 1, 1, SCHEMA[resource].length).getValues()[0];
  exigir(JSON.stringify(headers) === JSON.stringify(SCHEMA[resource]), "Encabezados incorrectos en " + resource + ".");
  return sheet;
}
function prepararHojas() {
  PropertiesService.getScriptProperties().setProperty("SPREADSHEET_ID", libro().getId());
  Object.keys(SCHEMA).forEach(function (resource) {
    var sheet = libro().getSheetByName(resource) || libro().insertSheet(resource);
    if (!sheet.getLastRow()) sheet.getRange(1, 1, 1, SCHEMA[resource].length).setValues([SCHEMA[resource]]);
    hoja(resource);
    sheet.setFrozenRows(1);
  });
}
function leer(resource) {
  var sheet = hoja(resource), count = sheet.getLastRow() - 1;
  if (count < 1) return [];
  return sheet.getRange(2, 1, count, SCHEMA[resource].length).getValues().filter(function (row) { return row[0] !== ""; }).map(function (values) {
    var row = {};
    SCHEMA[resource].forEach(function (key, i) { row[key] = values[i] instanceof Date ? values[i].toISOString() : values[i]; });
    row.id = String(row.id);
    ["categoriaId", "clienteId", "proveedorId", "codigo", "telefono"].forEach(function (key) { if (key in row) row[key] = String(row[key]); });
    return row;
  });
}
function buscar(resource, id) { return leer(resource).find(function (row) { return row.id === id; }); }
function fila(resource, id) {
  var sheet = hoja(resource), count = sheet.getLastRow() - 1;
  if (count < 1) return -1;
  var ids = sheet.getRange(2, 1, count, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return -1;
}
function escribir(resource, row, number) {
  var sheet = hoja(resource);
  var rowNumber = number || sheet.getLastRow() + 1;
  var values = SCHEMA[resource].map(function (key) { return row[key] == null ? "" : row[key]; });
  // Formato de texto en celdas con string antes de escribir: evita que Sheets
  // convierta codigos, telefonos o fechas, y que un valor empiece con = + @ se lea como formula.
  values.forEach(function (value, i) {
    if (typeof value === "string") sheet.getRange(rowNumber, i + 1).setNumberFormat("@");
  });
  sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]);
}
function conBloqueo(fn) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    return responder({ success: true, data: fn() });
  } catch (error) {
    return responder({ success: false, message: error.message || String(error) });
  } finally { if (lock.hasLock()) lock.releaseLock(); }
}
function doGet(event) {
  // Las lecturas no modifican la hoja: no necesitan el bloqueo del script.
  try {
    return responder({ success: true, data: leer(event && event.parameter && event.parameter.resource) });
  } catch (error) {
    return responder({ success: false, message: error.message || String(error) });
  }
}
function doPost(event) {
  return conBloqueo(function () {
    var resource = event && event.parameter && event.parameter.resource;
    hoja(resource);
    var body = JSON.parse(event.postData.contents);
    exigir(body && ["create", "update", "delete"].includes(body.action), "Accion invalida.");
    exigir(body.data && typeof body.data === "object" && !Array.isArray(body.data), "data debe ser un objeto.");
    var id = String(body.data.id || "").trim();
    exigir(id, "El id es obligatorio.");
    var old = buscar(resource, id);
    if (body.action === "delete") {
      exigir(old, "No existe el registro con id " + id + ".");
      validarEliminacion(resource, id, old);
      hoja(resource).deleteRow(fila(resource, id));
      SpreadsheetApp.flush();
      return { id: id };
    }
    var data = { id: id };
    Object.keys(body.data).forEach(function (key) {
      exigir(SCHEMA[resource].includes(key), "Campo desconocido: " + key);
      data[key] = body.data[key];
    });
    data.id = id;
    if (body.action === "update") exigir(old, "No existe el registro con id " + id + ".");
    if (old && (body.action === "create" || (resource === "ventas" && old.estado === "cerrada") || resource === "compras")) {
      // A response can be lost after a successful commit; retries cannot debit twice.
      exigir(equivalente(resource, old, Object.assign({}, old, data)), "El registro ya existe y no admite estos cambios.");
      return old;
    }
    var row = Object.assign({}, old || {}, data);
    validar(resource, row);
    if (resource === "ventas") row.actualizadoEn = new Date().toISOString();
    var changes = movimientos(resource, row, old);
    guardarConInventario(resource, row, old, changes);
    return row;
  });
}
function numero(value, label, integer) {
  exigir(value !== "" && value != null && typeof value !== "boolean", label + " es obligatorio.");
  var n = Number(value);
  exigir(Number.isFinite(n) && n >= 0 && (!integer || Number.isInteger(n)), label + " debe ser un numero " + (integer ? "entero " : "") + "no negativo.");
  return n;
}
function texto(value, label) {
  var result = String(value == null ? "" : value).trim();
  exigir(result, label + " es obligatorio.");
  return result;
}
function referencia(resource, id, label) {
  exigir(id && buscar(resource, String(id)), label + " no existe.");
}
function detalles(row) {
  var items;
  try { items = JSON.parse(row.itemsJson); } catch (e) { throw new Error("itemsJson debe ser un JSON valido."); }
  exigir(Array.isArray(items) && items.length, "El documento debe tener productos.");
  return items;
}
function validar(resource, row) {
  if (["categorias", "clientes", "proveedores", "productos"].includes(resource)) row.nombre = texto(row.nombre, "Nombre");
  if (["clientes", "proveedores"].includes(resource)) {
    row.telefono = String(row.telefono || "").trim();
    row.correo = String(row.correo || "").trim();
    exigir(!row.correo || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.correo), "El correo no es valido.");
  }
  if (resource === "categorias") exigir(!leer("categorias").some(function (r) { return r.id !== row.id && r.nombre.toLowerCase() === row.nombre.toLowerCase(); }), "Ya existe esa categoria.");
  if (resource === "productos") {
    row.codigo = texto(row.codigo, "Codigo");
    exigir(!leer("productos").some(function (p) { return p.id !== row.id && p.codigo.toLowerCase() === row.codigo.toLowerCase(); }), "Ya existe un producto con ese codigo.");
    referencia("categorias", row.categoriaId, "La categoria");
    row.precio = numero(row.precio, "Precio", true); row.costo = numero(row.costo, "Costo", true);
    exigir([true, false, "true", "false", "TRUE", "FALSE"].includes(row.seguimientoInventario), "seguimientoInventario debe ser booleano.");
    row.seguimientoInventario = String(row.seguimientoInventario).toLowerCase() === "true";
    row.stock = row.seguimientoInventario ? numero(row.stock, "Stock", true) : 0;
  }
  if (resource === "ventas" || resource === "compras") {
    exigir(row.fecha && !isNaN(new Date(row.fecha).getTime()), "La fecha no es valida.");
    var items = detalles(row), seen = {};
    items = items.map(function (i) {
      referencia("productos", i.productoId, "El producto " + (i.nombre || i.productoId));
      exigir(!seen[i.productoId], "El producto esta repetido: " + i.nombre);
      seen[i.productoId] = true;
      var quantity = numero(i.cantidad, "Cantidad", true);
      exigir(quantity > 0, "La cantidad debe ser mayor que cero.");
      var p = buscar("productos", i.productoId);
      var item = { productoId: p.id, codigo: texto(i.codigo, "Codigo del item"), nombre: texto(i.nombre, "Nombre del item"), cantidad: quantity, costo: numero(i.costo, "Costo del item", true) };
      if (resource === "ventas") item.precio = numero(i.precio, "Precio del item", true);
      return item;
    });
    row.itemsJson = JSON.stringify(items);
    row.total = items.reduce(function (sum, i) { return sum + i.cantidad * i[resource === "ventas" ? "precio" : "costo"]; }, 0);
    if (resource === "compras") referencia("proveedores", row.proveedorId, "El proveedor");
    if (resource === "ventas") {
      exigir(["abierta", "cerrada"].includes(row.estado), "Estado de venta invalido.");
      exigir(["Efectivo", "Nequi", "Debe"].includes(row.metodoPago), "Metodo de pago invalido.");
      row.clienteId = String(row.clienteId || "");
      if (row.clienteId) referencia("clientes", row.clienteId, "El cliente");
      exigir(!(row.estado === "cerrada" && row.metodoPago === "Debe" && !row.clienteId), "El pago Debe requiere un cliente.");
      row.subtotal = row.total;
      row.valorRecibido = numero(row.valorRecibido, "Valor recibido", true);
      if (row.metodoPago === "Nequi") row.valorRecibido = row.total;
      if (row.metodoPago === "Debe") row.valorRecibido = 0;
      if (row.estado === "cerrada" && row.metodoPago === "Efectivo") exigir(row.valorRecibido >= row.total, "El valor recibido no cubre el total.");
      row.cambio = row.estado === "cerrada" && row.metodoPago === "Efectivo" ? row.valorRecibido - row.total : 0;
    }
  }
}
function equivalente(resource, a, b) {
  var keys = SCHEMA[resource].filter(function (key) { return key !== "actualizadoEn"; });
  return keys.every(function (key) {
    if (key === "itemsJson") {
      try {
        var left = JSON.parse(a[key]), right = JSON.parse(b[key]);
        return left.length === right.length && left.every(function (item, i) {
          return ["productoId", "codigo", "nombre", "cantidad", "precio", "costo"].every(function (k) { return String(item[k]) === String(right[i][k]); });
        });
      } catch (e) { return false; }
    }
    return String(a[key] == null ? "" : a[key]) === String(b[key] == null ? "" : b[key]);
  });
}
function movimientos(resource, row, old) {
  if (resource !== "compras" && !(resource === "ventas" && row.estado === "cerrada" && (!old || old.estado === "abierta"))) return [];
  return detalles(row).map(function (i) {
    var before = buscar("productos", i.productoId), after = Object.assign({}, before);
    var tracked = String(before.seguimientoInventario).toLowerCase() === "true";
    if (tracked) {
      after.stock = numero(before.stock, "Stock", true) + (resource === "compras" ? i.cantidad : -i.cantidad);
      exigir(after.stock >= 0, "Stock insuficiente para " + before.nombre + ". Disponible: " + before.stock);
    }
    if (resource === "compras") after.costo = i.costo;
    return { before: before, after: after, number: fila("productos", before.id) };
  });
}
function guardarConInventario(resource, row, old, changes) {
  var number = old ? fila(resource, row.id) : hoja(resource).getLastRow() + 1;
  try {
    escribir(resource, row, number);
    changes.forEach(function (change) { escribir("productos", change.after, change.number); });
    SpreadsheetApp.flush();
  } catch (error) {
    // Sheets has no transactions; restore the original rows on ordinary failures.
    try {
      changes.forEach(function (change) { escribir("productos", change.before, change.number); });
      if (old) escribir(resource, old, number);
      else if (fila(resource, row.id) > 0) hoja(resource).deleteRow(fila(resource, row.id));
      SpreadsheetApp.flush();
    } catch (rollbackError) {
      throw new Error("Fallo el registro y la recuperacion del inventario. Revisar manualmente " + resource + " id " + row.id + " antes de reintentar.");
    }
    throw error;
  }
}
function validarEliminacion(resource, id, row) {
  if (resource === "categorias") exigir(!leer("productos").some(function (p) { return p.categoriaId === id; }), "La categoria tiene productos asociados.");
  if (resource === "proveedores") exigir(!leer("compras").some(function (p) { return p.proveedorId === id; }), "El proveedor tiene compras asociadas.");
  if (resource === "clientes") exigir(!leer("ventas").some(function (s) { return s.clienteId === id; }), "El cliente tiene ventas asociadas.");
  if (resource === "ventas") exigir(row.estado === "abierta", "No se pueden eliminar ventas cerradas.");
  if (resource === "compras") throw new Error("No se pueden eliminar compras registradas.");
  if (resource === "productos") exigir(!leer("ventas").some(function (sale) {
    return sale.estado === "abierta" && detalles(sale).some(function (i) { return i.productoId === id; });
  }), "El producto tiene ventas abiertas asociadas.");
}

function redondear(value) { return Math.round(Number(value) || 0); }
// One-time migration: paste the exported MVP1 JSON into the wrapper documented in README.
// MVP1 guardaba dinero con decimales; se redondea al entero mas cercano al migrar.
function migrarMVP1(datos) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    prepararHojas();
    exigir(Array.isArray(datos.products), "El archivo MVP1 no contiene products.");
    exigir(["productos", "ventas", "categorias", "clientes", "compras", "proveedores"].every(function (r) { return leer(r).length === 0; }), "La migracion requiere hojas vacias para evitar duplicados.");
    var categories = {}, clients = {};
    datos.products.forEach(function (p) {
      var name = String(p.categoria || "").trim() || "Sin categoria";
      if (!categories[name.toLowerCase()]) {
        var category = { id: Utilities.getUuid(), nombre: name };
        categories[name.toLowerCase()] = category.id;
        escribir("categorias", category);
      }
      escribir("productos", { id: p.id, codigo: p.codigoInterno || p.codigo, nombre: p.nombre, categoriaId: categories[name.toLowerCase()], precio: redondear(p.precio), costo: redondear(p.costo), seguimientoInventario: p.seguimientoInventario, stock: p.stock });
    });
    var sales = (datos.sales || []).slice();
    if (datos.currentSale && datos.currentSale.items && datos.currentSale.items.length) {
      var current = Object.assign({}, datos.currentSale, { id: datos.currentSale.draftId || datos.currentSale.id, estado: "borrador", fecha: new Date().toISOString() });
      sales = sales.filter(function (s) { return s.id !== current.id; }); sales.push(current);
    }
    sales.forEach(function (sale) {
      var name = String(sale.cliente || "").trim(), clientId = "";
      if (name && name !== "Consumidor final") {
        if (!clients[name.toLowerCase()]) {
          clientId = Utilities.getUuid(); clients[name.toLowerCase()] = clientId;
          escribir("clientes", { id: clientId, nombre: name, telefono: "", correo: "" });
        }
        clientId = clients[name.toLowerCase()];
      }
      var items = (sale.items || []).map(function (i) {
        var p = buscar("productos", i.productId || i.productoId);
        return { productoId: i.productId || i.productoId, codigo: i.codigoInterno || i.codigo, nombre: i.nombre, precio: redondear(i.precio), costo: redondear(i.costo == null ? (p ? p.costo : 0) : i.costo), cantidad: i.cantidad };
      });
      if (!items.length) return;
      var total = items.reduce(function (sum, i) { return sum + i.precio * i.cantidad; }, 0);
      var method = { efectivo: "Efectivo", nequi: "Nequi", debe: "Debe" }[sale.metodoPago] || sale.metodoPago || "Efectivo";
      escribir("ventas", { id: sale.id, fecha: sale.fecha || new Date().toISOString(), estado: sale.estado === "cerrada" ? "cerrada" : "abierta", clienteId: clientId, metodoPago: method, subtotal: total, total: total, valorRecibido: redondear(sale.valorRecibido), cambio: redondear(sale.cambio), itemsJson: JSON.stringify(items), actualizadoEn: new Date().toISOString() });
    });
    // Imported stock already includes closed MVP1 sales; do not debit it again.
    SpreadsheetApp.flush();
    return { productos: leer("productos").length, ventas: leer("ventas").length };
  } finally { lock.releaseLock(); }
}

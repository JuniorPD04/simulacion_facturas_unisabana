const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

function createBackend() {
  const sheets = new Map();
  let failure = null;
  class Sheet {
    constructor(name) { this.name = name; this.rows = []; this.formats = []; }
    getLastRow() { return this.rows.length; }
    setFrozenRows() {}
    deleteRow(number) { this.rows.splice(number - 1, 1); this.formats.splice(number - 1, 1); }
    getRange(row, col, height = 1, width = 1) {
      return {
        getValues: () => Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => this.rows[row - 1 + i]?.[col - 1 + j] ?? "")),
        setValues: (values) => {
          if (failure && failure(this.name, row, values)) { failure = null; throw new Error("Fallo de escritura simulado."); }
          values.forEach((value, i) => {
            this.rows[row - 1 + i] ||= [];
            value.forEach((cell, j) => { this.rows[row - 1 + i][col - 1 + j] = cell; });
          });
        },
        setNumberFormat: (format) => {
          for (let i = 0; i < height; i++) {
            this.formats[row - 1 + i] ||= [];
            for (let j = 0; j < width; j++) this.formats[row - 1 + i][col - 1 + j] = format;
          }
        }
      };
    }
  }
  const book = { getId: () => "test-sheet", getSheetByName: name => sheets.get(name), insertSheet: name => { const s = new Sheet(name); sheets.set(name, s); return s; } };
  const props = new Map();
  const context = vm.createContext({
    console, Date,
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => props.get(key), setProperty: (key, value) => props.set(key, value) }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => book, openById: () => book, flush() {} },
    LockService: { getScriptLock: () => { let locked = false; return { waitLock: () => { locked = true; }, hasLock: () => locked, releaseLock: () => { locked = false; } }; } },
    Utilities: { getUuid: () => crypto.randomUUID() },
    ContentService: { MimeType: { JSON: "application/json" }, createTextOutput: value => ({ value, setMimeType() { return this; } }) }
  });
  vm.runInContext(fs.readFileSync(path.join(root, "apps-script.gs"), "utf8"), context);
  context.prepararHojas();
  const decode = result => JSON.parse(result.value);
  return {
    context,
    get: resource => decode(context.doGet({ parameter: { resource } })),
    post: (resource, action, data) => decode(context.doPost({ parameter: { resource }, postData: { contents: JSON.stringify({ action, data }) } })),
    failOnce: fn => { failure = fn; },
    format: (resource, row, col) => sheets.get(resource)?.formats?.[row - 1]?.[col - 1]
  };
}
function createStore(backend, overrides = {}) {
  const calls = [];
  const context = vm.createContext({ window: {}, crypto: crypto.webcrypto, console });
  context.window.PYL = { api: {
    resources: ["productos", "ventas", "compras", "clientes", "proveedores", "categorias"],
    async apiGet(resource) { const result = backend.get(resource); if (!result.success) throw new Error(result.message); return result.data; },
    async apiPost(resource, action, data) { calls.push({ resource, action, data }); const result = backend.post(resource, action, data); if (!result.success) throw new Error(result.message); return result.data; },
    ...overrides
  } };
  vm.runInContext(fs.readFileSync(path.join(root, "js/utils.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(root, "js/store.js"), "utf8"), context);
  return { store: context.window.PYL.store, api: context.window.PYL.api, calls };
}
function seed(backend) {
  const records = [
    ["categorias", { id: "cat", nombre: "Papeleria" }],
    ["clientes", { id: "client", nombre: "Cliente de prueba", telefono: "3001234567", correo: "cliente@example.com" }],
    ["proveedores", { id: "provider", nombre: "Proveedor de prueba", telefono: "", correo: "" }],
    ["productos", { id: "product", codigo: "P-001", nombre: "Producto de prueba", categoriaId: "cat", precio: 100, costo: 40, seguimientoInventario: true, stock: 5 }],
    ["productos", { id: "service", codigo: "S-001", nombre: "Servicio de prueba", categoriaId: "cat", precio: 50, costo: 10, seguimientoInventario: false, stock: 0 }]
  ];
  records.forEach(([r, data]) => { const result = backend.post(r, "create", data); if (!result.success) throw new Error(result.message); });
}
module.exports = { createBackend, createStore, seed, root };

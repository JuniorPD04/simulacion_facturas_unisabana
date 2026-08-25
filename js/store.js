(function (global) {
  var PYL = global.PYL || (global.PYL = {});
  var STORAGE_KEY = "papel-y-luna-pos-mvp1";

  var state = {
    products: [],
    sales: [],
    currentSale: null,
    meta: {
      productSeq: 1,
      saleSeq: 1,
      draftSeq: 1
    }
  };

  function seedProducts() {
    return [
      { id: "p1", codigoInterno: "PL-001", nombre: "Cuaderno argollado carta", categoria: "Cuadernos", precio: 18500, costo: 11000, seguimientoInventario: true, stock: 24, imagen: "assets/cuadernos.svg" },
      { id: "p2", codigoInterno: "PL-002", nombre: "Lapicero negro gel", categoria: "Escritura", precio: 2800, costo: 1200, seguimientoInventario: true, stock: 80, imagen: "assets/escritura.svg" },
      { id: "p3", codigoInterno: "PL-003", nombre: "Resma papel carta", categoria: "Impresion", precio: 23500, costo: 16800, seguimientoInventario: true, stock: 18, imagen: "assets/impresion.svg" },
      { id: "p4", codigoInterno: "PL-004", nombre: "Caja de colores x24", categoria: "Arte", precio: 16900, costo: 9800, seguimientoInventario: true, stock: 15, imagen: "assets/arte.svg" },
      { id: "p5", codigoInterno: "PL-005", nombre: "Marcadores borrables x4", categoria: "Oficina", precio: 14200, costo: 8100, seguimientoInventario: true, stock: 22, imagen: "assets/oficina.svg" },
      { id: "p6", codigoInterno: "PL-006", nombre: "Carpeta plastica oficio", categoria: "Oficina", precio: 3200, costo: 1500, seguimientoInventario: true, stock: 40, imagen: "assets/oficina.svg" },
      { id: "p7", codigoInterno: "PL-007", nombre: "Cartulina escolar amarilla", categoria: "Arte", precio: 1800, costo: 700, seguimientoInventario: true, stock: 60, imagen: "assets/arte.svg" },
      { id: "p8", codigoInterno: "PL-008", nombre: "Cinta transparente grande", categoria: "Oficina", precio: 5600, costo: 2700, seguimientoInventario: true, stock: 28, imagen: "assets/oficina.svg" },
      { id: "p9", codigoInterno: "PL-009", nombre: "Memoria USB 32 GB", categoria: "Tecnología", precio: 28900, costo: 19500, seguimientoInventario: true, stock: 10, imagen: "assets/tecnologia.svg" },
      { id: "p10", codigoInterno: "PL-010", nombre: "Block iris surtido", categoria: "Arte", precio: 9500, costo: 5200, seguimientoInventario: true, stock: 16, imagen: "assets/arte.svg" },
      { id: "p11", codigoInterno: "PL-011", nombre: "Corrector liquido", categoria: "Escritura", precio: 4100, costo: 1900, seguimientoInventario: true, stock: 35, imagen: "assets/escritura.svg" },
      { id: "p12", codigoInterno: "PL-012", nombre: "Impresion blanco y negro", categoria: "Impresion", precio: 500, costo: 80, seguimientoInventario: false, stock: 0, imagen: "assets/impresion.svg" }
    ];
  }

  function emptySale() {
    return {
      id: PYL.utils.uid("sale"),
      draftId: null,
      draftNumero: "",
      items: [],
      cliente: "Consumidor final",
      metodoPago: "efectivo",
      valorRecibido: "",
      paso: "items"
    };
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        products: state.products,
        sales: state.sales,
        currentSale: state.currentSale,
        meta: state.meta
      }));
    } catch (error) {
      PYL.ui.toast("No se pudo guardar en este navegador. Revisa el almacenamiento local.", "error");
    }
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function lineSubtotal(item) {
    return item.precio * item.cantidad;
  }

  function saleTotal(items) {
    return items.reduce(function (sum, item) {
      return sum + lineSubtotal(item);
    }, 0);
  }

  function getProduct(id) {
    return state.products.find(function (product) {
      return product.id === id;
    }) || null;
  }

  function reservedQty(productId) {
    if (!state.currentSale) return 0;
    var line = state.currentSale.items.find(function (item) {
      return item.productId === productId;
    });
    return line ? line.cantidad : 0;
  }

  function availableStock(product) {
    if (!product.seguimientoInventario) return Infinity;
    return Math.max(0, Number(product.stock) - reservedQty(product.id));
  }

  function warehouseStock(product) {
    if (!product.seguimientoInventario) return Infinity;
    return Math.max(0, Number(product.stock) || 0);
  }

  function reconcileDraftItems(items) {
    var adjustments = [];
    var next = [];

    (items || []).forEach(function (item) {
      var product = getProduct(item.productId);
      if (!product) {
        adjustments.push(item.nombre + " se quitó porque ya no está en el catálogo.");
        return;
      }

      var qty = item.cantidad;
      if (product.seguimientoInventario) {
        var available = warehouseStock(product);
        if (available <= 0) {
          adjustments.push(product.nombre + " se quitó: no hay stock.");
          return;
        }
        if (qty > available) {
          adjustments.push(product.nombre + ": de " + qty + " a " + available + " und. (stock insuficiente).");
          qty = available;
        }
      }

      next.push({
        productId: product.id,
        codigoInterno: product.codigoInterno,
        nombre: product.nombre,
        precio: product.precio,
        cantidad: qty
      });
    });

    return { items: next, adjustments: adjustments };
  }

  var Store = {
    init: function () {
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          var saved = JSON.parse(raw);
          state.products = Array.isArray(saved.products) ? saved.products : seedProducts();
          state.sales = Array.isArray(saved.sales) ? saved.sales : [];
          state.currentSale = saved.currentSale || emptySale();
          state.meta = saved.meta || state.meta;
        } else {
          state.products = seedProducts();
          state.sales = [];
          state.currentSale = emptySale();
          state.meta = { productSeq: 13, saleSeq: 1, draftSeq: 1 };
          persist();
        }
      } catch (error) {
        state.products = seedProducts();
        state.sales = [];
        state.currentSale = emptySale();
        state.meta = { productSeq: 13, saleSeq: 1, draftSeq: 1 };
      }

      if (!state.currentSale) state.currentSale = emptySale();
      if (!state.meta.draftSeq) state.meta.draftSeq = 1;
      if (!state.currentSale.draftId) state.currentSale.draftId = null;
      if (!state.currentSale.draftNumero) state.currentSale.draftNumero = "";
    },

    getProducts: function () {
      return state.products.slice();
    },

    getProduct: getProduct,

    getCategories: function () {
      var set = {};
      state.products.forEach(function (product) {
        if (product.categoria) set[product.categoria] = true;
      });
      return Object.keys(set).sort();
    },

    suggestCode: function () {
      var max = 0;
      state.products.forEach(function (product) {
        var match = String(product.codigoInterno || "").match(/(\d+)$/);
        if (match) max = Math.max(max, parseInt(match[1], 10));
      });
      return "PL-" + PYL.utils.pad(max + 1, 3);
    },

    validateProduct: function (data, editingId) {
      var errors = {};
      var nombre = String(data.nombre || "").trim();
      var categoria = String(data.categoria || "").trim();
      var codigoInterno = String(data.codigoInterno || "").trim();
      var precio = PYL.utils.toNonNegativeNumber(data.precio);
      var costo = PYL.utils.toNonNegativeNumber(data.costo);
      var seguimiento = Boolean(data.seguimientoInventario);
      var stock = seguimiento ? PYL.utils.toNonNegativeInteger(data.stock) : 0;

      if (!nombre) errors.nombre = "El nombre es obligatorio.";
      if (!categoria) errors.categoria = "La categoría es obligatoria.";
      if (!codigoInterno) errors.codigoInterno = "El código interno es obligatorio.";
      if (!Number.isFinite(precio) || precio < 0) errors.precio = "El precio debe ser un número no negativo.";
      if (!Number.isFinite(costo) || costo < 0) errors.costo = "El costo debe ser un número no negativo.";
      if (seguimiento && !Number.isFinite(stock)) errors.stock = "El stock debe ser un entero no negativo.";

      var duplicated = state.products.some(function (product) {
        return product.codigoInterno.toLowerCase() === codigoInterno.toLowerCase() && product.id !== editingId;
      });
      if (duplicated) errors.codigoInterno = "Ya existe un producto con ese código interno.";

      return {
        ok: Object.keys(errors).length === 0,
        errors: errors,
        value: {
          nombre: nombre,
          categoria: categoria,
          codigoInterno: codigoInterno,
          precio: precio,
          costo: costo,
          seguimientoInventario: seguimiento,
          stock: seguimiento ? stock : 0,
          imagen: data.imagen || PYL.utils.categoryImage(categoria)
        }
      };
    },

    createProduct: function (data) {
      var result = this.validateProduct(data, null);
      if (!result.ok) return result;
      var product = result.value;
      product.id = PYL.utils.uid("p");
      state.products.unshift(product);
      persist();
      return { ok: true, product: clone(product) };
    },

    updateProduct: function (id, data) {
      var index = state.products.findIndex(function (product) {
        return product.id === id;
      });
      if (index === -1) return { ok: false, errors: { general: "El producto no existe." } };
      var result = this.validateProduct(data, id);
      if (!result.ok) return result;
      state.products[index] = Object.assign({}, state.products[index], result.value, { id: id });
      persist();
      return { ok: true, product: clone(state.products[index]) };
    },

    deleteProduct: function (id) {
      var index = state.products.findIndex(function (product) {
        return product.id === id;
      });
      if (index === -1) return { ok: false, message: "El producto ya no existe." };
      state.products.splice(index, 1);
      if (state.currentSale) {
        state.currentSale.items = state.currentSale.items.filter(function (item) {
          return item.productId !== id;
        });
      }
      persist();
      return { ok: true };
    },

    getCurrentSale: function () {
      return state.currentSale;
    },

    lineSubtotal: lineSubtotal,

    currentTotal: function () {
      return saleTotal(state.currentSale.items);
    },

    availableStock: availableStock,

    addItem: function (productId, quantity) {
      var product = getProduct(productId);
      if (!product) return { ok: false, message: "El producto no existe." };
      var qty = PYL.utils.toNonNegativeInteger(quantity);
      if (!Number.isFinite(qty) || qty < 1) return { ok: false, message: "La cantidad debe ser un entero mayor que 0." };

      var available = availableStock(product);
      if (product.seguimientoInventario && qty > available) {
        return { ok: false, message: available === 0 ? "No hay stock disponible." : "Solo hay " + available + " unidad(es) disponibles." };
      }

      var line = state.currentSale.items.find(function (item) {
        return item.productId === productId;
      });
      if (line) {
        line.cantidad += qty;
      } else {
        state.currentSale.items.push({
          productId: product.id,
          codigoInterno: product.codigoInterno,
          nombre: product.nombre,
          precio: product.precio,
          cantidad: qty
        });
      }
      persist();
      return { ok: true };
    },

    updateItemQty: function (productId, quantity) {
      var line = state.currentSale.items.find(function (item) {
        return item.productId === productId;
      });
      if (!line) return { ok: false, message: "El producto no está en la venta." };
      var qty = PYL.utils.toNonNegativeInteger(quantity);
      if (!Number.isFinite(qty) || qty < 1) return { ok: false, message: "La cantidad debe ser un entero mayor que 0." };

      var product = getProduct(productId);
      if (product && product.seguimientoInventario) {
        var already = line.cantidad;
        var available = availableStock(product) + already;
        if (qty > available) {
          line.cantidad = available;
          persist();
          return { ok: false, message: "El stock máximo es " + available + ".", clamped: true, cantidad: available };
        }
      }

      line.cantidad = qty;
      persist();
      return { ok: true };
    },

    removeItem: function (productId) {
      state.currentSale.items = state.currentSale.items.filter(function (item) {
        return item.productId !== productId;
      });
      persist();
    },

    clearSale: function () {
      state.currentSale.items = [];
      state.currentSale.paso = "items";
      state.currentSale.valorRecibido = "";
      state.currentSale.draftId = null;
      state.currentSale.draftNumero = "";
      persist();
    },

    newSale: function () {
      state.currentSale = emptySale();
      persist();
    },

    setSaleField: function (field, value) {
      state.currentSale[field] = value;
      persist();
    },

    previewDraftResume: function (id) {
      var draft = this.getSale(id);
      if (!draft || draft.estado !== "borrador") {
        return { ok: false, message: "Ese borrador ya no existe." };
      }
      var reconciled = reconcileDraftItems(draft.items);
      return {
        ok: true,
        draft: clone(draft),
        items: reconciled.items,
        adjustments: reconciled.adjustments,
        empty: !reconciled.items.length
      };
    },

    saveDraft: function () {
      var sale = state.currentSale;
      if (!sale || !sale.items.length) {
        return { ok: false, message: "Agrega al menos un producto para guardar el borrador." };
      }

      var draftId = sale.draftId || sale.id;
      var draftNumero = sale.draftNumero;
      if (!draftNumero) {
        draftNumero = "B-" + PYL.utils.pad(state.meta.draftSeq, 4);
        state.meta.draftSeq += 1;
      }

      var draft = {
        id: draftId,
        numero: draftNumero,
        fecha: new Date().toISOString(),
        cliente: String(sale.cliente || "").trim() || "Consumidor final",
        items: clone(sale.items),
        total: saleTotal(sale.items),
        metodoPago: sale.metodoPago,
        valorRecibido: sale.valorRecibido,
        cambio: 0,
        estado: "borrador"
      };

      var existing = state.sales.findIndex(function (entry) {
        return entry.id === draftId;
      });
      if (existing !== -1) state.sales.splice(existing, 1);
      state.sales.unshift(draft);
      state.currentSale = emptySale();
      persist();
      return { ok: true, sale: clone(draft) };
    },

    resumeDraft: function (id) {
      var index = state.sales.findIndex(function (sale) {
        return sale.id === id && sale.estado === "borrador";
      });
      if (index === -1) return { ok: false, message: "Ese borrador ya no existe." };

      if (state.currentSale.items.length) {
        var parked = this.saveDraft();
        if (!parked.ok) return parked;
        index = state.sales.findIndex(function (sale) {
          return sale.id === id && sale.estado === "borrador";
        });
        if (index === -1) return { ok: false, message: "Ese borrador ya no existe." };
      }

      var draft = state.sales[index];
      var reconciled = reconcileDraftItems(draft.items);
      if (!reconciled.items.length) {
        return {
          ok: false,
          empty: true,
          adjustments: reconciled.adjustments,
          message: "Ningún producto de este borrador tiene stock suficiente para continuar."
        };
      }

      state.sales.splice(index, 1);
      state.currentSale = {
        id: PYL.utils.uid("sale"),
        draftId: draft.id,
        draftNumero: draft.numero,
        items: reconciled.items,
        cliente: draft.cliente || "Consumidor final",
        metodoPago: draft.metodoPago || "efectivo",
        valorRecibido: draft.valorRecibido || "",
        paso: "items"
      };
      persist();
      return { ok: true, adjustments: reconciled.adjustments, sale: clone(state.currentSale) };
    },

    discardDraft: function (id) {
      var index = state.sales.findIndex(function (sale) {
        return sale.id === id && sale.estado === "borrador";
      });
      if (index === -1) return { ok: false, message: "Ese borrador ya no existe." };
      state.sales.splice(index, 1);
      persist();
      return { ok: true };
    },

    closeSale: function () {
      var sale = state.currentSale;
      if (!sale.items.length) return { ok: false, message: "No se puede cerrar una venta sin productos." };

      var total = saleTotal(sale.items);
      var metodo = sale.metodoPago;
      if (metodo !== "efectivo" && metodo !== "nequi" && metodo !== "debe") {
        return { ok: false, message: "Selecciona un método de pago." };
      }

      var cliente = String(sale.cliente || "").trim() || "Consumidor final";
      var valorRecibido = null;
      var cambio = 0;

      if (metodo === "efectivo") {
        valorRecibido = PYL.utils.toNonNegativeNumber(sale.valorRecibido);
        if (!Number.isFinite(valorRecibido)) return { ok: false, message: "Ingresa el valor recibido." };
        if (valorRecibido < total) return { ok: false, message: "El valor recibido no cubre el total." };
        cambio = valorRecibido - total;
      }

      if (metodo === "debe") {
        if (!String(sale.cliente || "").trim() || cliente === "Consumidor final") {
          return { ok: false, message: "Para pago en Debe debes indicar el nombre del cliente." };
        }
      }

      for (var i = 0; i < sale.items.length; i += 1) {
        var item = sale.items[i];
        var product = getProduct(item.productId);
        if (product && product.seguimientoInventario) {
          if (product.stock < item.cantidad) {
            return { ok: false, message: "Stock insuficiente para " + product.nombre + "." };
          }
        }
      }

      sale.items.forEach(function (item) {
        var product = getProduct(item.productId);
        if (product && product.seguimientoInventario) {
          product.stock -= item.cantidad;
        }
      });

      var closed = {
        id: sale.id,
        numero: "V-" + PYL.utils.pad(state.meta.saleSeq, 4),
        fecha: new Date().toISOString(),
        cliente: cliente,
        items: clone(sale.items),
        total: total,
        metodoPago: metodo,
        valorRecibido: valorRecibido,
        cambio: cambio,
        estado: "cerrada"
      };

      state.meta.saleSeq += 1;
      state.sales.unshift(closed);
      state.currentSale = emptySale();
      persist();
      return { ok: true, sale: clone(closed) };
    },

    getSales: function () {
      return state.sales.slice().sort(function (a, b) {
        if (a.estado === "borrador" && b.estado !== "borrador") return -1;
        if (b.estado === "borrador" && a.estado !== "borrador") return 1;
        return new Date(b.fecha) - new Date(a.fecha);
      });
    },

    getSale: function (id) {
      return state.sales.find(function (sale) {
        return sale.id === id;
      }) || null;
    }
  };

  PYL.store = Store;
})(window);

const IVA = 0.19;

const products = [
  {
    id: 1,
    nombre: "Cuaderno argollado carta",
    categoria: "Cuadernos",
    precio: 18500,
    imagen: "assets/cuadernos.svg",
    descripcion: "Cuaderno de 100 hojas cuadriculadas para clases y apuntes diarios."
  },
  {
    id: 2,
    nombre: "Lapicero negro gel",
    categoria: "Escritura",
    precio: 2800,
    imagen: "assets/escritura.svg",
    descripcion: "Tinta suave de secado rápido, ideal para oficina y colegio."
  },
  {
    id: 3,
    nombre: "Resma papel carta",
    categoria: "Impresion",
    precio: 23500,
    imagen: "assets/impresion.svg",
    descripcion: "Paquete de 500 hojas blancas para impresora o fotocopiadora."
  },
  {
    id: 4,
    nombre: "Caja de colores x24",
    categoria: "Arte",
    precio: 16900,
    imagen: "assets/arte.svg",
    descripcion: "Colores escolares con punta resistente y tonos vivos."
  },
  {
    id: 5,
    nombre: "Marcadores borrables x4",
    categoria: "Oficina",
    precio: 14200,
    imagen: "assets/oficina.svg",
    descripcion: "Set de marcadores para tablero acrílico en colores surtidos."
  },
  {
    id: 6,
    nombre: "Carpeta plastica oficio",
    categoria: "Oficina",
    precio: 3200,
    imagen: "assets/oficina.svg",
    descripcion: "Carpeta liviana para proteger documentos y trabajos impresos."
  },
  {
    id: 7,
    nombre: "Cartulina escolar amarilla",
    categoria: "Arte",
    precio: 1800,
    imagen: "assets/arte.svg",
    descripcion: "Cartulina de color pastel para manualidades y presentaciones."
  },
  {
    id: 8,
    nombre: "Cinta transparente grande",
    categoria: "Oficina",
    precio: 5600,
    imagen: "assets/oficina.svg",
    descripcion: "Rollo adhesivo para paquetes, tareas y uso comercial diario."
  },
  {
    id: 9,
    nombre: "Memoria USB 32 GB",
    categoria: "Tecnología",
    precio: 28900,
    imagen: "assets/tecnologia.svg",
    descripcion: "Unidad USB para guardar documentos, imágenes y presentaciones."
  },
  {
    id: 10,
    nombre: "Block iris surtido",
    categoria: "Arte",
    precio: 9500,
    imagen: "assets/arte.svg",
    descripcion: "Hojas de colores surtidos para recortes, carteleras y talleres."
  },
  {
    id: 11,
    nombre: "Corrector liquido",
    categoria: "Escritura",
    precio: 4100,
    imagen: "assets/escritura.svg",
    descripcion: "Corrector de aplicación uniforme para trabajos escritos."
  },
  {
    id: 12,
    nombre: "Impresion blanco y negro",
    categoria: "Impresion",
    precio: 500,
    imagen: "assets/impresion.svg",
    descripcion: "Servicio de impresión por página en tamaño carta."
  }
];

const invoice = [];

const catalogGrid = document.querySelector("#catalog-grid");
const searchInput = document.querySelector("#search-input");
const categoryFilter = document.querySelector("#category-filter");
const productCount = document.querySelector("#product-count");
const invoiceItems = document.querySelector("#invoice-items");
const emptyState = document.querySelector("#empty-state");
const subtotalValue = document.querySelector("#subtotal-value");
const taxValue = document.querySelector("#tax-value");
const totalValue = document.querySelector("#total-value");
const clearInvoiceButton = document.querySelector("#clear-invoice");
const printInvoiceButton = document.querySelector("#print-invoice");

const formatCurrency = (value) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0
  }).format(value);

function renderCategories() {
  const categories = [...new Set(products.map((product) => product.categoria))].sort();

  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    categoryFilter.appendChild(option);
  });
}

function getFilteredProducts() {
  const searchText = searchInput.value.trim().toLowerCase();
  const selectedCategory = categoryFilter.value;

  return products.filter((product) => {
    const matchesName = product.nombre.toLowerCase().includes(searchText);
    const matchesCategory =
      selectedCategory === "todos" || product.categoria === selectedCategory;

    return matchesName && matchesCategory;
  });
}

function renderCatalog() {
  const filteredProducts = getFilteredProducts();
  productCount.textContent = `${filteredProducts.length} producto${filteredProducts.length === 1 ? "" : "s"}`;

  if (filteredProducts.length === 0) {
    catalogGrid.innerHTML = '<p class="catalog-empty">No se encontraron productos con ese filtro.</p>';
    return;
  }

  catalogGrid.innerHTML = filteredProducts
    .map((product) => {
      return `
        <article class="product-card">
          <img class="product-card__image" src="${product.imagen}" alt="${product.nombre}">
          <div class="product-card__body">
            <div class="product-card__top">
              <h3>${product.nombre}</h3>
              <span class="category">${product.categoria}</span>
            </div>
            <p class="description">${product.descripcion}</p>
            <div class="product-card__bottom">
              <span class="price">${formatCurrency(product.precio)}</span>
              <div class="quantity-control">
                <input
                  id="qty-${product.id}"
                  type="number"
                  min="1"
                  value="1"
                  aria-label="Cantidad para ${product.nombre}"
                >
                <button class="button button--primary" type="button" data-add-id="${product.id}">
                  Agregar
                </button>
              </div>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function addProductToInvoice(productId) {
  const product = products.find((item) => item.id === productId);
  const quantityInput = document.querySelector(`#qty-${productId}`);
  const quantity = Math.max(1, Number(quantityInput.value));
  const existingLine = invoice.find((line) => line.id === productId);

  if (existingLine) {
    existingLine.cantidad += quantity;
  } else {
    invoice.push({
      id: product.id,
      nombre: product.nombre,
      categoria: product.categoria,
      precio: product.precio,
      cantidad: quantity
    });
  }

  quantityInput.value = 1;
  renderInvoice();
}

function updateQuantity(productId, quantity) {
  const line = invoice.find((item) => item.id === productId);

  if (!line) return;

  line.cantidad = Math.max(1, quantity);
  renderInvoice();
}

function removeProduct(productId) {
  const index = invoice.findIndex((item) => item.id === productId);

  if (index !== -1) {
    invoice.splice(index, 1);
    renderInvoice();
  }
}

function getInvoiceTotals() {
  const subtotal = invoice.reduce((total, line) => total + line.precio * line.cantidad, 0);
  const iva = subtotal * IVA;
  const total = subtotal + iva;

  return { subtotal, iva, total };
}

function renderInvoice() {
  emptyState.hidden = invoice.length > 0;
  invoiceItems.innerHTML = invoice
    .map((line) => {
      const lineTotal = line.precio * line.cantidad;

      return `
        <div class="invoice-row" role="row">
          <div class="invoice-product">
            <strong>${line.nombre}</strong>
            <span>${formatCurrency(line.precio)} unidad</span>
          </div>
          <input
            class="invoice-qty"
            type="number"
            min="1"
            value="${line.cantidad}"
            aria-label="Cantidad de ${line.nombre}"
            data-qty-id="${line.id}"
          >
          <span class="line-total">${formatCurrency(lineTotal)}</span>
          <button class="button button--danger" type="button" aria-label="Eliminar ${line.nombre}" data-remove-id="${line.id}">
            X
          </button>
        </div>
      `;
    })
    .join("");

  const totals = getInvoiceTotals();
  subtotalValue.textContent = formatCurrency(totals.subtotal);
  taxValue.textContent = formatCurrency(totals.iva);
  totalValue.textContent = formatCurrency(totals.total);
}

catalogGrid.addEventListener("click", (event) => {
  const addButton = event.target.closest("[data-add-id]");

  if (addButton) {
    addProductToInvoice(Number(addButton.dataset.addId));
  }
});

invoiceItems.addEventListener("input", (event) => {
  if (event.target.matches("[data-qty-id]")) {
    updateQuantity(Number(event.target.dataset.qtyId), Number(event.target.value));
  }
});

invoiceItems.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-remove-id]");

  if (removeButton) {
    removeProduct(Number(removeButton.dataset.removeId));
  }
});

searchInput.addEventListener("input", renderCatalog);
categoryFilter.addEventListener("change", renderCatalog);

clearInvoiceButton.addEventListener("click", () => {
  invoice.splice(0, invoice.length);
  renderInvoice();
});

printInvoiceButton.addEventListener("click", () => {
  window.print();
});

renderCategories();
renderCatalog();
renderInvoice();

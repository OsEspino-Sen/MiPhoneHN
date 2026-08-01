/* ========================================================================== 
   MI PHONE HN — LÓGICA DE APLICACIÓN
   Los productos se cargan desde Supabase en tiempo real
   ========================================================================== */

const WHATSAPP_DEFAULTS = {
  phone: "50488238432",
  title: "NUEVO PEDIDO — MI PHONE HN",
  labels: {
    cliente: "Cliente",
    dni: "DNI",
    ciudad: "Ciudad/Envío",
    productos: "Productos",
    cantidad: "Cantidad",
    subtotal: "Subtotal",
    total: "TOTAL",
    despacho: "Despacho",
    logistica: "Logística"
  },
  despachoValue: "Choluteca, Honduras",
  logisticaValue: "Rápido Cargo",
  messageTemplate: "*[TITULO]*\n\n[LABEL_CLIENTE]: [NOMBRE_CLIENTE]\n[LABEL_DNI]: [DNI_CLIENTE]\n[LABEL_CIUDAD]: [CIUDAD_CLIENTE]\n\n*[LABEL_PRODUCTOS]:*\n[LISTA_PRODUCTOS]\n\n*[LABEL_TOTAL]: [TOTAL_PEDIDO]*\n\n[LABEL_DESPACHO]: [DESPACHO]\n[LABEL_LOGISTICA]: [LOGISTICA]",
  productLineTemplate: "- [NOMBRE_PRODUCTO] ([VARIACION])\n  [LABEL_CANTIDAD]: [CANTIDAD]\n  [LABEL_SUBTOTAL]: [SUBTOTAL]"
};

let whatsappSettings = { ...WHATSAPP_DEFAULTS, labels: { ...WHATSAPP_DEFAULTS.labels } };
const FALLBACK_IMAGE = "https://fdn2.gsmarena.com/vv/pics/apple/apple-iphone-14-1.jpg";

let products = [];
let cart = getStoredCart();
let activeCategory = "all";
let activeCondition = "all";
let searchQuery = "";
let currentSelectedProduct = null;
let modalSelectedColor = "";
let modalSelectedStorage = "";
let modalActiveImageIndex = 0;
let modalActiveTab = "description";
let lastProductModalTrigger = null;

/* ========================================================================== 
   ELEMENTOS DEL DOM
   ========================================================================== */

const productsGrid = document.getElementById("products-grid");
const noResults = document.getElementById("no-results");
const searchInput = document.getElementById("search-input");
const filterTabs = document.querySelectorAll(".filter-tab");
const filterTags = document.querySelectorAll(".filter-tag");
const cartDrawer = document.getElementById("cart-drawer");
const cartToggleBtn = document.getElementById("cart-toggle");
const cartCloseBtn = document.getElementById("cart-close");
const cartDrawerOverlay = document.getElementById("cart-drawer-overlay");
const cartItemsContainer = document.getElementById("cart-items-container");
const cartSubtotalEl = document.getElementById("cart-subtotal");
const cartBadge = document.getElementById("cart-badge");
const checkoutBtn = document.getElementById("checkout-whatsapp-btn");
const productModal = document.getElementById("product-modal");
const productModalOverlay = document.getElementById("product-modal-overlay");
const productModalClose = document.getElementById("product-modal-close");
const productModalBody = document.getElementById("product-modal-body");
const calcAmount = document.getElementById("calc-amount");
const calcMonths = document.getElementById("calc-months");
const calcValue = document.getElementById("calc-value");
const calcWhatsappBtn = document.getElementById("calc-whatsapp-btn");
const themeToggle = document.getElementById("theme-toggle");
const mobileMenuToggle = document.getElementById("mobile-menu-toggle");
const navMenu = document.getElementById("nav-menu");

/* ========================================================================== 
   INICIALIZACIÓN
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  updateCartUI();
  setupEventListeners();
  calculateFinancing();
  loadProducts();
  loadSiteSettings();
});

/* ========================================================================== 
   CARGAR PRODUCTOS
   ========================================================================== */

async function loadProducts() {
  showCatalogLoading();

  try {
    const { db, collection, onSnapshot, getDocs } = await import("./supabase-config.js");
    const productsRef = collection(db, "productos");

    onSnapshot(productsRef, (snapshot) => {
      products = snapshot.docs.map((docSnap) => normalizeProductRecord({
        id: docSnap.id,
        ...docSnap.data()
      }));
      renderProducts();
    }, async (error) => {
      console.warn("⚠️ Streaming en tiempo real bloqueado, intentando lectura única getDocs:", error);
      try {
        const snapshot = await getDocs(productsRef);
        products = snapshot.docs.map((docSnap) => normalizeProductRecord({
          id: docSnap.id,
          ...docSnap.data()
        }));
        renderProducts();
      } catch (getErr) {
        console.error("Error al obtener catálogo desde Supabase:", getErr);
        showCatalogError();
      }
    });
  } catch (error) {
    console.error("No se pudo conectar a Supabase:", error);
    showCatalogError();
  }
}

function showCatalogLoading() {
  if (!productsGrid) return;

  productsGrid.innerHTML = `
    <div class="catalog-status" role="status">
      <p>Cargando productos...</p>
    </div>
  `;
}

function showCatalogError() {
  if (!productsGrid) return;

  productsGrid.innerHTML = `
    <div class="catalog-status catalog-status-error" role="alert">
      <h3>No se pudo cargar el catálogo</h3>
      <p>Verifica tu conexión a internet y la configuración de Supabase.</p>
      <button type="button" class="btn btn-secondary" id="retry-catalog-btn">Reintentar</button>
    </div>
  `;

  document.getElementById("retry-catalog-btn")?.addEventListener("click", loadProducts);
}

/* ========================================================================== 
   EVENTOS
   ========================================================================== */

function setupEventListeners() {
  searchInput?.addEventListener("input", (event) => {
    searchQuery = event.target.value.toLowerCase().trim();
    renderProducts();
  });

  filterTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      filterTabs.forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      activeCategory = tab.dataset.category || "all";
      renderProducts();
    });
  });

  filterTags.forEach((tag) => {
    tag.addEventListener("click", () => {
      filterTags.forEach((item) => item.classList.remove("active"));
      tag.classList.add("active");
      activeCondition = tag.dataset.condition || "all";
      renderProducts();
    });
  });

  cartToggleBtn?.addEventListener("click", openCart);
  cartCloseBtn?.addEventListener("click", closeCart);
  cartDrawerOverlay?.addEventListener("click", closeCart);
  checkoutBtn?.addEventListener("click", checkoutCartWhatsApp);

  productModalClose?.addEventListener("click", closeProductModal);
  productModalOverlay?.addEventListener("click", closeProductModal);

  calcAmount?.addEventListener("input", calculateFinancing);
  calcMonths?.addEventListener("change", calculateFinancing);
  themeToggle?.addEventListener("click", toggleTheme);

  mobileMenuToggle?.addEventListener("click", () => {
    const isOpen = navMenu?.classList.toggle("active");
    mobileMenuToggle.setAttribute("aria-expanded", String(Boolean(isOpen)));
  });

  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", () => {
      navMenu?.classList.remove("active");
      mobileMenuToggle?.setAttribute("aria-expanded", "false");
    });
  });

  bindFaqAccordion();

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeProductModal();
    closeCart();
  });

  setupCheckoutValidationListeners();
}

function bindFaqAccordion() {
  document.querySelectorAll(".faq-question").forEach((button) => {
    button.addEventListener("click", () => {
      const item = button.parentElement;
      if (!item) return;

      const willOpen = !item.classList.contains("active");

      document.querySelectorAll(".faq-item").forEach((faqItem) => {
        faqItem.classList.remove("active");
        faqItem.querySelector(".faq-question")?.setAttribute("aria-expanded", "false");
      });

      if (willOpen) {
        item.classList.add("active");
        button.setAttribute("aria-expanded", "true");
      }
    });
  });
}

/* ========================================================================== 
   CATÁLOGO
   ========================================================================== */

function renderProducts() {
  if (!productsGrid) return;

  const filteredProducts = products.filter((product) => {
    const title = String(product.title || "").toLowerCase();
    const brand = String(product.brand || "").toLowerCase();
    const category = String(product.category || "").toLowerCase();
    const condition = String(product.condition || "").toLowerCase();

    const matchesSearch = title.includes(searchQuery) || brand.includes(searchQuery);
    const matchesCategory = activeCategory === "all" || category === activeCategory;
    const matchesCondition = activeCondition === "all" || condition === activeCondition;

    return matchesSearch && matchesCategory && matchesCondition;
  });

  productsGrid.innerHTML = "";

  if (filteredProducts.length === 0) {
    if (noResults) noResults.style.display = "block";
    return;
  }

  if (noResults) noResults.style.display = "none";

  filteredProducts.forEach((product) => {
    const card = document.createElement("article");
    card.className = "product-card";

    const productId = String(product.id);
    const condition = String(product.condition || "").toLowerCase();
    const badgeClass = condition === "nuevo" ? "tag-nuevo" : "tag-seminuevo";
    const storageOptions = getStorageOptions(product);
    const baseStorageOption = storageOptions[0];
    const hasStoragePrices = storageOptions.length > 1;
    const availability = getProductAvailability(product);
    const productImage = getProductImages(product)[0] || FALLBACK_IMAGE;
    const oldPriceHTML = baseStorageOption.oldPrice
      ? `<span class="price-old">${formatCurrency(baseStorageOption.oldPrice)}</span>`
      : "";
    const priceLabel = `${hasStoragePrices ? "Desde " : ""}${formatCurrency(baseStorageOption.price)}`;

    card.innerHTML = `
      <span class="product-tag-badge ${badgeClass}">${escapeHTML(product.badge || product.condition || "Disponible")}</span>
      <button type="button" class="product-image-container" data-open-product="${escapeHTML(productId)}" aria-label="Ver detalles de ${escapeHTML(product.title)}">
        <img src="${escapeHTML(productImage)}" alt="${escapeHTML(product.title)}" loading="lazy">
      </button>
      <div class="product-info">
        <div class="product-card-meta">
          <span class="product-brand">${escapeHTML(product.brand || "")}</span>
          <span class="card-stock-status ${availability.className}"><i></i>${availability.label}</span>
        </div>
        <button type="button" class="product-title product-title-btn" data-open-product="${escapeHTML(productId)}">
          ${escapeHTML(product.title || "Producto")}
        </button>
        <p class="product-condition">${condition === "nuevo" ? "Equipo nuevo de fábrica" : "Seminuevo Grado A+"}</p>
        <div class="product-price-row">
          <span class="price-current">${priceLabel}</span>
          ${oldPriceHTML}
        </div>
        <button type="button" class="btn btn-primary" data-add-product="${escapeHTML(productId)}" ${availability.isOut ? "disabled" : ""}>
          ${availability.isOut ? "Agotado" : "Agregar al carrito"}
        </button>
      </div>
    `;

    card.querySelector("img")?.addEventListener("error", setFallbackImage);
    card.querySelectorAll("[data-open-product]").forEach((button) => {
      button.addEventListener("click", () => {
        lastProductModalTrigger = button;
        openProductModal(button.dataset.openProduct);
      });
    });
    card.querySelector("[data-add-product]")?.addEventListener("click", (event) => {
      quickAddToCart(event.currentTarget.dataset.addProduct);
    });

    productsGrid.appendChild(card);
  });
}

/* ========================================================================== 
   MODAL DE PRODUCTO
   ========================================================================== */

function openProductModal(productId) {
  if (!productModal || !productModalBody) return;
  const product = products.find((item) => String(item.id) === String(productId));
  if (!product) return;

  currentSelectedProduct = product;
  modalSelectedColor = product.variants?.colors?.[0]?.name || "Color estándar";

  const storageOptions = getStorageOptions(product);
  const firstAvailableOption = storageOptions.find((option) => !getStockInfo(product, option.name).isOut);
  modalSelectedStorage = (firstAvailableOption || storageOptions[0]).name;
  modalActiveImageIndex = 0;
  modalActiveTab = "description";

  renderModalContent();
  productModal?.classList.add("active");
  productModal?.setAttribute("aria-hidden", "false");
  document.body.classList.add("product-modal-open");
  document.body.style.overflow = "hidden";

  const modalContent = productModal?.querySelector(".product-modal-content");
  modalContent?.scrollTo({ top: 0, behavior: "auto" });
  requestAnimationFrame(() => productModalClose?.focus());
}

function closeProductModal() {
  if (!productModal?.classList.contains("active")) return;

  productModal.classList.remove("active");
  productModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("product-modal-open");
  document.body.style.overflow = "";

  window.setTimeout(() => {
    if (!productModal.classList.contains("active")) {
      lastProductModalTrigger?.focus?.();
    }
  }, 280);
}

function renderModalContent() {
  if (!productModalBody || !currentSelectedProduct) return;

  const product = currentSelectedProduct;
  const colors = product.variants?.colors?.length
    ? product.variants.colors
    : [{ name: "Color estándar", value: "#cccccc" }];
  const storage = getStorageOptions(product);
  const selectedStorageOption = getStorageOption(product, modalSelectedStorage);
  const selectedStock = getStockInfo(product, selectedStorageOption.name);
  const galleryImages = getProductImages(product, modalSelectedColor);
  modalActiveImageIndex = Math.min(Math.max(0, modalActiveImageIndex), galleryImages.length - 1);

  const colorsHTML = colors
    .map((color) => {
      const active = color.name === modalSelectedColor ? "active" : "";
      return `
        <button type="button" class="color-dot-btn ${active}" data-color="${escapeHTML(color.name)}" aria-pressed="${active ? "true" : "false"}">
          <span class="color-swatch" style="--swatch:${getSafeColor(color.value)};"></span>
          <span class="color-choice-name">${escapeHTML(color.name)}</span>
          <span class="color-choice-check" aria-hidden="true">✓</span>
        </button>
      `;
    })
    .join("");

  const storageHTML = storage
    .map((item) => {
      const active = item.name === modalSelectedStorage ? "active" : "";
      const itemStock = getStockInfo(product, item.name);
      return `
        <button type="button" class="variant-btn ${active}" data-storage="${escapeHTML(item.name)}" aria-pressed="${active ? "true" : "false"}" ${itemStock.isOut ? "disabled" : ""}>
          <span class="variant-name">${escapeHTML(item.name)}</span>
          <span class="variant-price">${formatCurrency(item.price)}</span>
          <small class="variant-stock ${itemStock.className}">${itemStock.label}</small>
        </button>
      `;
    })
    .join("");

  const specsHTML = buildSpecsTable(product.specs);
  const includesHTML = buildIncludesList(product.includes);
  const relatedHTML = buildRelatedProductsHTML(product);
  const oldPriceHTML = selectedStorageOption.oldPrice
    ? `<span class="modal-price-old">${formatCurrency(selectedStorageOption.oldPrice)}</span>`
    : "";
  const battery = getBatteryPresentation(product.batteryHealth);
  const batteryHTML = battery
    ? `
      <div class="product-health-card battery-health-card ${battery.className}">
        <span class="health-card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="16" height="12" rx="3"></rect><path d="M21 10v4"></path><path d="M7 10h5v4H7z"></path></svg>
        </span>
        <span class="health-card-copy"><small>Salud de batería</small><strong>${battery.value}%</strong></span>
        <span class="battery-meter" aria-label="Salud de batería ${battery.value} por ciento"><i style="width:${battery.value}%"></i></span>
      </div>
    `
    : "";

  const galleryControls = galleryImages.length > 1
    ? `
      <button type="button" class="gallery-nav gallery-nav-prev" data-gallery-prev aria-label="Imagen anterior">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"></path></svg>
      </button>
      <button type="button" class="gallery-nav gallery-nav-next" data-gallery-next aria-label="Imagen siguiente">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"></path></svg>
      </button>
    `
    : "";

  const galleryDots = galleryImages.length > 1
    ? `<div class="gallery-dots" aria-label="Seleccionar imagen">${galleryImages.map((_, index) => `
        <button type="button" class="gallery-dot ${index === modalActiveImageIndex ? "active" : ""}" data-gallery-index="${index}" aria-label="Ver imagen ${index + 1}" aria-current="${index === modalActiveImageIndex ? "true" : "false"}"></button>
      `).join("")}</div>`
    : "";

  const galleryThumbs = galleryImages.length > 1
    ? `<div class="gallery-thumbnails" aria-label="Miniaturas del producto">${galleryImages.map((image, index) => `
        <button type="button" class="gallery-thumbnail ${index === modalActiveImageIndex ? "active" : ""}" data-gallery-index="${index}" aria-label="Ver imagen ${index + 1}">
          <img src="${escapeHTML(image)}" alt="Vista ${index + 1} de ${escapeHTML(product.title)}" loading="lazy">
        </button>
      `).join("")}</div>`
    : "";

  productModalBody.innerHTML = `
    <div class="modal-product-shell">
      <div class="modal-grid">
        <section class="modal-gallery" aria-label="Galería de ${escapeHTML(product.title)}">
          <div class="modal-gallery-stage" tabindex="0">
            <div class="gallery-ambient" aria-hidden="true"></div>
            <span class="gallery-count">${modalActiveImageIndex + 1} / ${galleryImages.length}</span>
            ${galleryControls}
            <img id="modal-gallery-main" src="${escapeHTML(galleryImages[modalActiveImageIndex] || FALLBACK_IMAGE)}" alt="${escapeHTML(product.title)} — imagen ${modalActiveImageIndex + 1}">
            ${galleryDots}
          </div>
          ${galleryThumbs}
        </section>

        <section class="modal-details">
          <div class="modal-product-kicker">
            <span class="modal-condition-badge ${String(product.condition).toLowerCase() === "nuevo" ? "is-new" : "is-used"}">${escapeHTML(product.badge || product.condition || "Disponible")}</span>
          </div>
          <span class="product-brand">${escapeHTML(product.brand || "")}</span>
          <h1 class="modal-title">${escapeHTML(product.title || "Producto")}</h1>
          <p class="modal-lead">${escapeHTML(product.description || "Tecnología seleccionada y respaldada por Mi Phone HN.")}</p>

          <div class="modal-price-row">
            <div class="modal-price-main">
              <span class="modal-price">${formatCurrency(selectedStorageOption.price)}</span>
              ${oldPriceHTML}
            </div>
            <span class="price-tax-note">Precio final en HNL</span>
          </div>

          <div class="product-health-grid ${batteryHTML ? "" : "single"}">
            <div class="product-health-card stock-health-card ${selectedStock.className}">
              <span class="health-card-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 8 12 3 3 8l9 5 9-5Z"></path><path d="m3 12 9 5 9-5"></path><path d="m3 16 9 5 9-5"></path></svg>
              </span>
              <span class="health-card-copy"><small>Disponibilidad</small><strong>${selectedStock.label}</strong></span>
              <span class="stock-signal" aria-hidden="true"></span>
            </div>
            ${batteryHTML}
          </div>

          <div class="option-group">
            <div class="option-heading">
              <span class="option-label">Color</span>
              <strong id="modal-color-name">${escapeHTML(modalSelectedColor)}</strong>
            </div>
            <div class="option-selectors color-selectors" id="modal-colors-container">${colorsHTML}</div>
          </div>

          <div class="option-group">
            <div class="option-heading">
              <span class="option-label">Capacidad</span>
              <span class="option-helper">Selecciona una opción</span>
            </div>
            <div class="option-selectors storage-selectors" id="modal-storage-container">${storageHTML}</div>
          </div>

          <div class="modal-actions">
            <button type="button" class="btn btn-primary btn-block modal-cart-button" id="modal-add-cart-btn" ${selectedStock.isOut ? "disabled" : ""}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="20" r="1"></circle><circle cx="19" cy="20" r="1"></circle><path d="M3 4h2l2.4 10.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 8H6"></path></svg>
              <span>${selectedStock.isOut ? "Producto agotado" : "Agregar al carrito"}</span>
            </button>
          </div>

          <div class="modal-trust-summary">
            <div class="trust-summary-item"><span class="trust-icon-mini">✓</span><span><strong>Garantía escrita</strong><small>90 días de respaldo</small></span></div>
            <div class="trust-summary-item"><span class="trust-icon-mini">↗</span><span><strong>Envíos nacionales</strong><small>Rápido Cargo desde Choluteca</small></span></div>
            <div class="trust-summary-item"><span class="trust-icon-mini">◇</span><span><strong>Compra segura</strong><small>Equipo revisado antes del envío</small></span></div>
          </div>
        </section>
      </div>

      <section class="modal-tabs" aria-label="Información del producto">
        <div class="modal-tab-list" role="tablist" aria-label="Detalle del producto">
          <button type="button" class="modal-tab-btn ${modalActiveTab === "description" ? "active" : ""}" role="tab" data-modal-tab="description" aria-selected="${modalActiveTab === "description"}">Descripción</button>
          <button type="button" class="modal-tab-btn ${modalActiveTab === "specifications" ? "active" : ""}" role="tab" data-modal-tab="specifications" aria-selected="${modalActiveTab === "specifications"}">Especificaciones</button>
          <button type="button" class="modal-tab-btn ${modalActiveTab === "includes" ? "active" : ""}" role="tab" data-modal-tab="includes" aria-selected="${modalActiveTab === "includes"}">Incluye</button>
        </div>
        <div class="modal-tab-panels">
          <div class="modal-tab-panel ${modalActiveTab === "description" ? "active" : ""}" role="tabpanel" data-modal-panel="description" ${modalActiveTab === "description" ? "" : "hidden"}>
            <span class="tab-content-eyebrow">Acerca de este equipo</span>
            <h3>Diseñado para acompañar tu día</h3>
            <p>${escapeHTML(product.description || "Producto disponible en Mi Phone HN.")}</p>
          </div>
          <div class="modal-tab-panel ${modalActiveTab === "specifications" ? "active" : ""}" role="tabpanel" data-modal-panel="specifications" ${modalActiveTab === "specifications" ? "" : "hidden"}>
            <span class="tab-content-eyebrow">Ficha técnica</span>
            <h3>Especificaciones del producto</h3>
            ${specsHTML}
          </div>
          <div class="modal-tab-panel ${modalActiveTab === "includes" ? "active" : ""}" role="tabpanel" data-modal-panel="includes" ${modalActiveTab === "includes" ? "" : "hidden"}>
            <span class="tab-content-eyebrow">Listo para entregar</span>
            <h3>¿Qué incluye tu paquete?</h3>
            ${includesHTML}
          </div>
        </div>
      </section>

      ${relatedHTML}
    </div>
  `;

  productModalBody.querySelectorAll(".modal-gallery img, .related-product-image img").forEach((image) => {
    image.addEventListener("error", setFallbackImage);
  });

  productModalBody.querySelector("[data-gallery-prev]")?.addEventListener("click", () => {
    setModalGalleryImage(modalActiveImageIndex - 1);
  });
  productModalBody.querySelector("[data-gallery-next]")?.addEventListener("click", () => {
    setModalGalleryImage(modalActiveImageIndex + 1);
  });
  productModalBody.querySelectorAll("[data-gallery-index]").forEach((button) => {
    button.addEventListener("click", () => setModalGalleryImage(Number(button.dataset.galleryIndex)));
  });
  const galleryStage = productModalBody.querySelector(".modal-gallery-stage");
  galleryStage?.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") setModalGalleryImage(modalActiveImageIndex - 1);
    if (event.key === "ArrowRight") setModalGalleryImage(modalActiveImageIndex + 1);
  });

  let galleryTouchStartX = null;
  galleryStage?.addEventListener("touchstart", (event) => {
    galleryTouchStartX = event.changedTouches[0]?.clientX ?? null;
  }, { passive: true });
  galleryStage?.addEventListener("touchend", (event) => {
    if (galleryTouchStartX === null) return;
    const deltaX = (event.changedTouches[0]?.clientX ?? galleryTouchStartX) - galleryTouchStartX;
    galleryTouchStartX = null;
    if (Math.abs(deltaX) < 45) return;
    setModalGalleryImage(modalActiveImageIndex + (deltaX < 0 ? 1 : -1));
  }, { passive: true });

  productModalBody.querySelectorAll(".color-dot-btn").forEach((button) => {
    button.addEventListener("click", () => {
      modalSelectedColor = button.dataset.color || "Color estándar";
      modalActiveImageIndex = 0;
      renderModalContent();
    });
  });

  productModalBody.querySelectorAll(".variant-btn").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      modalSelectedStorage = button.dataset.storage || "Estándar";
      renderModalContent();
    });
  });

  productModalBody.querySelectorAll("[data-modal-tab]").forEach((button) => {
    button.addEventListener("click", () => activateModalTab(button.dataset.modalTab));
  });

  productModalBody.querySelectorAll("[data-related-product]").forEach((button) => {
    button.addEventListener("click", () => openProductModal(button.dataset.relatedProduct));
  });

  document.getElementById("modal-add-cart-btn")?.addEventListener("click", addModalProductToCart);
}

function setModalGalleryImage(nextIndex) {
  if (!currentSelectedProduct || !productModalBody) return;
  const images = getProductImages(currentSelectedProduct, modalSelectedColor);
  if (images.length === 0) return;

  modalActiveImageIndex = (nextIndex + images.length) % images.length;
  const mainImage = productModalBody.querySelector("#modal-gallery-main");
  if (mainImage) {
    mainImage.classList.add("is-changing");
    window.setTimeout(() => {
      delete mainImage.dataset.fallbackApplied;
      mainImage.src = images[modalActiveImageIndex];
      mainImage.alt = `${currentSelectedProduct.title || "Producto"} — imagen ${modalActiveImageIndex + 1}`;
      mainImage.classList.remove("is-changing");
    }, 110);
  }

  const count = productModalBody.querySelector(".gallery-count");
  if (count) count.textContent = `${modalActiveImageIndex + 1} / ${images.length}`;

  productModalBody.querySelectorAll("[data-gallery-index]").forEach((button) => {
    const isActive = Number(button.dataset.galleryIndex) === modalActiveImageIndex;
    button.classList.toggle("active", isActive);
    if (button.classList.contains("gallery-dot")) {
      button.setAttribute("aria-current", String(isActive));
    }
  });
}

function activateModalTab(tabName) {
  if (!productModalBody) return;
  modalActiveTab = ["description", "specifications", "includes"].includes(tabName) ? tabName : "description";

  productModalBody.querySelectorAll("[data-modal-tab]").forEach((button) => {
    const isActive = button.dataset.modalTab === modalActiveTab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  productModalBody.querySelectorAll("[data-modal-panel]").forEach((panel) => {
    const isActive = panel.dataset.modalPanel === modalActiveTab;
    panel.classList.toggle("active", isActive);
    panel.hidden = !isActive;
  });
}


/* ========================================================================== 
   CARRITO
   ========================================================================== */

function openCart() {
  cartDrawer?.classList.add("active");
}

function closeCart() {
  cartDrawer?.classList.remove("active");
}

function quickAddToCart(productId) {
  const product = products.find((item) => String(item.id) === String(productId));
  if (!product) return;

  const color = product.variants?.colors?.[0]?.name || "Color estándar";
  const storageOption = getStorageOptions(product).find((option) => !getStockInfo(product, option.name).isOut);
  if (!storageOption) {
    alert("Este producto está agotado por el momento.");
    return;
  }
  addToCart(product, color, storageOption.name);
}

function addModalProductToCart() {
  if (!currentSelectedProduct) return;

  const added = addToCart(currentSelectedProduct, modalSelectedColor, modalSelectedStorage);
  if (added) closeProductModal();
}

function addToCart(product, color, storage) {
  const selectedStorageOption = getStorageOption(product, storage);
  const stockInfo = getStockInfo(product, selectedStorageOption.name);
  const cartItemId = `${product.id}-${color}-${selectedStorageOption.name}`;
  const existingItem = cart.find((item) => item.cartItemId === cartItemId);
  const nextQuantity = Number(existingItem?.quantity || 0) + 1;

  if (stockInfo.isOut) {
    alert("Esta variante está agotada.");
    return false;
  }

  if (stockInfo.quantity !== null && nextQuantity > stockInfo.quantity) {
    alert(`Solo hay ${stockInfo.quantity} unidad(es) disponibles para esta variante.`);
    return false;
  }

  if (existingItem) {
    existingItem.quantity = nextQuantity;
  } else {
    cart.push({
      cartItemId,
      id: String(product.id),
      title: product.title,
      brand: product.brand,
      price: selectedStorageOption.price,
      oldPrice: selectedStorageOption.oldPrice,
      image: getProductImages(product, color)[0] || FALLBACK_IMAGE,
      color,
      storage: selectedStorageOption.name,
      quantity: 1
    });
  }

  saveCart();
  updateCartUI();
  openCart();
  return true;
}

function changeCartQty(cartItemId, delta) {
  const item = cart.find((product) => product.cartItemId === cartItemId);
  if (!item) return;

  if (delta > 0) {
    const sourceProduct = products.find((product) => String(product.id) === String(item.id));
    if (sourceProduct) {
      const stockInfo = getStockInfo(sourceProduct, item.storage);
      if (stockInfo.quantity !== null && Number(item.quantity) >= stockInfo.quantity) {
        alert(`Solo hay ${stockInfo.quantity} unidad(es) disponibles.`);
        return;
      }
    }
  }

  item.quantity += delta;

  if (item.quantity <= 0) {
    cart = cart.filter((product) => product.cartItemId !== cartItemId);
  }

  saveCart();
  updateCartUI();
}

function removeFromCart(cartItemId) {
  cart = cart.filter((product) => product.cartItemId !== cartItemId);
  saveCart();
  updateCartUI();
}

function saveCart() {
  localStorage.setItem("cart", JSON.stringify(cart));
}

function updateCartUI() {
  if (!cartItemsContainer || !cartSubtotalEl || !cartBadge) return;

  const totalItems = cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const checkoutForm = document.getElementById("cart-checkout-form");

  cartBadge.textContent = String(totalItems);
  cartBadge.classList.toggle("is-empty", totalItems === 0);
  cartItemsContainer.innerHTML = "";

  if (cart.length === 0) {
    cartItemsContainer.innerHTML = `
      <div class="cart-empty">
        <p>Tu carrito está vacío.</p>
        <p class="cart-empty-hint">Añade productos para empezar.</p>
      </div>
    `;
    cartSubtotalEl.textContent = formatCurrency(0);
    if (checkoutForm) checkoutForm.style.display = "none";
    if (checkoutBtn) checkoutBtn.style.display = "none";
    return;
  }

  let subtotal = 0;

  cart.forEach((item) => {
    const itemTotal = Number(item.price || 0) * Number(item.quantity || 0);
    subtotal += itemTotal;

    const itemElement = document.createElement("article");
    itemElement.className = "cart-item";
    itemElement.innerHTML = `
      <div class="cart-item-img">
        <img src="${escapeHTML(item.image || FALLBACK_IMAGE)}" alt="${escapeHTML(item.title)}">
      </div>
      <div class="cart-item-details">
        <h4>${escapeHTML(item.title)}</h4>
        <p class="cart-item-meta">${escapeHTML(item.color)} | ${escapeHTML(item.storage)}</p>
        <div class="cart-item-qty" aria-label="Cantidad de ${escapeHTML(item.title)}">
          <button type="button" class="qty-btn" data-action="decrease" aria-label="Reducir cantidad">−</button>
          <span class="qty-val">${Number(item.quantity)}</span>
          <button type="button" class="qty-btn" data-action="increase" aria-label="Aumentar cantidad">+</button>
        </div>
      </div>
      <div class="cart-item-price-remove">
        <span class="cart-item-price">${formatCurrency(itemTotal)}</span>
        <button type="button" class="cart-item-remove">Eliminar</button>
      </div>
    `;

    itemElement.querySelector("img")?.addEventListener("error", setFallbackImage);
    itemElement.querySelector('[data-action="decrease"]')?.addEventListener("click", () => changeCartQty(item.cartItemId, -1));
    itemElement.querySelector('[data-action="increase"]')?.addEventListener("click", () => changeCartQty(item.cartItemId, 1));
    itemElement.querySelector(".cart-item-remove")?.addEventListener("click", () => removeFromCart(item.cartItemId));

    cartItemsContainer.appendChild(itemElement);
  });

  cartSubtotalEl.textContent = formatCurrency(subtotal);
  if (checkoutForm) checkoutForm.style.display = "block";
  if (checkoutBtn) checkoutBtn.style.display = "flex";
}

/* ========================================================================== 
   CHECKOUT POR WHATSAPP
   ========================================================================== */

const CHECKOUT_FIELDS = [
  { id: "client-name", groupId: "group-client-name" },
  { id: "client-dni", groupId: "group-client-dni" },
  { id: "client-location", groupId: "group-client-location" }
];

function setFieldError(field) {
  const input = document.getElementById(field.id);
  const group = document.getElementById(field.groupId);
  if (input) input.setAttribute("aria-invalid", "true");
  if (group) group.classList.add("is-invalid");
}

function clearFieldError(field) {
  const input = document.getElementById(field.id);
  const group = document.getElementById(field.groupId);
  if (input) input.removeAttribute("aria-invalid");
  if (group) group.classList.remove("is-invalid");
}

function showCheckoutError() {
  const error = document.getElementById("checkout-form-error");
  if (error) error.hidden = false;
}

function hideCheckoutError() {
  const error = document.getElementById("checkout-form-error");
  if (error) error.hidden = true;
}

function validateCheckoutForm() {
  let isValid = true;
  let firstInvalid = null;

  CHECKOUT_FIELDS.forEach((field) => {
    const input = document.getElementById(field.id);
    const value = input?.value.trim() || "";

    if (value) {
      clearFieldError(field);
    } else {
      setFieldError(field);
      isValid = false;
      firstInvalid = firstInvalid || input;
    }
  });

  if (isValid) {
    hideCheckoutError();
  } else {
    showCheckoutError();
    if (firstInvalid) firstInvalid.focus();
  }
  return isValid;
}

function setupCheckoutValidationListeners() {
  CHECKOUT_FIELDS.forEach((field) => {
    const input = document.getElementById(field.id);
    if (!input) return;
    input.addEventListener("input", () => {
      clearFieldError(field);
      hideCheckoutError();
    });
    input.addEventListener("blur", () => {
      if (!(input.value.trim())) setFieldError(field);
    });
  });
}

function checkoutCartWhatsApp() {
  if (cart.length === 0) return;

  const invalidStockItem = cart.find((item) => {
    const product = products.find((candidate) => String(candidate.id) === String(item.id));
    if (!product) return false;
    const stockInfo = getStockInfo(product, item.storage);
    return stockInfo.isOut || (stockInfo.quantity !== null && Number(item.quantity) > stockInfo.quantity);
  });

  if (invalidStockItem) {
    alert(`Actualiza la cantidad de ${invalidStockItem.title}; el stock disponible cambió.`);
    return;
  }

  if (!validateCheckoutForm()) return;

  const nameInput = document.getElementById("client-name");
  const dniInput = document.getElementById("client-dni");
  const locationInput = document.getElementById("client-location");

  const name = nameInput?.value.trim() || "";
  const dni = dniInput?.value.trim() || "";
  const location = locationInput?.value.trim() || "";

  const ws = whatsappSettings;
  const labels = ws.labels || {};
  let subtotal = 0;
  const lines = cart.map((item) => {
    const itemTotal = Number(item.price || 0) * Number(item.quantity || 0);
    subtotal += itemTotal;
    return fillTemplate(ws.productLineTemplate, {
      NOMBRE_PRODUCTO: item.title,
      VARIACION: `${item.storage} | ${item.color}`,
      LABEL_CANTIDAD: labels.cantidad,
      CANTIDAD: item.quantity,
      LABEL_SUBTOTAL: labels.subtotal,
      SUBTOTAL: formatCurrency(itemTotal)
    });
  }).join("\n");

  const message = fillTemplate(ws.messageTemplate, {
    TITULO: ws.title,
    LABEL_CLIENTE: labels.cliente,
    NOMBRE_CLIENTE: name,
    LABEL_DNI: labels.dni,
    DNI_CLIENTE: dni,
    LABEL_CIUDAD: labels.ciudad,
    CIUDAD_CLIENTE: location,
    LABEL_PRODUCTOS: labels.productos,
    LISTA_PRODUCTOS: lines,
    LABEL_TOTAL: labels.total,
    TOTAL_PEDIDO: formatCurrency(subtotal),
    LABEL_DESPACHO: labels.despacho,
    DESPACHO: ws.despachoValue,
    LABEL_LOGISTICA: labels.logistica,
    LOGISTICA: ws.logisticaValue
  });

  window.open(`https://wa.me/${ws.phone}?text=${encodeURIComponent(message)}`, "_blank", "noopener");
}

function fillTemplate(template, values) {
  let output = String(template || "");
  Object.entries(values).forEach(([key, value]) => {
    output = output.split(`[${key}]`).join(String(value ?? ""));
  });
  return output;
}

/* ========================================================================== 
   CALCULADORA DE EXTRAFINANCIAMIENTO
   ========================================================================== */

function calculateFinancing() {
  if (!calcAmount || !calcMonths || !calcValue || !calcWhatsappBtn) return;

  const amount = Math.max(0, Number.parseFloat(calcAmount.value) || 0);
  const months = Number.parseInt(calcMonths.value, 10) || 6;

  if (amount <= 0) {
    calcValue.textContent = "L. 0 / mes";
    calcWhatsappBtn.href = `https://wa.me/${whatsappSettings.phone}`;
    return;
  }

  const monthlyPayment = Math.round(amount / months);
  calcValue.textContent = `${formatCurrency(monthlyPayment)} / mes`;

  const message = [
    "Hola Mi Phone HN, me gustaría consultar por Extrafinanciamiento:",
    `Monto: ${formatCurrency(amount)}`,
    `Plazo: ${months} meses sin intereses.`,
    "",
    "¿Cuáles son los requisitos con BAC o Ficohsa?"
  ].join("\n");

  calcWhatsappBtn.href = `https://wa.me/${whatsappSettings.phone}?text=${encodeURIComponent(message)}`;
}

/* ========================================================================== 
   TEMA OSCURO / CLARO
   ========================================================================== */

function initTheme() {
  const savedTheme = localStorage.getItem("theme");
  const theme = savedTheme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", theme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute("data-theme");
  const nextTheme = currentTheme === "light" ? "dark" : "light";

  document.documentElement.setAttribute("data-theme", nextTheme);
  localStorage.setItem("theme", nextTheme);
}

/* ========================================================================== 
   UTILIDADES
   ========================================================================== */

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
}

function getSafeColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : "#cccccc";
}

function normalizeProductRecord(product) {
  const images = getProductImages(product);
  return {
    ...product,
    images,
    // Alias en memoria para cualquier componente legado que todavía use image.
    image: images[0] || product.image || FALLBACK_IMAGE,
    batteryHealth: normalizeBatteryHealth(product.batteryHealth),
    stock: normalizeNullableStock(product.stock)
  };
}

function getProductImages(product, colorName = "") {
  const selectedColor = colorName
    ? product?.variants?.colors?.find((color) => String(color.name) === String(colorName))
    : null;
  const colorImages = Array.isArray(selectedColor?.images)
    ? selectedColor.images
    : selectedColor?.image
      ? [selectedColor.image]
      : [];
  const productImages = Array.isArray(product?.images) ? product.images : [];
  const legacyImage = product?.image ? [product.image] : [];
  const normalizedImages = uniqueStrings(colorImages.length ? colorImages : (productImages.length ? productImages : legacyImage));
  return normalizedImages.length ? normalizedImages : [FALLBACK_IMAGE];
}

function normalizeBatteryHealth(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(100, Math.max(0, Math.round(number)));
}

function normalizeNullableStock(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.floor(number));
}

function getStockInfo(product, storageName = "") {
  const option = getStorageOptions(product).find((item) => item.name === storageName);
  const quantity = normalizeNullableStock(option?.stock) ?? normalizeNullableStock(product?.stock);

  // Los productos anteriores sin campo stock conservan su comportamiento:
  // siguen disponibles hasta que el administrador defina una cantidad.
  if (quantity === null) {
    return { quantity: null, label: "Disponible", className: "stock-available", isOut: false, isLow: false };
  }
  if (quantity <= 0) {
    return { quantity: 0, label: "Agotado", className: "stock-out", isOut: true, isLow: false };
  }
  if (quantity <= 3) {
    return { quantity, label: "Pocas unidades", className: "stock-low", isOut: false, isLow: true };
  }
  return { quantity, label: "Disponible", className: "stock-available", isOut: false, isLow: false };
}

function getProductAvailability(product) {
  const states = getStorageOptions(product).map((option) => getStockInfo(product, option.name));
  const purchasable = states.filter((state) => !state.isOut);
  if (purchasable.length === 0) return states[0] || getStockInfo(product);
  return purchasable.find((state) => !state.isLow) || purchasable[0];
}

function getBatteryPresentation(value) {
  const batteryHealth = normalizeBatteryHealth(value);
  if (batteryHealth === null) return null;
  if (batteryHealth >= 90) return { value: batteryHealth, className: "battery-excellent" };
  if (batteryHealth >= 80) return { value: batteryHealth, className: "battery-good" };
  return { value: batteryHealth, className: "battery-attention" };
}

function normalizeSpecification(spec, index) {
  if (spec && typeof spec === "object") {
    return {
      label: String(spec.label || spec.name || spec.key || `Detalle ${index + 1}`),
      value: String(spec.value || spec.description || spec.detail || "—")
    };
  }

  const text = String(spec || "").trim();
  const separated = text.match(/^([^:|–—]+?)\s*(?::|\||–|—|\s-\s)\s*(.+)$/);
  if (separated) return { label: separated[1].trim(), value: separated[2].trim() };

  const knownLabel = text.match(/^(Pantalla|Procesador|Chip|RAM|Almacenamiento|Cámara|Batería|Sistema|Conectividad|Carga|Resistencia|Seguridad|Audio|Puerto|Material)\b\s*(.*)$/i);
  if (knownLabel) {
    return {
      label: knownLabel[1],
      value: knownLabel[2].trim() || "Incluido"
    };
  }

  return { label: `Característica ${index + 1}`, value: text || "—" };
}

function buildSpecsTable(specs) {
  const normalized = (Array.isArray(specs) ? specs : [])
    .map(normalizeSpecification)
    .filter((spec) => spec.value !== "—");

  if (normalized.length === 0) {
    return '<p class="tab-empty-state">Las especificaciones detalladas estarán disponibles muy pronto.</p>';
  }

  return `
    <div class="specs-table-wrap">
      <table class="specs-table">
        <tbody>
          ${normalized.map((spec) => `
            <tr>
              <th scope="row">${escapeHTML(spec.label)}</th>
              <td>${escapeHTML(spec.value)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function buildIncludesList(includes) {
  // El cliente no define contenido predeterminado: todo proviene del documento
  // del producto en la base de datos y conserva exactamente el orden del administrador.
  const items = (Array.isArray(includes) ? includes : [])
    .map((item) => typeof item === "string"
      ? item.trim()
      : String(item?.name || item?.label || item?.text || "").trim())
    .filter(Boolean);

  if (items.length === 0) {
    return '<p class="tab-empty-state">El contenido de este paquete aún no ha sido especificado.</p>';
  }

  return `
    <div class="includes-grid">
      ${items.map((item) => `
        <div class="includes-item">
          <span aria-hidden="true">✓</span>
          <p>${escapeHTML(item)}</p>
        </div>
      `).join("")}
    </div>
  `;
}

function getRelatedProducts(product) {
  return products
    .filter((item) => String(item.id) !== String(product.id) && String(item.category) === String(product.category))
    .sort((first, second) => Number(getProductAvailability(first).isOut) - Number(getProductAvailability(second).isOut))
    .slice(0, 4);
}

function buildRelatedProductsHTML(product) {
  const related = getRelatedProducts(product);
  if (related.length === 0) return "";

  return `
    <section class="related-products" aria-labelledby="related-products-title">
      <div class="related-products-heading">
        <div>
          <span class="tab-content-eyebrow">También te puede interesar</span>
          <h2 id="related-products-title">Productos relacionados</h2>
        </div>
        <span>${related.length} opciones</span>
      </div>
      <div class="related-products-grid">
        ${related.map((item) => {
          const price = getStorageOptions(item)[0]?.price || item.price || 0;
          const availability = getProductAvailability(item);
          return `
            <article class="related-product-card">
              <div class="related-product-image">
                <img src="${escapeHTML(getProductImages(item)[0])}" alt="${escapeHTML(item.title || "Producto relacionado")}" loading="lazy">
                <span class="related-stock ${availability.className}"><i></i>${availability.label}</span>
              </div>
              <div class="related-product-copy">
                <span>${escapeHTML(item.brand || "")}</span>
                <h3>${escapeHTML(item.title || "Producto")}</h3>
                <strong>${formatCurrency(price)}</strong>
                <button type="button" class="related-product-button" data-related-product="${escapeHTML(String(item.id))}">
                  Ver producto <span aria-hidden="true">→</span>
                </button>
              </div>
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

/*
  Cada opción de almacenamiento puede definir su propio precio y stock:
  { name: "256GB", price: 29500, oldPrice: 32000, stock: 4 }
  También se aceptan strings para mantener compatibilidad con catálogos anteriores.
*/
function getStorageOptions(product) {
  const defaultOption = {
    name: "Estándar",
    price: Number(product?.price) || 0,
    oldPrice: Number(product?.oldPrice) || 0,
    stock: normalizeNullableStock(product?.stock)
  };
  const storage = product?.variants?.storage;

  if (!Array.isArray(storage) || storage.length === 0) {
    return [defaultOption];
  }

  return storage.map((item, index) => {
    if (typeof item === "string") {
      return {
        name: item,
        price: defaultOption.price,
        oldPrice: defaultOption.oldPrice,
        stock: defaultOption.stock
      };
    }

    return {
      name: String(item.name || `Opción ${index + 1}`),
      price: Number(item.price) || defaultOption.price,
      oldPrice: Number(item.oldPrice) || 0,
      // El stock por variante tiene prioridad; null hereda el stock general.
      stock: normalizeNullableStock(item.stock) ?? defaultOption.stock
    };
  });
}

function getStorageOption(product, storageName) {
  const options = getStorageOptions(product);
  return options.find((option) => option.name === storageName) || options[0];
}

function getStoredCart() {
  try {
    const savedCart = JSON.parse(localStorage.getItem("cart") || "[]");
    return Array.isArray(savedCart) ? savedCart : [];
  } catch {
    return [];
  }
}

function setFallbackImage(event) {
  const image = event.currentTarget;
  if (image.dataset.fallbackApplied) return;
  image.dataset.fallbackApplied = "true";
  image.src = FALLBACK_IMAGE;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#039;",
    '"': "&quot;"
  })[character]);
}

function formatCurrency(value) {
  const number = Number(value) || 0;

  return `L. ${number.toLocaleString("es-HN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  })}`;
}

/* ========================================================================== 
   CONTENIDO DEL SITIO (configuracion/ en Supabase)
   ========================================================================== */

function applyCompanySettings(company) {
  if (!company) return;

  if (company.name) {
    document.title = `${company.name} | Celulares Nuevos y Seminuevos en Honduras`;
  }

  const metaDescription = document.querySelector('meta[name="description"]');
  if (metaDescription && company.description) {
    metaDescription.setAttribute("content", company.description);
  }

  const aboutParagraphs = document.getElementById("about-paragraphs");
  if (aboutParagraphs && company.about) {
    const raw = String(company.about);
    if (/<[a-z][\s\S]*>/i.test(raw)) {
      aboutParagraphs.innerHTML = raw;
    } else {
      aboutParagraphs.innerHTML = raw
        .split(/\n\s*\n/)
        .filter((paragraph) => paragraph.trim())
        .map((paragraph) => `<p>${paragraph}</p>`)
        .join("");
    }
  }

  // Campos de contacto y ubicación configurables desde el panel.
  if (company.ubicacion) {
    const footerLocation = document.getElementById("footer-location");
    if (footerLocation) footerLocation.textContent = company.ubicacion;
  }

  if (company.telefono) {
    const footerPhone = document.getElementById("footer-phone");
    if (footerPhone) footerPhone.textContent = company.telefono;
    const footerWaLink = document.getElementById("footer-wa-link");
    if (footerWaLink) {
      const digits = String(company.telefono).replace(/[^0-9]/g, "");
      if (digits) footerWaLink.href = `https://wa.me/${digits}`;
    }
  }
}

function applyHomeSettings(home) {
  if (!home) return;

  const announcement = document.getElementById("announcement-text");
  if (announcement && home.announcement) {
    announcement.textContent = home.announcement;
  }

  const heroTag = document.getElementById("hero-tag");
  if (heroTag && home.hero?.tag) heroTag.textContent = home.hero.tag;

  const heroTitle = document.getElementById("hero-title");
  if (heroTitle && home.hero?.title) heroTitle.textContent = home.hero.title;

  const heroSubtitle = document.getElementById("hero-subtitle");
  if (heroSubtitle && home.hero?.subtitle) heroSubtitle.textContent = home.hero.subtitle;

  if (Array.isArray(home.cards)) renderTrustCards(home.cards);
  if (Array.isArray(home.stats)) renderStats(home.stats);
}

function renderTrustCards(cards) {
  const grid = document.getElementById("trust-grid");
  if (!grid) return;

  const template = grid.querySelector(".trust-card")?.outerHTML;
  if (!template) return;

  grid.innerHTML = cards.map((card, index) => {
    const doc = new DOMParser().parseFromString(template, "text/html");
    const article = doc.querySelector(".trust-card");
    if (!article) return "";
    article.querySelector("h2").textContent = card.title || "";
    article.querySelector("p").textContent = card.description || "";
    return article.outerHTML;
  }).join("");
}

function renderStats(stats) {
  const container = document.getElementById("about-stats");
  if (!container) return;

  container.innerHTML = stats.map((stat) => `
    <div class="stat-card">
      <span class="stat-num">${escapeHTML(stat.number)}</span>
      <span class="stat-lbl">${escapeHTML(stat.label)}</span>
    </div>
  `).join("");
}

function renderFaqs(items) {
  const accordion = document.getElementById("faq-accordion");
  if (!accordion || !Array.isArray(items)) return;

  accordion.innerHTML = items.map((item) => `
    <article class="faq-item">
      <button type="button" class="faq-question" aria-expanded="false">
        <span>${escapeHTML(item.q)}</span>
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" class="faq-arrow" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
      </button>
      <div class="faq-answer">${item.a || ""}</div>
    </article>
  `).join("");

  bindFaqAccordion();
}

function applyFooterSettings(footer) {
  if (!footer) return;

  const description = document.getElementById("footer-desc");
  if (description && footer.description) description.textContent = footer.description;

  const location = document.getElementById("footer-location");
  if (location && footer.location) location.textContent = footer.location;

  const phone = document.getElementById("footer-phone");
  if (phone && footer.phone) phone.textContent = footer.phone;

  const shipping = document.getElementById("footer-shipping");
  if (shipping && footer.shipping) shipping.textContent = footer.shipping;

  const copyright = document.getElementById("footer-copyright");
  if (copyright && footer.copyright) copyright.textContent = footer.copyright;

  const payments = document.getElementById("payment-methods");
  if (payments && Array.isArray(footer.paymentMethods)) {
    payments.innerHTML = footer.paymentMethods
      .map((method) => `<span class="pay-logo-badge">${escapeHTML(method)}</span>`)
      .join("");
  }
}

function applyWhatsappSettings(whatsapp) {
  if (!whatsapp) return;

  whatsappSettings = {
    ...WHATSAPP_DEFAULTS,
    ...whatsapp,
    labels: { ...WHATSAPP_DEFAULTS.labels, ...(whatsapp.labels || {}) }
  };

  const phone = whatsappSettings.phone;
  const heroBtn = document.getElementById("hero-wa-btn");
  if (heroBtn) {
    const text = "Hola Mi Phone HN, me gustaría solicitar información sobre el extrafinanciamiento.";
    heroBtn.href = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  }

  const footerWaLink = document.getElementById("footer-wa-link");
  if (footerWaLink) footerWaLink.href = `https://wa.me/${phone}`;

  calculateFinancing();
}

function setBrandLogo(dataUrl) {
  if (!dataUrl) return;
  const imgHtml = `<img src="${dataUrl}" alt="Mi Phone HN" class="brand-logo-img">`;
  const headerLogo = document.querySelector(".logo");
  if (headerLogo) headerLogo.innerHTML = imgHtml;
  const footerLogo = document.querySelector(".footer-logo");
  if (footerLogo) footerLogo.innerHTML = imgHtml;
}

function applyHeroImage(dataUrl) {
  if (!dataUrl) return;
  const hero = document.getElementById("hero");
  if (!hero) return;
  hero.style.setProperty("--hero-img", `url('${dataUrl}')`);
  hero.classList.add("has-hero-img");
}

let heroPhonesTimer = null;

function applyHeroPhones(images) {
  const list = (images || []).filter(Boolean);
  const visual = document.querySelector(".hero-visual");
  const p1 = document.querySelector(".phone-mockup.phone-1");
  const p2 = document.querySelector(".phone-mockup.phone-2");

  if (heroPhonesTimer) {
    clearInterval(heroPhonesTimer);
    heroPhonesTimer = null;
  }

  const setSlot = (mockup, url) => {
    if (!mockup) return;
    const img = mockup.querySelector(".phone-mockup-img");
    if (img) {
      img.onerror = null;
      img.hidden = !url;
      img.src = url;
      mockup.classList.toggle("has-img", !!url);
      if (url) {
        img.onerror = () => {
          img.hidden = true;
          mockup.classList.remove("has-img");
        };
      }
    } else {
      mockup.classList.toggle("has-img", !!url);
    }
  };

  if (!visual || !p1 || list.length === 0) {
    setSlot(p1, "");
    setSlot(p2, "");
    visual?.classList.remove("has-single", "is-swapping", "has-carousel");
    return;
  }

  if (list.length === 1) {
    setSlot(p1, list[0]);
    setSlot(p2, "");
    visual.classList.add("has-single");
    visual.classList.remove("is-swapping", "has-carousel");
    return;
  }

  visual.classList.remove("has-single");
  visual.classList.add("has-carousel");
  let idx = 0;
  setSlot(p1, list[0]);
  setSlot(p2, list[1]);

  const swapSlot = (mockup, url) => {
    const img = mockup?.querySelector(".phone-mockup-img");
    if (!img || !mockup) return;
    img.onerror = null;
    img.hidden = !url;
    mockup.classList.toggle("has-img", !!url);
    img.src = url;
    if (url) {
      img.onerror = () => {
        img.hidden = true;
        mockup.classList.remove("has-img");
      };
    }
  };

  const clearInline = (el) => {
    el.style.left = "";
    el.style.top = "";
    el.style.transform = "";
    el.style.opacity = "";
    el.style.zIndex = "";
    el.style.transition = "";
    el.style.animation = "";
  };

  const advance = async () => {
    const mA = document.querySelector(".hero-visual .phone-mockup.phone-1");
    const mB = document.querySelector(".hero-visual .phone-mockup.phone-2");
    const imgA = mA && mA.querySelector(".phone-mockup-img");
    const imgB = mB && mB.querySelector(".phone-mockup-img");
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const nextIdx = (idx + 1) % list.length;
    const nextImg = list[(nextIdx + 1) % list.length];

    if (!reduced && mA && mB) {
      clearInline(mA);
      clearInline(mB);
      mA.style.animation = "none";
      mA.style.transition = "transform 0.5s ease-in, opacity 0.5s ease-in";
      mA.style.transform = "translateY(80px) rotate(3deg)";
      mA.style.opacity = "0";
      mB.style.transition = "transform 0.6s cubic-bezier(0.2, 0.8, 0.3, 1), opacity 0.6s ease";
      mB.style.transform = "translate(-112px, 20px) rotate(-5deg)";
      mB.style.opacity = "1";
      mB.style.zIndex = "3";
      await new Promise((r) => setTimeout(r, 500));

      if (imgA) imgA.src = nextImg;
      mA.classList.remove("phone-1");
      mA.classList.add("phone-2");
      mB.classList.remove("phone-2");
      mB.classList.add("phone-1");
      mB.style.transition = "none";
      mB.style.transform = "";
      mB.style.opacity = "";
      mB.style.zIndex = "";
      void mB.offsetWidth;
      mB.style.transition = "";

      mA.style.transition = "all 0.5s ease";
      mA.style.left = "112px";
      mA.style.top = "0px";
      mA.style.transform = "rotate(10deg)";
      mA.style.opacity = "0.75";
      await new Promise((r) => setTimeout(r, 500));
      clearInline(mA);
      clearInline(mB);
    } else {
      if (imgA) imgA.src = nextImg;
      if (mA) { mA.classList.remove("phone-1"); mA.classList.add("phone-2"); }
      if (mB) { mB.classList.remove("phone-2"); mB.classList.add("phone-1"); }
    }
    idx = nextIdx;
  };

  const start = () => { if (!heroPhonesTimer) heroPhonesTimer = setInterval(advance, 5000); };
  start();
}

function applyAboutImage(dataUrl) {
  const wrap = document.getElementById("about-image-wrap");
  const img = document.getElementById("about-image");
  if (!wrap || !img) return;
  if (dataUrl) {
    img.src = dataUrl;
    wrap.hidden = false;
  } else {
    img.src = "";
    wrap.hidden = true;
  }
}

function applySiteSettings(documents) {
  const byId = {};
  documents.forEach((docSnap) => { byId[docSnap.id] = docSnap.data ? docSnap.data() : docSnap; });

  applyCompanySettings(byId.empresa);
  applyHomeSettings(byId.inicio);
  applyFooterSettings(byId["pie-de-pagina"]);
  renderFaqs(byId["preguntas-frecuentes"]?.items);
  applyWhatsappSettings(byId.whatsapp);
  setBrandLogo(byId.logo?.url || byId.logo?.data);
  applyHeroImage(byId["hero-fondo"]?.url || byId["hero-fondo"]?.data);
  const phones = [];
  for (let i = 1; i <= 5; i++) {
    const pdoc = byId["telefono-" + i];
    const url = pdoc && (pdoc.url || pdoc.data);
    if (url) phones.push(url);
  }
  applyHeroPhones(phones);
  applyAboutImage(byId.nosotros?.url || byId.nosotros?.data);
}

async function loadSiteSettings() {
  try {
    const { db, collection, onSnapshot, getDocs } = await import("./supabase-config.js");
    const settingsRef = collection(db, "configuracion");
    const imagesRef = collection(db, "imagenes");

    const applyAll = async () => {
      try {
        const [snapA, snapB] = await Promise.all([getDocs(settingsRef), getDocs(imagesRef)]);
        applySiteSettings([...snapA.docs, ...snapB.docs]);
      } catch (err) {
        console.warn("No se pudo cargar la configuración del sitio:", err);
      }
    };

    onSnapshot(settingsRef, () => { applyAll(); }, applyAll);
    onSnapshot(imagesRef, () => { applyAll(); }, applyAll);
  } catch (error) {
    console.warn("No se pudo conectar para cargar la configuración del sitio:", error);
  }
}


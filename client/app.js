/* ========================================================================== 
   MI PHONE HN — LÓGICA DE APLICACIÓN
   Los productos se cargan desde Firebase Cloud Firestore en tiempo real
   ========================================================================== */

const WHATSAPP_PHONE = "50488238432";
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
});

/* ========================================================================== 
   CARGAR PRODUCTOS
   ========================================================================== */

async function loadProducts() {
  showCatalogLoading();

  try {
    const { db, collection, onSnapshot, getDocs } = await import("../firebase-config.js");
    const productsRef = collection(db, "products");

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
        console.error("Error al obtener catálogo desde Firestore:", getErr);
        showCatalogError();
      }
    });
  } catch (error) {
    console.error("No se pudo conectar a Firebase Firestore:", error);
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
      <p>Verifica tu conexión a internet y la configuración de Cloud Firestore.</p>
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

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeProductModal();
    closeCart();
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
  const monthlyPayment = formatCurrency(Math.round(selectedStorageOption.price / 6));
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
            <span class="modal-product-code">Ref. ${escapeHTML(String(product.id).slice(0, 8).toUpperCase())}</span>
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

          <div class="payment-option">
            <span class="payment-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="3"></rect><path d="M3 10h18"></path><path d="M7 15h3"></path></svg>
            </span>
            <span><small>Financiamiento disponible</small><strong>6 cuotas de ${monthlyPayment}/mes sin intereses</strong></span>
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

  const nameInput = document.getElementById("client-name");
  const dniInput = document.getElementById("client-dni");
  const locationInput = document.getElementById("client-location");

  const name = nameInput?.value.trim() || "";
  const dni = dniInput?.value.trim() || "";
  const location = locationInput?.value.trim() || "";

  if (!name || !dni || !location) {
    alert("Completa todos los datos de entrega antes de enviar tu pedido.");
    return;
  }

  let subtotal = 0;
  let message = "*NUEVO PEDIDO — MI PHONE HN*\n\n";
  message += `Cliente: ${name}\n`;
  message += `DNI: ${dni}\n`;
  message += `Ciudad/Envío: ${location}\n\n`;
  message += "*Productos:*\n";

  cart.forEach((item) => {
    const itemTotal = Number(item.price || 0) * Number(item.quantity || 0);
    subtotal += itemTotal;
    message += `- ${item.title} (${item.storage} | ${item.color})\n`;
    message += `  Cantidad: ${item.quantity}\n`;
    message += `  Subtotal: ${formatCurrency(itemTotal)}\n`;
  });

  message += `\n*TOTAL: ${formatCurrency(subtotal)}*\n\n`;
  message += "Despacho: Choluteca, Honduras\n";
  message += "Logística: Rápido Cargo";

  window.open(`https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`, "_blank", "noopener");
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
    calcWhatsappBtn.href = `https://wa.me/${WHATSAPP_PHONE}`;
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

  calcWhatsappBtn.href = `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`;
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
  // del producto en Firestore y conserva exactamente el orden del administrador.
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

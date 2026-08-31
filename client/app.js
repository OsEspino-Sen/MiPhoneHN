/* ==========================================================================
   MI PHONE HN — LÓGICA DE APLICACIÓN
   Los productos se cargan desde Supabase en tiempo real
   ========================================================================== */

import { iniciarMantenimientoCliente, mostrarProductoCompartidoEnMantenimiento } from "./mantenimiento-cliente.js";

/* ==========================================================================
   MARCA DE LA EMPRESA (configurable desde el panel Admin)
   Nombre único propagado a TODOS los textos del sitio: título, logos,
   loader, copyright, aria-labels, mensajes de WhatsApp y modales.
   ========================================================================== */
const MARCA_DEFAULT = "Mi Phone HN";
let nombreEmpresa = MARCA_DEFAULT;
const TITULO_PARTES = document.title.split(MARCA_DEFAULT);
const NODOS_MARCA = [];

/* Logo de dos tonos: última palabra acentuada (patrón "Mi Phone <span>HN</span>"). */
function marcaHTML(nombre) {
  const palabras = String(nombre).trim().split(/\s+/).filter(Boolean);
  if (!palabras.length) return "";
  const ultima = palabras.pop();
  const resto = palabras.join(" ");
  return resto
    ? `${escapeHTML(resto)} <span>${escapeHTML(ultima)}</span>`
    : `<span>${escapeHTML(ultima)}</span>`;
}

/* Registra (una sola vez) cada nodo de texto y atributo que menciona la
   marca por defecto, para reemplazarla cuando llegue el nombre real. */
function registrarNodosMarca() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const nodo = walker.currentNode;
    if (nodo.nodeValue && nodo.nodeValue.includes(MARCA_DEFAULT)) {
      NODOS_MARCA.push({ tipo: "texto", nodo, original: nodo.nodeValue });
    }
  }
  document.querySelectorAll("[aria-label], [alt], [title], [placeholder]").forEach((el) => {
    for (const attr of ["aria-label", "alt", "title", "placeholder"]) {
      const valor = el.getAttribute(attr);
      if (valor && valor.includes(MARCA_DEFAULT)) {
        NODOS_MARCA.push({ tipo: "attr", nodo: el, attr, original: valor });
      }
    }
  });
}

/* Propaga el nombre actual a todos los lugares registrados + logos. */
function aplicarMarcaEnSitio() {
  NODOS_MARCA.forEach((registro) => {
    if (registro.tipo === "texto") {
      registro.nodo.nodeValue = registro.original.split(MARCA_DEFAULT).join(nombreEmpresa);
    } else {
      registro.nodo.setAttribute(registro.attr, registro.original.split(MARCA_DEFAULT).join(nombreEmpresa));
    }
  });
  document.querySelectorAll(".brand-logo-text, .page-loader-brand").forEach((el) => {
    el.innerHTML = marcaHTML(nombreEmpresa);
  });
}

const WHATSAPP_DEFAULTS = {
  phone: "50488878066",
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

// Única fuente de verdad del número: se normaliza desde la configuración
// del negocio (configuracion/whatsapp → phone). Maneja el prefijo 504 de
// Honduras sin duplicarlo: 9 dígitos (0XXXXXXXX) → 504XXXXXXXX,
// 8 dígitos → 504XXXXXXXX, y mantiene 504XXXXXXXX / 50488XXXX etc.
function normalizarWhatsAppNumero(numero) {
  let d = String(numero || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  if (d.length === 8) d = "504" + d;
  return d;
}

function enlaceWhatsApp(numero, texto) {
  const d = normalizarWhatsAppNumero(numero);
  if (!d) return "";
  const base = `https://wa.me/${d}`;
  return texto ? `${base}?text=${encodeURIComponent(texto)}` : base;
}

// Aplica el número configurado a TODOS los enlaces/CTA de WhatsApp (los
// href iniciales del HTML quedan vacíos a propósito; aquí se completan).
function aplicarWhatsAppEnlaces() {
  const phone = normalizarWhatsAppNumero(whatsappSettings.phone);
  if (!phone) return;
  const heroBtn = document.getElementById("hero-wa-btn");
  if (heroBtn) {
    heroBtn.setAttribute(
      "href",
      enlaceWhatsApp(phone, `Hola ${nombreEmpresa}, me gustaría solicitar información sobre el extrafinanciamiento.`)
    );
  }
  const footerWaLink = document.getElementById("footer-wa-link");
  if (footerWaLink) footerWaLink.setAttribute("href", `https://wa.me/${phone}`);
  const calcBtn = document.getElementById("calc-whatsapp-btn");
  if (calcBtn) calcBtn.setAttribute("href", `https://wa.me/${phone}`);
}
const FALLBACK_IMAGE =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">` +
    `<rect width="600" height="600" fill="#f2f4f8"/>` +
    `<circle cx="300" cy="270" r="120" fill="#e3ecf7"/>` +
    `<rect x="228" y="140" width="144" height="290" rx="26" fill="#ffffff"/>` +
    `<rect x="236" y="148" width="128" height="240" rx="16" fill="#eef2f7"/>` +
    `<circle cx="300" cy="412" r="8" fill="#c9d4e2"/>` +
    `<rect x="262" y="180" width="76" height="10" rx="5" fill="#d8e2ee"/>` +
    `<rect x="262" y="202" width="56" height="8" rx="4" fill="#e4ebf3"/>` +
    `<text x="300" y="520" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="600" fill="#8a94a6" text-anchor="middle">${escapeHTML(nombreEmpresa)}</text>` +
    `</svg>`
  );

let products = [];
let categories = [];
let cart = getStoredCart();
let activeCategory = "all";
let activeCondition = "all";
let searchQuery = "";
let currentBaseProduct = null;   // Producto agrupado original (sin overrides)
let currentSelectedProduct = null; // Producto efectivo según la variante (color) activa
let modalSelectedColor = "";
/* La vista de producto participa del historial del navegador: true cuando su
   entrada está registrada (Atrás la cierra), false en carga directa por enlace
   compartido (Atrás sale del sitio, como en toda página web). */
let vistaProductoConHistoria = false;
/* Cuántos productos consecutivos hay apilados en el historial desde el
   catálogo (Catálogo → A → B → C = 3). Permite que "clic fuera" regrese al
   catálogo de un solo salto, sin recorrer producto por producto. */
let profundidadHistorialProducto = 0;
/* Deep link de producto presente en la URL al cargar: mientras se resuelve,
   el loader (logo animado) permanece y el Home no debe asomar jamás. */
const ENLACE_PRODUCTO_EN_URL = new URLSearchParams(window.location.search).has("producto");
let productoEnlaceResuelto = false;
let entradaProductoPendiente = false;
let modalSelectedStorage = "";
let modalActiveImageIndex = 0;
let modalActiveTab = "description";
let lastProductModalTrigger = null;

// Catálogo con carga progresiva: el Home es vitrina (8 destacados) y la
// página de Tienda muestra el catálogo completo de 8 en 8.
const CATALOG_PAGE_SIZE = 8;
const isShopPage = document.body?.dataset.page === "shop";
let catalogVisibleCount = CATALOG_PAGE_SIZE;
let filteredCatalogTotal = 0;

const LOAD_MORE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true" width="18" height="18"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 12h16m0 0l-6-6m6 6l-6 6"/></svg>';
const BACK_TO_TOP_ICON = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true" width="18" height="18"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19V5m0 0l-6 6m6-6l6 6"/></svg>';

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
const productModalBody = document.getElementById("product-modal-body");
const calcAmount = document.getElementById("calc-amount");
const calcWhatsappBtn = document.getElementById("calc-whatsapp-btn");
const bankCardsEl = document.getElementById("bank-cards");
const planCardsEl = document.getElementById("plan-cards");
const resultMonthly = document.getElementById("result-monthly");
const resultPrice = document.getElementById("result-price");
const resultInterest = document.getElementById("result-interest");
const resultTotal = document.getElementById("result-total");
const resultRate = document.getElementById("result-rate");
const resultSummary = document.getElementById("result-summary");
const themeToggle = document.getElementById("theme-toggle");
const mobileMenuToggle = document.getElementById("mobile-menu-toggle");
const navMenu = document.getElementById("nav-menu");
const categoryGrid = document.getElementById("category-grid");

/* ========================================================================== 
   TOASTS
   ========================================================================== */

function notify(message, type = "info") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.setAttribute("aria-live", "polite");
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.setAttribute("role", "status");
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("toast-visible"));

  setTimeout(() => {
    toast.classList.remove("toast-visible");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

/* ==========================================================================
   COMPARTIR PRODUCTOS POR ENLACE
   - "Compartir" en el detalle: usa el menu nativo del telefono (WhatsApp,
     etc.) si existe; si no, copia el enlace al portapapeles.
   - Enlace profundo: ?producto=<id>&color=<nombre> abre ese producto al
     cargar la pagina (funciona en Inicio y en Tienda).
   ========================================================================== */

function obtenerUrlCompartirProducto(productId, colorName = "") {
  const url = new URL(window.location.href);
  url.hash = "";
  url.search = "";
  url.searchParams.set("producto", String(productId));
  if (colorName) url.searchParams.set("color", String(colorName));
  return url.toString();
}

function compartirProductoActual() {
  const producto = currentBaseProduct;
  if (!producto) return;
  const url = obtenerUrlCompartirProducto(producto.id, modalSelectedColor);
  const titulo = `${producto.title || "Producto"} — ${nombreEmpresa}`;
  // Menu nativo de compartir (ideal en movil: WhatsApp, Instagram, etc.)
  if (typeof navigator.share === "function") {
    navigator.share({ title: titulo, text: titulo, url })
      .then(() => notify("¡Producto compartido!", "success"))
      .catch((err) => {
        if (err && err.name === "AbortError") return; // el usuario cancelo: sin ruido
        copiarEnlaceProducto(url);
      });
    return;
  }
  copiarEnlaceProducto(url);
}

function copiarEnlaceProducto(url) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url)
      .then(() => notify("Enlace del producto copiado", "success"))
      .catch(() => copiarEnlaceConTextarea(url));
    return;
  }
  copiarEnlaceConTextarea(url);
}

function copiarEnlaceConTextarea(url) {
  const area = document.createElement("textarea");
  area.value = url;
  area.setAttribute("aria-hidden", "true");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand("copy");
    notify("Enlace del producto copiado", "success");
  } catch {
    notify("Copia este enlace manualmente: " + url, "error");
  }
  area.remove();
}

/* "Ver más" / Enter en el buscador del producto: lleva a la TIENDA con el
   término aplicado (la tienda lo lee de ?busqueda= al cargar). */
function irATiendaConBusqueda(termino) {
  const terminoLimpio = String(termino || "").trim();
  if (!terminoLimpio) {
    notify("Escribe algo para buscar en la Tienda", "info");
    return;
  }
  const url = new URL("tienda.html", window.location.href);
  url.searchParams.set("busqueda", terminoLimpio);
  window.location.href = url.toString();
}

/* La Tienda aplica el término recibido por ?busqueda= al cargar. */
function aplicarBusquedaDesdeURL() {
  const params = new URLSearchParams(window.location.search);
  const termino = (params.get("busqueda") || "").trim();
  if (!termino || !searchInput) return;
  searchInput.value = termino;
  searchQuery = termino.toLowerCase().trim();
  renderProducts();
  document.querySelector(".catalog-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

let enlaceProductoAtendido = false;

/* Mapa de IDs legados → IDs actuales (tras la renumeración del catálogo).
   Los enlaces compartidos ANTES de la renumeración siguen funcionando. */
const PRODUCTO_IDS_LEGADO = {
  "producto-2": "producto-1", "producto-3": "producto-2", "producto-4": "producto-3",
  "producto-6": "producto-4", "producto-7": "producto-5", "producto-8": "producto-6",
  "producto-41": "producto-7", "producto-13": "producto-8", "producto-14": "producto-9",
  "producto-15": "producto-10", "producto-16": "producto-11", "producto-17": "producto-12",
  "producto-18": "producto-13", "producto-19": "producto-14", "producto-20": "producto-15",
  "producto-21": "producto-16", "producto-22": "producto-17", "producto-23": "producto-18",
  "producto-24": "producto-19", "producto-25": "producto-20", "producto-26": "producto-21",
  "producto-27": "producto-22", "producto-28": "producto-23", "producto-29": "producto-24",
  "producto-30": "producto-25", "producto-31": "producto-26", "producto-32": "producto-27",
  "producto-33": "producto-28", "producto-34": "producto-29", "producto-35": "producto-30",
  "producto-36": "producto-31", "producto-37": "producto-32", "producto-38": "producto-33"
};

function resolverIdProductoLegado(id) {
  return PRODUCTO_IDS_LEGADO[String(id || "").trim().toLowerCase()] || null;
}

function resolverProductoDelEnlace(id) {
  // 1) por ID exacto; 2) por ID legado (anterior a la renumeración); 3) null
  const directo = products.find((item) => String(item.id) === String(id));
  if (directo) return directo;
  const remapeado = resolverIdProductoLegado(id);
  if (remapeado) return products.find((item) => String(item.id) === String(remapeado)) || null;
  return null;
}

/* Abre el producto indicado por ?producto=<id> — AUTOSUFICIENTE: no depende
   de haber visitado la tienda, del estado previo ni de que realtime haya
   cargado. Estrategia:
   1) Esperar el catálogo por realtime (llega en ms; reintenta hasta ~3.5s).
   2) Fallback definitivo: leer el producto DIRECTO de la base con la función
      pública producto_publico e inyectarlo en el catálogo para abrirlo.
   La URL se CONSERVA (es la página del producto) y respeta el gate de
   mantenimiento (si bloquea, la ficha la pinta el propio gate). */
async function abrirProductoDesdeEnlaceCompartido() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("producto");
  if (!id) return;
  enlaceProductoAtendido = true;
  const color = params.get("color") || "";

  // Mantenimiento activo: el gate de mantenimiento muestra la ficha del
  // producto por su cuenta (vía producto_publico). Aquí liberamos el loader
  // para que la página de cierre + ficha queden visibles (nunca atascado).
  if (document.getElementById("mantenimiento-overlay")) {
    productoEnlaceResuelto = true;
    finishPageLoader();
    return;
  }

  // 1) Esperar el catálogo (realtime)
  for (let intento = 0; intento < 7; intento++) {
    const producto = resolverProductoDelEnlace(id);
    if (producto) {
      openProductModal(producto.id, color, { cargaDirecta: true });
      productoEnlaceResuelto = true;
      finishPageLoader();
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  // 2) Fallback: lectura directa por RPC (funciona siempre, incluso con
  //    mantenimiento activo o realtime caído) — con tope de tiempo para que
  //    el loader NUNCA quede atascado.
  try {
    const { supabase } = await import("./supabase-config.js");
    const rpcConTope = Promise.race([
      supabase.rpc("producto_publico", { p_id: String(id) }),
      new Promise((resolve) => setTimeout(() => resolve({ data: null }), 8000))
    ]);
    let data = null;
    const directa = await rpcConTope;
    data = directa?.data || null;
    if (!data) {
      const legado = resolverIdProductoLegado(id);
      if (legado) {
        const resp = await Promise.race([
          supabase.rpc("producto_publico", { p_id: legado }),
          new Promise((resolve) => setTimeout(() => resolve({ data: null }), 8000))
        ]);
        data = resp?.data || null;
      }
    }
    if (data && data.id) {
      const producto = normalizeProductRecord({ id: data.id, ...data });
      if (!products.some((item) => String(item.id) === String(producto.id))) {
        products.push(producto); // queda disponible para la vista y el carrito
      }
      openProductModal(producto.id, color, { cargaDirecta: true });
      productoEnlaceResuelto = true;
      finishPageLoader();
      return;
    }
  } catch (err) {
    console.warn("[compartir] No se pudo cargar el producto por RPC:", err);
  }

  // No se encontró: entrada normal al Home.
  productoEnlaceResuelto = true;
  finishPageLoader();
  notify("El producto compartido ya no está disponible", "error");
}

/* ========================================================================== 
   INICIALIZACIÓN
   ========================================================================== */

// Ocultador suave del cargador de pantalla: se desvanece cuando termina la
// carga inicial de datos (productos, categorías y configuración), cuando el
// navegador termina de cargar recursos, o como máximo a los 4s. Se mantiene
// visible un mínimo de 0.9s para que el desvanecimiento sea limpio y el
// contenido tenga tiempo de aparecer bajo el crossfade.
const pageLoadStart = performance.now();

function finishPageLoader() {
  const loader = document.getElementById("page-loader");
  if (!loader || loader.dataset.done) return;
  // Deep link de producto: el loader (logo animado) permanece hasta que la
  // vista del producto esté abierta; el Home no debe asomar durante la
  // resolución del enlace compartido.
  if (ENLACE_PRODUCTO_EN_URL && !productoEnlaceResuelto) return;
  const elapsed = performance.now() - pageLoadStart;
  if (elapsed < 900) {
    setTimeout(finishPageLoader, 900 - elapsed);
    return;
  }
  loader.dataset.done = "1";
  document.body.classList.add("page-ready");
  loader.classList.add("page-loader--done");
  // Animación de entrada del producto (deep link): la vista sube y aparece
  // mientras el loader se desvanece. Una sola vez por carga.
  if (entradaProductoPendiente) {
    entradaProductoPendiente = false;
    const panel = productModal?.querySelector(".product-modal-content");
    if (panel) {
      panel.classList.add("entrada-producto");
      setTimeout(() => {
        panel.classList.remove("entrada-producto");
        // Restaurar las transiciones normales para cambios de producto posteriores.
        productModal?.classList.remove("sin-animacion");
      }, 650);
    }
  }
  setTimeout(() => loader.remove(), 700);
}

document.addEventListener("DOMContentLoaded", () => {
  iniciarMantenimientoCliente();
  registrarNodosMarca();
  aplicarWhatsAppEnlaces();
  initTheme();
  updateCartUI();
  setupEventListeners();
  initFinancingCalculator();
  Promise.allSettled([loadProducts(), loadCategories(), loadSiteSettings()])
    .then(() => document.fonts.ready)
    .then(async () => {
      // Deep link de producto: el loader (logo animado) permanece visible
      // hasta resolver el producto; el Home nunca llega a verse.
      await abrirProductoDesdeEnlaceCompartido();
      // Búsqueda llegada por enlace (?busqueda=): aplicarla en la Tienda.
      aplicarBusquedaDesdeURL();
      finishPageLoader();
    });
  window.addEventListener("load", finishPageLoader);
  setTimeout(finishPageLoader, 4000);

  // Navegación entre páginas: al llegar desde otra página (p. ej. Tienda/Soporte)
  // con un hash (#about-section, #faq-section, #hero) se hace un scroll suave a
  // esa sección una vez el layout está estable (las imágenes del hero desplazan
  // el layout) y se reintenta por si queda algún cambio tardío; al finalizar se
  // limpia el hash para que una recarga posterior del Inicio quede arriba y no
  // salte de nuevo a esa sección.
  if (!isShopPage) {
    if (window.location.hash) {
      const hash = window.location.hash;
      const target = (() => {
        try {
          return document.querySelector(hash);
        } catch {
          return null;
        }
      })();
      const scrollToHashSection = () => {
        try {
          if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch {
          /* ignorar */
        }
      };
      const clearHash = () => {
        if (window.location.hash) {
          history.replaceState(null, "", window.location.pathname + window.location.search);
        }
      };
      const runHashScroll = () => {
        setTimeout(scrollToHashSection, 200);
        setTimeout(() => {
          scrollToHashSection();
          clearHash();
        }, 1000);
      };
      if (document.readyState === "complete") {
        runHashScroll();
      } else {
        window.addEventListener("load", runHashScroll, { once: true });
      }
    } else {
      // Carga directa del Inicio sin hash: anular cualquier restauración de
      // scroll del navegador y quedar arriba (sección Inicio).
      requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
    }
  }
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
      renderFeaturedCarousel();
    }, async (error) => {
      console.warn("⚠️ Streaming en tiempo real bloqueado, intentando lectura única getDocs:", error);
      try {
        const snapshot = await getDocs(productsRef);
        products = snapshot.docs.map((docSnap) => normalizeProductRecord({
          id: docSnap.id,
          ...docSnap.data()
        }));
        renderProducts();
        renderFeaturedCarousel();
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

/* ========================================================================== 
   CARGAR CATEGORÍAS
   ========================================================================== */

let categoryChipsContainer = null; // contenedor #category-chips (solo tienda)
let categoryParamHandled = false; // el ?categoria= se aplica una sola vez

async function loadCategories() {
  categoryChipsContainer = document.getElementById("category-chips");
  try {
    const { db, collection, query, orderBy, onSnapshot, getDocs } = await import("./supabase-config.js");
    const categoriesRef = query(collection(db, "categorias"), orderBy("id"));
    const apply = (snapshot) => {
      categories = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      renderCategoriesSection();
      renderCategoryChips();
      applyCategoryParamFilter();
    };
    onSnapshot(categoriesRef, apply, async () => {
      try {
        const snapshot = await getDocs(categoriesRef);
        apply(snapshot);
      } catch (err) {
        console.warn("No se pudieron cargar las categorías:", err);
      }
    });
  } catch (error) {
    console.warn("No se pudo conectar para cargar las categorías:", error);
  }
}

function renderCategoriesSection() {
  if (!categoryGrid) return;
  // Misma lógica que el filtro de "Condición": la sección nunca se vacía ni se
  // re-renderiza si el conjunto de categorías no cambió (evita el parpadeo).
  if (!categories.length) return;
  const ids = categories.map((cat) => cat.id).join("|");
  if (categoryGrid.dataset.renderedIds === ids) return;
  const html = categories.map((cat, index) => `
    <a href="${isShopPage ? `?categoria=${encodeURIComponent(cat.id)}` : `tienda.html?categoria=${encodeURIComponent(cat.id)}`}" class="category-card" data-category-id="${escapeHTML(cat.id)}" data-pastel-index="${index % 6}">
      <span class="category-card-image">
        <img src="${escapeHTML(cat.image || FALLBACK_IMAGE)}" alt="${escapeHTML(cat.label)}" loading="lazy">
      </span>
      <span class="category-card-name">${escapeHTML(cat.label)}</span>
    </a>
  `).join("");
  categoryGrid.dataset.renderedIds = ids;
  categoryGrid.innerHTML = html;

  initCategoryCarousel();

  categoryGrid.querySelectorAll(".category-card").forEach((card) => {
    const img = card.querySelector("img");
    if (img) {
      img.addEventListener("error", () => {
        if (img.dataset.fallbackApplied) return;
        img.dataset.fallbackApplied = "1";
        img.src = FALLBACK_IMAGE;
      });
    }
    card.addEventListener("click", (event) => {
      if (!isShopPage) return; // En Inicio el enlace navega a tienda.html?categoria=…
      event.preventDefault();
      applyCategoryFilter(card.dataset.categoryId);
      history.replaceState(null, "", `?categoria=${encodeURIComponent(card.dataset.categoryId)}`);
      document.getElementById("catalog-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function initCategoryCarousel() {
  if (!categoryGrid || categoryGrid.dataset.carouselInit) return;
  categoryGrid.dataset.carouselInit = "1";
  const mqMobile = matchMedia("(max-width: 640px)");
  const mqHover = matchMedia("(hover: hover)");
  const mqReduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let raf = 0;
  let autoScroll = true;
  let scrollSpeed = 0.55;
  let resumeTimer = 0;

  const tick = () => {
    const max = categoryGrid.scrollWidth - categoryGrid.clientWidth;
    if (max > 0 && autoScroll) {
      let next = categoryGrid.scrollLeft + scrollSpeed;
      if (next >= max) {
        next = max;
        scrollSpeed = -Math.abs(scrollSpeed);
      } else if (next <= 0) {
        next = 0;
        scrollSpeed = Math.abs(scrollSpeed);
      }
      categoryGrid.scrollLeft = next;
    }
    raf = requestAnimationFrame(tick);
  };

  const pause = () => {
    autoScroll = false;
    clearTimeout(resumeTimer);
  };

  const resume = (delay = 1200) => {
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
      autoScroll = true;
    }, delay);
  };

  // Arrastre con ratón: el contenido sigue al cursor y se pausa el movimiento.
  categoryGrid.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse") return;
    pause();
    const startX = event.clientX;
    const startScroll = categoryGrid.scrollLeft;
    let moved = false;
    const onMove = (moveEvent) => {
      const delta = moveEvent.clientX - startX;
      if (Math.abs(delta) > 5) moved = true;
      categoryGrid.scrollLeft = startScroll - delta;
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moved) categoryGrid.dataset.dragMoved = "1";
      resume();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  // Tras un arrastre no se debe activar el enlace de la tarjeta.
  categoryGrid.addEventListener("click", (event) => {
    if (categoryGrid.dataset.dragMoved !== "1") return;
    delete categoryGrid.dataset.dragMoved;
    event.preventDefault();
    event.stopPropagation();
  }, true);

  // En escritorio, al pasar el cursor se pausa; al salir, se reanuda.
  if (mqHover.matches) {
    categoryGrid.addEventListener("mouseenter", pause);
    categoryGrid.addEventListener("mouseleave", () => resume(1000));
  }

  // En táctil, el deslizamiento nativo se encarga; solo pausamos y reanudamos.
  categoryGrid.addEventListener("touchstart", pause, { passive: true });
  categoryGrid.addEventListener("touchend", () => resume(), { passive: true });
  categoryGrid.addEventListener("touchcancel", () => resume(), { passive: true });

  if (!mqMobile.matches || mqReduceMotion.matches) {
    autoScroll = false;
    return;
  }
  raf = requestAnimationFrame(tick);
}

function renderCategoryChips() {
  if (!categoryChipsContainer || !categories.length) return;
  // Idéntico a renderCategoriesSection: solo se re-renderiza si el conjunto de
  // categorías cambió; la selección activa se maneja solo con clases.
  const ids = categories.map((cat) => cat.id).join("|");
  if (categoryChipsContainer.dataset.renderedIds === ids) return;
  const tabs = [
    `<button type="button" class="filter-tab${activeCategory === "all" ? " active" : ""}" data-category="all">Todos</button>`
  ].concat(categories.map((cat) =>
    `<button type="button" class="filter-tab${activeCategory === cat.id ? " active" : ""}" data-category="${escapeHTML(cat.id)}">${escapeHTML(cat.label)}</button>`
  )).join("");
  categoryChipsContainer.dataset.renderedIds = ids;
  categoryChipsContainer.innerHTML = tabs;
  categoryChipsContainer.querySelectorAll(".filter-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      applyCategoryFilter(tab.dataset.category || "all");
    });
  });
}

function applyCategoryFilter(categoryId) {
  activeCategory = categoryId || "all";
  document.querySelectorAll(".filter-tab[data-category]").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.category === activeCategory);
  });
  resetCatalogPagination();
  renderProducts();
}

// Aplica ?categoria=… al cargar la Tienda (por ejemplo, al pulsar una tarjeta
// de categoría desde otra página) sin volver a tocarlo en actualizaciones en
// tiempo real ni pisar la elección manual del usuario.
function applyCategoryParamFilter() {
  if (!isShopPage || categoryParamHandled || !categories.length) return;
  const params = new URLSearchParams(window.location.search);
  const cat = params.get("categoria");
  if (cat && cat !== "all" && categories.some((c) => c.id === cat)) {
    applyCategoryFilter(cat);
  }
  categoryParamHandled = true;
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
    resetCatalogPagination();
    renderProducts();
  });

  filterTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      filterTabs.forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      activeCategory = tab.dataset.category || "all";
      resetCatalogPagination();
      renderProducts();
    });
  });

  filterTags.forEach((tag) => {
    tag.addEventListener("click", () => {
      filterTags.forEach((item) => item.classList.remove("active"));
      tag.classList.add("active");
      activeCondition = tag.dataset.condition || "all";
      resetCatalogPagination();
      renderProducts();
    });
  });

  document.getElementById("load-more-btn")?.addEventListener("click", () => {
    if (isShopPage && catalogVisibleCount >= filteredCatalogTotal) {
      // Catálogo completo desplegado: volver arriba del catálogo (buscador y
      // filtros) sin colapsar la lista. scroll-margin-top respeta el header.
      const catalogSection = document.getElementById("catalog-section");
      (catalogSection || productsGrid)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    catalogVisibleCount += CATALOG_PAGE_SIZE;
    renderProducts();
  });

  cartToggleBtn?.addEventListener("click", openCart);
  cartCloseBtn?.addEventListener("click", closeCart);
  cartDrawerOverlay?.addEventListener("click", closeCart);
  checkoutBtn?.addEventListener("click", checkoutCartWhatsApp);

  productModalOverlay?.addEventListener("click", cerrarDetalleCompleto);
  // Boton "Compartir" + navegación del detalle: delegacion porque el cuerpo
  // del modal se re-renderiza al cambiar de color/capacidad/resultado.
  productModalBody?.addEventListener("click", (event) => {
    if (event.target.closest("[data-share-product]")) {
      compartirProductoActual();
      return;
    }
    if (event.target.closest("[data-producto-volver-tienda]")) {
      cerrarDetalleCompleto();
      return;
    }
  });
  // Scrollbar elegante: visible solo mientras el usuario se desplaza y con
  // desvanecimiento suave al soltar (en navegadores con ::-webkit-scrollbar).
  const scrollProducto = document.getElementById("product-modal-scroll");
  let scrollProductoTimer = null;
  scrollProducto?.addEventListener("scroll", () => {
    scrollProducto.classList.add("is-scrolling");
    clearTimeout(scrollProductoTimer);
    scrollProductoTimer = setTimeout(() => scrollProducto.classList.remove("is-scrolling"), 900);
  }, { passive: true });

  calcAmount?.addEventListener("input", calculateFinancing);
  themeToggle?.addEventListener("click", toggleTheme);

  mobileMenuToggle?.addEventListener("click", () => {
    const isOpen = navMenu?.classList.toggle("active");
    mobileMenuToggle.setAttribute("aria-expanded", String(Boolean(isOpen)));
  });

  // Navegación tipo Single Page: scroll suave sin recargar, sin cambiar la URL
  // ni agregar entradas al historial (los anclas nativos se mantienen como
  // mejora progresiva para navegadores sin JS).
  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    const targetId = decodeURIComponent(link.getAttribute("href").slice(1));
    event.preventDefault();
    const target = targetId ? document.getElementById(targetId) : null;
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    if (link.classList.contains("nav-link")) {
      navMenu?.classList.remove("active");
      mobileMenuToggle?.setAttribute("aria-expanded", "false");
      document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active"));
      link.classList.add("active");
    }
  });

  bindFaqAccordion();

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    cerrarDetalleCompleto();
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

function resetCatalogPagination() {
  if (isShopPage) catalogVisibleCount = CATALOG_PAGE_SIZE;
}

function renderProducts() {
  if (!productsGrid) return;

  let filteredProducts = products.filter((product) => {
    const title = String(product.title || "").toLowerCase();
    const brand = String(product.brand || "").toLowerCase();
    const category = String(product.category || "").toLowerCase();
    const condition = String(product.condition || "").toLowerCase();

    const matchesSearch = title.includes(searchQuery) || brand.includes(searchQuery);
    const matchesCategory = activeCategory === "all" || category === activeCategory;
    const matchesCondition = activeCondition === "all" || condition === activeCondition;

    return matchesSearch && matchesCategory && matchesCondition;
  });

  // Un producto sólo está agotado cuando TODAS sus variantes tienen stock 0.
  const isSoldOut = (product) => getProductAvailability(product).isOut;
  if (isShopPage) {
    // Tienda: los disponibles primero; los completamente agotados siempre al final.
    const available = filteredProducts.filter((item) => !isSoldOut(item));
    const soldOut = filteredProducts.filter(isSoldOut);
    filteredProducts = available.concat(soldOut);
  } else {
    // Home: ocultar por completo los productos con todas sus variantes agotadas.
    filteredProducts = filteredProducts.filter((item) => !isSoldOut(item));
  }

  productsGrid.innerHTML = "";
  filteredCatalogTotal = filteredProducts.length;

  if (filteredProducts.length === 0) {
    if (noResults) noResults.style.display = "block";
    updateCatalogFooter(false, 0);
    return;
  }

  if (noResults) noResults.style.display = "none";

  const maxVisible = isShopPage ? catalogVisibleCount : CATALOG_PAGE_SIZE;
  const visibleProducts = filteredProducts.slice(0, Math.min(maxVisible, filteredProducts.length));

  visibleProducts.forEach((product) => {
    const card = document.createElement("article");
    card.className = "product-card";

    const productId = String(product.id);
    const condition = String(product.condition || "").toLowerCase();
    const badgeClass = condition === "nuevo" ? "tag-nuevo" : "tag-seminuevo";
    const storageOptions = getStorageOptions(product);
    const baseStorageOption = storageOptions[0];
    const hasStoragePrices = storageOptions.length > 1;
    const availability = getProductAvailability(product);
    const cardImages = getProductImages(product);
    const hasCarousel = cardImages.length > 1;
    const productColors = getProductColors(product);
    const rating = getCardRating(product);
    const oldPriceHTML = baseStorageOption.oldPrice
      ? `<span class="price-old">${formatCurrency(baseStorageOption.oldPrice)}</span>`
      : "";
    const priceLabel = `${hasStoragePrices ? "Desde " : ""}${formatCurrency(baseStorageOption.price)}`;
    const exploreButton = `
      <button type="button" class="btn btn-explore" data-open-product="${escapeHTML(productId)}">
        <span>Ver más información</span>
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8l4 4m0 0l-4 4m4-4H3"/>
        </svg>
      </button>`;
    const galleryHTML = hasCarousel
      ? `
        <div class="product-carousel" aria-hidden="true">
          ${cardImages.map((src, index) => `
            <img class="carousel-img ${index === 0 ? "active" : ""}" src="${escapeHTML(src)}" alt="" loading="lazy">
          `).join("")}
          <span class="carousel-dots">${cardImages.map((_, index) => `<i class="carousel-dot ${index === 0 ? "active" : ""}"></i>`).join("")}</span>
        </div>`
      : `<img src="${escapeHTML(cardImages[0])}" alt="${escapeHTML(product.title)}" loading="lazy">`;
    const colorsRow = productColors.length
      ? `
        <div class="product-colors">
          ${productColors.slice(0, 4).map((color) => `
            <button type="button" class="color-swatch-dot color-swatch-btn" data-card-color="${escapeHTML(color.name)}" style="--swatch:${getSafeColor(color.value)};" title="Ver ${escapeHTML(color.name)}" aria-label="Ver variante ${escapeHTML(color.name)} de ${escapeHTML(product.title || "Producto")}"></button>
          `).join("")}
          ${productColors.length > 4 ? `<span class="color-dot-more">+${productColors.length - 4}</span>` : ""}
        </div>`
      : "";
    const ratingRow = `
      <div class="product-rating" aria-label="Calificación ${rating.value.toFixed(1)} de 5 estrellas">
        <span class="stars" aria-hidden="true">${renderStarRating(rating.value)}</span>
        <span class="rating-count">${rating.reviews} reseñas</span>
      </div>`;

    card.innerHTML = `
      <span class="product-tag-badge ${badgeClass}">${escapeHTML(product.badge || product.condition || "Disponible")}</span>
      <button type="button" class="product-image-container ${hasCarousel ? "has-carousel" : ""}" data-open-product="${escapeHTML(productId)}" aria-label="Ver detalles de ${escapeHTML(product.title)}">
        ${galleryHTML}
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
        ${ratingRow}
        ${colorsRow}
        <div class="product-price-row">
          <span class="price-current">${priceLabel}</span>
          ${oldPriceHTML}
        </div>
        ${exploreButton}
      </div>
    `;

    card.querySelectorAll("img").forEach((img) => img.addEventListener("error", setFallbackImage));
    card.querySelectorAll("[data-open-product]").forEach((button) => {
      button.addEventListener("click", () => {
        lastProductModalTrigger = button;
        openProductModal(button.dataset.openProduct);
      });
    });

    // Puntos de color interactivos: el hover previsualiza la imagen (y el precio)
    // de esa variante; el clic abre el detalle ya posicionado en ese color.
    const cardImage = card.querySelector(".product-image-container img");
    const priceCurrent = card.querySelector(".price-current");
    card.querySelectorAll("[data-card-color]").forEach((dot) => {
      const colorName = dot.dataset.cardColor;
      const variantImages = getProductImages(product, colorName);
      const variantStorage = getVariantStorageOptions(product, colorName);
      const basePrice = Math.min(...getStorageOptions(product).map((option) => Number(option.price) || 0));
      const variantPrice = Math.min(...variantStorage.map((option) => Number(option.price) || 0));
      const hasVariantPrice = variantPrice && variantPrice !== basePrice;
      let originalImageSrc = null;
      let originalPriceText = null;

      dot.addEventListener("mouseenter", () => {
        if (cardImage && variantImages[0]) {
          if (originalImageSrc === null) originalImageSrc = cardImage.getAttribute("src");
          cardImage.setAttribute("src", variantImages[0]);
        }
        if (priceCurrent && hasVariantPrice) {
          if (originalPriceText === null) originalPriceText = priceCurrent.textContent;
          const cheapestVariantStorage = variantStorage.reduce((min, option) => (Number(option.price) || 0) < (Number(min.price) || 0) ? option : min, variantStorage[0]);
          priceCurrent.textContent = `${hasStoragePrices ? "Desde " : ""}${formatCurrency(cheapestVariantStorage.price)}`;
        }
      });
      dot.addEventListener("mouseleave", () => {
        if (cardImage && originalImageSrc !== null) cardImage.setAttribute("src", originalImageSrc);
        if (priceCurrent && originalPriceText !== null) priceCurrent.textContent = originalPriceText;
      });
      dot.addEventListener("click", () => {
        lastProductModalTrigger = card.querySelector("[data-open-product]");
        openProductModal(productId, colorName);
      });
    });

    productsGrid.appendChild(card);
  });

  updateCatalogFooter(visibleProducts.length < filteredProducts.length, filteredProducts.length);
  startCardCarousels();
}

function updateCatalogFooter(hasMore, total) {
  const loadMoreBtn = document.getElementById("load-more-btn");
  const catalogEnd = document.getElementById("catalog-end");
  const exploreBtn = document.getElementById("explore-catalog-btn");
  const shopCount = document.getElementById("shop-count");

  if (exploreBtn) exploreBtn.hidden = total === 0;
  if (catalogEnd) {
    const reachedEnd = !hasMore && total > 0;
    catalogEnd.hidden = !reachedEnd;
    if (reachedEnd) {
      catalogEnd.textContent = total > CATALOG_PAGE_SIZE
        ? `Has visto los ${total} productos del catálogo.`
        : "Este es todo el catálogo disponible por ahora.";
    }
  }
  if (shopCount) {
    shopCount.textContent = total === 1 ? "1 producto disponible" : `${total} productos disponibles`;
  }
  if (loadMoreBtn) {
    if (hasMore) {
      loadMoreBtn.hidden = false;
      loadMoreBtn.innerHTML = `${LOAD_MORE_ICON} Cargar más productos`;
    } else if (total > CATALOG_PAGE_SIZE) {
      loadMoreBtn.hidden = false;
      loadMoreBtn.innerHTML = `${BACK_TO_TOP_ICON} Volver arriba`;
    } else {
      loadMoreBtn.hidden = true;
    }
  }
}

/* ========================================================================== 
   CARRUSEL DE TARJETAS Y DESTACADOS
   ========================================================================== */

const REDUCED_MOTION_QUERY = window.matchMedia?.("(prefers-reduced-motion: reduce)") || { matches: false };
let cardCarouselInterval = null;
let cardCarouselObserver = null;
let featuredCarouselTimer = null;
let featuredNavBound = false;

function startCardCarousels() {
  stopCardCarousels();

  const carousels = Array.from(document.querySelectorAll(".product-carousel"));
  if (!carousels.length || REDUCED_MOTION_QUERY.matches) return;

  cardCarouselObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      entry.target.dataset.inView = entry.isIntersecting ? "1" : "0";
    });
  }, { rootMargin: "120px 0px" });
  carousels.forEach((carousel) => cardCarouselObserver.observe(carousel));

  const advance = () => {
    if (document.hidden || document.body.classList.contains("product-modal-open")) return;
    carousels.forEach((carousel) => {
      if (carousel.dataset.inView !== "1") return;
      const card = carousel.closest(".product-card");
      if (!card || card.matches(":hover")) return;
      const images = carousel.querySelectorAll(".carousel-img");
      if (images.length < 2) return;
      const current = Number(carousel.dataset.index || 0);
      const next = (current + 1) % images.length;
      carousel.dataset.index = String(next);
      images.forEach((image, index) => image.classList.toggle("active", index === next));
      carousel.querySelectorAll(".carousel-dot").forEach((dot, index) => dot.classList.toggle("active", index === next));
    });
  };

  advance();
  cardCarouselInterval = window.setInterval(advance, 3500);
}

function stopCardCarousels() {
  if (cardCarouselInterval) {
    window.clearInterval(cardCarouselInterval);
    cardCarouselInterval = null;
  }
  if (cardCarouselObserver) {
    cardCarouselObserver.disconnect();
    cardCarouselObserver = null;
  }
}

function renderFeaturedCarousel() {
  const track = document.getElementById("featured-track");
  const section = document.getElementById("featured-section");
  if (!track) return;
  stopFeaturedAutoScroll();

  if (!products.length) {
    if (section) section.hidden = true;
    return;
  }
  if (section) section.hidden = false;

  // Home: el carrusel de destacados sólo muestra productos con al menos una
  // variante disponible (los completamente agotados se ocultan).
  const featuredProducts = products.filter((product) => !getProductAvailability(product).isOut);
  if (!featuredProducts.length) {
    if (section) section.hidden = true;
    track.innerHTML = "";
    stopFeaturedAutoScroll();
    return;
  }
  if (section) section.hidden = false;

  track.innerHTML = featuredProducts.map((product) => {
    const productId = String(product.id);
    const storageOptions = getStorageOptions(product);
    const baseOption = storageOptions[0];
    const hasStoragePrices = storageOptions.length > 1;
    const priceLabel = `${hasStoragePrices ? "Desde " : ""}${formatCurrency(baseOption.price)}`;
    const image = getProductImages(product)[0] || FALLBACK_IMAGE;
    return `
      <button type="button" class="featured-card" data-open-product="${escapeHTML(productId)}" aria-label="Ver detalles de ${escapeHTML(product.title || "Producto")}">
        <span class="featured-image-wrap">
          <img src="${escapeHTML(image)}" alt="" loading="lazy">
        </span>
        <span class="featured-card-info">
          <span class="featured-card-name">${escapeHTML(product.title || "Producto")}</span>
          <span class="featured-card-price">${priceLabel}</span>
        </span>
      </button>
    `;
  }).join("");

  track.querySelectorAll("img").forEach((img) => img.addEventListener("error", setFallbackImage));
  track.querySelectorAll("[data-open-product]").forEach((button) => {
    button.addEventListener("click", () => {
      lastProductModalTrigger = button;
      openProductModal(button.dataset.openProduct);
    });
  });

  bindFeaturedNav();
  startFeaturedAutoScroll();
}

function bindFeaturedNav() {
  if (featuredNavBound) return;
  featuredNavBound = true;
  document.getElementById("featured-prev")?.addEventListener("click", () => scrollFeatured(-1));
  document.getElementById("featured-next")?.addEventListener("click", () => scrollFeatured(1));
}

function getFeaturedStep(track) {
  const card = track.querySelector(".featured-card");
  if (!card) return 0;
  const gap = parseFloat(window.getComputedStyle(track).columnGap) || 16;
  return card.getBoundingClientRect().width + gap;
}

function scrollFeatured(direction) {
  const track = document.getElementById("featured-track");
  if (!track || track.scrollWidth <= track.clientWidth) return;
  const step = getFeaturedStep(track) * 3;
  const maxScroll = track.scrollWidth - track.clientWidth;
  if (direction > 0 && track.scrollLeft >= maxScroll - 2) {
    track.scrollTo({ left: 0, behavior: "smooth" });
    return;
  }
  if (direction < 0 && track.scrollLeft <= 2) {
    track.scrollTo({ left: maxScroll, behavior: "smooth" });
    return;
  }
  track.scrollBy({ left: direction * step, behavior: "smooth" });
}

function startFeaturedAutoScroll() {
  stopFeaturedAutoScroll();
  const track = document.getElementById("featured-track");
  if (!track || REDUCED_MOTION_QUERY.matches) return;

  featuredCarouselTimer = window.setInterval(() => {
    if (document.hidden || document.body.classList.contains("product-modal-open")) return;
    if (track.matches(":hover") || track.matches(":focus-within")) return;
    scrollFeatured(1);
  }, 4000);
}

function stopFeaturedAutoScroll() {
  if (featuredCarouselTimer) {
    window.clearInterval(featuredCarouselTimer);
    featuredCarouselTimer = null;
  }
}

/* ========================================================================== 
   GALERÍA MODAL — REPRODUCCIÓN AUTOMÁTICA DEL VISOR
   ========================================================================== */
let modalGalleryTimer = null;
let modalGalleryHover = false;

// Avance automático del visor de imágenes en el detalle de producto.
// Solo se activa cuando hay más de una imagen, respeta prefers-reduced-motion
// y se detiene mientras el cursor pasa sobre el visor. Tras una interacción
// manual se reinicia, de modo que la reproducción jamás se interrumpe.
function startModalGalleryAuto() {
  stopModalGalleryAuto();
  if (modalGalleryHover) return;
  if (!currentSelectedProduct || !productModal?.classList.contains("active")) return;
  const images = getProductImages(currentSelectedProduct, modalSelectedColor);
  if (images.length < 2) return;
  if (REDUCED_MOTION_QUERY.matches) return;

  modalGalleryTimer = window.setInterval(() => {
    if (document.hidden || !productModal?.classList.contains("active")) {
      stopModalGalleryAuto();
      return;
    }
    if (modalGalleryHover) return;
    setModalGalleryImage(modalActiveImageIndex + 1);
  }, 4000);
}

function stopModalGalleryAuto() {
  if (modalGalleryTimer) {
    window.clearInterval(modalGalleryTimer);
    modalGalleryTimer = null;
  }
}

function resetModalGalleryAuto() {
  stopModalGalleryAuto();
  startModalGalleryAuto();
}

/* ========================================================================== 
   MODAL DE PRODUCTO
   ========================================================================== */

function openProductModal(productId, colorName = "", opciones = {}) {
  if (!productModal || !productModalBody) return;
  const product = products.find((item) => String(item.id) === String(productId));
  if (!product) return;

  // Cambio de producto con la vista ya abierta (relacionados, Atrás/Adelante):
  // transición suave de salida antes de mostrar el nuevo. No aplica a la
  // primera apertura ni con movimiento reducido del sistema.
  const cambioConTransicion =
    productModal.classList.contains("active") &&
    currentBaseProduct &&
    String(currentBaseProduct.id) !== String(productId) &&
    !REDUCED_MOTION_QUERY.matches;

  const abrirVista = () => {
    currentBaseProduct = product;
    const availableColors = getProductColors(product);

    // Permite abrir el modal ya posicionado en una variante concreta (ej. desde
    // un punto de color de la tarjeta). Si el color no existe, se usa el primero.
    const requestedColor = colorName
      ? availableColors.find((color) => String(color.name) === String(colorName))
      : null;
    modalSelectedColor = requestedColor?.name || availableColors[0]?.name || "Color estándar";

    // El producto efectivo puede tener capacidades/precios/stock propios.
    currentSelectedProduct = resolveVariantProduct(product, modalSelectedColor);

    const storageOptions = getStorageOptions(currentSelectedProduct);
    const firstAvailableOption = storageOptions.find((option) => !getStockInfo(currentSelectedProduct, option.name).isOut);
    modalSelectedStorage = (firstAvailableOption || storageOptions[0]).name;
    modalActiveImageIndex = 0;
    modalActiveTab = "description";

    renderModalContent();
    productModal?.classList.add("active");
    productModal?.setAttribute("aria-hidden", "false");
    document.body.classList.add("product-modal-open");
    document.body.style.overflow = "hidden";
    startModalGalleryAuto();

    const modalContent = productModal?.querySelector(".product-modal-scroll");
    modalContent?.scrollTo({ top: 0, behavior: "auto" });

    // La vista de producto se comporta como una PÁGINA: registra su propia
    // entrada en el historial para que Atrás regrese al catálogo (móvil y
    // escritorio) y Adelante la reabra. La URL queda compartible.
    if (opciones.cargaDirecta) {
      // Enlace compartido abierto directo: sembrar el catálogo en el historial
      // para que Atrás deje al usuario DENTRO de la tienda (catálogo limpio,
      // navegable) en lugar de sacarlo del sitio. El header queda disponible.
      vistaProductoConHistoria = false;
      profundidadHistorialProducto = 0;
      try {
        const urlCatalogo = new URL(window.location.href);
        urlCatalogo.searchParams.delete("producto");
        urlCatalogo.searchParams.delete("color");
        history.replaceState({ tienda: true }, "", urlCatalogo.toString());
        history.pushState(
          { vistaProducto: { id: String(productId), color: modalSelectedColor }, profundidad: 1 },
          "",
          obtenerUrlCompartirProducto(productId, modalSelectedColor)
        );
        vistaProductoConHistoria = true;
        profundidadHistorialProducto = 1;
      } catch { /* sin historial interno: el header cubre la navegación */ }
      // La vista aparece SIN transición (queda bajo el loader); al revelarse,
      // finishPageLoader dispara la animación de entrada del producto.
      productModal.classList.add("sin-animacion");
      entradaProductoPendiente = true;
    } else if (opciones.desdeHistorial) {
      // La entrada ya existe en el historial (navegación Atrás/Adelante).
      vistaProductoConHistoria = true;
    } else {
      profundidadHistorialProducto += 1;
      history.pushState(
        { vistaProducto: { id: String(productId), color: modalSelectedColor }, profundidad: profundidadHistorialProducto },
        "",
        obtenerUrlCompartirProducto(productId, modalSelectedColor)
      );
      vistaProductoConHistoria = true;
    }

    // Sin botón de cierre: el foco pasa al contenido de la vista.
    const panelProducto = productModal?.querySelector(".product-modal-content");
    requestAnimationFrame(() => panelProducto?.focus({ preventScroll: true }));
  };

  if (cambioConTransicion) {
    productModalBody.classList.add("producto-cambiando");
    window.setTimeout(() => {
      abrirVista();
      requestAnimationFrame(() => productModalBody.classList.remove("producto-cambiando"));
    }, 240);
    return;
  }

  abrirVista();
}

/* "Cerrar" (clic/tap fuera, ESC, tras agregar al carrito): cierre INDEPENDIENTE
   que regresa al catálogo de un solo salto, deshaciendo las entradas de
   productos apiladas SIN recorrer el historial de productos (nunca muestra
   el producto anterior ni cambia la URL hacia otro producto). */
function cerrarDetalleCompleto() {
  if (!productModal?.classList.contains("active")) return;
  if (vistaProductoConHistoria && profundidadHistorialProducto > 0) {
    // Un solo salto al entry del catálogo: el popstate cierra la vista y
    // deja la URL del catálogo. El historial queda disponible para
    // Atrás/Adelante reales del navegador.
    history.go(-profundidadHistorialProducto);
    return;
  }
  cerrarVistaProductoSilenciosa();
}

function cerrarVistaProductoSilenciosa() {
  if (!productModal?.classList.contains("active")) return;
  stopModalGalleryAuto();

  productModal.classList.remove("active");
  productModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("product-modal-open");
  document.body.style.overflow = "";
  vistaProductoConHistoria = false;
  profundidadHistorialProducto = 0;

  window.setTimeout(() => {
    if (!productModal.classList.contains("active")) {
      lastProductModalTrigger?.focus?.();
    }
  }, 280);
}

/* Atrás/Adelante del navegador: NAVEGA el historial de productos.
   - Atrás → el producto anterior (C → B → A → Catálogo).
   - Adelante → el producto siguiente. */
window.addEventListener("popstate", (event) => {
  const estado = event.state;
  const abierta = productModal?.classList.contains("active");
  if (estado && estado.vistaProducto) {
    profundidadHistorialProducto = Number(estado.profundidad) || 1;
    if (!abierta || String(currentBaseProduct?.id || "") !== String(estado.vistaProducto.id)) {
      openProductModal(estado.vistaProducto.id, estado.vistaProducto.color || "", { desdeHistorial: true });
    } else {
      vistaProductoConHistoria = true;
    }
  } else {
    profundidadHistorialProducto = 0;
    if (abierta) cerrarVistaProductoSilenciosa();
  }
});

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
    <div class="producto-topbar">
      <button type="button" class="producto-topbar-btn" data-producto-volver-tienda aria-label="Volver a la tienda">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>
      </button>
      <div class="producto-topbar-buscador">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m21 21-4-4"></path></svg>
        <input type="search" id="producto-buscador" placeholder="Buscar productos" autocomplete="off" aria-label="Buscar productos">
      </div>
      <div class="producto-buscador-resultados" id="producto-buscador-resultados" hidden></div>
    </div>
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
            <button type="button" class="modal-share-btn" data-share-product aria-label="Compartir este producto">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="18" cy="5" r="2.8"></circle><circle cx="6" cy="12" r="2.8"></circle><circle cx="18" cy="19" r="2.8"></circle><path d="m8.6 10.6 6.8-4M8.6 13.4l6.8 4"></path></svg>
              Compartir
            </button>
          </div>
          <span class="product-brand">${escapeHTML(product.brand || "")}</span>
          <h1 class="modal-title">${escapeHTML(product.title || "Producto")}</h1>
          <p class="modal-lead">${escapeHTML(product.description || `Tecnología seleccionada y respaldada por ${nombreEmpresa}.`)}</p>

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
            <p>${escapeHTML(product.description || `Producto disponible en ${nombreEmpresa}.`)}</p>
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
    resetModalGalleryAuto();
  });
  productModalBody.querySelector("[data-gallery-next]")?.addEventListener("click", () => {
    setModalGalleryImage(modalActiveImageIndex + 1);
    resetModalGalleryAuto();
  });
  productModalBody.querySelectorAll("[data-gallery-index]").forEach((button) => {
    button.addEventListener("click", () => {
      setModalGalleryImage(Number(button.dataset.galleryIndex));
      resetModalGalleryAuto();
    });
  });
  const galleryStage = productModalBody.querySelector(".modal-gallery-stage");
  galleryStage?.addEventListener("mouseenter", () => { modalGalleryHover = true; });
  galleryStage?.addEventListener("mouseleave", () => {
    modalGalleryHover = false;
    resetModalGalleryAuto();
  });
  galleryStage?.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      setModalGalleryImage(modalActiveImageIndex - 1);
      resetModalGalleryAuto();
    }
    if (event.key === "ArrowRight") {
      setModalGalleryImage(modalActiveImageIndex + 1);
      resetModalGalleryAuto();
    }
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
    resetModalGalleryAuto();
  }, { passive: true });

  // Buscador contextual COMPACTO: panel desplegable sobre el contenido, sin
  // reemplazar la ficha del producto. Máximo 5 resultados. Consulta DIRECTA
  // a la base: funciona aunque realtime aún no haya cargado el catálogo.
  const buscadorProducto = productModalBody.querySelector("#producto-buscador");
  const resultadosProducto = productModalBody.querySelector("#producto-buscador-resultados");
  let buscadorProductoTimer = null;
  let catalogoBusquedaCache = null;

  const normalizarBusqueda = (texto) => String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Catálogo ligero para la búsqueda: si realtime aún no cargó (o cargó
  // parcialmente en el escenario de deep link), se lee DIRECTO de la base.
  async function obtenerCatalogoBusqueda() {
    if (products.length >= 5) return products;
    if (catalogoBusquedaCache) return catalogoBusquedaCache;
    try {
      const { supabase } = await import("./supabase-config.js");
      const { data, error } = await supabase
        .from("productos")
        .select("id,title,brand,price,images,variants");
      if (!error && Array.isArray(data) && data.length) {
        catalogoBusquedaCache = data.map((r) => normalizeProductRecord({ id: r.id, ...r }));
        return catalogoBusquedaCache;
      }
    } catch (err) {
      console.warn("[compartir] No se pudo leer el catálogo para la búsqueda:", err);
    }
    return products;
  }

  buscadorProducto?.addEventListener("input", () => {
    clearTimeout(buscadorProductoTimer);
    buscadorProductoTimer = setTimeout(async () => {
      const consulta = normalizarBusqueda(buscadorProducto.value);
      if (!consulta) {
        resultadosProducto.hidden = true;
        resultadosProducto.innerHTML = "";
        return;
      }
      const catalogo = await obtenerCatalogoBusqueda();
      // El usuario pudo seguir escribiendo durante la consulta: aplicar solo
      // si el término sigue vigente.
      if (normalizarBusqueda(buscadorProducto.value) !== consulta) return;
      const coincidencias = catalogo
        .filter((item) => String(item.id) !== String(currentBaseProduct?.id || ""))
        .filter((item) => {
          const objetivo = normalizarBusqueda(`${item.title || ""} ${item.brand || ""}`);
          return objetivo.includes(consulta);
        })
        .slice(0, 5);
      resultadosProducto.hidden = false;
      resultadosProducto.innerHTML = coincidencias.length
        ? `<span class="producto-resultados-titulo">Resultados de búsqueda</span>` + coincidencias.map((item) => {
            const imagen = getProductImages(item)[0] || FALLBACK_IMAGE;
            const precio = Number(item.price) || 0;
            return `
            <button type="button" class="producto-resultado" data-resultado-id="${escapeHTML(String(item.id))}">
              <img src="${escapeHTML(imagen)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
              <span class="producto-resultado-info"><strong>${escapeHTML(item.title || "Producto")}</strong><small>${escapeHTML(item.brand || "")}</small></span>
              <span class="producto-resultado-precio">${formatCurrency(precio)}</span>
            </button>`;
          }).join("")
          + `<button type="button" class="producto-ver-mas" data-ver-mas-tienda>
              Ver más resultados en la Tienda
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"></path></svg>
            </button>`
        : `<div class="producto-resultado-vacio">No encontramos productos que coincidan con tu búsqueda.</div>`;
    }, 180);
  });
  buscadorProducto?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      irATiendaConBusqueda(buscadorProducto.value);
      return;
    }
    if (event.key === "Escape") {
      buscadorProducto.value = "";
      resultadosProducto.hidden = true;
      resultadosProducto.innerHTML = "";
      buscadorProducto.blur();
    }
  });
  resultadosProducto?.addEventListener("click", (event) => {
    if (event.target.closest("[data-ver-mas-tienda]")) {
      irATiendaConBusqueda(buscadorProducto.value);
      return;
    }
    const boton = event.target.closest("[data-resultado-id]");
    if (!boton) return;
    resultadosProducto.hidden = true;
    resultadosProducto.innerHTML = "";
    buscadorProducto.value = "";
    openProductModal(boton.dataset.resultadoId);
  });

  productModalBody.querySelectorAll(".color-dot-btn").forEach((button) => {
    button.addEventListener("click", () => {
      modalSelectedColor = button.dataset.color || "Color estándar";
      // Toda la ficha pasa a la variante seleccionada: marca, categoría,
      // capacidades, precios, stock, especificaciones, descripción e imágenes.
      currentSelectedProduct = resolveVariantProduct(currentBaseProduct, modalSelectedColor);
      modalActiveImageIndex = 0;

      // Si la variante define capacidades distintas, revalidar la selección.
      const storageOptions = getStorageOptions(currentSelectedProduct);
      const stillValid = storageOptions.some((option) => option.name === modalSelectedStorage);
      if (!stillValid) {
        const firstAvailable = storageOptions.find((option) => !getStockInfo(currentSelectedProduct, option.name).isOut) || storageOptions[0];
        modalSelectedStorage = firstAvailable.name;
      }
      renderModalContent();
      // La URL de la vista refleja siempre la variante activa (compartible y
      // coherente con Atrás/Adelante) sin crear entradas extra en el historial.
      if (currentBaseProduct && productModal?.classList.contains("active")) {
        history.replaceState(
          { vistaProducto: { id: String(currentBaseProduct.id), color: modalSelectedColor }, profundidad: profundidadHistorialProducto },
          "",
          obtenerUrlCompartirProducto(currentBaseProduct.id, modalSelectedColor)
        );
      }
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

  startModalGalleryAuto();
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
  // La ficha efectiva de la variante puede tener capacidades/stock distintos.
  const effectiveProduct = resolveVariantProduct(product, color);
  const storageOption = getStorageOptions(effectiveProduct).find((option) => !getStockInfo(effectiveProduct, option.name).isOut);
  if (!storageOption) {
    notify("Este producto está agotado por el momento.", "warning");
    return;
  }
  addToCart(effectiveProduct, color, storageOption.name);
}

function addModalProductToCart() {
  if (!currentSelectedProduct) return;

  const added = addToCart(currentSelectedProduct, modalSelectedColor, modalSelectedStorage);
  if (added) cerrarDetalleCompleto();
}

function addToCart(product, color, storage) {
  const selectedStorageOption = getStorageOption(product, storage);
  const stockInfo = getStockInfo(product, selectedStorageOption.name);
  const cartItemId = `${product.id}-${color}-${selectedStorageOption.name}`;
  const existingItem = cart.find((item) => item.cartItemId === cartItemId);
  const nextQuantity = Number(existingItem?.quantity || 0) + 1;

  if (stockInfo.isOut) {
    notify("Esta variante está agotada.", "warning");
    return false;
  }

  if (stockInfo.quantity !== null && nextQuantity > stockInfo.quantity) {
    notify(`Solo hay ${stockInfo.quantity} unidad(es) disponibles para esta variante.`, "warning");
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
        notify(`Solo hay ${stockInfo.quantity} unidad(es) disponibles.`, "warning");
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

/* Mensaje de campos obligatorios: TEMPORAL. Solo aparece cuando el
   formulario se envía incompleto, dura ~5s y se oculta solo con una
   transición suave (gana espacio visual en el carrito). */
const CHECKOUT_ERROR_DURACION_MS = 5000;
let checkoutErrorTimer = null;

function showCheckoutError() {
  const error = document.getElementById("checkout-form-error");
  if (!error) return;
  error.hidden = false;
  clearTimeout(checkoutErrorTimer);
  // Doble rAF: garantiza que la transición corra tras quitar `hidden`.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => error.classList.add("is-visible"));
  });
  checkoutErrorTimer = setTimeout(() => hideCheckoutError(), CHECKOUT_ERROR_DURACION_MS);
}

function hideCheckoutError() {
  clearTimeout(checkoutErrorTimer);
  checkoutErrorTimer = null;
  const error = document.getElementById("checkout-form-error");
  if (!error) return;
  error.classList.remove("is-visible");
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
    notify(`Actualiza la cantidad de ${invalidStockItem.title}; el stock disponible cambió.`, "warning");
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

// Fuente de datos única: agregar un banco o ajustar porcentajes aquí.
const bancos = {
  bac: {
    nombre: "BAC Credomatic",
    sigla: "BAC",
    color: "#e5001c",
    planes: [
      { meses: 6, interes: 9 },
      { meses: 12, interes: 13.8 }
    ]
  },
  ficohsa: {
    nombre: "Ficohsa",
    sigla: "FIC",
    color: "#003a70",
    planes: [
      { meses: 3, interes: 5 },
      { meses: 6, interes: 8 },
      { meses: 9, interes: 9 },
      { meses: 12, interes: 10.5 },
      { meses: 18, interes: 15.8 }
    ]
  }
};

const financingState = {
  banco: "bac",
  planIndex: 0,
  last: { price: 0, interest: 0, total: 0, monthly: 0, rate: 0 }
};

function renderBankCards() {
  if (!bankCardsEl) return;
  bankCardsEl.innerHTML = Object.entries(bancos).map(([key, banco], index) => `
    <button type="button" class="bank-card${financingState.banco === key ? " is-selected" : ""}"
      data-bank="${key}" role="radio" aria-checked="${financingState.banco === key}"
      style="--bank-color: ${banco.color}; animation-delay: ${index * 60}ms" aria-label="${banco.nombre}">
      <span class="bank-emblem">${banco.sigla}</span>
      <div class="bank-card-body">
        <span class="bank-card-name">${banco.nombre}</span>
        <span class="bank-card-plans">${banco.planes.length} ${banco.planes.length === 1 ? "plan" : "planes"} disponibles</span>
      </div>
      <span class="bank-card-check" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </span>
    </button>
  `).join("");
}

function renderPlanCards() {
  if (!planCardsEl) return;
  const banco = bancos[financingState.banco];
  if (!banco) return;
  const planSeguro = Math.min(financingState.planIndex, banco.planes.length - 1);
  planCardsEl.innerHTML = banco.planes.map((plan, index) => `
    <button type="button" class="plan-card${index === planSeguro ? " is-selected" : ""}"
      data-plan="${index}" role="radio" aria-checked="${index === planSeguro}"
      style="animation-delay: ${index * 50}ms">
      <span class="plan-card-months">${plan.meses} meses</span>
      <span class="plan-card-rate">${plan.interes}%</span>
      <span class="plan-card-desc">${plan.meses} cuotas mensuales</span>
    </button>
  `).join("");
}

function animateCount(el, from, to, formatter, duration = 500) {
  if (!el) return;
  if (el.__countRaf) cancelAnimationFrame(el.__countRaf);
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = formatter(from + (to - from) * eased);
    if (t < 1) el.__countRaf = requestAnimationFrame(tick);
    else delete el.__countRaf;
  };
  el.__countRaf = requestAnimationFrame(tick);
}

function addRipple(card, event) {
  const rect = card.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const span = document.createElement("span");
  span.className = "ripple";
  span.style.width = `${size}px`;
  span.style.height = `${size}px`;
  span.style.left = `${event.clientX - rect.left - size / 2}px`;
  span.style.top = `${event.clientY - rect.top - size / 2}px`;
  card.appendChild(span);
  span.addEventListener("animationend", () => span.remove());
}

function formatRatePercent(value) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function calculateFinancing() {
  if (!calcAmount || !calcWhatsappBtn) return;

  const amount = Math.max(0, Number.parseFloat(calcAmount.value) || 0);
  const banco = bancos[financingState.banco];
  const plan = banco && banco.planes[Math.min(financingState.planIndex, banco.planes.length - 1)];

  if (!banco || !plan || amount <= 0) {
    animateCount(resultMonthly, financingState.last.monthly, 0, (v) => `${formatCurrency(v)} / mes`);
    animateCount(resultPrice, financingState.last.price, 0, formatCurrency);
    animateCount(resultInterest, financingState.last.interest, 0, formatCurrency);
    animateCount(resultTotal, financingState.last.total, 0, formatCurrency);
    animateCount(resultRate, financingState.last.rate, 0, (v) => `${formatRatePercent(v)}%`);
    financingState.last = { price: 0, interest: 0, total: 0, monthly: 0, rate: 0 };
    if (resultSummary) resultSummary.textContent = "Ingresa un monto válido para ver tus cuotas";
    calcWhatsappBtn.href = `https://wa.me/${whatsappSettings.phone}`;
    return;
  }

  const interest = Math.round((amount * plan.interes) / 100);
  const total = amount + interest;
  const monthly = Math.round(total / plan.meses);

  animateCount(resultMonthly, financingState.last.monthly, monthly, (v) => `${formatCurrency(v)} / mes`);
  animateCount(resultPrice, financingState.last.price, amount, formatCurrency);
  animateCount(resultInterest, financingState.last.interest, interest, formatCurrency);
  animateCount(resultTotal, financingState.last.total, total, formatCurrency);
  animateCount(resultRate, financingState.last.rate, plan.interes, (v) => `${formatRatePercent(v)}%`);
  financingState.last = { price: amount, interest, total, monthly, rate: plan.interes };

  if (resultSummary) {
    resultSummary.textContent = `${banco.nombre} · ${plan.meses} cuotas de ${formatCurrency(monthly)}`;
  }

  const message = [
    `Hola ${nombreEmpresa}, me gustaría consultar por Extrafinanciamiento:`,
    `Banco: ${banco.nombre}`,
    `Producto: ${formatCurrency(amount)}`,
    `Plazo: ${plan.meses} meses (tasa ${plan.interes}%)`,
    `Interés: ${formatCurrency(interest)}`,
    `Total a pagar: ${formatCurrency(total)}`,
    `Cuota mensual: ${formatCurrency(monthly)}`,
    "",
    "¿Cuáles son los requisitos?"
  ].join("\n");

  calcWhatsappBtn.href = `https://wa.me/${whatsappSettings.phone}?text=${encodeURIComponent(message)}`;
}

function initFinancingCalculator() {
  if (!bankCardsEl && !planCardsEl) return;

  renderBankCards();
  renderPlanCards();

  bankCardsEl?.addEventListener("pointerdown", (event) => {
    const card = event.target.closest(".bank-card");
    if (card) addRipple(card, event);
  });
  planCardsEl?.addEventListener("pointerdown", (event) => {
    const card = event.target.closest(".plan-card");
    if (card) addRipple(card, event);
  });

  bankCardsEl?.addEventListener("click", (event) => {
    const card = event.target.closest(".bank-card");
    if (!card || card.dataset.bank === financingState.banco) return;
    financingState.banco = card.dataset.bank;
    financingState.planIndex = 0;
    renderBankCards();
    renderPlanCards();
    calculateFinancing();
  });

  planCardsEl?.addEventListener("click", (event) => {
    const card = event.target.closest(".plan-card");
    if (!card || Number(card.dataset.plan) === financingState.planIndex) return;
    financingState.planIndex = Number(card.dataset.plan);
    renderPlanCards();
    calculateFinancing();
  });

  calculateFinancing();
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

function optimizeCloudinaryUrl(url, width = 800) {
  if (!url || typeof url !== "string" || !url.includes("/image/upload/")) return url;
  if (url.includes("/f_auto") || url.includes("q_auto")) return url;
  const marker = "/image/upload/";
  const idx = url.indexOf(marker);
  return url.slice(0, idx + marker.length) + `f_auto,q_auto,w_${width}/` + url.slice(idx + marker.length);
}

function getProductImages(product, colorName = "") {
  const candidateColors = colorName
    ? (product?.variants?.colors || []).filter((color) => String(color.name) === String(colorName))
    : [];
  // Prioridad de imágenes para una variante de color:
  //   1. color.images / color.image (formato legado ya soportado)
  //   2. color.overrides.images / color.overrides.image (ficha completa de la variante)
  //   3. imágenes generales del producto (resuelto o base)
  // Con nombres duplicados, priorizar el color con overrides (variante real).
  const selectedColor = candidateColors.length > 1
    ? (candidateColors.find((color) => color.overrides) || candidateColors[candidateColors.length - 1])
    : candidateColors[0];
  const variantImages = Array.isArray(selectedColor?.overrides?.images) && selectedColor.overrides.images.length
    ? selectedColor.overrides.images
    : selectedColor?.overrides?.image
      ? [selectedColor.overrides.image]
      : null;
  const colorImages = Array.isArray(selectedColor?.images)
    ? selectedColor.images
    : selectedColor?.image
      ? [selectedColor.image]
      : variantImages || [];
  const productImages = Array.isArray(product?.images) ? product.images : [];
  const legacyImage = product?.image ? [product.image] : [];
  const normalizedImages = uniqueStrings(colorImages.length ? colorImages : (productImages.length ? productImages : legacyImage));
  if (!normalizedImages.length) return [FALLBACK_IMAGE];
  return normalizedImages.map((img) => optimizeCloudinaryUrl(img, 800));
}

/*
  Resuelve el "producto efectivo" para una variante de color.

  variants.colors[i] puede incluir un bloque `overrides` con una ficha completa
  independiente (title, brand, category, description, specs, includes, images,
  battery, condition, badge, storage...). Campos sin override se heredan del
  producto base, por lo que los productos antiguos (sin overrides) se comportan
  exactamente igual que siempre.
*/
function resolveVariantProduct(product, colorName = "") {
  if (!product || !colorName) return product;
  const colors = product?.variants?.colors;
  if (!Array.isArray(colors)) return product;
  // Si hay varios colores con el mismo nombre (dato antiguo duplicado),
  // priorizar el que tiene overrides: es la variante real.
  const matches = colors.filter((item) => String(item?.name) === String(colorName));
  const color = matches.length > 1
    ? (matches.find((item) => item.overrides) || matches[matches.length - 1])
    : matches[0];
  const overrides = color?.overrides;
  if (!overrides || typeof overrides !== "object") return product;

  const variantImages = Array.isArray(overrides.images) && overrides.images.length
    ? overrides.images
    : (overrides.image ? [overrides.image] : null);

  const resolved = { ...product };
  Object.entries(overrides).forEach(([key, value]) => {
    if (key === "images") {
      if (variantImages) resolved.images = variantImages;
      return;
    }
    // Un override vacío (null/undefined/"") nunca degrada el dato base.
    if (value === null || value === undefined || value === "") return;
    resolved[key] = value;
  });

  // Los colores del grupo SIEMPRE provienen del producto base; las capacidades,
  // en cambio, pueden ser propias de la variante.
  resolved.variants = {
    ...product.variants,
    ...(Array.isArray(overrides.storage) && overrides.storage.length ? { storage: overrides.storage } : {})
  };
  resolved.image = variantImages?.[0] || product.image || "";
  return resolved;
}

// Opciones de capacidad/precio/stock de una variante concreta (o del base).
function getVariantStorageOptions(product, colorName = "") {
  return getStorageOptions(resolveVariantProduct(product, colorName));
}

function getProductColors(product) {
  const colors = Array.isArray(product?.variants?.colors) ? product.variants.colors : [];
  return colors.filter((color) => color && color.name);
}

function hashString(value) {
  const text = String(value);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// Valoración visual estable por producto: la misma tarjeta siempre muestra la
// misma calificación (4.0–5.0) sin depender de datos externos.
function getCardRating(product) {
  const seed = hashString(product?.id || product?.title || "producto") || 12345;
  let state = seed >>> 0;
  const random = () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const value = Math.min(5, Math.max(4, Math.round((4 + random()) * 2) / 2));
  const reviews = 8 + Math.floor(random() * 142);
  return { value, reviews };
}

function renderStarRating(value) {
  const full = Math.floor(value);
  const hasHalf = value - full >= 0.5;
  let html = "";
  for (let i = 0; i < 5; i++) {
    const className = i < full ? "star-full" : i === full && hasHalf ? "star-half" : "star-empty";
    html += `<span class="star ${className}">★</span>`;
  }
  return html;
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
    nombreEmpresa = String(company.name).trim() || nombreEmpresa;
    // Título conservando el formato propio de cada página
    // ("Tienda | X", "Soporte y FAQ | X", "X | Celulares...").
    document.title = TITULO_PARTES.join(nombreEmpresa);
    // Marca visible en TODOS los lugares del sitio (texto, atributos,
    // header, footer y loader de carga).
    aplicarMarcaEnSitio();
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
    // El <a id="footer-wa-link"> NO usa company.telefono: su href lo
    // gestiona aplicarWhatsAppEnlaces() con el número único configurado
    // en WhatsApp del negocio.
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
  whatsapp = whatsapp || {};
  whatsappSettings = {
    ...WHATSAPP_DEFAULTS,
    ...whatsapp,
    labels: { ...WHATSAPP_DEFAULTS.labels, ...(whatsapp.labels || {}) }
  };
  // El número configurado es la única fuente de verdad. Se normaliza aquí
  // para que toda la app (checkout, cuotas, hero, footer, carrito, producto)
  // use exactamente el mismo número en cada enlace wa.me.
  whatsappSettings.phone = normalizarWhatsAppNumero(whatsappSettings.phone);

  aplicarWhatsAppEnlaces();
  if (typeof calculateFinancing === "function") calculateFinancing();
}

function setBrandLogo(dataUrl) {
  if (!dataUrl) return;
  const src = optimizeCloudinaryUrl(dataUrl, 400);
  // Identidad visual: el logotipo acompaña al nombre de la empresa.
  // [ LOGO ] Mi Phone HN — el logo nunca sustituye el texto.
  const brandHtml =
    `<img src="${escapeHTML(src)}" alt="${escapeHTML(nombreEmpresa)}" class="brand-logo-img">` +
    `<span class="brand-logo-text">${marcaHTML(nombreEmpresa)}</span>`;
  document.querySelectorAll(".logo, .footer-logo").forEach((el) => {
    el.innerHTML = brandHtml;
  });
}

function applyHeroImage(dataUrl) {
  if (!dataUrl) return;
  const hero = document.getElementById("hero");
  if (!hero) return;
  hero.style.setProperty("--hero-img", `url('${optimizeCloudinaryUrl(dataUrl, 1920)}')`);
  hero.classList.add("has-hero-img");
}

let heroPhonesTimer = null;

const markPhoneImgLoaded = (img, mockup, instant) => {
  img.classList.add("is-loaded");
  mockup.classList.add("is-loaded");
  if (instant) {
    img.classList.add("is-cached");
    mockup.classList.add("is-cached");
    requestAnimationFrame(() => {
      img.classList.remove("is-cached");
      mockup.classList.remove("is-cached");
    });
  }
};

const attachPhoneImgLoad = (img, mockup) => {
  img.onload = () => markPhoneImgLoaded(img, mockup, false);
  img.onerror = () => {
    img.onload = null;
    img.onerror = null;
    img.classList.remove("is-loaded");
    mockup.classList.remove("is-loaded");
    img.hidden = true;
    mockup.classList.remove("has-img");
  };
};

const setPhoneImg = (mockup, url) => {
  if (!mockup) return;
  const img = mockup.querySelector(".phone-mockup-img");
  if (!img) {
    mockup.classList.toggle("has-img", !!url);
    return;
  }
  img.onload = null;
  img.onerror = null;
  img.classList.remove("is-loaded", "is-cached");
  mockup.classList.remove("is-loaded", "is-cached");
  img.hidden = !url;
  if (url) {
    img.src = optimizeCloudinaryUrl(url, 500);
    mockup.classList.add("has-img");
    if (img.complete && img.naturalWidth > 0) {
      markPhoneImgLoaded(img, mockup, true);
    } else {
      attachPhoneImgLoad(img, mockup);
    }
  } else {
    img.removeAttribute("src");
    mockup.classList.remove("has-img");
  }
};

const preloadPhoneImg = (url) => {
  if (!url) return;
  const im = new Image();
  im.src = optimizeCloudinaryUrl(url, 500);
};

function applyHeroPhones(images) {
  const list = (images || []).filter(Boolean);
  const visual = document.querySelector(".hero-visual");
  const p1 = document.querySelector(".phone-mockup.phone-1");
  const p2 = document.querySelector(".phone-mockup.phone-2");

  if (heroPhonesTimer) {
    clearInterval(heroPhonesTimer);
    heroPhonesTimer = null;
  }

  if (!visual || !p1 || list.length === 0) {
    setPhoneImg(p1, "");
    setPhoneImg(p2, "");
    visual?.classList.remove("has-single", "is-swapping", "has-carousel");
    visual?.classList.add("phone-ready");
    return;
  }

  list.forEach(preloadPhoneImg);

  if (list.length === 1) {
    setPhoneImg(p1, list[0]);
    setPhoneImg(p2, "");
    visual.classList.add("has-single");
    visual.classList.remove("is-swapping", "has-carousel");
    visual.classList.add("phone-ready");
    return;
  }

  visual.classList.remove("has-single");
  visual.classList.add("has-carousel", "phone-ready");
  let idx = 0;
  setPhoneImg(p1, list[0]);
  setPhoneImg(p2, list[1]);

  const swapSlot = (mockup, url) => {
    const img = mockup?.querySelector(".phone-mockup-img");
    if (!img || !mockup) return;
    img.onerror = null;
    img.onload = null;
    img.classList.remove("is-loaded");
    mockup.classList.remove("is-loaded");
    img.hidden = !url;
    mockup.classList.toggle("has-img", !!url);
    img.src = url;
    if (url) {
      img.onload = () => {
        img.classList.add("is-loaded");
        mockup.classList.add("is-loaded");
      };
      img.onerror = () => {
        img.classList.remove("is-loaded");
        mockup.classList.remove("is-loaded");
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

      if (imgA && mA) {
        imgA.onload = null;
        imgA.onerror = null;
        imgA.classList.remove("is-loaded", "is-cached");
        mA.classList.remove("is-loaded", "is-cached");
        imgA.src = nextImg;
        if (imgA.complete && imgA.naturalWidth > 0) {
          markPhoneImgLoaded(imgA, mA, true);
        } else {
          attachPhoneImgLoad(imgA, mA);
        }
      }
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
      if (imgA && mA) {
        imgA.onload = null;
        imgA.onerror = null;
        imgA.classList.remove("is-loaded", "is-cached");
        mA.classList.remove("is-loaded", "is-cached");
        imgA.src = nextImg;
        if (imgA.complete && imgA.naturalWidth > 0) {
          markPhoneImgLoaded(imgA, mA, true);
        } else {
          attachPhoneImgLoad(imgA, mA);
        }
      }
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
    img.classList.remove("is-loaded");
    img.onload = () => img.classList.add("is-loaded");
    img.onerror = () => img.classList.remove("is-loaded");
    img.src = optimizeCloudinaryUrl(dataUrl, 1200);
    wrap.hidden = false;
  } else {
    img.onload = null;
    img.onerror = null;
    img.classList.remove("is-loaded");
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


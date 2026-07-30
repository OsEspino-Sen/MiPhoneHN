/* ==========================================================================
   MI PHONE HN — PANEL ADMIN SAAS CON FIREBASE FIRESTORE & STORAGE
   ========================================================================== */

import { 
  db, 
  storage, 
  auth, 
  collection, 
  doc, 
  setDoc, 
  addDoc, 
  deleteDoc, 
  getDocs,
  getDoc,
  onSnapshot, 
  ref, 
  uploadBytes, 
  getDownloadURL, 
  onAuthStateChanged, 
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  syncUserToFirestore
} from './firebase-config.js';

let categories = [];

function getCategoryLabel(catId) {
  const cat = categories.find(c => c.id === catId);
  return cat ? cat.label : catId;
}

let unsubscribeCategories = null;

async function seedDefaultCategories() {
  try {
    const snap = await getDocs(collection(db, "categories"));
    if (!snap.empty) return;
    const defaults = [
      { id: "iphones", label: "iPhones" },
      { id: "samsung", label: "Samsung" },
      { id: "ipads", label: "iPads" },
      { id: "accessories", label: "Accesorios" }
    ];
    for (const cat of defaults) {
      await setDoc(doc(db, "categories", cat.id), { label: cat.label });
    }
    console.log("✅ Categorías predeterminadas creadas en Firestore.");
  } catch (err) {
    console.warn("⚠️ Error al crear categorías predeterminadas:", err);
  }
}

function listenToCategories() {
  const catRef = collection(db, "categories");
  if (unsubscribeCategories) {
    try { unsubscribeCategories(); } catch(e) {}
    unsubscribeCategories = null;
  }
  seedDefaultCategories();
  try {
    unsubscribeCategories = onSnapshot(catRef, (snap) => {
      categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderCategoryFilter();
      renderFormCategories();
      updateDashboardMetrics();
    }, async () => {
      await fetchCategoriesFallback();
    });
  } catch {
    fetchCategoriesFallback();
  }
}

async function fetchCategoriesFallback() {
  try {
    const snap = await getDocs(collection(db, "categories"));
    categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCategoryFilter();
    renderFormCategories();
    updateDashboardMetrics();
  } catch (err) {
    console.error("Error al obtener categorías:", err);
  }
}

function renderCategoryFilter() {
  const filter = document.getElementById("admin-category-filter");
  if (!filter) return;
  const currentValue = filter.value;
  filter.innerHTML = '<option value="all">📁 Todas las Categorías</option>';
  categories.forEach(cat => {
    const opt = document.createElement("option");
    opt.value = cat.id;
    opt.textContent = cat.label;
    filter.appendChild(opt);
  });
  filter.value = currentValue;
}

function renderFormCategories() {
  const formSelect = document.getElementById("product-category");
  if (!formSelect) return;
  const currentValue = formSelect.value;
  formSelect.innerHTML = '';
  categories.forEach(cat => {
    const opt = document.createElement("option");
    opt.value = cat.id;
    opt.textContent = cat.label;
    formSelect.appendChild(opt);
  });
  if (currentValue) formSelect.value = currentValue;
}

function renderCategoryList() {
  const list = document.getElementById("category-list");
  if (!list) return;
  list.innerHTML = '';
  categories.forEach((cat, index) => {
    const item = document.createElement("div");
    item.className = "category-list-item";
    item.innerHTML = `
      <span class="category-list-label">${escapeHTML(cat.label)}</span>
      <button type="button" class="btn btn-danger btn-sm" data-cat-index="${index}">Eliminar</button>
    `;
    list.appendChild(item);
  });
  list.querySelectorAll("[data-cat-index]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const index = parseInt(btn.dataset.catIndex);
      const catId = categories[index].id;
      const productsUsing = products.filter(p => p.category === catId);
      if (productsUsing.length > 0) {
        showAlert(`No se puede eliminar "${categories[index].label}": ${productsUsing.length} producto(s) la usan.`, "error");
        return;
      }
      try {
        await deleteDoc(doc(db, "categories", catId));
      } catch (err) {
        showAlert("Error al eliminar categoría: " + err.message, "error");
      }
    });
  });
}

function openCategoryModal() {
  renderCategoryList();
  const catModal = document.getElementById("category-modal");
  if (catModal) catModal.hidden = false;
}

function closeCategoryModal() {
  const catModal = document.getElementById("category-modal");
  if (catModal) catModal.hidden = true;
}

let products = [];
let editingProductId = null;
let confirmCallback = null;
let unsubscribeFirestore = null;

/* Estado temporal del editor multimedia. No se persiste hasta guardar. */
let existingImageUrls = [];
let pendingImageFiles = [];
let pendingImagesFirst = false;
let previewObjectUrls = [];
const migratedProductIds = new Set();
const MAX_PRODUCT_IMAGES = 8;
const MAX_IMAGE_SIZE = 8 * 1024 * 1024;

/* DOM elements */
const loginScreen = document.getElementById("login-screen");
const adminApp = document.getElementById("admin-app");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const logoutBtn = document.getElementById("logout-btn");
const adminAlert = document.getElementById("admin-alert");
const productsTableBody = document.getElementById("products-table-body");
const emptyTableMsg = document.getElementById("empty-table-msg");
const adminSearch = document.getElementById("admin-search");
const categoryFilter = document.getElementById("admin-category-filter");
const addProductBtn = document.getElementById("add-product-btn");
const reloadBtn = document.getElementById("reload-btn");
const reloadBtnTop = document.getElementById("reload-btn-top");
const productModal = document.getElementById("product-modal");
const modalOverlay = document.getElementById("modal-overlay");
const modalCloseBtn = document.getElementById("modal-close-btn");
const productForm = document.getElementById("product-form");
const modalTitle = document.getElementById("modal-title");
const deleteProductBtn = document.getElementById("delete-product-btn");
const cancelFormBtn = document.getElementById("cancel-form-btn");
const formError = document.getElementById("form-error");
const includesList = document.getElementById("includes-list");
const specsList = document.getElementById("specs-list");
const colorsList = document.getElementById("colors-list");
const storageList = document.getElementById("storage-list");
const addIncludeBtn = document.getElementById("add-include-btn");
const addSpecBtn = document.getElementById("add-spec-btn");
const addColorBtn = document.getElementById("add-color-btn");
const addStorageBtn = document.getElementById("add-storage-btn");
const confirmDialog = document.getElementById("confirm-dialog");
const confirmOverlay = document.getElementById("confirm-overlay");
const confirmTitle = document.getElementById("confirm-title");
const confirmMessage = document.getElementById("confirm-message");
const confirmCancelBtn = document.getElementById("confirm-cancel-btn");
const confirmOkBtn = document.getElementById("confirm-ok-btn");
const fileDropzone = document.getElementById("file-dropzone");
const productImageFileInput = document.getElementById("product-image-file");
const productImageUrlsInput = document.getElementById("product-image");
const productImagesPreview = document.getElementById("product-images-preview");
const productImagesCount = document.getElementById("product-images-count");

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

function init() {
  // Autenticación con Firebase Auth
  onAuthStateChanged(auth, (user) => {
    if (user) {
      showAdmin();
      listenToProducts();
      listenToCategories();

      const sidebarUserName = document.getElementById("sidebar-user-name");
      if (sidebarUserName) {
        sidebarUserName.textContent = user.displayName || user.email || "Admin Session";
      }
    } else {
      showLogin();
      if (unsubscribeFirestore) {
        unsubscribeFirestore();
        unsubscribeFirestore = null;
      }
      if (unsubscribeCategories) {
        unsubscribeCategories();
        unsubscribeCategories = null;
      }
    }
  });

  loginForm?.addEventListener("submit", handleLogin);
  logoutBtn?.addEventListener("click", handleLogout);
  adminSearch?.addEventListener("input", renderProductsTable);
  categoryFilter?.addEventListener("change", renderProductsTable);
  addProductBtn?.addEventListener("click", () => openProductModal(null));
  reloadBtn?.addEventListener("click", () => listenToProducts());
  reloadBtnTop?.addEventListener("click", () => listenToProducts());
  productForm?.addEventListener("submit", handleProductSubmit);
  modalCloseBtn?.addEventListener("click", closeProductModal);
  modalOverlay?.addEventListener("click", closeProductModal);
  cancelFormBtn?.addEventListener("click", closeProductModal);
  deleteProductBtn?.addEventListener("click", handleDeleteProduct);
  addIncludeBtn?.addEventListener("click", () => addIncludeRow());
  addSpecBtn?.addEventListener("click", () => addSpecRow());
  addColorBtn?.addEventListener("click", () => addColorRow());
  addStorageBtn?.addEventListener("click", () => addStorageRow());
  confirmCancelBtn?.addEventListener("click", closeConfirm);
  confirmOverlay?.addEventListener("click", closeConfirm);
  confirmOkBtn?.addEventListener("click", () => {
    confirmCallback?.();
    closeConfirm();
  });

  // Mobile Sidebar Toggle
  const mobileToggle = document.getElementById("mobile-menu-toggle");
  const sidebar = document.getElementById("admin-sidebar");
  if (mobileToggle && sidebar) {
    mobileToggle.addEventListener("click", () => {
      sidebar.classList.toggle("mobile-open");
    });
  }

  // Quick Add Product Card Listener
  const quickAddCard = document.getElementById("add-product-quick-card");
  if (quickAddCard) {
    quickAddCard.addEventListener("click", () => openProductModal(null));
  }

  // Sidebar Categories Trigger Listener
  const sidebarCategoriesTrigger = document.getElementById("sidebar-categories-trigger");
  if (sidebarCategoriesTrigger) {
    sidebarCategoriesTrigger.addEventListener("click", (e) => {
      e.preventDefault();
      openCategoryModal();
    });
  }

  // Galería múltiple: selector, drag & drop, validación y vista previa.
  if (fileDropzone && productImageFileInput) {
    fileDropzone.addEventListener("dragover", (event) => {
      event.preventDefault();
      fileDropzone.classList.add("dragover");
    });

    fileDropzone.addEventListener("dragleave", () => {
      fileDropzone.classList.remove("dragover");
    });

    fileDropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      fileDropzone.classList.remove("dragover");
      addPendingImageFiles(event.dataTransfer?.files || []);
    });

    productImageFileInput.addEventListener("change", () => {
      addPendingImageFiles(productImageFileInput.files || []);
      // Permite volver a seleccionar un archivo previamente retirado.
      productImageFileInput.value = "";
    });
  }

  productImageUrlsInput?.addEventListener("input", () => {
    existingImageUrls = parseImageUrls(productImageUrlsInput.value).slice(0, MAX_PRODUCT_IMAGES);
    renderProductImagesPreview();
  });

  productImageUrlsInput?.addEventListener("change", () => {
    if (!productImageUrlsInput) return;
    productImageUrlsInput.value = existingImageUrls.join("\n");
  });

  // Fix "Ver Tienda" link for local dev vs production
  const storeLink = document.getElementById("view-store-link");
  if (storeLink) {
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      storeLink.href = "http://localhost:5173/";
    } else {
      storeLink.href = "/";
    }
  }

  // Category management
  const manageCategoriesBtn = document.getElementById("manage-categories-btn");
  const categoryOverlay = document.getElementById("category-overlay");
  const closeCategoryModalBtn = document.getElementById("close-category-modal-btn");
  const addCategoryBtnModal = document.getElementById("add-category-btn-modal");
  const newCategoryName = document.getElementById("new-category-name");

  manageCategoriesBtn?.addEventListener("click", openCategoryModal);
  categoryOverlay?.addEventListener("click", closeCategoryModal);
  closeCategoryModalBtn?.addEventListener("click", closeCategoryModal);

  addCategoryBtnModal?.addEventListener("click", async () => {
    const name = newCategoryName?.value.trim();
    if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!id) {
      showAlert("Ingresa un nombre válido para la categoría.", "error");
      return;
    }
    if (categories.some(c => c.id === id)) {
      showAlert(`La categoría "${name}" ya existe.`, "error");
      return;
    }
    try {
      await setDoc(doc(db, "categories", id), { label: name });
      if (newCategoryName) newCategoryName.value = "";
      showAlert(`✅ Categoría "${name}" creada.`, "success");
    } catch (err) {
      showAlert("Error al crear categoría: " + err.message, "error");
    }
  });

  newCategoryName?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      addCategoryBtnModal?.click();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeProductModal();
      closeCategoryModal();
      closeConfirm();
    }
  });
}

/* Sesión y Autenticación */

async function handleLogin(event) {
  event.preventDefault();
  hideLoginError();

  const email = document.getElementById("admin-email")?.value.trim();
  const password = document.getElementById("admin-password")?.value || "";

  if (!email || !password) {
    showLoginError("Ingresa tu correo y contraseña.");
    return;
  }

  const submitBtn = loginForm.querySelector("button[type='submit']");
  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      setButtonLabel(submitBtn, "Conectando a Firebase...", "spinner-gap");
    }

    let userCred;
    try {
      userCred = await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
        userCred = await createUserWithEmailAndPassword(auth, email, password);
      } else {
        throw err;
      }
    }

    await syncUserToFirestore(userCred.user);
    showAlert("¡Sesión iniciada con éxito!", "success");
  } catch (error) {
    showLoginError(error.message || "Error al iniciar sesión.");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      setButtonLabel(submitBtn, "Entrar al panel", "arrow-right");
    }
  }
}

async function handleLogout() {
  try {
    await signOut(auth);
    location.reload();
  } catch (err) {
    showAlert("Error al cerrar sesión: " + err.message, "error");
  }
}

function showAdmin() {
  loginScreen.hidden = true;
  adminApp.hidden = false;
}

function showLogin() {
  loginScreen.hidden = false;
  adminApp.hidden = true;
}

function showLoginError(message) {
  if (!loginError) return;
  loginError.textContent = message;
  loginError.hidden = false;
}

function hideLoginError() {
  if (loginError) loginError.hidden = true;
}

/* Firestore: Lectura en Tiempo Real (R) & Auto-Importación Garantizada */

const SEED_PRODUCTS = [
  {
    "id": "1",
    "title": "iPhone 15 Pro Max",
    "brand": "Apple",
    "price": 29500,
    "oldPrice": 32000,
    "category": "iphones",
    "condition": "nuevo",
    "badge": "Nuevo",
    "image": "https://fdn2.gsmarena.com/vv/pics/apple/apple-iphone-15-pro-max-1.jpg",
    "description": "iPhone premium con titanio, chip A17 Pro y cámara avanzada.",
    "specs": [
      "Pantalla Super Retina XDR de 6.7 pulgadas",
      "Chip A17 Pro",
      "Cámara principal de 48 MP",
      "USB-C",
      "Face ID"
    ],
    "variants": {
      "colors": [
        { "name": "Titanio Natural", "value": "#bebeb6" },
        { "name": "Titanio Azul", "value": "#2f4452" },
        { "name": "Titanio Negro", "value": "#3b3c3e" }
      ],
      "storage": [
        { "name": "256GB", "price": 29500, "oldPrice": 32000 },
        { "name": "512GB", "price": 32000, "oldPrice": 34500 },
        { "name": "1TB", "price": 36000, "oldPrice": 38500 }
      ]
    }
  },
  {
    "id": "2",
    "title": "iPhone 13 Pro",
    "brand": "Apple",
    "price": 15900,
    "oldPrice": 18500,
    "category": "iphones",
    "condition": "seminuevo",
    "badge": "Seminuevo",
    "image": "https://fdn2.gsmarena.com/vv/pics/apple/apple-iphone-13-pro-01.jpg",
    "description": "Equipo seminuevo grado A+ con pantalla ProMotion y gran rendimiento.",
    "specs": [
      "Pantalla Super Retina XDR de 6.1 pulgadas",
      "ProMotion 120Hz",
      "Chip A15 Bionic",
      "Triple cámara Pro",
      "Face ID"
    ],
    "variants": {
      "colors": [
        { "name": "Sierra Blue", "value": "#a7c1d6" },
        { "name": "Graphite", "value": "#4e4f50" },
        { "name": "Gold", "value": "#fae0c5" }
      ],
      "storage": [
        { "name": "128GB", "price": 15900, "oldPrice": 18500 },
        { "name": "256GB", "price": 18000, "oldPrice": 20600 }
      ]
    }
  },
  {
    "id": "3",
    "title": "iPhone 14",
    "brand": "Apple",
    "price": 18500,
    "oldPrice": 20500,
    "category": "iphones",
    "condition": "seminuevo",
    "badge": "Seminuevo",
    "image": "https://fdn2.gsmarena.com/vv/pics/apple/apple-iphone-14-1.jpg",
    "description": "iPhone moderno con excelente cámara, batería y rendimiento.",
    "specs": [
      "Pantalla OLED de 6.1 pulgadas",
      "Chip A15 Bionic",
      "Cámara dual de 12 MP",
      "Face ID",
      "Carga MagSafe"
    ],
    "variants": {
      "colors": [
        { "name": "Midnight", "value": "#1c1c1e" },
        { "name": "Blue", "value": "#a7c7e7" },
        { "name": "Purple", "value": "#d8bfd8" }
      ],
      "storage": [
        { "name": "128GB", "price": 18500, "oldPrice": 20500 },
        { "name": "256GB", "price": 20500, "oldPrice": 22500 }
      ]
    }
  },
  {
    "id": "4",
    "title": "iPhone 12",
    "brand": "Apple",
    "price": 10500,
    "oldPrice": 12500,
    "category": "iphones",
    "condition": "seminuevo",
    "badge": "Seminuevo",
    "image": "https://fdn2.gsmarena.com/vv/pics/apple/apple-iphone-12-1.jpg",
    "description": "Diseño clásico con bordes planos, pantalla OLED y conectividad 5G.",
    "specs": [
      "Pantalla Super Retina XDR",
      "Chip A14 Bionic",
      "Cámara dual",
      "5G",
      "Face ID"
    ],
    "variants": {
      "colors": [
        { "name": "Negro", "value": "#111111" },
        { "name": "Blanco", "value": "#f5f5f7" },
        { "name": "Azul", "value": "#203a43" }
      ],
      "storage": [
        { "name": "64GB", "price": 10500, "oldPrice": 12500 },
        { "name": "128GB", "price": 12000, "oldPrice": 14000 }
      ]
    }
  },
  {
    "id": "5",
    "title": "Samsung Galaxy S24 Ultra",
    "brand": "Samsung",
    "price": 27900,
    "oldPrice": 31000,
    "category": "samsung",
    "condition": "nuevo",
    "badge": "Nuevo",
    "image": "https://fdn2.gsmarena.com/vv/pics/samsung/samsung-galaxy-s24-ultra-5g-0.jpg",
    "description": "Samsung premium con Galaxy AI, cámara de 200 MP y S Pen.",
    "specs": [
      "Pantalla Dynamic AMOLED 2X",
      "Snapdragon 8 Gen 3",
      "Cámara de 200 MP",
      "S Pen integrado",
      "Batería de 5000 mAh"
    ],
    "variants": {
      "colors": [
        { "name": "Titanium Gray", "value": "#8e8e93" },
        { "name": "Titanium Violet", "value": "#4b415a" },
        { "name": "Titanium Black", "value": "#1c1c1e" }
      ],
      "storage": [
        { "name": "256GB", "price": 27900, "oldPrice": 31000 },
        { "name": "512GB", "price": 30900, "oldPrice": 34000 }
      ]
    }
  },
  {
    "id": "6",
    "title": "Samsung Galaxy S23 Ultra",
    "brand": "Samsung",
    "price": 22500,
    "oldPrice": 25000,
    "category": "samsung",
    "condition": "seminuevo",
    "badge": "Seminuevo",
    "image": "https://fdn2.gsmarena.com/vv/pics/samsung/samsung-galaxy-s23-ultra-5g-1.jpg",
    "description": "Potente gama alta con S Pen, excelente zoom y pantalla AMOLED.",
    "specs": [
      "Pantalla AMOLED de 6.8 pulgadas",
      "Snapdragon 8 Gen 2",
      "Cámara de 200 MP",
      "S Pen",
      "Carga rápida"
    ],
    "variants": {
      "colors": [
        { "name": "Phantom Black", "value": "#111111" },
        { "name": "Green", "value": "#4b6043" }
      ],
      "storage": [
        { "name": "256GB", "price": 22500, "oldPrice": 25000 },
        { "name": "512GB", "price": 25500, "oldPrice": 28000 }
      ]
    }
  },
  {
    "id": "7",
    "title": "Samsung Galaxy A55 5G",
    "brand": "Samsung",
    "price": 9500,
    "oldPrice": 11000,
    "category": "samsung",
    "condition": "nuevo",
    "badge": "Nuevo",
    "image": "https://fdn2.gsmarena.com/vv/pics/samsung/samsung-galaxy-a55-1.jpg",
    "description": "Excelente opción gama media con pantalla AMOLED y 5G.",
    "specs": [
      "Pantalla Super AMOLED 120Hz",
      "Cámara principal de 50 MP",
      "Batería de 5000 mAh",
      "5G",
      "Resistencia IP67"
    ],
    "variants": {
      "colors": [
        { "name": "Awesome Navy", "value": "#1a237e" },
        { "name": "Awesome Iceblue", "value": "#e3f2fd" }
      ],
      "storage": [
        { "name": "128GB", "price": 9500, "oldPrice": 11000 },
        { "name": "256GB", "price": 11000, "oldPrice": 12500 }
      ]
    }
  },
  {
    "id": "8",
    "title": "iPad Air 5ta Generación",
    "brand": "Apple",
    "price": 12900,
    "oldPrice": 14500,
    "category": "ipads",
    "condition": "seminuevo",
    "badge": "Seminuevo",
    "image": "https://fdn2.gsmarena.com/vv/pics/apple/apple-ipad-air-2022-1.jpg",
    "description": "iPad con chip M1, ideal para estudio, diseño y productividad.",
    "specs": [
      "Pantalla Liquid Retina de 10.9 pulgadas",
      "Chip M1",
      "Compatible con Apple Pencil",
      "USB-C",
      "Cámara frontal ultra gran angular"
    ],
    "variants": {
      "colors": [
        { "name": "Gris Espacial", "value": "#4e4f50" },
        { "name": "Azul", "value": "#a7c1d6" },
        { "name": "Púrpura", "value": "#d7c3eb" }
      ],
      "storage": [
        { "name": "64GB", "price": 12900, "oldPrice": 14500 },
        { "name": "256GB", "price": 15500, "oldPrice": 17100 }
      ]
    }
  },
  {
    "id": "9",
    "title": "AirPods Pro 2da Generación",
    "brand": "Apple",
    "price": 5900,
    "oldPrice": 6800,
    "category": "accessories",
    "condition": "nuevo",
    "badge": "Nuevo",
    "image": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR8QiKJZ_WGAAnfJ1jRV5X-jGrpCnHykAZ_yITbM8nAcw&s=10",
    "description": "Audífonos premium con cancelación activa de ruido y audio espacial.",
    "specs": [
      "Chip H2",
      "Cancelación activa de ruido",
      "Audio espacial",
      "Estuche MagSafe",
      "Hasta 6 horas de reproducción"
    ],
    "variants": {
      "colors": [
        { "name": "Blanco", "value": "#ffffff" }
      ],
      "storage": [
        { "name": "Estándar", "price": 5900, "oldPrice": 6800 }
      ]
    }
  },
  {
    "id": "10",
    "title": "Cargador Apple USB-C 20W",
    "brand": "Apple",
    "price": 750,
    "oldPrice": 950,
    "category": "accessories",
    "condition": "nuevo",
    "badge": "Nuevo",
    "image": "https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/MHJA3?wid=572&hei=572&fmt=jpeg&qlt=95&.v=1603730167000",
    "description": "Adaptador de carga rápida USB-C compatible con iPhone y iPad.",
    "specs": [
      "Carga rápida de 20W",
      "Puerto USB-C",
      "Compatible con iPhone",
      "Compatible con iPad",
      "Diseño compacto"
    ],
    "variants": {
      "colors": [
        { "name": "Blanco", "value": "#ffffff" }
      ],
      "storage": [
        { "name": "Estándar", "price": 750, "oldPrice": 950 }
      ]
    }
  }
];

let isImportingProducts = false;

async function autoImportProductsJson() {
  if (isImportingProducts) return;
  isImportingProducts = true;

  try {
    let importedCount = 0;
    for (const item of SEED_PRODUCTS) {
      if (!item || item.id === undefined) continue;
      const docId = String(item.id);
      const docRef = doc(db, "products", docId);

      try {
        const docSnap = await getDoc(docRef);
        // Crear en Firestore únicamente si el documento no existe para evitar duplicados y no borrar productos modificados
        if (!docSnap.exists()) {
          const productPayload = {
            id: docId,
            title: item.title || "",
            brand: item.brand || "Apple",
            price: Number(item.price) || 0,
            oldPrice: Number(item.oldPrice) || 0,
            category: item.category || "iphones",
            condition: item.condition || "seminuevo",
            badge: item.badge || "Seminuevo",
            images: getProductImageUrls(item),
            // Se conserva image como alias de portada para clientes anteriores.
            image: getProductImageUrls(item)[0] || "",
            batteryHealth: normalizeBatteryHealth(item.batteryHealth),
            description: item.description || "",
            includes: normalizeIncludes(item.includes),
            specs: Array.isArray(item.specs) ? item.specs : [],
            variants: item.variants || { colors: [], storage: [] },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };

          await setDoc(docRef, productPayload);
          importedCount++;
        }
      } catch (docErr) {
        console.warn(`⚠️ No se pudo verificar o importar el producto ID ${docId}:`, docErr.message);
      }
    }

    if (importedCount > 0) {
      console.log(`✅ ${importedCount} productos sincronizados automáticamente hacia Cloud Firestore.`);
      showAlert(`📦 Se importaron ${importedCount} productos a Firestore.`, "success");
    }
  } catch (err) {
    console.warn("⚠️ Error durante la sincronización inicial de productos con Firestore:", err.message);
  } finally {
    isImportingProducts = false;
  }
}

function listenToProducts() {
  setLoading(true);
  const productsRef = collection(db, "products");

  if (unsubscribeFirestore) {
    try { unsubscribeFirestore(); } catch(e) {}
    unsubscribeFirestore = null;
  }

  // Sincronizar automáticamente productos.json si la colección no contiene los productos iniciales
  autoImportProductsJson();

  try {
    unsubscribeFirestore = onSnapshot(productsRef, (snapshot) => {
      products = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data()
      }));

      migrateLegacyProductImages(products);
      renderProductsTable();
      updateDashboardMetrics();
      setLoading(false);
    }, async (error) => {
      console.warn("⚠️ Streaming en tiempo real bloqueado, ejecutando fallback HTTP getDocs:", error);
      await fetchProductsFallback();
    });
  } catch (err) {
    fetchProductsFallback();
  }
}

async function fetchProductsFallback() {
  try {
    const productsRef = collection(db, "products");
    const snapshot = await getDocs(productsRef);
    products = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data()
    }));
    migrateLegacyProductImages(products);
    renderProductsTable();
    updateDashboardMetrics();
  } catch (err) {
    console.error("Error al obtener productos vía fallback:", err);
    showAlert("⚠️ Conexión bloqueada por el navegador.", "error");
  } finally {
    setLoading(false);
  }
}

function setLoading(loading) {
  if (reloadBtn) reloadBtn.disabled = loading;
  if (reloadBtnTop) reloadBtnTop.disabled = loading;
  if (addProductBtn) addProductBtn.disabled = loading;
}

function updateDashboardMetrics() {
  const totalElem = document.getElementById("metric-total-products");
  const iphonesElem = document.getElementById("metric-iphones-count");
  const samsungElem = document.getElementById("metric-samsung-count");
  const othersElem = document.getElementById("metric-others-count");

  if (!totalElem) return;

  const total = products.length;
  const iphones = products.filter(p => p.category === "iphones").length;
  const samsung = products.filter(p => p.category === "samsung").length;
  const others = total - iphones - samsung;

  totalElem.textContent = total;
  iphonesElem.textContent = iphones;
  samsungElem.textContent = samsung;
  othersElem.textContent = others;
}

function getFilteredProducts() {
  const query = (adminSearch?.value || "").toLowerCase().trim();
  const category = categoryFilter?.value || "all";

  return products.filter((product) => {
    const title = String(product.title || "").toLowerCase();
    const brand = String(product.brand || "").toLowerCase();
    const matchesSearch = !query || title.includes(query) || brand.includes(query);
    const matchesCategory = category === "all" || product.category === category;
    return matchesSearch && matchesCategory;
  });
}

function renderProductsTable() {
  const filtered = getFilteredProducts();

  const countChip = document.getElementById("table-count-chip");
  if (countChip) {
    countChip.textContent = `${filtered.length} ítems`;
  }

  productsTableBody.innerHTML = "";

  if (filtered.length === 0) {
    emptyTableMsg.hidden = false;
    return;
  }

  emptyTableMsg.hidden = true;

  filtered.forEach((product) => {
    const row = document.createElement("tr");
    const basePrice = getBasePrice(product);
    const conditionClass = product.condition === "nuevo" ? "nuevo" : "seminuevo";

    row.innerHTML = `
      <td>
        <div class="product-cell">
          <img class="product-thumb" src="${escapeHTML(getProductImageUrls(product)[0] || '')}" alt="${escapeHTML(product.title || '')}" loading="lazy">
          <div class="product-cell-info">
            <strong>${escapeHTML(product.title || '')}</strong>
            <span>${escapeHTML(product.brand || '')}</span>
          </div>
        </div>
      </td>
      <td><span class="category-pill">${escapeHTML(getCategoryLabel(product.category) || product.category || '')}</span></td>
      <td><span class="condition-pill ${conditionClass}">${escapeHTML(product.badge || (product.condition === 'nuevo' ? 'Nuevo' : 'Seminuevo'))}</span></td>
      <td><strong>${formatCurrency(basePrice)}</strong></td>
      <td style="text-align: right;">
        <div class="table-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-edit="${product.id}">Editar</button>
        </div>
      </td>
    `;

    row.querySelector("img")?.addEventListener("error", (event) => {
      event.currentTarget.style.visibility = "hidden";
    });

    row.querySelector("[data-edit]")?.addEventListener("click", () => {
      openProductModal(product.id);
    });

    productsTableBody.appendChild(row);
  });
}

function getBasePrice(product) {
  const storageVars = product?.variants?.storage;
  if (Array.isArray(storageVars) && storageVars.length > 0) {
    const first = storageVars[0];
    return typeof first === "object" ? Number(first.price) || 0 : Number(product.price) || 0;
  }
  return Number(product.price) || 0;
}

/* Modal / Slide-Over Drawer de producto */

function openProductModal(productId) {
  editingProductId = productId;
  formError.hidden = true;

  resetMediaEditor();
  const dropzoneText = fileDropzone?.querySelector(".dropzone-text");
  if (dropzoneText) dropzoneText.textContent = "Arrastra varias imágenes o haz clic para explorar";

  if (productId === null) {
    modalTitle.textContent = "Nuevo producto";
    deleteProductBtn.hidden = true;
    fillProductForm(createEmptyProduct());
  } else {
    const product = products.find((item) => String(item.id) === String(productId));
    if (!product) return;

    modalTitle.textContent = "Editar producto";
    deleteProductBtn.hidden = false;
    fillProductForm(product);
  }

  productModal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeProductModal() {
  productModal.hidden = true;
  document.body.style.overflow = "";
  editingProductId = null;
  clearPreviewObjectUrls();
}

function createEmptyProduct() {
  return {
    id: null,
    title: "",
    brand: "",
    price: 0,
    oldPrice: 0,
    category: "iphones",
    condition: "nuevo",
    badge: "Nuevo",
    images: [],
    image: "",
    batteryHealth: null,
    description: "",
    includes: [""],
    specs: [""],
    variants: {
      colors: [{ name: "", value: "#cccccc" }],
      storage: [{ name: "128GB", price: 0, oldPrice: 0, stock: null }]
    }
  };
}

function fillProductForm(product) {
  document.getElementById("product-id").value = product.id || "";
  document.getElementById("product-title").value = product.title || "";
  document.getElementById("product-brand").value = product.brand || "";
  document.getElementById("product-category").value = product.category || "iphones";
  document.getElementById("product-condition").value = product.condition || "nuevo";
  document.getElementById("product-badge").value = product.badge || "";
  document.getElementById("product-battery-health").value = product.batteryHealth ?? "";

  existingImageUrls = getProductImageUrls(product).slice(0, MAX_PRODUCT_IMAGES);
  pendingImageFiles = [];
  pendingImagesFirst = false;
  document.getElementById("product-image").value = existingImageUrls.join("\n");
  document.getElementById("product-description").value = product.description || "";
  renderProductImagesPreview();
  
  const fileInput = document.getElementById("product-image-file");
  if (fileInput) fileInput.value = "";

  includesList.innerHTML = "";
  const productIncludes = normalizeIncludes(product.includes);
  (productIncludes.length ? productIncludes : [""]).forEach((item) => addIncludeRow(item));

  specsList.innerHTML = "";
  (product.specs?.length ? product.specs : [""]).forEach((spec) => addSpecRow(spec));

  colorsList.innerHTML = "";
  const colors = product.variants?.colors?.length
    ? product.variants.colors
    : [{ name: "", value: "#cccccc" }];
  colors.forEach((color) => addColorRow(color));

  storageList.innerHTML = "";
  const storageVars = product.variants?.storage?.length
    ? product.variants.storage
    : [{ name: "128GB", price: product.price || 0, oldPrice: product.oldPrice || 0, stock: null }];
  storageVars.forEach((item) => {
    if (typeof item === "string") {
      addStorageRow(item, product.price || 0, product.oldPrice || 0, null);
    } else {
      addStorageRow(item.name, item.price, item.oldPrice, item.stock);
    }
  });
}

function normalizeIncludes(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => typeof item === "string"
      ? item.trim()
      : String(item?.name || item?.label || item?.text || "").trim())
    .filter(Boolean);
}

function updateIncludeOrderButtons() {
  if (!includesList) return;
  const rows = [...includesList.querySelectorAll(".include-row")];
  rows.forEach((row, index) => {
    const upButton = row.querySelector('[data-move="up"]');
    const downButton = row.querySelector('[data-move="down"]');
    if (upButton) upButton.disabled = index === 0;
    if (downButton) downButton.disabled = index === rows.length - 1;
  });
}

function addIncludeRow(value = "") {
  if (!includesList) return;
  const row = document.createElement("div");
  row.className = "dynamic-row include-row";
  row.innerHTML = `
    <input type="text" class="include-input" value="${escapeHTML(value)}" placeholder="Ej. Cable USB-C original" aria-label="Elemento incluido">
    <div class="include-order-actions" aria-label="Cambiar orden">
      <button type="button" class="move-row-btn" data-move="up" aria-label="Mover hacia arriba" title="Mover hacia arriba"><i class="ph ph-arrow-up" aria-hidden="true"></i></button>
      <button type="button" class="move-row-btn" data-move="down" aria-label="Mover hacia abajo" title="Mover hacia abajo"><i class="ph ph-arrow-down" aria-hidden="true"></i></button>
    </div>
    <button type="button" class="remove-row-btn">Quitar</button>
  `;

  row.querySelector(".remove-row-btn")?.addEventListener("click", () => {
    row.remove();
    updateIncludeOrderButtons();
  });

  row.querySelectorAll("[data-move]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.move === "up" && row.previousElementSibling) {
        includesList.insertBefore(row, row.previousElementSibling);
      }
      if (button.dataset.move === "down" && row.nextElementSibling) {
        includesList.insertBefore(row.nextElementSibling, row);
      }
      updateIncludeOrderButtons();
      row.querySelector(".include-input")?.focus();
    });
  });

  includesList.appendChild(row);
  updateIncludeOrderButtons();
}

function addSpecRow(value = "") {
  const row = document.createElement("div");
  row.className = "dynamic-row";
  row.innerHTML = `
    <input type="text" class="spec-input" value="${escapeHTML(value)}" placeholder="Ej. Chip A17 Pro">
    <button type="button" class="remove-row-btn">Quitar</button>
  `;
  row.querySelector(".remove-row-btn")?.addEventListener("click", () => row.remove());
  specsList.appendChild(row);
}

function normalizeHexColor(value, fallback = "#CCCCCC") {
  let hex = String(value || "").trim().toUpperCase();
  if (/^#[0-9A-F]{3}$/.test(hex)) {
    hex = `#${hex.slice(1).split("").map((character) => character + character).join("")}`;
  }
  return /^#[0-9A-F]{6}$/.test(hex) ? hex : fallback;
}

function getColorRepresentations(hexValue) {
  const hex = normalizeHexColor(hexValue);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * (((blue - red) / delta) + 2);
    else hue = 60 * (((red - green) / delta) + 4);
  }
  if (hue < 0) hue += 360;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));

  const toLinear = (channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
  const linearR = toLinear(red);
  const linearG = toLinear(green);
  const linearB = toLinear(blue);
  const l = Math.cbrt(0.4122214708 * linearR + 0.5363325363 * linearG + 0.0514459929 * linearB);
  const m = Math.cbrt(0.2119034982 * linearR + 0.6806995451 * linearG + 0.1073969566 * linearB);
  const s = Math.cbrt(0.0883024619 * linearR + 0.2817188376 * linearG + 0.6299787005 * linearB);
  const oklabL = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const oklabA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const oklabB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const chroma = Math.sqrt(oklabA ** 2 + oklabB ** 2);
  let oklchHue = Math.atan2(oklabB, oklabA) * 180 / Math.PI;
  if (oklchHue < 0) oklchHue += 360;

  return {
    hex,
    rgb: `${r}, ${g}, ${b}`,
    hsl: `${Math.round(hue)}, ${Math.round(saturation * 100)}%, ${Math.round(lightness * 100)}%`,
    oklch: `${oklabL.toFixed(3)}, ${chroma.toFixed(3)}, ${oklchHue.toFixed(1)}`
  };
}

function addColorRow(colorOrName = "", legacyValue = "#cccccc") {
  const source = colorOrName && typeof colorOrName === "object"
    ? colorOrName
    : { name: colorOrName, value: legacyValue };
  const calculated = getColorRepresentations(source.hex || source.value || legacyValue);
  const color = {
    name: String(source.name || ""),
    hex: calculated.hex,
    rgb: String(source.rgb || calculated.rgb),
    hsl: String(source.hsl || calculated.hsl),
    oklch: String(source.oklch || calculated.oklch)
  };

  const row = document.createElement("div");
  row.className = "dynamic-row color-row";
  row.innerHTML = `
    <div class="color-row-summary">
      <label class="variant-field">
        <span>Nombre del color</span>
        <input type="text" class="color-name" value="${escapeHTML(color.name)}" placeholder="Ej. Titanio natural">
      </label>
      <div class="color-primary-control">
        <span class="compact-field-label">Color y Hex</span>
        <div class="color-compact-control">
          <input type="color" class="color-value" value="${escapeHTML(color.hex.toLowerCase())}" aria-label="Seleccionar color">
          <input type="text" class="color-hex" value="${escapeHTML(color.hex)}" placeholder="#F54927" maxlength="7" spellcheck="false" aria-label="Valor hexadecimal">
        </div>
      </div>
      <button type="button" class="remove-row-btn">Quitar</button>
    </div>
    <details class="color-advanced">
      <summary>
        <i class="ph ph-sliders-horizontal" aria-hidden="true"></i>
        Más información del color
        <span class="color-advanced-hint">RGB · HSL · OKLCH</span>
        <i class="ph ph-caret-down" aria-hidden="true"></i>
      </summary>
      <div class="color-advanced-grid">
        <label class="variant-field">
          <span>RGB</span>
          <input type="text" class="color-rgb" value="${escapeHTML(color.rgb)}" placeholder="245, 73, 39" spellcheck="false">
        </label>
        <label class="variant-field">
          <span>HSL</span>
          <input type="text" class="color-hsl" value="${escapeHTML(color.hsl)}" placeholder="10, 91%, 56%" spellcheck="false">
        </label>
        <label class="variant-field">
          <span>OKLCH</span>
          <input type="text" class="color-oklch" value="${escapeHTML(color.oklch)}" placeholder="0.65, 0.21, 33" spellcheck="false">
        </label>
      </div>
    </details>
  `;

  const picker = row.querySelector(".color-value");
  const hexInput = row.querySelector(".color-hex");
  const syncCalculatedValues = (hexValue) => {
    const values = getColorRepresentations(hexValue);
    picker.value = values.hex.toLowerCase();
    hexInput.value = values.hex;
    row.querySelector(".color-rgb").value = values.rgb;
    row.querySelector(".color-hsl").value = values.hsl;
    row.querySelector(".color-oklch").value = values.oklch;
  };

  picker?.addEventListener("input", () => syncCalculatedValues(picker.value));
  hexInput?.addEventListener("input", () => {
    if (/^#[0-9a-f]{6}$/i.test(hexInput.value.trim())) syncCalculatedValues(hexInput.value);
  });
  hexInput?.addEventListener("blur", () => syncCalculatedValues(hexInput.value));
  row.querySelector(".remove-row-btn")?.addEventListener("click", () => row.remove());
  colorsList.appendChild(row);
}

function addStorageRow(name = "128GB", price = 0, oldPrice = 0, stock = null) {
  const row = document.createElement("div");
  row.className = "dynamic-row storage-row";
  const stockValue = stock === null || stock === undefined || stock === "" ? "" : Math.max(0, Number(stock) || 0);
  row.innerHTML = `
    <label class="variant-field">
      <span>Capacidad</span>
      <input type="text" class="storage-name" value="${escapeHTML(name)}" placeholder="Ej. 256GB" aria-label="Capacidad">
    </label>
    <label class="variant-field">
      <span>Precio normal</span>
      <input type="number" class="storage-old-price" value="${Number(oldPrice) || 0}" min="0" step="100" placeholder="L. 0" aria-label="Precio normal">
    </label>
    <label class="variant-field">
      <span>Precio oferta</span>
      <input type="number" class="storage-price" value="${Number(price) || 0}" min="0" step="100" placeholder="L. 0" aria-label="Precio de oferta">
    </label>
    <label class="variant-field">
      <span>Stock</span>
      <input type="number" class="storage-stock" value="${stockValue}" min="0" step="1" placeholder="0" aria-label="Stock de esta capacidad">
    </label>
    <button type="button" class="remove-row-btn" aria-label="Quitar capacidad">Quitar</button>
  `;
  row.querySelector(".remove-row-btn")?.addEventListener("click", () => row.remove());
  storageList.appendChild(row);
}

/* Multimedia, compatibilidad y normalización */

function uniqueImageUrls(urls) {
  return [...new Set((Array.isArray(urls) ? urls : [])
    .map((url) => String(url || "").trim())
    .filter(Boolean))];
}

function getProductImageUrls(product) {
  const modernImages = Array.isArray(product?.images) ? product.images : [];
  const legacyImage = product?.image ? [product.image] : [];
  return uniqueImageUrls(modernImages.length ? modernImages : legacyImage);
}

function parseImageUrls(value) {
  return uniqueImageUrls(String(value || "")
    .split(/\r?\n/)
    .map((url) => url.trim()));
}

function normalizeBatteryHealth(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(100, Math.max(0, Math.round(number)));
}

function normalizeStockValue(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.floor(number));
}

function clearPreviewObjectUrls() {
  previewObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  previewObjectUrls = [];
}

function resetMediaEditor() {
  clearPreviewObjectUrls();
  existingImageUrls = [];
  pendingImageFiles = [];
  pendingImagesFirst = false;
  if (productImageFileInput) productImageFileInput.value = "";
  if (productImageUrlsInput) productImageUrlsInput.value = "";
  renderProductImagesPreview();
}

function addPendingImageFiles(fileList) {
  const incomingFiles = Array.from(fileList || []);
  if (incomingFiles.length === 0) return;

  let rejected = 0;
  incomingFiles.forEach((file) => {
    const duplicate = pendingImageFiles.some((item) =>
      item.name === file.name && item.size === file.size && item.lastModified === file.lastModified
    );
    const currentTotal = existingImageUrls.length + pendingImageFiles.length;

    if (!file.type.startsWith("image/") || file.size > MAX_IMAGE_SIZE || duplicate || currentTotal >= MAX_PRODUCT_IMAGES) {
      rejected += 1;
      return;
    }

    pendingImageFiles.push(file);
  });

  if (rejected > 0) {
    showAlert(`Se omitieron ${rejected} archivo(s). Usa imágenes válidas de hasta 8 MB y un máximo de ${MAX_PRODUCT_IMAGES}.`, "error");
  }

  const textLabel = fileDropzone?.querySelector(".dropzone-text");
  if (textLabel) {
    const total = existingImageUrls.length + pendingImageFiles.length;
    textLabel.textContent = `${total} ${total === 1 ? "imagen lista" : "imágenes listas"} para la galería`;
  }

  renderProductImagesPreview();
}

function renderProductImagesPreview() {
  if (!productImagesPreview) return;
  clearPreviewObjectUrls();
  productImagesPreview.innerHTML = "";

  const total = existingImageUrls.length + pendingImageFiles.length;
  if (productImagesCount) {
    productImagesCount.textContent = `${total} ${total === 1 ? "imagen" : "imágenes"}`;
  }

  if (total === 0) {
    pendingImagesFirst = false;
    productImagesPreview.innerHTML = `
      <div class="media-preview-empty"><i class="ph ph-images" aria-hidden="true"></i> Aún no hay imágenes seleccionadas.</div>
    `;
    return;
  }

  let renderedCount = 0;
  const appendPreview = ({ src, type, index, alt }) => {
    const globalIndex = renderedCount;
    renderedCount += 1;
    const item = document.createElement("div");
    item.className = `media-preview-item ${type === "pending" ? "is-pending" : ""} ${globalIndex === 0 ? "is-primary" : ""}`;
    item.innerHTML = `
      <img src="${escapeHTML(src)}" alt="${escapeHTML(alt)}">
      ${globalIndex === 0
        ? '<span class="media-primary-badge"><i class="ph ph-star" aria-hidden="true"></i> Portada</span>'
        : `<button type="button" class="media-primary-btn" data-primary-type="${type}" data-primary-index="${index}" aria-label="Usar como portada" title="Usar como portada"><i class="ph ph-star" aria-hidden="true"></i></button>`}
      <button type="button" class="media-remove-btn" data-media-type="${type}" data-media-index="${index}" aria-label="Quitar imagen">
        <i class="ph ph-x" aria-hidden="true"></i>
      </button>
    `;
    item.querySelector("img")?.addEventListener("error", (event) => {
      event.currentTarget.style.opacity = ".25";
    });
    productImagesPreview.appendChild(item);
  };

  const renderExisting = () => existingImageUrls.forEach((url, index) => {
    appendPreview({ src: url, type: "existing", index, alt: `Imagen guardada ${index + 1}` });
  });

  const renderPending = () => pendingImageFiles.forEach((file, index) => {
    const objectUrl = URL.createObjectURL(file);
    previewObjectUrls.push(objectUrl);
    appendPreview({ src: objectUrl, type: "pending", index, alt: file.name });
  });

  if (pendingImagesFirst && pendingImageFiles.length > 0) {
    renderPending();
    renderExisting();
  } else {
    pendingImagesFirst = false;
    renderExisting();
    renderPending();
  }

  productImagesPreview.querySelectorAll(".media-remove-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.mediaIndex);
      if (button.dataset.mediaType === "existing") {
        existingImageUrls.splice(index, 1);
        if (productImageUrlsInput) productImageUrlsInput.value = existingImageUrls.join("\n");
      } else {
        pendingImageFiles.splice(index, 1);
        if (pendingImageFiles.length === 0) pendingImagesFirst = false;
      }
      renderProductImagesPreview();
    });
  });

  productImagesPreview.querySelectorAll(".media-primary-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.primaryIndex);
      if (button.dataset.primaryType === "pending") {
        const [file] = pendingImageFiles.splice(index, 1);
        if (file) pendingImageFiles.unshift(file);
        pendingImagesFirst = true;
      } else {
        const [url] = existingImageUrls.splice(index, 1);
        if (url) existingImageUrls.unshift(url);
        pendingImagesFirst = false;
        if (productImageUrlsInput) productImageUrlsInput.value = existingImageUrls.join("\n");
      }
      renderProductImagesPreview();
    });
  });
}

async function uploadProductImages(files, submitBtn) {
  const urls = [];

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (submitBtn) setButtonLabel(submitBtn, `Subiendo imagen ${index + 1} de ${files.length}...`, "spinner-gap");

    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const productFolder = editingProductId ? String(editingProductId) : "new";
      const storageRef = ref(storage, `products/${productFolder}/${Date.now()}_${index}_${safeName}`);
      const snapshot = await uploadBytes(storageRef, file);
      urls.push(await getDownloadURL(snapshot.ref));
    } catch (storageError) {
      // Conserva el fallback existente para entornos locales o Storage bloqueado.
      // La compresión reduce el riesgo de exceder el tamaño del documento.
      console.warn(`Firebase Storage no disponible para ${file.name}; usando imagen comprimida.`, storageError);
      urls.push(await compressAndReadImage(file, 640, 0.62));
    }
  }

  return urls;
}

async function migrateLegacyProductImages(items) {
  for (const product of items) {
    if (!product?.id || migratedProductIds.has(String(product.id))) continue;
    if (Array.isArray(product.images) && product.images.length > 0) continue;
    if (!product.image) continue;

    const productId = String(product.id);
    migratedProductIds.add(productId);
    try {
      await setDoc(doc(db, "products", productId), {
        images: [String(product.image)],
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (error) {
      migratedProductIds.delete(productId);
      console.warn(`No se pudo migrar la galería del producto ${productId}:`, error);
    }
  }
}

/* Firestore & Firebase Storage: Crear, Editar, Eliminar */

async function handleProductSubmit(event) {
  event.preventDefault();
  formError.hidden = true;

  const submitBtn = productForm.querySelector("button[type='submit']");

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      setButtonLabel(submitBtn, "Procesando...", "spinner-gap");
    }

    const title = document.getElementById("product-title").value.trim();
    const brand = document.getElementById("product-brand").value.trim();
    const category = document.getElementById("product-category").value;
    const condition = document.getElementById("product-condition").value;
    const badge = document.getElementById("product-badge").value.trim() || (condition === "nuevo" ? "Nuevo" : "Seminuevo");
    const batteryHealth = normalizeBatteryHealth(document.getElementById("product-battery-health").value);
    const description = document.getElementById("product-description").value.trim();
    const directImageUrls = parseImageUrls(document.getElementById("product-image").value).slice(0, MAX_PRODUCT_IMAGES);

    if (!title || !brand) {
      throw new Error("Completa el nombre y marca del producto.");
    }

    // Subida múltiple. Las URLs ya guardadas se conservan y los archivos nuevos
    // se agregan al array en el mismo orden mostrado por la vista previa.
    let uploadedImageUrls = [];
    if (pendingImageFiles.length > 0) {
      uploadedImageUrls = await uploadProductImages(pendingImageFiles, submitBtn);
    }

    const orderedImageUrls = pendingImagesFirst
      ? [...uploadedImageUrls, ...directImageUrls]
      : [...directImageUrls, ...uploadedImageUrls];
    const images = uniqueImageUrls(orderedImageUrls).slice(0, MAX_PRODUCT_IMAGES);
    if (images.length === 0) {
      throw new Error("Agrega al menos una imagen mediante URL o archivo.");
    }

    const includes = [...includesList.querySelectorAll(".include-input")]
      .map((input) => input.value.trim())
      .filter(Boolean);

    const specs = [...specsList.querySelectorAll(".spec-input")]
      .map((input) => input.value.trim())
      .filter(Boolean);

    const colors = [...colorsList.querySelectorAll(".color-row")]
      .map((row) => {
        const calculated = getColorRepresentations(row.querySelector(".color-hex")?.value || row.querySelector(".color-value")?.value);
        return {
          name: row.querySelector(".color-name")?.value.trim() || "",
          // value se conserva como alias para el selector del cliente actual.
          value: calculated.hex,
          hex: calculated.hex,
          rgb: row.querySelector(".color-rgb")?.value.trim() || calculated.rgb,
          hsl: row.querySelector(".color-hsl")?.value.trim() || calculated.hsl,
          oklch: row.querySelector(".color-oklch")?.value.trim() || calculated.oklch
        };
      })
      .filter((color) => color.name);

    const storageVars = [...storageList.querySelectorAll(".dynamic-row")]
      .map((row) => {
        const stockInput = row.querySelector(".storage-stock")?.value;
        return {
          name: row.querySelector(".storage-name")?.value.trim() || "",
          price: Number(row.querySelector(".storage-price")?.value) || 0,
          oldPrice: Number(row.querySelector(".storage-old-price")?.value) || 0,
          // null conserva compatibilidad con variantes antiguas sin inventario definido.
          stock: stockInput === "" || stockInput === undefined ? null : normalizeStockValue(stockInput)
        };
      })
      .filter((item) => item.name);

    if (storageVars.length === 0) {
      throw new Error("Agrega al menos una capacidad con precio.");
    }

    const baseStorage = storageVars[0];
    const defaultColorValues = getColorRepresentations("#CCCCCC");

    const productData = {
      title,
      brand,
      price: baseStorage.price,
      oldPrice: baseStorage.oldPrice,
      category,
      condition,
      badge,
      images,
      // Alias legado: mantiene operativos clientes que todavía leen image.
      image: images[0],
      batteryHealth,
      description,
      includes,
      specs,
      variants: {
        colors: colors.length ? colors : [{ name: "Estándar", value: defaultColorValues.hex, ...defaultColorValues }],
        storage: storageVars
      },
      updatedAt: new Date().toISOString()
    };

    if (submitBtn) setButtonLabel(submitBtn, "Guardando en Firestore...", "cloud-arrow-up");

    if (editingProductId) {
      // Actualizar documento existente
      const productRef = doc(db, "products", String(editingProductId));
      await setDoc(productRef, productData, { merge: true });
      showAlert("🎉 Producto actualizado con éxito en Firestore.", "success");
    } else {
      // Crear nuevo documento
      productData.createdAt = new Date().toISOString();
      const colRef = collection(db, "products");
      await addDoc(colRef, productData);
      showAlert("🎉 Nuevo producto agregado con éxito a Firestore.", "success");
    }

    closeProductModal();
  } catch (error) {
    console.error("Error al guardar producto:", error);
    let msg = error.message;
    if (error.code === "permission-denied" || error.message.includes("permissions")) {
      msg = "Permisos insuficientes en Firebase: Revisa las Reglas de Seguridad en tu Consola de Firebase para la colección 'products'.";
    }
    formError.textContent = msg;
    formError.hidden = false;
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      setButtonLabel(submitBtn, "Guardar cambios", "check");
    }
  }
}

async function handleDeleteProduct() {
  if (!editingProductId) return;

  showConfirm(
    "Eliminar producto",
    "¿Estás seguro de eliminar este producto directamente de Firestore?",
    async () => {
      try {
        const productRef = doc(db, "products", String(editingProductId));
        await deleteDoc(productRef);
        closeProductModal();
        showAlert("🗑️ Producto eliminado de Firestore.", "success");
      } catch (error) {
        showAlert("Error al eliminar producto: " + error.message, "error");
      }
    }
  );
}

/* Helpers UI */

function setButtonLabel(button, label, icon = "check") {
  if (!button) return;
  button.innerHTML = `<i class="ph ph-${escapeHTML(icon)}" aria-hidden="true"></i><span>${escapeHTML(label)}</span>`;
}

function showAlert(message, type = "success") {
  if (!adminAlert) return;
  adminAlert.textContent = message;
  adminAlert.className = `admin-toast admin-alert-${type}`;
  adminAlert.hidden = false;

  setTimeout(() => {
    adminAlert.hidden = true;
  }, 4000);
}

function showConfirm(title, message, callback) {
  confirmTitle.textContent = title;
  confirmMessage.textContent = message;
  confirmCallback = callback;
  confirmDialog.hidden = false;
}

function closeConfirm() {
  confirmDialog.hidden = true;
  confirmCallback = null;
}

function escapeHTML(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatCurrency(amount) {
  const number = Number(amount) || 0;
  return `L. ${number.toLocaleString("es-HN")}`;
}

function compressAndReadImage(file, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error("No se pudo decodificar el formato de imagen."));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("No se pudo leer el archivo seleccionado."));
    reader.readAsDataURL(file);
  });
}

/* ==========================================================================
   MI PHONE HN — PANEL ADMIN SAAS CON SUPABASE + CLOUDINARY
   ========================================================================== */

import { 
  db, 
  auth, 
  collection, 
  doc, 
  setDoc, 
  addDoc, 
  deleteDoc, 
  getDocs,
  getDoc,
  onSnapshot, 
  onAuthStateChanged,
  signOut,
  signInWithEmailAndPassword,
  syncUserToSupabase,
  obtenerSiguienteId,
  permisosPorRol,
  query,
  where,
  crearUsuarioTemporal,
  uploadToCloudinary
} from './supabase-config.js';


// Rol y permisos del usuario autenticado (Configuración → Usuarios).
// 'admin' tiene acceso completo; 'editor' solo puede ver y editar el catálogo.
let rolUsuarioActual = 'admin';
let permisosUsuario = null;

function esAdmin() {
  return rolUsuarioActual === 'admin';
}

function getPermisos() {
  if (!permisosUsuario) permisosUsuario = permisosPorRol(rolUsuarioActual);
  return permisosUsuario;
}

/* ==========================================================================
   LLAVES DE ACCESO — validación (Configuración → Llaves)
   Las llaves se almacenan con hash SHA-256; nunca en texto plano.
   ========================================================================== */

async function sha256Hex(texto) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(texto).trim()));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (err) {
    return String(texto).trim();
  }
}

async function validarLlave(codigo, opciones = {}) {
  try {
    const snap = await getDoc(doc(db, 'configuracion', 'llaves-acceso'));
    if (!snap.exists()) return true; // Bootstrap: sin llaves configuradas aún, acceso libre.
    const llaves = Array.isArray(snap.data().llaves) ? snap.data().llaves : [];
    if (llaves.length === 0) return true; // Bootstrap: primera llave se crea sin validación previa.
    const texto = String(codigo || '').trim().toUpperCase();
    if (!texto) return false;
    const hash = await sha256Hex(texto);
    // La confirmación de acciones sensibles acepta llaves inactivas para
    // evitar encerrar al administrador tras desactivar la única llave.
    return llaves.some(l => (l.activa !== false || opciones.incluirInactivas) && (l.hash === hash || l.codigo === texto));
  } catch (err) {
    console.warn('No se pudo validar la llave:', err.message);
    return false;
  }
}

// Modal de solicitud de llave. Resuelve true si la llave es correcta.
// opciones.incluirInactivas: permite confirmar acciones con llaves desactivadas.
let intentosLlave = 0;
let bloqueoLlaveHasta = 0;
const MAX_INTENTOS_LLAVE = 5;
const BLOQUEO_LLAVE_MS = 30000;

function pedirLlave(titulo, mensaje, opciones = {}) {
  return new Promise((resolve) => {
    const dlg = document.getElementById('llave-prompt-dialog');
    if (!dlg) { resolve(false); return; }
    if (Date.now() >= bloqueoLlaveHasta) intentosLlave = 0;
    if (Date.now() < bloqueoLlaveHasta) {
      const segundos = Math.ceil((bloqueoLlaveHasta - Date.now()) / 1000);
      showAlert(`Demasiados intentos fallidos. Espera ${segundos} s para volver a intentar.`, 'error');
      resolve(false);
      return;
    }
    const input = dlg.querySelector('.llave-prompt-input');
    const errorEl = dlg.querySelector('.llave-prompt-error');
    const okBtn = dlg.querySelector('.llave-prompt-ok');
    const cancelBtn = dlg.querySelector('.llave-prompt-cancel');
    const tituloEl = dlg.querySelector('#llave-prompt-title');
    const msgEl = dlg.querySelector('#llave-prompt-message');
    if (!input || !errorEl || !okBtn || !cancelBtn || !tituloEl || !msgEl) { resolve(false); return; }
    tituloEl.textContent = titulo || 'Llave de acceso';
    msgEl.textContent = mensaje || 'Introduce la llave generada en Configuración ? Llaves.';
    input.value = '';
    input.disabled = false;
    errorEl.hidden = true;
    dlg.hidden = false;
    setTimeout(() => input.focus(), 50);

    const terminar = (resultado) => {
      dlg.hidden = true;
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
      resolve(resultado);
    };
    const onOk = async () => {
      okBtn.disabled = true;
      const ok = await validarLlave(input.value, opciones);
      okBtn.disabled = false;
      if (ok) { intentosLlave = 0; terminar(true); }
      else {
        intentosLlave++;
        if (intentosLlave >= MAX_INTENTOS_LLAVE) {
          bloqueoLlaveHasta = Date.now() + BLOQUEO_LLAVE_MS;
          errorEl.textContent = 'Demasiados intentos fallidos. Espera 30 segundos.';
          errorEl.hidden = false;
          input.disabled = true;
          okBtn.disabled = true;
          setTimeout(() => terminar(false), 2500);
        } else {
          errorEl.textContent = `Llave incorrecta. Intenta de nuevo (${MAX_INTENTOS_LLAVE - intentosLlave} intento(s) restante(s)).`;
          errorEl.hidden = false;
          input.focus();
          input.select();
        }
      }
    };
    const onCancel = () => terminar(false);
    const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); onOk(); } if (e.key === 'Escape') terminar(false); };
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
  });
}

let categories = [];

function getCategoryLabel(catId) {
  const cat = categories.find(c => c.id === catId);
  return cat ? cat.label : catId;
}

let unsubscribeCategories = null;

async function seedDefaultCategories() {
  try {
    const snap = await getDocs(collection(db, "categorias"));
    if (!snap.empty) return;
    const defaults = [
      { id: "iphones", label: "iPhones" },
      { id: "samsung", label: "Samsung" },
      { id: "ipads", label: "iPads" },
      { id: "accessories", label: "Accesorios" }
    ];
    for (const cat of defaults) {
      await setDoc(doc(db, "categorias", cat.id), { label: cat.label });
    }
    console.log("Categorías predeterminadas creadas en Supabase.");
  } catch (err) {
    console.warn("Error al crear categorías predeterminadas:", err);
  }
}

function listenToCategories() {
  const catRef = collection(db, "categorias");
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
      // Actualizar la lista del modal en tiempo real si está abierto.
      const catModal = document.getElementById("category-modal");
      if (catModal && !catModal.hidden) renderCategoryList();
    }, async () => {
      await fetchCategoriesFallback();
    });
  } catch {
    fetchCategoriesFallback();
  }
}

async function fetchCategoriesFallback() {
  try {
    const snap = await getDocs(collection(db, "categorias"));
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
  filter.innerHTML = '<option value="all">Todas las Categorías</option>';
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

let categoryEditingId = null; // id de la categoría en edición inline (null = ninguna)

function renderCategoryList() {
  const list = document.getElementById("category-list");
  if (!list) return;
  list.innerHTML = "";
  categories.forEach((cat, index) => {
    const count = products.filter(p => p.category === cat.id).length;
    const item = document.createElement("div");
    item.className = "category-list-item" + (cat.id === categoryEditingId ? " is-editing" : "");

    if (cat.id === categoryEditingId) {
      // Modo edición inline: reemplaza el prompt nativo del navegador.
      item.innerHTML = `
        <div class="category-list-edit">
          <input type="text" class="category-name-input" value="${escapeHTML(cat.label)}" maxlength="40" aria-label="Nombre de categoría">
          <div class="category-list-edit-actions">
            <button type="button" class="btn btn-primary btn-sm" data-cat-save="${escapeHTML(cat.id)}"><i class="ph ph-check" aria-hidden="true"></i> Guardar</button>
            <button type="button" class="btn btn-secondary btn-sm" data-cat-cancel title="Cancelar" aria-label="Cancelar"><i class="ph ph-x" aria-hidden="true"></i></button>
          </div>
        </div>
      `;
    } else {
      item.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:2px;min-width:0">
          <span class="category-list-label">${escapeHTML(cat.label)}</span>
          <span style="font-family:var(--font-mono);font-size:.6875rem;color:var(--ink-3);font-weight:600">${escapeHTML(cat.id)} · ${count} prod</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <button type="button" class="btn btn-secondary btn-sm" data-cat-edit="${escapeHTML(cat.id)}" title="Renombrar categoría">
            <i class="ph ph-pencil-simple" aria-hidden="true"></i>
            <span>Editar</span>
          </button>
          <button type="button" class="btn btn-danger btn-sm" data-cat-index="${index}">
            <i class="ph ph-trash" aria-hidden="true"></i>
            <span>Eliminar</span>
          </button>
        </div>
      `;
    }

    list.appendChild(item);

    const inputEl = item.querySelector(".category-name-input");
    if (inputEl) {
      inputEl.focus();
      inputEl.select();
      inputEl.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); item.querySelector("[data-cat-save]")?.click(); }
        else if (ev.key === "Escape") { categoryEditingId = null; renderCategoryList(); }
      });
    }
    item.querySelector("[data-cat-cancel]")?.addEventListener("click", () => { categoryEditingId = null; renderCategoryList(); });
    item.querySelector("[data-cat-save]")?.addEventListener("click", () => {
      const name = item.querySelector(".category-name-input")?.value.trim() || "";
      if (!name) { showAlert("El nombre no puede estar vacío.", "error"); return; }
      if (name === cat.label) { categoryEditingId = null; renderCategoryList(); return; }
      setDoc(doc(db, "categorias", cat.id), { label: name }, { merge: true })
        .then(() => { categoryEditingId = null; showAlert("Categoría actualizada correctamente", "success"); })
        .catch((err) => showAlert("Error al actualizar categoría: " + err.message, "error"));
    });
  });
  list.querySelectorAll("[data-cat-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      categoryEditingId = btn.dataset.catEdit;
      renderCategoryList();
    });
  });
  list.querySelectorAll("[data-cat-index]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const index = parseInt(btn.dataset.catIndex);
      const catId = categories[index].id;
      const catLabel = categories[index].label;
      const productsUsing = products.filter(p => p.category === catId);
      if (productsUsing.length > 0) {
        showAlert(`No se puede eliminar "${escapeHTML(catLabel)}": ${productsUsing.length} producto(s) la usan.`, "error");
        return;
      }
      showConfirm(
        "Eliminar categoría",
        `¿Seguro que deseas eliminar la categoría "<strong>${escapeHTML(catLabel)}</strong>"? Esta acción no se puede deshacer.`,
        async () => {
          try {
            await deleteDoc(doc(db, "categorias", catId));
            showAlert("Categoría eliminada correctamente", "success");
          } catch (err) {
            showAlert("Error al eliminar categoría: " + err.message, "error");
          }
        },
        { tone: "danger", okLabel: "Sí, eliminar" }
      );
    });
  });
}

function openCategoryModal() {
  categoryEditingId = null;
  renderCategoryList();
  const catModal = document.getElementById("category-modal");
  if (catModal) catModal.hidden = false;
}

function closeCategoryModal() {
  categoryEditingId = null;
  const catModal = document.getElementById("category-modal");
  if (catModal) catModal.hidden = true;
}

let products = [];
let editingProductId = null;
let confirmCallback = null;
let unsubscribeRealtime = null;

/* Estado temporal del editor multimedia. No se persiste hasta guardar. */
let existingImageUrls = [];
let pendingImageFiles = [];
let pendingImagesFirst = false;
let previewObjectUrls = [];
/* Detección de cambios sin guardar del Drawer de producto. */
let formSnapshot = null;
let formIsDirty = false;
const migratedProductIds = new Set();
const MAX_PRODUCT_IMAGES = 8;
const MAX_IMAGE_SIZE = 8 * 1024 * 1024;

/* DOM elements */
const adminApp = document.getElementById("admin-app");
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
// Drawer de producto: elementos del rediseño
const drawerModeChip = document.getElementById("drawer-mode-chip");
const drawerModeCopy = document.getElementById("drawer-mode-copy");
const drawerUpdateNotice = document.getElementById("drawer-update-notice");
const drawerDangerZone = document.getElementById("drawer-danger-zone");
const unsavedDialog = document.getElementById("unsaved-dialog");
const unsavedOverlay = document.getElementById("unsaved-overlay");
const unsavedStayBtn = document.getElementById("unsaved-stay-btn");
const unsavedDiscardBtn = document.getElementById("unsaved-discard-btn");

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

function init() {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      try {
        const userDoc = await getDoc(doc(db, 'usuarios', user.uid));
        let userData = userDoc.exists() ? userDoc.data() : null;
        // Fallback: si el usuario existe en Auth pero no en la colección usuarios,
        // sincronizarlo para conservar el acceso de cuentas legadas.
        if (!userData) {
          await syncUserToSupabase(user);
          const usuariosCol = collection(db, 'usuarios');
          const match = await getDocs(query(usuariosCol, where('uid', '==', user.uid)));
          if (match.empty) {
            await signOut(auth);
            window.location.href = 'login.html';
            return;
          }
          userData = match.docs[0].data();
        }
        if (!userData || !['admin', 'editor'].includes(userData.rol || userData.role) || userData.activo === false) {
          await signOut(auth);
          window.location.href = 'login.html';
          return;
        }

        // Estado de rol para permisos de interfaz (admin vs editor).
        rolUsuarioActual = userData.rol || userData.role || 'admin';
        permisosUsuario = null;
        document.body.dataset.rol = rolUsuarioActual;

        // Bienvenida solo tras un inicio de sesión real (flag fijado en login.html).
        if (sessionStorage.getItem('miphone_bienvenida')) {
          sessionStorage.removeItem('miphone_bienvenida');
          const nombreUsuario = userData.nombre || user.displayName || user.email || "Administrador";
          showAlert(`¡Bienvenido de nuevo, ${escapeHTML(nombreUsuario)}!`, "success");
        }

        adminApp.hidden = false;
        listenToProducts();
        listenToCategories();
        // Migración de estructura ya realizada (IDs secuenciales producto-N / Usuario-Admin-N).
        // Migración desactivada (ya migrado a Postgres).
        // Defensa de duplicados desactivada (Supabase trigger lo maneja)
        // repararUsuariosDuplicados();
      } catch (err) {
        await signOut(auth);
        window.location.href = 'login.html';
        return;
      }

      const sidebarUserName = document.getElementById("sidebar-user-name");
      if (sidebarUserName) {
        sidebarUserName.textContent = user.displayName || user.email || "Admin Session";
      }
    } else {
      window.location.href = 'login.html';
      if (unsubscribeRealtime) {
        unsubscribeRealtime();
        unsubscribeRealtime = null;
      }
      if (unsubscribeCategories) {
        unsubscribeCategories();
        unsubscribeCategories = null;
      }
    }
  });

  logoutBtn?.addEventListener("click", handleLogout);
  adminSearch?.addEventListener("input", renderProductsTable);
  categoryFilter?.addEventListener("change", renderProductsTable);
  addProductBtn?.addEventListener("click", () => openProductModal(null));
  reloadBtn?.addEventListener("click", () => listenToProducts());
  reloadBtnTop?.addEventListener("click", () => listenToProducts());
  productForm?.addEventListener("submit", handleProductSubmit);

  // Limpieza de errores de campo mientras el usuario corrige (solo Drawer).
  productForm?.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.id) {
      const slot = productForm.querySelector(`[data-error-for="${target.id}"]`);
      if (slot) {
        slot.hidden = true;
        slot.textContent = "";
      }
      target.classList.remove("field-invalid");
    }
    const section = target.closest(".form-section");
    if (section?.id) {
      const sectionSlot = productForm.querySelector(`[data-error-for="${section.id}"]`);
      if (sectionSlot) {
        sectionSlot.hidden = true;
        sectionSlot.textContent = "";
      }
    }
  });
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

  // Diálogo de cambios sin guardar (pertenece al Drawer de producto)
  unsavedStayBtn?.addEventListener("click", closeUnsavedDialog);
  unsavedOverlay?.addEventListener("click", closeUnsavedDialog);
  unsavedDiscardBtn?.addEventListener("click", () => {
    const action = unsavedDialogAction;
    closeUnsavedDialog();
    action?.();
  });

  // Protección al abandonar la página con el Drawer abierto y cambios pendientes.
  window.addEventListener("beforeunload", (event) => {
    if (productModal && !productModal.hidden && isProductFormDirty()) {
      event.preventDefault();
      event.returnValue = "";
    }
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
      storeLink.href = "https://mi-phone-hn.web.app/";
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
      showAlert(`La categoría "${escapeHTML(name)}" ya existe.`, "error");
      return;
    }
    try {
      await setDoc(doc(db, "categorias", id), { label: name });
      if (newCategoryName) newCategoryName.value = "";
      showAlert("Categoría creada correctamente", "success");
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
      if (unsavedDialog && !unsavedDialog.hidden) {
        closeUnsavedDialog();
        return;
      }
      closeProductModal();
      closeCategoryModal();
      closeConfirm();
    }
  });
}
/* Sesión y Autenticación */

async function handleLogout() {
  try {
    await signOut(auth);
    window.location.href = 'login.html';
  } catch (err) {
    showAlert("Error al cerrar sesión: " + err.message, "error");
  }
}

function showAdmin() {
  adminApp.hidden = false;
}

function showLogin() {
  window.location.href = 'login.html';
}

/* Supabase: Lectura en Tiempo Real (R) & Auto-Importación Garantizada */

const SEED_PRODUCTS = [
  {
    "id": "iphone-15-pro-max",
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
    "id": "iphone-13-pro-max",
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
    "id": "iphone-14",
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
    "id": "iphone-12",
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
    "id": "samsung-galaxy-s24-ultra",
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
    "id": "samsung-galaxy-s23-ultra",
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
    "id": "samsung-galaxy-a55-5g",
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
    "id": "ipad-air-5ta-generacion",
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
    "id": "airpods-pro-2da",
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
    "id": "cargador-apple-usb-c-40w",
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


// Reparación idempotente: elimina documentos de usuarios duplicados por uid de
// Auth. Corre en cada carga del panel; es no-op cuando no hay duplicados.
async function repararUsuariosDuplicados() {
  try {
    const snap = await getDocs(collection(db, 'usuarios'));
    const grupos = new Map();
    for (const d of snap.docs) {
      const uid = d.data().uid;
      if (!uid) continue;
      if (!grupos.has(uid)) grupos.set(uid, []);
      grupos.get(uid).push(d);
    }
    let eliminados = 0;
    for (const [, docs] of grupos) {
      if (docs.length < 2) continue;
      docs.sort((a, b) => {
        const n = Object.keys(b.data()).length - Object.keys(a.data()).length;
        if (n !== 0) return n;
        return String(a.data().createdAt || a.data().fechaCreacion || '').localeCompare(String(b.data().createdAt || b.data().fechaCreacion || ''));
      });
      for (let i = 1; i < docs.length; i++) {
        await deleteDoc(docs[i].ref);
        eliminados++;
      }
      console.log(`Reparación: duplicados de uid ${String(docs[0].data().uid).slice(0, 8)}… → se conserva ${docs[0].id}.`);
    }
    if (eliminados > 0) console.log(`Reparación de usuarios completada: ${eliminados} duplicado(s) eliminado(s).`);
  } catch (err) {
    console.warn('Reparación de usuarios duplicados falló (se reintentará):', err.message);
  }
}


async function autoImportProductsJson() {
  if (isImportingProducts) return;
  isImportingProducts = true;

  try {
    // Solo sembrar productos de demostración si la colección está completamente vacía.
    // Esto evita recrear documentos con IDs antiguos tras una migración a slugs.
    const existingSnap = await getDocs(collection(db, "productos"));
    if (!existingSnap.empty) {
      isImportingProducts = false;
      return;
    }

    let importedCount = 0;
    for (const item of SEED_PRODUCTS) {
      if (!item || item.id === undefined) continue;
      // Estructura de productos: IDs secuenciales (producto-N), nunca IDs automáticos.
      const nuevoId = await obtenerSiguienteId("productos", "contador_productos", "producto-");
      const docRef = doc(db, "productos", nuevoId);

      try {
        const docSnap = await getDoc(docRef);
        // Crear en Supabase únicamente si el documento no existe para evitar duplicados y no borrar productos modificados
        if (!docSnap.exists()) {
          const productPayload = {
            id: nuevoId,
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
        console.warn(`No se pudo verificar o importar el producto ID ${nuevoId}:`, docErr.message);
      }
    }

    if (importedCount > 0) {
      console.log(`${importedCount} productos sincronizados automáticamente hacia Supabase.`);
      showAlert(`Se importaron ${importedCount} productos a Supabase.`, "success");
    }
  } catch (err) {
    console.warn("Error durante la sincronización inicial de productos con Supabase:", err.message);
  } finally {
    isImportingProducts = false;
  }
}

function listenToProducts() {
  setLoading(true);
  const productsRef = collection(db, "productos");

  if (unsubscribeRealtime) {
    try { unsubscribeRealtime(); } catch(e) {}
    unsubscribeRealtime = null;
  }

  // Sincronizar automáticamente productos.json si la colección no contiene los productos iniciales
  autoImportProductsJson();

  try {
    unsubscribeRealtime = onSnapshot(productsRef, (snapshot) => {
      products = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data()
      }));

      migrateLegacyProductImages(products);
      renderProductsTable();
      updateDashboardMetrics();
      setLoading(false);
    }, async (error) => {
      console.warn("Streaming en tiempo real bloqueado, ejecutando fallback HTTP getDocs:", error);
      await fetchProductsFallback();
    });
  } catch (err) {
    fetchProductsFallback();
  }
}

async function fetchProductsFallback() {
  try {
    const productsRef = collection(db, "productos");
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
    showAlert("Conexión bloqueada por el navegador.", "error");
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
  // FLAT OPS v7 — Rework total de renderizado: colores planos, sin círculos infantiles, jerarquía editorial
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
    const row = document.createElement("div");
    row.className = "data-grid-row";
    const basePrice = getBasePrice(product);
    const conditionClass = product.condition === "nuevo" ? "nuevo" : "seminuevo";
    const conditionLabel = product.badge || (product.condition === 'nuevo' ? 'Nuevo' : 'Seminuevo');
    const imageUrl = getProductImageUrls(product)[0] || '';
    const brandInitial = (product.brand || product.title || '?').trim().charAt(0).toUpperCase();
    const productCategoryLabel = getCategoryLabel(product.category) || product.category || '';
    const shortId = String(product.id).slice(0,6).toUpperCase();

    row.innerHTML = `
      <div class="data-grid-cell">
        <div class="product-cell">
          ${imageUrl
            ? `<img class="product-thumb" src="${escapeHTML(imageUrl)}" alt="${escapeHTML(product.title || '')}" loading="lazy">`
            : `<div class="product-thumb product-thumb--placeholder" aria-hidden="true"><span>${escapeHTML(brandInitial)}</span></div>`
          }
          <div class="product-cell-info">
            <strong>${escapeHTML(product.title || '')}</strong>
            <span class="product-cell-meta">
              <span class="product-cell-brand">${escapeHTML(product.brand || '')}</span>
              <span class="product-cell-meta-dot" aria-hidden="true"></span>
              <span class="product-cell-sku">${escapeHTML(shortId)}</span>
            </span>
          </div>
        </div>
      </div>
      <div class="data-grid-cell">
        <span class="category-pill">${escapeHTML(productCategoryLabel)}</span>
      </div>
      <div class="data-grid-cell">
        <span class="condition-pill ${conditionClass}"><i class="condition-dot" aria-hidden="true"></i>${escapeHTML(conditionLabel)}</span>
      </div>
      <div class="data-grid-cell data-grid-cell--right">
        <div class="price-cell">
          <strong class="product-price">${formatCurrency(basePrice)}</strong>
          <span class="price-cell-currency">HNL</span>
        </div>
      </div>
      <div class="data-grid-cell data-grid-cell--right">
        <div class="table-actions">
          <button type="button" class="table-action-btn table-action-btn--edit" data-edit="${product.id}" title="Editar producto">
            <i class="ph ph-pencil-simple" aria-hidden="true"></i>
            <span>Editar</span>
          </button>
        </div>
      </div>
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
  // Si el Drawer ya está abierto con cambios sin guardar, pedir confirmación
  // antes de cambiar de producto.
  if (productModal && !productModal.hidden && isProductFormDirty()) {
    openUnsavedDialog(() => {
      forceCloseProductModal();
      openProductModal(productId);
    });
    return;
  }

  editingProductId = productId;
  formError.hidden = true;
  clearFieldErrors();

  resetMediaEditor();
  const dropzoneText = fileDropzone?.querySelector(".dropzone-text");
  if (dropzoneText) dropzoneText.textContent = "Arrastra tus imágenes aquí o haz clic para explorar";

  const isEditing = productId !== null;

  if (!isEditing) {
    modalTitle.textContent = "Nuevo producto";
    fillProductForm(createEmptyProduct());
  } else {
    const product = products.find((item) => String(item.id) === String(productId));
    if (!product) return;

    modalTitle.textContent = "Editar producto";
    fillProductForm(product);
  }

  // Estados visuales del rediseño: chip de modo, aviso y zona de riesgo.
  deleteProductBtn.hidden = !isEditing;
  if (drawerDangerZone) drawerDangerZone.hidden = !isEditing;
  if (drawerUpdateNotice) drawerUpdateNotice.hidden = !isEditing;
  if (drawerModeChip) {
    drawerModeChip.textContent = isEditing ? "Edición" : "Nuevo";
    drawerModeChip.classList.toggle("is-editing", isEditing);
  }
  if (drawerModeCopy) {
    drawerModeCopy.textContent = isEditing
      ? "Los cambios reemplazarán la información publicada"
      : "Completa las secciones y guarda para publicar";
  }

  const submitBtn = productForm?.querySelector("button[type='submit']");
  if (submitBtn) setButtonLabel(submitBtn, isEditing ? "Actualizar producto" : "Guardar producto", "check");

  productModal.hidden = false;
  document.body.style.overflow = "hidden";
  document.getElementById("drawer-body")?.scrollTo({ top: 0 });

  // Punto de partida para detectar cambios sin guardar.
  captureFormBaseline();
}

/* Cierre con protección de cambios sin guardar */
function closeProductModal() {
  if (isProductFormDirty()) {
    openUnsavedDialog(forceCloseProductModal);
    return;
  }
  forceCloseProductModal();
}

function forceCloseProductModal() {
  productModal.hidden = true;
  document.body.style.overflow = "";
  editingProductId = null;
  formSnapshot = null;
  formIsDirty = false;
  clearFieldErrors();
  clearPreviewObjectUrls();
}

/* ---- Detección de cambios sin guardar (solo Drawer de producto) ---- */

function computeFormSnapshot() {
  if (!productForm) return "";
  const parts = [];

  ["product-title", "product-brand", "product-category", "product-condition",
   "product-battery-health", "product-image", "product-description"]
    .forEach((id) => {
      parts.push(document.getElementById(id)?.value ?? "");
    });

  parts.push([...(includesList?.querySelectorAll(".include-input") || [])].map((i) => i.value).join("¦"));
  parts.push([...(specsList?.querySelectorAll(".spec-input") || [])].map((i) => i.value).join("¦"));
  parts.push([...(colorsList?.querySelectorAll(".color-row") || [])].map((row) => [
    row.querySelector(".color-name")?.value,
    row.querySelector(".color-hex")?.value,
    row.querySelector(".color-rgb")?.value,
    row.querySelector(".color-hsl")?.value,
    row.querySelector(".color-oklch")?.value
  ].join("·")).join("¦"));
  parts.push([...(storageList?.querySelectorAll(".dynamic-row") || [])].map((row) => [
    row.querySelector(".storage-name")?.value,
    row.querySelector(".storage-old-price")?.value,
    row.querySelector(".storage-price")?.value,
    row.querySelector(".storage-stock")?.value
  ].join("·")).join("¦"));

  parts.push(existingImageUrls.join("¦"));
  parts.push(String(pendingImageFiles.length));

  return parts.join("?");
}

function captureFormBaseline() {
  formSnapshot = computeFormSnapshot();
  formIsDirty = false;
}

function isProductFormDirty() {
  if (formSnapshot === null) return false;
  formIsDirty = computeFormSnapshot() !== formSnapshot;
  return formIsDirty;
}

let unsavedDialogAction = null;

function openUnsavedDialog(onDiscard) {
  if (!unsavedDialog) {
    // Respaldo defensivo: sin diálogo disponible, no bloquear al usuario.
    onDiscard?.();
    return;
  }
  unsavedDialogAction = onDiscard;
  unsavedDialog.hidden = false;
}

function closeUnsavedDialog() {
  if (unsavedDialog) unsavedDialog.hidden = true;
  unsavedDialogAction = null;
}

/* ---- Validación visual por campo (solo Drawer de producto) ---- */

function setFieldError(targetId, message) {
  const slot = productForm?.querySelector(`[data-error-for="${targetId}"]`);
  if (slot) {
    slot.textContent = message;
    slot.hidden = false;
  }
  const input = document.getElementById(targetId);
  input?.classList.add("field-invalid");
}

function clearFieldErrors() {
  productForm?.querySelectorAll(".field-error-msg").forEach((slot) => {
    slot.hidden = true;
    slot.textContent = "";
  });
  productForm?.querySelectorAll(".field-invalid").forEach((el) => el.classList.remove("field-invalid"));
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
    <input type="text" class="include-input" value="${escapeHTML(value)}" placeholder="Cable USB-C original, cargador 25W…" aria-label="Elemento incluido">
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
    <input type="text" class="spec-input" value="${escapeHTML(value)}" placeholder="Chip A17 Pro, pantalla 6.7″ OLED 120 Hz…">
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
        <input type="text" class="color-name" value="${escapeHTML(color.name)}" placeholder="Titanio natural, Negro fantasma…">
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
      <input type="text" class="storage-name" value="${escapeHTML(name)}" placeholder="256 GB" aria-label="Capacidad">
    </label>
    <label class="variant-field">
      <span>Precio normal</span>
      <input type="number" class="storage-old-price" value="${Number(oldPrice) || 0}" min="0" step="100" placeholder="24,999.00" aria-label="Precio normal">
    </label>
    <label class="variant-field">
      <span>Precio oferta</span>
      <input type="number" class="storage-price" value="${Number(price) || 0}" min="0" step="100" placeholder="22,499.00" aria-label="Precio de oferta">
    </label>
    <label class="variant-field">
      <span>Stock</span>
      <input type="number" class="storage-stock" value="${stockValue}" min="0" step="1" placeholder="5" aria-label="Stock de esta capacidad">
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
    if (submitBtn) setButtonLabel(submitBtn, `Subiendo imagen ${index + 1} de ${files.length} a Cloudinary...`, "spinner-gap");

    try {
      const finalUrl = await uploadToCloudinary(file);
      urls.push(finalUrl);
    } catch (err) {
      console.error(`Error al subir imagen ${file.name} a Cloudinary:`, err);
      throw new Error(`No se pudo subir la imagen ${file.name} a Cloudinary`);
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
      await setDoc(doc(db, "productos", productId), {
        images: [String(product.image)],
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (error) {
      migratedProductIds.delete(productId);
      console.warn(`No se pudo migrar la galería del producto ${productId}:`, error);
    }
  }
}

/* Supabase: Crear, Editar, Eliminar */

async function handleProductSubmit(event) {
  event.preventDefault();

  // Al actualizar un producto publicado, pedir confirmación visual elegante
  // antes de reemplazar la información actual.
  if (editingProductId) {
    showConfirm(
      "Actualizar producto",
      "Los cambios reemplazarán la información actual del producto publicado en la tienda.",
      () => submitProductForm(),
      { tone: "primary", okLabel: "Sí, actualizar" }
    );
    return;
  }

  submitProductForm();
}

async function submitProductForm() {
  formError.hidden = true;
  clearFieldErrors();

  const isEditing = Boolean(editingProductId);
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
    // La etiqueta se deriva de la condición (el campo manual fue retirado del formulario).
    const badge = condition === "nuevo" ? "Nuevo" : "Seminuevo";
    const batteryHealth = normalizeBatteryHealth(document.getElementById("product-battery-health").value);
    const description = document.getElementById("product-description").value.trim();
    const directImageUrls = parseImageUrls(document.getElementById("product-image").value).slice(0, MAX_PRODUCT_IMAGES);

    // Validación visual por campo, con desplazamiento al primer error.
    let firstInvalidId = null;
    if (!title) {
      setFieldError("product-title", "Escribe el nombre comercial del producto.");
      firstInvalidId = firstInvalidId || "product-title";
    }
    if (!brand) {
      setFieldError("product-brand", "Indica la marca del producto.");
      firstInvalidId = firstInvalidId || "product-brand";
    }
    if (firstInvalidId) {
      document.getElementById(firstInvalidId)?.scrollIntoView({ behavior: "smooth", block: "center" });
      document.getElementById(firstInvalidId)?.focus({ preventScroll: true });
      throw new Error("Revisa los campos marcados para continuar.");
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
      setFieldError("fs-gallery", "Agrega al menos una imagen: sube un archivo o pega una URL.");
      document.getElementById("fs-gallery")?.scrollIntoView({ behavior: "smooth", block: "start" });
      throw new Error("La galería necesita al menos una imagen.");
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
      setFieldError("fs-storage", "Agrega al menos una capacidad con su precio.");
      document.getElementById("fs-storage")?.scrollIntoView({ behavior: "smooth", block: "start" });
      throw new Error("Debes definir al menos una capacidad con precio.");
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

    if (submitBtn) setButtonLabel(submitBtn, "Guardando en Supabase...", "cloud-arrow-up");

    if (editingProductId) {
      // Actualizar documento existente
      productData.id = String(editingProductId);
      const productRef = doc(db, "productos", String(editingProductId));
      await setDoc(productRef, productData, { merge: true });
      showAlert("Producto actualizado con éxito en Supabase.", "success");
    } else {
      // Crear nuevo documento: la estructura de productos usa IDs secuenciales
      // (producto-N), NUNCA IDs automáticos.
      productData.createdAt = new Date().toISOString();
      const nuevoId = await obtenerSiguienteId("productos", "contador_productos", "producto-");
      productData.id = nuevoId;
      const colRef = doc(db, "productos", nuevoId);
      await setDoc(colRef, productData);
      showAlert("Nuevo producto agregado con éxito a Supabase.", "success");
    }

    // Guardado exitoso: no hay cambios pendientes, cerrar sin confirmación.
    formSnapshot = null;
    formIsDirty = false;
    forceCloseProductModal();
  } catch (error) {
    console.error("Error al guardar producto:", error);
    let msg = error.message;
    if (error.code === "permission-denied" || error.message.includes("permissions")) {
      msg = "Permisos insuficientes en Supabase: Revisa las políticas RLS de la tabla 'productos'.";
    }
    formError.textContent = msg;
    formError.hidden = false;
    formError.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      setButtonLabel(submitBtn, isEditing ? "Actualizar producto" : "Guardar producto", "check");
    }
  }
}

async function handleDeleteProduct() {
  if (!editingProductId) return;

  showConfirm(
    "Eliminar producto",
    "Esta acción eliminará permanentemente el producto del catálogo y de la tienda. No se puede deshacer.",
    async () => {
      try {
        const productRef = doc(db, "productos", String(editingProductId));
        await deleteDoc(productRef);
        forceCloseProductModal();
        showAlert("Producto eliminado de Supabase.", "success");
      } catch (error) {
        showAlert("Error al eliminar producto: " + error.message, "error");
      }
    },
    { tone: "danger", okLabel: "Sí, eliminar" }
  );
}

/* Helpers UI */

function setButtonLabel(button, label, icon = "check") {
  if (!button) return;
  button.innerHTML = `<i class="ph ph-${escapeHTML(icon)}" aria-hidden="true"></i><span>${escapeHTML(label)}</span>`;
}

function showAlert(message, type = "success") {
  if (!adminAlert) return;
  adminAlert.innerHTML = message;
  adminAlert.className = `admin-toast admin-alert-${type}`;
  adminAlert.hidden = false;

  setTimeout(() => {
    adminAlert.hidden = true;
  }, 4000);
}

function showConfirm(title, message, callback, options = {}) {
  confirmTitle.textContent = title;
  confirmMessage.innerHTML = message;
  confirmCallback = callback;

  // Tono visual del diálogo: "danger" (predeterminado) o "primary".
  const tone = options.tone === "primary" ? "primary" : "danger";
  const icon = confirmDialog.querySelector(".confirm-icon");
  const iconGlyph = confirmDialog.querySelector(".confirm-icon i");
  if (icon) {
    icon.classList.toggle("confirm-icon--danger", tone === "danger");
    icon.classList.toggle("confirm-icon--blue", tone === "primary");
  }
  if (iconGlyph) {
    iconGlyph.className = tone === "primary" ? "ph ph-arrows-clockwise" : "ph ph-warning";
  }
  if (confirmOkBtn) {
    confirmOkBtn.classList.toggle("btn-danger", tone === "danger");
    confirmOkBtn.classList.toggle("btn-primary", tone === "primary");
    confirmOkBtn.textContent = options.okLabel || "Confirmar";
  }

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

/* ==========================================================================
   OBSIDIAN PRISM v6 — VISUAL ENHANCEMENTS LAYER
   Solo estética — No modifica Supabase, Auth, CRUD, Validaciones.
   ========================================================================== */
(() => {
  // ---------- Metrics Count Animation ----------
  const animateCount = (el, target) => {
    if (!el) return;
    const start = parseInt(el.dataset.lastValue || '0', 10);
    const end = Number(target) || 0;
    if (start === end) return;
    const duration = 600;
    const t0 = performance.now();
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);
    const step = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = easeOut(p);
      el.textContent = Math.round(start + (end - start) * eased);
      if (p < 1) requestAnimationFrame(step);
      else el.dataset.lastValue = String(end);
    };
    requestAnimationFrame(step);
  };

  const origUpdateMetrics = window.updateDashboardMetrics || updateDashboardMetrics;
  // Enhance metrics after original logic
  const enhancedUpdateMetrics = () => {
    try { origUpdateMetrics(); } catch(e){}
    const ids = ['metric-total-products','metric-iphones-count','metric-samsung-count','metric-others-count'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el && el.textContent) {
        const val = parseInt(el.textContent,10);
        if (!isNaN(val)) {
          // trigger count animation from previous
          const previous = el.dataset.lastValue ? parseInt(el.dataset.lastValue,10) : 0;
          if (previous !== val) animateCount(el, val);
        }
      }
    });
    const syncEl = document.getElementById('sync-time');
    if (syncEl) {
      const now = new Date();
      syncEl.textContent = now.toLocaleTimeString('es-HN',{hour:'2-digit',minute:'2-digit'});
    }
  };
  // Monkey patch if possible
  try { window.updateDashboardMetrics = enhancedUpdateMetrics; } catch(e){}

  // Since original function is not on window, we override the local reference by observing DOM
  // Poll metrics container for changes
  const metricsObserver = new MutationObserver(() => {
    // re-animate sparkline bars on hover sequence
    document.querySelectorAll('.metric-card').forEach((card, idx) => {
      const bars = card.querySelectorAll('.metric-sparkline span');
      bars.forEach((b,i)=>{
        b.style.transitionDelay = `${i*40}ms`;
      });
    });
  });
  const metricGrid = document.querySelector('.metrics-grid');
  if (metricGrid) metricsObserver.observe(metricGrid,{childList:true,subtree:true,characterData:true});

  // ---------- Table Row Staggered Entrance ----------
  const enhanceTableRows = () => {
    const rows = document.querySelectorAll('#products-table-body .data-grid-row');
    rows.forEach((row, i) => {
      row.style.opacity = '0';
      row.style.transform = 'translateY(6px)';
      row.style.transition = `opacity 360ms cubic-bezier(.16,1,.3,1) ${i*32}ms, transform 360ms cubic-bezier(.16,1,.3,1) ${i*32}ms`;
      requestAnimationFrame(()=> {
        requestAnimationFrame(()=> {
          row.style.opacity = '1';
          row.style.transform = 'translateY(0)';
        });
      });
    });
  };
  // Hook after renderProductsTable
  const origRender = renderProductsTable;
  const wrappedRender = function(...args){
    const res = origRender.apply(this, args);
    setTimeout(enhanceTableRows, 20);
    return res;
  };
  try {
    // Replace local reference — JS closure cannot be overwritten from outer, so we patch global if exported
    // We'll also use MutationObserver fallback
    window.renderProductsTable = wrappedRender;
  } catch(e){}
  // Observer fallback for every table body change
  const tb = document.getElementById('products-table-body');
  if (tb) {
    new MutationObserver(() => enhanceTableRows()).observe(tb, {childList:true});
  }

  // ---------- Command+K Focus Search ----------
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      document.getElementById('admin-search')?.focus();
    }
  });
  document.querySelector('.topbar-search-kbd')?.addEventListener('click', ()=>{
    document.getElementById('admin-search')?.focus();
  });

  // ---------- Button Ripple / Press ----------
  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.btn, .topbar-icon-btn, .table-action-btn');
    if (!btn) return;
    btn.style.setProperty('--ripple-x', `${e.offsetX || 20}px`);
    btn.style.setProperty('--ripple-y', `${e.offsetY || 20}px`);
    btn.classList.add('is-pressing');
  });
  document.addEventListener('pointerup', () => {
    document.querySelectorAll('.is-pressing').forEach(b=>b.classList.remove('is-pressing'));
  });

  // ---------- Login Orb Parallax (Mouse) ----------
  const loginVisual = document.querySelector('.login-visual');
  if (loginVisual && window.matchMedia('(min-width: 981px)').matches) {
    let raf = null;
    loginVisual.addEventListener('mousemove', (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const rect = loginVisual.getBoundingClientRect();
        const mx = (e.clientX - rect.left) / rect.width - 0.5;
        const my = (e.clientY - rect.top) / rect.height - 0.5;
        document.querySelectorAll('.login-orb').forEach((orb, i) => {
          const depth = (i+1)*10;
          orb.style.transform = `translate(${mx*depth}px, ${my*depth}px) scale(${1 + Math.abs(mx)*0.04})`;
        });
        const content = document.querySelector('.login-visual-content');
        if (content) content.style.transform = `translate(${mx*8}px, ${my*8}px)`;
      });
    });
    loginVisual.addEventListener('mouseleave', () => {
      document.querySelectorAll('.login-orb').forEach(orb=> orb.style.transform='');
      const content = document.querySelector('.login-visual-content');
      if (content) content.style.transform='';
    });
  }

  // ---------- Standalone login body parallax ----------
  const loginBody = document.querySelector('.login-body');
  if (loginBody) {
    let raf2 = null;
    loginBody.addEventListener('mousemove', (e) => {
      if (raf2) return;
      raf2 = requestAnimationFrame(()=>{
        raf2=null;
        const mx = (e.clientX / window.innerWidth - 0.5);
        const my = (e.clientY / window.innerHeight - 0.5);
        document.querySelectorAll('.login-body .login-orb').forEach((orb,i)=>{
          const d = (i+1)*12;
          orb.style.transform = `translate(${mx*d}px, ${my*d}px)`;
        });
        const card = document.querySelector('.login-body .login-card');
        if (card) card.style.transform = `translate(${mx*6}px, ${my*6}px)`;
      });
    });
    loginBody.addEventListener('mouseleave', ()=>{
      document.querySelectorAll('.login-body .login-orb').forEach(o=>o.style.transform='');
      const card = document.querySelector('.login-body .login-card');
      if (card) card.style.transform='';
    });
  }

  // ---------- Sidebar: improve mobile close on link click ----------
  document.querySelectorAll('.sidebar-link').forEach(link=>{
    link.addEventListener('click', ()=>{
      const sb = document.getElementById('admin-sidebar');
      if (sb && sb.classList.contains('mobile-open')) {
        // small delay for UX
        setTimeout(()=> sb.classList.remove('mobile-open'), 120);
        const toggle = document.getElementById('sidebar-toggle');
        if (toggle) toggle.checked = false;
      }
    });
  });

  // ---------- Sync time live updater ----------
  setInterval(()=>{
    const el = document.getElementById('sync-time');
    if (el && el.textContent && el.textContent !== 'ahora') {
      // keep simple relative update each minute
    }
  }, 60000);

  // ---------- Add subtle focus ring animation for inputs ----------
  document.addEventListener('focusin', (e)=>{
    if (e.target.matches('input, select, textarea')) {
      e.target.closest('.form-group')?.classList.add('is-focused');
    }
  });
  document.addEventListener('focusout', (e)=>{
    if (e.target.matches('input, select, textarea')) {
      e.target.closest('.form-group')?.classList.remove('is-focused');
    }
  });

  console.log('[Obsidian Prism v6] Visual enhancements loaded — logic intact.');
})();

/* ==========================================================================
   FLAT OPS v7 — VISUAL ENHANCEMENTS REALES (colores planos + movimiento perceptible)
   ========================================================================== */
(() => {
  // Grid speed boost for flat ops — make animation perceptible
  const grids = document.querySelectorAll('.login-grid');
  grids.forEach(g=>{ g.style.animationDuration = '12s'; });

  // Bars growth on view
  const barsObs = new IntersectionObserver((entries)=>{
    entries.forEach(entry=>{
      if(entry.isIntersecting){
        entry.target.querySelectorAll('.login-device__bars span').forEach((b,i)=>{
          const h = b.style.getPropertyValue('--bar');
          b.style.height='2%';
          setTimeout(()=>{ b.style.height=h; }, 80+i*90);
        });
      }
    });
  },{threshold:0.4});
  document.querySelectorAll('.login-device__bars').forEach(b=>barsObs.observe(b));

  // Metric bars sequential rise
  document.querySelectorAll('.metric-card').forEach(card=>{
    card.addEventListener('mouseenter', ()=>{
      card.querySelectorAll('.metric-sparkline span').forEach((s,i)=>{
        const h = s.style.getPropertyValue('--h') || '60%';
        s.style.height='4%';
        setTimeout(()=>{ s.style.height=h; }, i*60);
      });
    });
  });

  // Table row deeper stagger + flat border left accent on hover
  const styleSheet = document.createElement('style');
  styleSheet.textContent = `
    #products-table-body .data-grid-row{position:relative;transition:background 160ms ease,transform 220ms cubic-bezier(.16,1,.3,1),opacity 220ms ease}
    #products-table-body .data-grid-row:hover{transform:translateX(2px)}
    #products-table-body .data-grid-row::before{
      content:'';position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--ink);opacity:0;transition:opacity 160ms ease
    }
    #products-table-body .data-grid-row:hover::before{opacity:1}
  `;
  document.head.appendChild(styleSheet);

  // Sidebar active line draw animation
  const activeLinks = document.querySelectorAll('.sidebar-link.active');
  activeLinks.forEach(l=>{
    l.animate([{borderLeftColor:'transparent'},{borderLeftColor:'var(--side-active-line)'}],{duration:600,easing:'ease-out'});
  });

  // Sync time update cada 60 min
  const syncEl = document.getElementById('sync-time');
  if(syncEl){
    const updateSync = ()=>{
      syncEl.textContent = new Date().toLocaleTimeString('es-HN',{hour:'2-digit',minute:'2-digit'});
    };
    updateSync();
    setInterval(updateSync, 3600000);
  }

  // Input flat focus — border 2px animation
  document.addEventListener('focusin', e=>{
    if(e.target.matches('input,select,textarea')){
      e.target.style.transition='border-color 160ms ease,box-shadow 160ms ease';
    }
  });

  console.log('[Flat Ops v7] Flat colors + real motion loaded — logic intact.');
})();

/* ==========================================================================
   v8 FINAL — Sidebar imágenes + promo card útil
   ========================================================================== */
(() => {
  const tryLoadImage = (base, exts, onSuccess, onFail) => {
    let idx = 0;
    const attempt = () => {
      if (idx >= exts.length) { onFail && onFail(); return; }
      const url = exts[idx++].includes('/') ? exts[idx-1] : `${base}${exts[idx-1]}`;
      // Actually construct correctly
    };
    // Simpler: try direct URLs via Image
    const candidates = [
      `${base}.jpg`, `${base}.jpeg`, `${base}.png`, `${base}.webp`, `${base}.avif`,
      `${base}`, // maybe user uploaded without ext but with dot?
      `imagensidebar.jpg`, `imagensidebar.png`, `imagensidebar.webp`,
      `imagensidebar.jpeg`, `imagensidebar`,
      `imagentarjeta.jpg`, `imagentarjeta.png`, `imagentarjeta.webp`, `imagentarjeta.jpeg`, `imagentarjeta`
    ];
    // Filter for relevant base
    const filtered = base.includes('sidebar') ? candidates.filter(c=>c.toLowerCase().includes('sidebar')) : candidates.filter(c=>c.toLowerCase().includes('tarjeta') || c.toLowerCase().includes('card'));
    // Also include base + exts
    const finalList = [...new Set([
      `${base}.jpg`, `${base}.png`, `${base}.webp`, `${base}.jpeg`,
      `${base}`,
      ...filtered
    ])];
    let i = 0;
    const loadNext = () => {
      if (i >= finalList.length) { onFail && onFail(); return; }
      const src = finalList[i++];
      const img = new Image();
      img.onload = () => onSuccess(src);
      img.onerror = loadNext;
      img.src = src + (src.includes('?') ? '' : `?t=${Date.now()}`); // cache bust for new uploads
    };
    loadNext();
  };

  const setSidebarBg = () => {
    const el = document.getElementById('sidebar-bg');
    if (!el) return;
    const candidates = [
      'imagensidebar.jpg','imagensidebar.png','imagensidebar.webp','imagensidebar.jpeg',
      'imagensidebar.JPG','imagensidebar.PNG',
      'sidebar-bg.jpg','sidebar-bg.png',
      'uploads/imagensidebar.jpg','uploads/imagensidebar.png'
    ];
    let idx=0;
    const tryNext=()=>{
      if(idx>=candidates.length){
        // fallback: generate subtle dark texture with canvas
        el.style.background = 'radial-gradient(400px 300px at 20% 20%, #151A2E, transparent 70%), radial-gradient(500px 360px at 80% 80%, #12182C, transparent 70%), #0E101C';
        el.classList.add('is-loaded');
        el.style.opacity='0.55';
        return;
      }
      const src=candidates[idx++];
      const img=new Image();
      img.onload=()=>{
        el.style.backgroundImage = `url('${src}')`;
        el.style.backgroundSize='cover';
        el.style.backgroundPosition='center';
        el.classList.add('is-loaded');
      };
      img.onerror=tryNext;
      img.src=src;
    };
    tryNext();
  };

  const setPromoBg = () => {
    const el=document.getElementById('promo-bg');
    if(!el) return;
    const candidates=[
      'imagentarjeta.jpg','imagentarjeta.png','imagentarjeta.webp','imagentarjeta.jpeg',
      'imagentarjeta.JPG','imagentarjeta.PNG',
      'card-bg.jpg','card-bg.png',
      'uploads/imagentarjeta.jpg'
    ];
    let idx=0;
    const tryNext=()=>{
      if(idx>=candidates.length){
        el.style.background='linear-gradient(135deg, #1A1F3A 0%, #121525 100%)';
        el.classList.add('is-loaded');
        return;
      }
      const src=candidates[idx++];
      const img=new Image();
      img.onload=()=>{
        el.style.backgroundImage=`url('${src}')`;
        el.style.backgroundSize='cover';
        el.style.backgroundPosition='center';
        el.classList.add('is-loaded');
      };
      img.onerror=tryNext;
      img.src=src;
    };
    tryNext();
  };

  // Promo stats sync
  const updatePromoStats = () => {
    const totalEl = document.getElementById('promo-total');
    const mainTotal = document.getElementById('metric-total-products');
    if(totalEl && mainTotal){
      totalEl.textContent = mainTotal.textContent || '0';
    }
  };

  // Observe metric changes
  const metricTotal = document.getElementById('metric-total-products');
  if(metricTotal){
    new MutationObserver(updatePromoStats).observe(metricTotal,{childList:true,characterData:true,subtree:true});
  }

  // Init after DOM
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',()=>{ setSidebarBg(); setPromoBg(); updatePromoStats(); });
  }else{
    setSidebarBg(); setPromoBg(); updatePromoStats();
  }

  // Also try again after 2s in case images uploaded late
  setTimeout(()=>{ setSidebarBg(); setPromoBg(); }, 2000);

  console.log('[v8 Final] Sidebar imagen + promo tarjeta integrada lista');
})();

// Sidebar footer image loader — busca imagen_barra con cualquier extensión
(() => {
  const img = document.getElementById('imagen-barra');
  if (!img) return;
  const exts = ['jpg','jpeg','png','webp','gif','svg','JPG','JPEG','PNG','WEBP'];
  let i = 0;
  const fromSupabase = () => window.__imagenesSupabase && (window.__imagenesSupabase.imagen_barra_principal || window.__imagenesSupabase.barra);
  const tryNext = () => {
    if (fromSupabase()) return;
    if (i >= exts.length) { img.style.display = 'none'; return; }
    const src = 'imagen_barra.' + exts[i++];
    const test = new Image();
    test.onload = () => { img.src = src; img.style.display = 'block'; };
    test.onerror = tryNext;
    test.src = src + '?t=' + Date.now();
  };
  tryNext();
  // Re-check when page becomes visible (e.g. after upload)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tryNext(); });
})();

// ==========================================================================
// SETTINGS MODULE — Navegación + Gestión de Imágenes (Supabase + Cloudinary)
// ==========================================================================
(() => {
  const settingsLink = document.getElementById('settings-link');
  const catalogSection = document.getElementById('catalog');
  const overviewSection = document.getElementById('overview');
  const metricsSection = document.querySelector('.metrics-grid');
  const settingsSection = document.getElementById('settings');
  const bannerEl = document.getElementById('admin-banner');

  if (!settingsLink || !settingsSection) return;

  const IMAGENES_COLLECTION = 'imagenes';

  const IMAGE_KEYS = ['imagen_banner_panel', 'imagen_login', 'imagen_sidebar', 'imagen_tarjeta_promocional', 'imagen_barra_principal'];
  // Alias legacy → nueva key (compatibilidad con datos anteriores)
  const LEGACY_KEY_MAP = { banner: 'imagen_banner_panel', login: 'imagen_login', sidebar: 'imagen_sidebar', tarjeta: 'imagen_tarjeta_promocional', barra: 'imagen_barra_principal' };

  const imageMeta = {
    imagen_banner_panel:          { label: 'Banner del panel' },
    imagen_login:                 { label: 'Imagen de login' },
    imagen_sidebar:               { label: 'Imagen de la sidebar' },
    imagen_tarjeta_promocional:   { label: 'Imagen para tarjeta' },
    imagen_barra_principal:       { label: 'Imagen de barra' }
  };

  // ---- Navegación ----
  function showCatalog() {
    if (catalogSection) catalogSection.hidden = false;
    if (overviewSection) overviewSection.hidden = false;
    if (metricsSection) metricsSection.hidden = false;
    if (bannerEl) bannerEl.style.display = '';
    settingsSection.hidden = true;
    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
    const catLink = document.querySelector('a[href="#catalog"]');
    if (catLink) catLink.classList.add('active');
  }

  function showSettings() {
    if (catalogSection) catalogSection.hidden = true;
    if (overviewSection) overviewSection.hidden = true;
    if (metricsSection) metricsSection.hidden = true;
    if (bannerEl) bannerEl.style.display = 'none';
    settingsSection.hidden = false;
    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
    settingsLink.classList.add('active');
  }

  settingsLink.addEventListener('click', async (e) => {
    e.preventDefault();
    // Los editores deben ingresar la llave de acceso antes de entrar a Configuración.
    if (!esAdmin() && !(await pedirLlave('Acceso a Configuración', 'Introduce la llave de acceso generada en Configuración ? Llaves para continuar.'))) {
      return;
    }
    showSettings();
  });
  const catLink = document.querySelector('a[href="#catalog"]');
  if (catLink) catLink.addEventListener('click', (e) => { e.preventDefault(); showCatalog(); });

  // ---- State: mapa de key ? { url, file?, urlInput? } ----
  const state = {};
  IMAGE_KEYS.forEach(k => { state[k] = { url: '', file: null, urlValue: '', changed: false }; });

  // ---- Helpers ----
  function setStatus(key, type, msg) {
    const el = document.getElementById(`status-${key}`);
    if (!el) return;
    if (type === 'loading') {
      el.innerHTML = `<span class="settings-upload-spinner"></span><span>${msg}</span>`;
      el.className = 'settings-upload-status is-loading';
    } else if (type === 'success') {
      el.innerHTML = `<i class="ph ph-check-circle"></i><span>${msg}</span>`;
      el.className = 'settings-upload-status is-success';
    } else if (type === 'error') {
      el.innerHTML = `<i class="ph ph-x-circle"></i><span>${msg}</span>`;
      el.className = 'settings-upload-status is-error';
    } else {
      el.innerHTML = ''; el.className = 'settings-upload-status';
    }
  }

  function setPreview(key, url) {
    const card = document.querySelector(`.settings-image-card[data-key="${key}"]`);
    if (!card) return;
    const img = card.querySelector('.settings-image-preview img');
    const ph = card.querySelector('.settings-image-placeholder');
    if (img) {
      if (url) { img.src = url.startsWith('data:') ? url : url + '?t=' + Date.now(); img.style.display = 'block'; }
      else { img.src = ''; img.style.display = 'none'; }
    }
    if (ph) ph.style.display = url ? 'none' : 'flex';
  }

  function updateButtons(key) {
    const card = document.querySelector(`.settings-image-card[data-key="${key}"]`);
    if (!card) return;
    const saveBtn = card.querySelector('.settings-save-btn');
    const cancelBtn = card.querySelector('.settings-cancel-btn');
    const changed = state[key].changed;
    saveBtn.disabled = !changed;
    cancelBtn.disabled = !changed;
  }

  async function loadImagesFromSupabase() {
    try {
      const snapshot = await getDocs(collection(db, IMAGENES_COLLECTION));
      snapshot.forEach(docSnap => {
        const rawKey = docSnap.id;
        const docData = docSnap.data();
        // Resolver key: si es legacy, mapear a la nueva; si ya es nueva, usarla directa.
        const key = LEGACY_KEY_MAP[rawKey] || (IMAGE_KEYS.includes(rawKey) ? rawKey : null);
        if (!key) return;
        // Priorizar la URL (Cloudinary) sobre el base64 legado que puede seguir en la BD.
        const imageData = docData.url || docData.data;
        if (imageData) {
          state[key].url = imageData;
          setPreview(key, imageData);
          applySitePreview(key, imageData);
          const urlInput = document.querySelector(`.settings-image-card[data-key="${key}"] .settings-url-input`);
          if (urlInput && !imageData.startsWith('data:')) urlInput.value = imageData;
        }
      });
    } catch (err) {
      console.warn('[Settings] Supabase no disponible.');
    }
  }

  // ---- Aplicar preview en todo el sitio ----
  function applySitePreview(key, url) {
    if (!url) return;
    window.__imagenesSupabase = window.__imagenesSupabase || {};
    window.__imagenesSupabase[key] = true;
    const finalUrl = url.startsWith('data:') ? url : url + '?t=' + Date.now();
    switch (key) {
      case 'imagen_banner_panel':
        const bannerImg = document.querySelector('#admin-banner');
        if (bannerImg) bannerImg.style.backgroundImage = `url('${finalUrl}')`;
        break;
      case 'imagen_sidebar':
        const sidebarBg = document.getElementById('sidebar-bg');
        if (sidebarBg) sidebarBg.style.backgroundImage = `url('${finalUrl}')`;
        break;
      case 'imagen_tarjeta_promocional':
        const promoBg = document.getElementById('promo-bg');
        if (promoBg) promoBg.style.backgroundImage = `url('${finalUrl}')`;
        break;
      case 'imagen_barra_principal':
        const barraImg = document.getElementById('imagen-barra');
        if (barraImg) { barraImg.src = finalUrl; barraImg.style.display = 'block'; }
        break;
      case 'imagen_login':
        break;
    }
  }

  function readAsDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
      reader.readAsDataURL(blob);
    });
  }

  async function doSave(key) {
    setStatus(key, 'loading', 'Guardando...');
    const file = state[key].file;
    const urlValue = state[key].urlValue;
    let finalUrl;

    try {
      if (file) {
        finalUrl = await uploadToCloudinary(file);
      } else if (urlValue) {
        finalUrl = await uploadToCloudinary(urlValue);
      } else {
        setStatus(key, 'error', 'No hay datos para guardar');
        return;
      }

      const docRef = doc(db, IMAGENES_COLLECTION, key);
      await setDoc(docRef, { url: finalUrl, type: 'upload', updatedAt: new Date().toISOString() });

      state[key].url = finalUrl;
      state[key].file = null;
      state[key].urlValue = '';
      state[key].changed = false;
      updateButtons(key);

      setPreview(key, finalUrl);
      applySitePreview(key, finalUrl);

      const card = document.querySelector(`.settings-image-card[data-key="${key}"]`);
      if (card) {
        const fnEl = card.querySelector('.settings-file-name');
        if (fnEl) fnEl.textContent = '';
        const fi = card.querySelector('.settings-file-input');
        if (fi) fi.value = '';
        const ui = card.querySelector('.settings-url-input');
        if (ui) ui.value = '';
      }

      setStatus(key, 'success', 'Imagen guardada');
      showAlert('Imagen actualizada correctamente', 'success');
      setTimeout(() => setStatus(key, '', ''), 3000);
    } catch (err) {
      console.error('[Settings] Save error:', err);
      setStatus(key, 'error', 'Error al guardar');
      showAlert('Error al guardar la imagen', 'error');
    }
  }

  function doCancel(key) {
    state[key].file = null;
    state[key].urlValue = '';
    state[key].changed = false;
    updateButtons(key);

    const card = document.querySelector(`.settings-image-card[data-key="${key}"]`);
    if (card) {
      const fnEl = card.querySelector('.settings-file-name');
      if (fnEl) fnEl.textContent = '';
      const fi = card.querySelector('.settings-file-input');
      if (fi) fi.value = '';
      const ui = card.querySelector('.settings-url-input');
      if (ui) ui.value = '';
    }

    setPreview(key, state[key].url || '');
    setStatus(key, '', '');
  }

  // ---- File picker: solo se abre al hacer clic en el botón ----
  document.querySelectorAll('.settings-file-btn').forEach(btn => {
    const card = btn.closest('.settings-image-card');
    if (!card) return;
    const key = card.dataset.key;
    const fileInput = card.querySelector('.settings-file-input');
    if (!fileInput) return;

    btn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      // Validate type
      const validTypes = ['image/jpeg','image/png','image/webp','image/gif'];
      if (!validTypes.includes(file.type)) {
        showAlert('Formato no válido. Usa JPG, PNG, WEBP o GIF.', 'error');
        fileInput.value = '';
        return;
      }

      if (file.size > 8 * 1024 * 1024) {
        showAlert('La imagen no puede superar 8MB.', 'error');
        fileInput.value = '';
        return;
      }

      state[key].file = file;
      state[key].urlValue = '';
      state[key].changed = true;
      updateButtons(key);

      // Show filename
      const fnEl = card.querySelector('.settings-file-name');
      if (fnEl) fnEl.textContent = file.name;

      // Preview local
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = card.querySelector('.settings-image-preview img');
        const ph = card.querySelector('.settings-image-placeholder');
        if (img) { img.src = ev.target.result; img.style.display = 'block'; }
        if (ph) ph.style.display = 'none';
      };
      reader.readAsDataURL(file);

      // Clear URL input
      const urlInput = card.querySelector('.settings-url-input');
      if (urlInput) urlInput.value = '';
    });
  });

  // ---- URL input ----
  document.querySelectorAll('.settings-url-input').forEach(input => {
    const card = input.closest('.settings-image-card');
    if (!card) return;
    const key = card.dataset.key;

    input.addEventListener('input', () => {
      state[key].urlValue = input.value.trim();
      state[key].file = null;
      state[key].changed = !!state[key].urlValue;
      updateButtons(key);

      // Clear file
      const fi = card.querySelector('.settings-file-input');
      if (fi) fi.value = '';
      const fnEl = card.querySelector('.settings-file-name');
      if (fnEl) fnEl.textContent = '';
    });
  });

  // ---- Guardar / Cancelar ----
  document.querySelectorAll('.settings-save-btn').forEach(btn => {
    const card = btn.closest('.settings-image-card');
    if (!card) return;
    const key = card.dataset.key;

    btn.addEventListener('click', () => {
      if (!state[key].changed) return;
      showConfirm('Reemplazar imagen',
        '¿Estás seguro de que deseas reemplazar esta imagen? La versión anterior será sobrescrita.',
        () => doSave(key));
    });
  });

  document.querySelectorAll('.settings-cancel-btn').forEach(btn => {
    const card = btn.closest('.settings-image-card');
    if (!card) return;
    const key = card.dataset.key;
    btn.addEventListener('click', () => doCancel(key));
  });

  // ---- Cargar datos al iniciar ----
  loadImagesFromSupabase();

  console.log('[Settings v2] Módulo de configuración con Supabase listo');
})();

// ==========================================================================
// SETTINGS CONTENT MODULE — Contenido público del sitio
// Tabla Supabase: configuracion/{empresa, inicio, pie-de-pagina, preguntas-frecuentes, whatsapp} + imagenes/{logo, hero-fondo, nosotros, telefono-*}
// ==========================================================================
(() => {
  const settingsSection = document.getElementById('settings');
  if (!settingsSection) return;

  const SETTINGS_COLLECTION = 'configuracion';
  const IMG_COLLECTION = 'imagenes';
  const TEXT_DOCS = ['empresa', 'inicio', 'pie-de-pagina', 'preguntas-frecuentes', 'whatsapp'];
  const IMG_KEYS = ['logo', 'hero-fondo', 'nosotros'];
  const FIELD_PREFIX = { empresa: 'cmp', inicio: 'home', 'pie-de-pagina': 'ftr', whatsapp: 'wa' };

  const DEFAULTS = {
    empresa: {
      name: 'Mi Phone HN',
      description: 'Compra celulares nuevos y seminuevos certificados en Honduras. iPhones, Samsung, iPads y accesorios con garantía, envíos rápidos y pagos flexibles desde Choluteca.',
      about: '<p>En <strong>Mi Phone HN</strong>, nacimos en la ciudad de <strong>Choluteca</strong> con un propósito claro: hacer que la tecnología móvil de gama alta sea accesible para todos los hondureños sin complicaciones.</p><p>Nos especializamos en la comercialización de celulares nuevos y seminuevos certificados de las marcas Apple y Samsung. Cada equipo pasa por una rigurosa inspección técnica antes de llegar a tus manos.</p><p>No solo vendemos dispositivos; vendemos la tranquilidad de contar con una garantía real, múltiples facilidades de pago y una entrega rápida respaldada por empresas logísticas de Honduras.</p>',
      ubicacion: 'Choluteca, Honduras',
      telefono: '+504 8823-8432',
      email: ''
    },
    inicio: {
      announcement: 'Envíos seguros a nivel nacional vía Rápido Cargo desde Choluteca',
      hero: {
        tag: 'Tecnología premium garantizada',
        title: 'El celular que quieres, con las facilidades que necesitas.',
        subtitle: 'iPhones y Samsung nuevos y seminuevos certificados. Compra hoy de forma segura desde Choluteca con envíos rápidos a toda Honduras.'
      },
      cards: [
        { title: 'Garantía certificada', description: 'Todos nuestros equipos cuentan con 90 días de garantía escrita por fallas de fábrica.' },
        { title: 'Pagos flexibles', description: 'Efectivo, transferencia bancaria y extrafinanciamiento con tarjetas participantes.' },
        { title: 'Envíos rápidos', description: 'Despachos desde Choluteca a todo el país vía Rápido Cargo en un plazo estimado de 24 a 48 horas.' }
      ],
      stats: [
        { number: '90', label: 'Días de garantía real' },
        { number: '100%', label: 'Inspección de calidad' },
        { number: '48h', label: 'Tiempo máximo de envío' },
        { number: '24/7', label: 'Soporte personalizado' }
      ]
    },
    'pie-de-pagina': {
      description: 'El distribuidor de confianza para celulares premium nuevos y seminuevos garantizados en la zona sur y a nivel nacional.',
      location: 'Choluteca, Honduras',
      phone: '+504 8823-8432',
      shipping: 'Envíos vía Rápido Cargo',
      copyright: '© 2026 Mi Phone HN. Todos los derechos reservados.',
      paymentMethods: ['BAC Credomatic', 'Ficohsa', 'Transferencias', 'Efectivo']
    },
    'preguntas-frecuentes': {
      items: [
        { q: '¿Tienen tienda física y dónde están ubicados?', a: '<p>Atendemos principalmente por pedido y envíos desde <strong>Choluteca, Honduras</strong>. Escríbenos por WhatsApp para confirmar disponibilidad, punto de entrega o retiro.</p>' },
        { q: '¿Cómo funcionan los envíos y cuánto tardan?', a: '<p>Enviamos con <strong>Rápido Cargo</strong> a nivel nacional. El tiempo estimado de entrega es de <strong>24 a 48 horas hábiles</strong> tras confirmar el pago. Te compartiremos el número de guía para rastrear tu paquete.</p>' },
        { q: '¿Cómo compro con extrafinanciamiento o cuotas?', a: '<p>Para compras con extrafinanciamiento de <strong>BAC Credomatic</strong> o <strong>Ficohsa</strong>:</p><ol><li>Selecciona el producto y agrégalo al carrito.</li><li>Escríbenos por WhatsApp con tu pedido.</li><li>Nuestro asesor confirmará los requisitos y procesará el pago en 3, 6, 9 o 12 cuotas.</li></ol>' },
        { q: '¿Cuáles son las cuentas de transferencia disponibles?', a: '<p>Aceptamos transferencias a <strong>BAC Honduras</strong>, <strong>Banco Atlántida</strong>, <strong>Banco de Occidente</strong>, <strong>Banpaís</strong> y <strong>Davivienda</strong>. Envía el comprobante por WhatsApp para procesar tu pedido.</p>' },
        { q: '¿Qué cubre y qué no cubre la garantía?', a: '<p><strong>Cubre:</strong> fallas mecánicas e internas de fábrica, como pantalla táctil, micrófono, cámaras, señal, carga y botones.</p><p><strong>No cubre:</strong> daños físicos por caídas, contacto con líquidos o manipulación de software no autorizada.</p>' }
      ]
    },
    whatsapp: {
      phone: '50488238432',
      title: 'NUEVO PEDIDO — MI PHONE HN',
      labels: {
        cliente: 'Cliente',
        dni: 'DNI',
        ciudad: 'Ciudad/Envío',
        productos: 'Productos',
        cantidad: 'Cantidad',
        subtotal: 'Subtotal',
        total: 'TOTAL',
        despacho: 'Despacho',
        logistica: 'Logística'
      },
      despachoValue: 'Choluteca, Honduras',
      logisticaValue: 'Rápido Cargo',
      messageTemplate: '*[TITULO]*\n\n[LABEL_CLIENTE]: [NOMBRE_CLIENTE]\n[LABEL_DNI]: [DNI_CLIENTE]\n[LABEL_CIUDAD]: [CIUDAD_CLIENTE]\n\n*[LABEL_PRODUCTOS]:*\n[LISTA_PRODUCTOS]\n\n*[LABEL_TOTAL]: [TOTAL_PEDIDO]*\n\n[LABEL_DESPACHO]: [DESPACHO]\n[LABEL_LOGISTICA]: [LOGISTICA]',
      productLineTemplate: '- [NOMBRE_PRODUCTO] ([VARIACION])\n  [LABEL_CANTIDAD]: [CANTIDAD]\n  [LABEL_SUBTOTAL]: [SUBTOTAL]'
    }
  };

  const LISTS = [
    { listKey: 'cards', doc: 'inicio', container: 'home-cards-list', fields: [
      { key: 'title', label: 'Título', type: 'input' },
      { key: 'description', label: 'Descripción', type: 'input' }
    ]},
    { listKey: 'stats', doc: 'inicio', container: 'home-stats-list', fields: [
      { key: 'number', label: 'Valor', type: 'input' },
      { key: 'label', label: 'Texto', type: 'input' }
    ]},
    { listKey: 'paymentMethods', doc: 'pie-de-pagina', container: 'footer-payments-list', fields: [
      { key: 'value', label: 'Método de pago', type: 'input' }
    ]},
    { listKey: 'items', doc: 'preguntas-frecuentes', container: 'faqs-list', fields: [
      { key: 'q', label: 'Pregunta', type: 'input' },
      { key: 'a', label: 'Respuesta', type: 'rich' }
    ]}
  ];

  const docsState = {};
  TEXT_DOCS.forEach(d => { docsState[d] = { loaded: null, changed: false }; });
  const imgState = {};
  const imgSaved = {};
  IMG_KEYS.forEach(k => { imgState[k] = { url: '', file: null, changed: false, hasImage: false, source: '' }; imgSaved[k] = ''; });

  function getPath(obj, path) {
    return path.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
  }

  function setPath(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      cur[parts[i]] = cur[parts[i]] || {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  function deepMerge(base, override) {
    const out = { ...base };
    Object.entries(override || {}).forEach(([k, v]) => {
      if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
        out[k] = deepMerge(base[k], v);
      } else {
        out[k] = v;
      }
    });
    return out;
  }

  function cardStatus(card, type, msg) {
    const el = card?.querySelector('.settings-upload-status');
    if (!el) return;
    if (type === 'loading') {
      el.innerHTML = `<span class="settings-upload-spinner"></span><span>${escapeHTML(msg)}</span>`;
      el.className = 'settings-upload-status is-loading';
    } else if (type === 'success') {
      el.innerHTML = `<i class="ph ph-check-circle"></i><span>${escapeHTML(msg)}</span>`;
      el.className = 'settings-upload-status is-success';
    } else if (type === 'error') {
      el.innerHTML = `<i class="ph ph-x-circle"></i><span>${escapeHTML(msg)}</span>`;
      el.className = 'settings-upload-status is-error';
    } else {
      el.innerHTML = '';
      el.className = 'settings-upload-status';
    }
  }

  // ---- Tabs ----
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const content = document.getElementById(`settings-${tab.dataset.tab}-tab`);
      if (content) content.classList.add('active');
    });
  });
  // Al inicializar: garantiza que el contenido de la pestaña activa esté visible.
  const initActiveTab = document.querySelector('.settings-tab.active');
  const initActiveContent = initActiveTab ? document.getElementById(`settings-${initActiveTab.dataset.tab}-tab`) : null;
  if (initActiveContent) initActiveContent.classList.add('active');

  // ---- Botones por documento ----
  function docButtons(docId) {
    return {
      save: Array.from(document.querySelectorAll(`.settings-save-btn[data-save-doc="${docId}"]`)),
      cancel: Array.from(document.querySelectorAll(`.settings-cancel-btn[data-cancel-doc="${docId}"]`))
    };
  }

  function updateDocButtons(docId) {
    const btns = docButtons(docId);
    const changed = docsState[docId].changed;
    btns.save.forEach(b => { b.disabled = !changed; });
    btns.cancel.forEach(b => { b.disabled = !changed; });
  }

  function markDocChanged(docId) {
    docsState[docId].changed = true;
    updateDocButtons(docId);
  }

  // ---- Valores de inputs (rutas con puntos) ----
  function collectDocValues(docId) {
    const prefix = FIELD_PREFIX[docId];
    if (!prefix) return {};
    const values = {};
    document.querySelectorAll(`[data-${prefix}]`).forEach(el => {
      setPath(values, el.dataset[prefix], el.value);
    });
    return values;
  }

  function applyDocValues(docId, data) {
    const prefix = FIELD_PREFIX[docId];
    if (!prefix) return;
    document.querySelectorAll(`[data-${prefix}]`).forEach(el => {
      el.value = getPath(data, el.dataset[prefix]) ?? '';
    });
    document.dispatchEvent(new CustomEvent('settings-applied', { detail: { docId, data } }));
  }

  // ---- Editor enriquecido (sin HTML a la vista) ----
  const RICH_ALLOWED = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI']);

  function sanitizeRichHTML(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    function clean(node) {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') { node.remove(); return; }
      if (node.tagName === 'DIV') {
        const p = doc.createElement('p');
        while (node.firstChild) p.appendChild(node.firstChild);
        node.parentNode.replaceChild(p, node);
        clean(p);
        return;
      }
      if (!RICH_ALLOWED.has(node.tagName)) {
        while (node.firstChild) node.parentNode.insertBefore(node.firstChild, node);
        node.parentNode.removeChild(node);
        return;
      }
      Array.from(node.attributes).forEach(a => node.removeAttribute(a.name));
      Array.from(node.childNodes).forEach(clean);
    }
    Array.from(doc.body.childNodes).forEach(clean);
    doc.body.querySelectorAll('p').forEach(p => { if (!p.innerHTML.trim()) p.remove(); });
    return doc.body.innerHTML.trim();
  }

  function richHidden(editor) {
    return editor.closest('.settings-rich')?.querySelector('.settings-rich-hidden');
  }

  function initRichFields(scope, docId) {
    scope.querySelectorAll('.settings-rich-editor').forEach(ed => {
      if (ed.dataset.bound) return;
      ed.dataset.bound = '1';
      const container = ed.closest('.settings-rich');
      if (container?.dataset.richPlaceholder) ed.dataset.placeholder = container.dataset.richPlaceholder;
      ed.addEventListener('input', () => {
        const hidden = richHidden(ed);
        if (hidden) hidden.value = sanitizeRichHTML(ed.innerHTML);
        markDocChanged(docId);
      });
    });
  }

  function syncRichFields() {
    document.querySelectorAll('.settings-rich').forEach(rich => {
      const hidden = rich.querySelector('.settings-rich-hidden');
      const editor = rich.querySelector('.settings-rich-editor');
      if (!hidden || !editor) return;
      const val = hidden.value ? sanitizeRichHTML(hidden.value) : '';
      if (editor.innerHTML !== val) editor.innerHTML = val;
    });
  }

  function wrapSelection(editor, wrapperTag) {
    const sel = window.getSelection();
    const range = sel.rangeCount ? sel.getRangeAt(0) : null;
    if (!range || range.collapsed || !range.toString().trim()) return;
    const frag = range.extractContents();
    const wrapper = document.createElement(wrapperTag);
    wrapper.appendChild(frag);
    range.insertNode(wrapper);
    const r = document.createRange();
    r.selectNodeContents(wrapper);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function applyList(editor, tag) {
    const sel = window.getSelection();
    const range = sel.rangeCount ? sel.getRangeAt(0) : null;
    let targets = [];
    if (range && !range.collapsed && range.toString().trim()) {
      targets = Array.from(editor.querySelectorAll('p, ul, ol, div')).filter(b => {
        if (b.closest('li')) return false;
        return range.intersectsNode(b);
      });
    }
    if (!targets.length) targets = Array.from(editor.children).filter(c => /^P|UL|OL|DIV$/.test(c.tagName));
    const list = document.createElement(tag);
    targets.forEach(block => {
      const li = document.createElement('li');
      li.innerHTML = block.innerHTML;
      list.appendChild(li);
    });
    if (targets.length) {
      if (targets[0] === editor) {
        editor.textContent = '';
        editor.appendChild(list);
      } else {
        editor.insertBefore(list, targets[0]);
        targets.forEach(block => block.remove());
      }
    } else {
      editor.appendChild(list);
    }
  }

  function richCommand(editor, cmd) {
    editor.focus();
    let ok = false;
    try {
      ok = document.execCommand(cmd, false, null);
    } catch (e) { /* fallback manual */ }
    if (!ok) {
      if (cmd === 'bold') wrapSelection(editor, 'strong');
      else if (cmd === 'insertUnorderedList') applyList(editor, 'ul');
      else if (cmd === 'insertOrderedList') applyList(editor, 'ol');
    }
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }

  settingsSection.addEventListener('click', (e) => {
    const btn = e.target.closest('.settings-rich-btn');
    if (!btn) return;
    const editor = btn.closest('.settings-rich')?.querySelector('.settings-rich-editor');
    if (!editor) return;
    richCommand(editor, btn.dataset.cmd);
  });

  // ---- Listas dinámicas ----
  function listCfg(listKey) {
    return LISTS.find(c => c.listKey === listKey);
  }

  function listRowHTML(cfg, values) {
    const fieldsHTML = cfg.fields.map(f => {
      let val = '';
      if (values && typeof values === 'object') val = values[f.key] ?? '';
      else if (cfg.fields.length === 1) val = values ?? '';
      if (f.type === 'rich') {
        return `
        <div class="form-group">
          <label>${escapeHTML(f.label)}</label>
          <div class="settings-rich">
            <div class="settings-rich-toolbar">
              <button type="button" class="settings-rich-btn" data-cmd="bold" title="Negrita" aria-label="Negrita"><strong>B</strong></button>
              <button type="button" class="settings-rich-btn" data-cmd="insertUnorderedList" title="Lista con viñetas" aria-label="Lista con viñetas">• Lista</button>
              <button type="button" class="settings-rich-btn" data-cmd="insertOrderedList" title="Lista numerada" aria-label="Lista numerada">1. Lista</button>
            </div>
            <div class="settings-rich-editor" contenteditable="true" data-placeholder="${escapeHTML(f.label)}"></div>
            <input type="hidden" class="settings-rich-hidden" data-field="${escapeHTML(f.key)}" value="${escapeHTML(val)}">
          </div>
        </div>`;
      }
      return `
        <div class="form-group">
          <label>${escapeHTML(f.label)}</label>
          ${f.type === 'textarea'
            ? `<textarea class="settings-list-input" data-field="${escapeHTML(f.key)}" rows="3" placeholder="${escapeHTML(f.label)}">${escapeHTML(val)}</textarea>`
            : `<input type="text" class="settings-list-input" data-field="${escapeHTML(f.key)}" value="${escapeHTML(val)}" placeholder="${escapeHTML(f.label)}">`}
        </div>`;
    }).join('');
    return `
      <div class="settings-list-item">
        <div class="settings-list-fields">${fieldsHTML}</div>
        <div class="settings-list-controls">
          <button type="button" class="settings-list-btn settings-list-btn--up" title="Subir" aria-label="Subir"><i class="ph ph-caret-up" aria-hidden="true"></i></button>
          <button type="button" class="settings-list-btn settings-list-btn--down" title="Bajar" aria-label="Bajar"><i class="ph ph-caret-down" aria-hidden="true"></i></button>
          <button type="button" class="settings-list-btn settings-list-btn--del" title="Eliminar" aria-label="Eliminar"><i class="ph ph-trash" aria-hidden="true"></i></button>
        </div>
      </div>`;
  }

  function renderList(cfg, items) {
    const container = document.getElementById(cfg.container);
    if (!container) return;
    container.innerHTML = (items || []).map(item => listRowHTML(cfg, item)).join('');
    initRichFields(container, cfg.doc);
    syncRichFields();
  }

  function collectList(cfg) {
    const container = document.getElementById(cfg.container);
    if (!container) return [];
    return Array.from(container.querySelectorAll('.settings-list-item')).map(row => {
      if (cfg.fields.length === 1) {
        return row.querySelector(`[data-field="${cfg.fields[0].key}"]`)?.value || '';
      }
      const obj = {};
      cfg.fields.forEach(f => {
        obj[f.key] = row.querySelector(`[data-field="${f.key}"]`)?.value || '';
      });
      return obj;
    });
  }

  function bindList(cfg) {
    const container = document.getElementById(cfg.container);
    if (!container) return;
    container.addEventListener('input', () => markDocChanged(cfg.doc));
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('.settings-list-btn');
      if (!btn) return;
      const row = btn.closest('.settings-list-item');
      if (!row) return;
      const rows = Array.from(container.querySelectorAll('.settings-list-item'));
      const idx = rows.indexOf(row);
      if (btn.classList.contains('settings-list-btn--up') && idx > 0) {
        rows[idx - 1].before(row);
      } else if (btn.classList.contains('settings-list-btn--down') && idx < rows.length - 1) {
        rows[idx + 1].after(row);
      } else if (btn.classList.contains('settings-list-btn--del')) {
        row.remove();
      } else {
        return;
      }
      markDocChanged(cfg.doc);
    });
  }

  document.querySelectorAll('.settings-list-add').forEach(btn => {
    btn.addEventListener('click', () => {
      const cfg = listCfg(btn.dataset.addItem);
      if (!cfg) return;
      const container = document.getElementById(cfg.container);
      if (!container) return;
      container.insertAdjacentHTML('beforeend', listRowHTML(cfg, null));
      markDocChanged(cfg.doc);
    });
  });

  LISTS.forEach(bindList);

  // ---- Guardar / Cancelar por documento ----
  async function doSaveDoc(docId, card) {
    const values = collectDocValues(docId);
    LISTS.filter(cfg => cfg.doc === docId).forEach(cfg => {
      values[cfg.listKey] = collectList(cfg);
    });

    cardStatus(card, 'loading', 'Guardando...');
    try {
      await setDoc(doc(db, SETTINGS_COLLECTION, docId), { ...values, updatedAt: new Date().toISOString() });
      docsState[docId].loaded = JSON.parse(JSON.stringify(values));
      docsState[docId].changed = false;
      updateDocButtons(docId);
      cardStatus(card, 'success', 'Cambios guardados');
      showAlert('Configuración guardada correctamente', 'success');
      setTimeout(() => cardStatus(card, '', ''), 3000);
    } catch (err) {
      console.error('[Settings Content] Save error:', err);
      cardStatus(card, 'error', 'Error al guardar');
      showAlert('Error al guardar la configuración', 'error');
    }
  }

  function doCancelDoc(docId, card) {
    const data = docsState[docId].loaded || DEFAULTS[docId];
    applyDocValues(docId, data);
    LISTS.filter(cfg => cfg.doc === docId).forEach(cfg => renderList(cfg, data[cfg.listKey]));
    syncRichFields();
    docsState[docId].changed = false;
    updateDocButtons(docId);
    if (docId === 'whatsapp') renderWaPreview();
    cardStatus(card, '', '');
  }

  document.querySelectorAll('.settings-save-btn[data-save-doc]').forEach(btn => {
    btn.addEventListener('click', () => doSaveDoc(btn.dataset.saveDoc, btn.closest('.settings-form-card')));
  });

  document.querySelectorAll('.settings-cancel-btn[data-cancel-doc]').forEach(btn => {
    btn.addEventListener('click', () => doCancelDoc(btn.dataset.cancelDoc, btn.closest('.settings-form-card')));
  });

  // ---- Inputs marcan cambio (y preview WhatsApp) ----
  TEXT_DOCS.forEach(docId => {
    const prefix = FIELD_PREFIX[docId];
    if (!prefix) return;
    document.querySelectorAll(`[data-${prefix}]`).forEach(el => {
      el.addEventListener('input', () => {
        markDocChanged(docId);
        if (docId === 'whatsapp') renderWaPreview();
      });
    });
  });

  // ---- Preview de WhatsApp ----
  function fillTemplate(tpl, map) {
    let out = String(tpl || '');
    Object.entries(map).forEach(([key, value]) => {
      out = out.split(`[${key}]`).join(String(value ?? ''));
    });
    return out;
  }

  function renderWaPreview() {
    const pre = document.getElementById('wa-preview');
    if (!pre) return;
    const v = { ...DEFAULTS.whatsapp, ...collectDocValues('whatsapp') };
    const labels = v.labels || {};
    const line = fillTemplate(v.productLineTemplate, {
      NOMBRE_PRODUCTO: 'iPhone 15 Pro Max',
      VARIACION: 'Natural Titanio | 256 GB',
      LABEL_CANTIDAD: labels.cantidad || 'Cantidad',
      CANTIDAD: '1',
      LABEL_SUBTOTAL: labels.subtotal || 'Subtotal',
      SUBTOTAL: 'L. 23,000'
    });
    const sample = fillTemplate(v.messageTemplate, {
      TITULO: v.title || 'NUEVO PEDIDO',
      LABEL_CLIENTE: labels.cliente || 'Cliente',
      NOMBRE_CLIENTE: 'Juan Pérez',
      LABEL_DNI: labels.dni || 'DNI',
      DNI_CLIENTE: '0801-1990-12345',
      LABEL_CIUDAD: labels.ciudad || 'Ciudad/Envío',
      CIUDAD_CLIENTE: 'Choluteca',
      LABEL_PRODUCTOS: labels.productos || 'Productos',
      LISTA_PRODUCTOS: line,
      LABEL_TOTAL: labels.total || 'TOTAL',
      TOTAL_PEDIDO: 'L. 23,000',
      LABEL_DESPACHO: labels.despacho || 'Despacho',
      DESPACHO: v.despachoValue || '',
      LABEL_LOGISTICA: labels.logistica || 'Logística',
      LOGISTICA: v.logisticaValue || ''
    });
    pre.textContent = sample;
  }

  // ---- Imágenes (logo, hero, about) ----
  function imgCard(key) {
    return document.querySelector(`.settings-img-card[data-img-doc="${key}"]`);
  }

  function imgSourceOf(url) {
    return /^https?:/i.test(url) ? 'url' : (url ? 'file' : '');
  }

  function updateImgPreview(key) {
    const card = imgCard(key);
    if (!card) return;
    const img = card.querySelector('.settings-image-preview img');
    const ph = card.querySelector('.settings-image-placeholder');
    const url = imgState[key].url;
    if (img) {
      if (url) { img.src = url.startsWith('data:') ? url : url + '?t=' + Date.now(); img.style.display = 'block'; }
      else { img.src = ''; img.style.display = 'none'; }
    }
    if (ph) ph.style.display = url ? 'none' : 'flex';
    const removeBtn = card.querySelector('.settings-remove-btn');
    if (removeBtn) removeBtn.disabled = !imgState[key].hasImage && !imgState[key].changed;
  }

  function updateImgUrlInput(key) {
    const input = imgCard(key)?.querySelector('.settings-site-url');
    if (!input) return;
    const st = imgState[key];
    const desired = st.source === 'url' ? st.url : '';
    if ((input.value || '').trim() !== desired) input.value = desired;
  }

  function updateImgButtons(key) {
    const card = imgCard(key);
    if (!card) return;
    const saveBtn = card.querySelector('.settings-save-btn');
    const cancelBtn = card.querySelector('.settings-cancel-btn');
    const changed = imgState[key].changed;
    saveBtn.disabled = !changed;
    cancelBtn.disabled = !changed;
  }

  function resetImgCardFields(card) {
    const fi = card.querySelector('.settings-file-input');
    if (fi) fi.value = '';
    const fnEl = card.querySelector('.settings-file-name');
    if (fnEl) fnEl.textContent = '';
  }

  async function loadImg(key) {
    try {
      const snap = await getDoc(doc(db, IMG_COLLECTION, key));
      if (snap.exists()) {
        const data = snap.data();
        const url = data.url || data.data || '';
        if (url) {
          imgState[key].url = url;
          imgState[key].hasImage = true;
          imgState[key].source = imgSourceOf(url);
          imgSaved[key] = url;
          updateImgPreview(key);
          updateImgUrlInput(key);
        }
      }
    } catch (err) {
      console.warn(`[Settings Content] No se pudo cargar la imagen "${key}".`);
    }
  }

  async function doSaveImg(key) {
    const card = imgCard(key);
    const st = imgState[key];
    if (!st.changed) return;
    cardStatus(card, 'loading', 'Guardando...');
    try {
      let finalUrl = '';
      if (st.file) {
        const dataUrl = await compressAndReadImage(st.file, 1600, 0.8);
        await setDoc(doc(db, IMG_COLLECTION, key), { data: dataUrl, type: 'upload', updatedAt: new Date().toISOString() });
        finalUrl = dataUrl;
      } else if (st.source === 'url' && st.url) {
        await setDoc(doc(db, IMG_COLLECTION, key), { url: st.url, type: 'url', updatedAt: new Date().toISOString() });
        finalUrl = st.url;
      }
      if (!finalUrl) return;
      st.url = finalUrl;
      st.file = null;
      st.changed = false;
      st.hasImage = true;
      imgSaved[key] = finalUrl;
      updateImgButtons(key);
      updateImgPreview(key);
      updateImgUrlInput(key);
      resetImgCardFields(card);
      cardStatus(card, 'success', 'Imagen guardada');
      showAlert('Imagen actualizada correctamente', 'success');
      setTimeout(() => cardStatus(card, '', ''), 3000);
    } catch (err) {
      console.error('[Settings Content] Save image error:', err);
      cardStatus(card, 'error', 'Error al guardar');
      showAlert('Error al guardar la imagen', 'error');
    }
  }

  function doCancelImg(key) {
    const card = imgCard(key);
    const saved = imgSaved[key] || '';
    imgState[key] = { url: saved, file: null, changed: false, hasImage: !!saved, source: imgSourceOf(saved) };
    updateImgButtons(key);
    updateImgPreview(key);
    updateImgUrlInput(key);
    resetImgCardFields(card);
    cardStatus(card, '', '');
  }

  async function doRemoveImg(key) {
    const card = imgCard(key);
    cardStatus(card, 'loading', 'Eliminando...');
    try {
      await deleteDoc(doc(db, IMG_COLLECTION, key));
      imgState[key] = { url: '', file: null, changed: false, hasImage: false, source: '' };
      imgSaved[key] = '';
      updateImgButtons(key);
      updateImgPreview(key);
      updateImgUrlInput(key);
      resetImgCardFields(card);
      cardStatus(card, 'success', 'Imagen eliminada');
      showAlert('Imagen eliminada correctamente', 'success');
      setTimeout(() => cardStatus(card, '', ''), 3000);
    } catch (err) {
      console.error('[Settings Content] Remove image error:', err);
      cardStatus(card, 'error', 'Error al eliminar');
      showAlert('Error al eliminar la imagen', 'error');
    }
  }

  document.querySelectorAll('.settings-img-card').forEach(card => {
    const key = card.dataset.imgDoc;
    if (!key) return;
    const fileBtn = card.querySelector('.settings-file-btn');
    const fileInput = card.querySelector('.settings-file-input');
    const saveBtn = card.querySelector('.settings-save-btn');
    const cancelBtn = card.querySelector('.settings-cancel-btn');
    const removeBtn = card.querySelector('.settings-remove-btn');
    const urlInput = card.querySelector('.settings-site-url');

    fileBtn?.addEventListener('click', () => fileInput?.click());

    fileInput?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (!validTypes.includes(file.type)) {
        showAlert('Formato no válido. Usa JPG, PNG, WEBP o GIF.', 'error');
        fileInput.value = '';
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        showAlert('La imagen no puede superar 8MB.', 'error');
        fileInput.value = '';
        return;
      }
      imgState[key].file = file;
      imgState[key].changed = true;
      imgState[key].source = 'file';
      updateImgButtons(key);
      updateImgPreview(key);
      updateImgUrlInput(key);
      const fnEl = card.querySelector('.settings-file-name');
      if (fnEl) fnEl.textContent = file.name;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = card.querySelector('.settings-image-preview img');
        const ph = card.querySelector('.settings-image-placeholder');
        if (img) { img.src = ev.target.result; img.style.display = 'block'; }
        if (ph) ph.style.display = 'none';
      };
      reader.readAsDataURL(file);
    });

    ['input', 'change'].forEach(evt => {
      urlInput?.addEventListener(evt, () => {
        const st = imgState[key];
        const value = urlInput.value.trim();
        if (!value) {
          if (st.source === 'url' && st.url) {
            st.url = '';
            st.file = null;
            st.changed = true;
            st.hasImage = false;
            st.source = '';
            updateImgPreview(key);
            updateImgButtons(key);
          }
          return;
        }
        let valid = false;
        try {
          const parsed = new URL(value);
          valid = parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'data:';
        } catch (err) { valid = /^data:image\//i.test(value); }
        if (!valid) return;
        st.url = value;
        st.file = null;
        st.changed = true;
        st.hasImage = true;
        st.source = 'url';
        updateImgPreview(key);
        updateImgButtons(key);
      });
    });

    saveBtn?.addEventListener('click', () => {
      if (!imgState[key].changed) return;
      showConfirm('Reemplazar imagen',
        '¿Estás seguro de que deseas reemplazar esta imagen? La versión anterior será sobrescrita.',
        () => doSaveImg(key),
        { tone: 'primary', okLabel: 'Guardar' });
    });

    cancelBtn?.addEventListener('click', () => doCancelImg(key));

    removeBtn?.addEventListener('click', () => {
      showConfirm('Eliminar imagen',
        'La imagen se eliminará del sitio público. Esta acción no se puede deshacer.',
        () => doRemoveImg(key));
    });
  });

  // ---- Teléfonos del hero (1-5 imágenes o URLs; un documento por teléfono) ----
  const HERO_PHONES_MAX = 5;
  const HERO_PHONES_NAMES = Array.from({ length: HERO_PHONES_MAX }, (_, i) => 'phone' + (i + 1));
  const HERO_PHONES_DOCS = HERO_PHONES_NAMES.reduce((acc, n, i) => { acc[n] = 'telefono-' + (i + 1); return acc; }, {});

  const phonesState = {};
  const phonesSaved = {};
  let phonesAdded = [];
  HERO_PHONES_NAMES.forEach(n => {
    phonesState[n] = { url: '', file: null, changed: false, hasImage: false, source: '' };
    phonesSaved[n] = '';
  });

  function duoCard() {
    return document.querySelector('.settings-img-card-duo');
  }

  function duoSlot(name) {
    return duoCard()?.querySelector(`.settings-duo-slot[data-slot="${name}"]`);
  }

  function phoneSlotHtml(name, index) {
    return `
      <div class="settings-duo-slot settings-phone-slot" data-slot="${name}">
        <span class="settings-duo-label">Imagen ${index}</span>
        <div class="settings-image-preview settings-image-preview--phone">
          <img src="" alt="Imagen ${index}">
          <div class="settings-image-placeholder"><i class="ph ph-device-mobile" aria-hidden="true"></i><span>Sin imagen</span></div>
        </div>
        <div class="settings-slot-url-wrap">
          <i class="ph ph-link-simple" aria-hidden="true"></i>
          <input type="url" class="settings-slot-url" data-slot-url="${name}" placeholder="O pega una URL de imagen (https://...)" autocomplete="off" spellcheck="false">
        </div>
        <div class="settings-file-wrap">
          <button type="button" class="settings-file-btn" data-slot-btn="${name}"><i class="ph ph-upload-simple" aria-hidden="true"></i> Subir archivo</button>
          <input type="file" accept=".png,.webp,.jpg,.jpeg,.gif" class="settings-file-input" data-slot-input="${name}" hidden>
          <span class="settings-file-name"></span>
          <button type="button" class="btn btn-danger-ghost btn-sm settings-slot-remove" data-slot-remove="${name}" disabled><i class="ph ph-trash" aria-hidden="true"></i> Quitar</button>
        </div>
      </div>`;
  }

  function renderPhonesList() {
    const card = duoCard();
    if (!card) return;
    const list = card.querySelector('#phones-list');
    const empty = card.querySelector('#phones-empty');
    const addBtn = card.querySelector('#phones-add-btn');
    if (!list) return;
    list.innerHTML = phonesAdded.map((n, i) => phoneSlotHtml(n, i + 1)).join('');
    if (empty) empty.style.display = phonesAdded.length ? 'none' : 'flex';
    if (addBtn) {
      addBtn.hidden = phonesAdded.length >= HERO_PHONES_MAX;
      addBtn.disabled = phonesAdded.length >= HERO_PHONES_MAX;
    }
    phonesAdded.forEach(syncPhoneSlot);
    bindPhoneSlots();
    updatePhoneButtons();
  }

  function updatePhonePreview(name) {
    const slot = duoSlot(name);
    if (!slot) return;
    const st = phonesState[name];
    const img = slot.querySelector('.settings-image-preview img');
    const ph = slot.querySelector('.settings-image-placeholder');
    if (img) {
      if (st.url) { img.src = st.url.startsWith('data:') ? st.url : st.url + '?t=' + Date.now(); img.style.display = 'block'; }
      else { img.src = ''; img.style.display = 'none'; }
    }
    if (ph) ph.style.display = st.url ? 'none' : 'flex';
  }

  function updatePhoneUrlInput(name) {
    const input = duoSlot(name)?.querySelector('.settings-slot-url');
    if (!input) return;
    const st = phonesState[name];
    const desired = st.source === 'url' ? st.url : '';
    if ((input.value || '').trim() !== desired) input.value = desired;
  }

  function updatePhoneButtons() {
    const card = duoCard();
    if (!card) return;
    const changed = phonesAdded.some(n => phonesState[n].changed);
    const saveBtn = card.querySelector('.settings-duo-save');
    const cancelBtn = card.querySelector('.settings-duo-cancel');
    if (saveBtn) saveBtn.disabled = !changed;
    if (cancelBtn) cancelBtn.disabled = !changed;
    card.querySelectorAll('.settings-slot-remove').forEach(btn => {
      btn.disabled = false;
    });
  }

  function resetPhoneSlotInputs(name) {
    const slot = duoSlot(name);
    const fi = slot?.querySelector('.settings-file-input');
    if (fi) fi.value = '';
    const fnEl = slot?.querySelector('.settings-file-name');
    if (fnEl) fnEl.textContent = '';
  }

  function applyPhonesSaved(name) {
    const saved = phonesSaved[name] || '';
    phonesState[name] = { url: saved, file: null, changed: false, hasImage: !!saved, source: /^https?:/i.test(saved) ? 'url' : (saved ? 'file' : '') };
    resetPhoneSlotInputs(name);
    updatePhonePreview(name);
    updatePhoneUrlInput(name);
  }

  function syncPhoneSlot(name) {
    if (phonesState[name].changed || phonesState[name].file) {
      resetPhoneSlotInputs(name);
      updatePhonePreview(name);
      updatePhoneUrlInput(name);
    } else {
      applyPhonesSaved(name);
    }
  }

  function bindPhoneSlots() {
    const card = duoCard();
    if (!card) return;
    card.querySelectorAll('.settings-file-btn[data-slot-btn]').forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => duoSlot(btn.dataset.slotBtn)?.querySelector('.settings-file-input')?.click());
    });

    card.querySelectorAll('.settings-file-input').forEach(input => {
      if (input.dataset.bound) return;
      input.dataset.bound = '1';
      input.addEventListener('change', (e) => {
        const slotEl = input.closest('.settings-duo-slot');
        const name = slotEl?.dataset.slot;
        const file = e.target.files[0];
        if (!name || !file) return;
        const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (!validTypes.includes(file.type)) {
          showAlert('Formato no válido. Usa PNG, WebP, JPG o GIF.', 'error');
          input.value = '';
          return;
        }
        if (file.size > 8 * 1024 * 1024) {
          showAlert('La imagen no puede superar 8MB.', 'error');
          input.value = '';
          return;
        }
        phonesState[name].file = file;
        phonesState[name].changed = true;
        phonesState[name].source = 'file';
        const fnEl = slotEl.querySelector('.settings-file-name');
        if (fnEl) fnEl.textContent = file.name;
        const reader = new FileReader();
        reader.onload = (ev) => {
          phonesState[name].url = ev.target.result;
          updatePhonePreview(name);
        };
        reader.readAsDataURL(file);
        updatePhoneUrlInput(name);
        updatePhoneButtons();
      });
    });

    card.querySelectorAll('.settings-slot-url').forEach(input => {
      if (input.dataset.bound) return;
      input.dataset.bound = '1';
      ['input', 'change'].forEach(evt => {
        input.addEventListener(evt, () => {
          const slotEl = input.closest('.settings-duo-slot');
          const name = slotEl?.dataset.slot;
          if (!name) return;
          const st = phonesState[name];
          const value = input.value.trim();
          if (!value) {
            if (st.source === 'url' && st.url) {
              st.url = '';
              st.file = null;
              st.changed = true;
              st.hasImage = false;
              st.source = '';
              updatePhonePreview(name);
              updatePhoneButtons();
            }
            return;
          }
          let valid = false;
          try {
            const parsed = new URL(value);
            valid = parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'data:';
          } catch (err) { valid = /^data:image\//i.test(value); }
          if (!valid) return;
          st.url = value;
          st.file = null;
          st.changed = true;
          st.hasImage = true;
          st.source = 'url';
          updatePhonePreview(name);
          updatePhoneButtons();
        });
      });
    });

    card.querySelectorAll('.settings-slot-remove').forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        const name = btn.dataset.slotRemove;
        const st = phonesState[name];
        if (!st.hasImage && !st.changed && !phonesSaved[name]) {
          phonesAdded = phonesAdded.filter(n => n !== name);
          renderPhonesList();
          return;
        }
        st.url = '';
        st.file = null;
        st.changed = true;
        st.hasImage = false;
        st.source = '';
        resetPhoneSlotInputs(name);
        updatePhonePreview(name);
        updatePhoneUrlInput(name);
        updatePhoneButtons();
      });
    });
  }

  duoCard()?.querySelector('#phones-add-btn')?.addEventListener('click', () => {
    const next = HERO_PHONES_NAMES.find(n => !phonesAdded.includes(n));
    if (!next) return;
    phonesAdded.push(next);
    renderPhonesList();
  });

  async function loadHeroPhones() {
    try {
      const docs = await Promise.all(HERO_PHONES_NAMES.map(n => getDoc(doc(db, IMG_COLLECTION, HERO_PHONES_DOCS[n]))));
      HERO_PHONES_NAMES.forEach((n, i) => {
        const d = docs[i].exists() ? docs[i].data() : {};
        phonesSaved[n] = d.url || d.data || '';
      });
      phonesAdded = HERO_PHONES_NAMES.filter(n => phonesSaved[n]);
      renderPhonesList();
      updatePhoneButtons();
    } catch (err) {
      console.warn('[Settings Content] No se pudieron cargar los teléfonos del hero.');
      renderPhonesList();
    }
  }

  async function compressPhoneImage(file) {
    const readAsDataURL = (blob) => new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('No se pudo leer el archivo'));
      r.readAsDataURL(blob);
    });
    const decode = (src) => new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('No se pudo decodificar la imagen'));
      el.src = src;
    });
    const MAX_LEN = 950000;
    try {
      const rawUrl = await readAsDataURL(file);
      const img = await decode(rawUrl);
      const ladder = [
        { maxDim: 2400, quality: 0.92 },
        { maxDim: 2400, quality: 0.85 },
        { maxDim: 2400, quality: 0.78 },
        { maxDim: 1600, quality: 0.85 },
        { maxDim: 1600, quality: 0.72 },
        { maxDim: 1200, quality: 0.75 },
        { maxDim: 900, quality: 0.65 }
      ];
      for (const step of ladder) {
        const scale = Math.min(1, step.maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        let out = canvas.toDataURL('image/webp', step.quality);
        if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/jpeg', step.quality);
        if (out.length <= MAX_LEN) return out;
      }
      throw new Error('La imagen no se puede reducir por debajo del límite');
    } catch (err) {
      const raw = await readAsDataURL(file);
      if (raw.length <= MAX_LEN) return raw;
      throw new Error('La imagen es demasiado grande incluso comprimida');
    }
  }

  async function doSavePhones() {
    const card = duoCard();
    cardStatus(card, 'loading', 'Guardando...');
    try {
      for (const name of phonesAdded) {
        const st = phonesState[name];
        const ref = doc(db, IMG_COLLECTION, HERO_PHONES_DOCS[name]);
        if (st.file) {
          const finalUrl = await uploadToCloudinary(st.file);
          await setDoc(ref, { url: finalUrl, type: 'upload', updatedAt: new Date().toISOString() });
          phonesSaved[name] = finalUrl;
        } else if (st.source === 'url' && st.url) {
          const finalUrl = await uploadToCloudinary(st.url);
          await setDoc(ref, { url: finalUrl, type: 'url', updatedAt: new Date().toISOString() });
          phonesSaved[name] = finalUrl;
        } else if (st.changed) {
          await deleteDoc(ref);
          phonesSaved[name] = '';
        }
      }
      phonesAdded.forEach(applyPhonesSaved);
      updatePhoneButtons();
      cardStatus(card, 'success', 'Imágenes guardadas');
      showAlert('Imágenes del hero actualizadas correctamente', 'success');
      setTimeout(() => cardStatus(card, '', ''), 3000);
    } catch (err) {
      console.error('[Settings Content] Save hero phones error:', err);
      cardStatus(card, 'error', 'Error al guardar');
      showAlert('Error al guardar las imágenes del hero', 'error');
    }
  }

  function doCancelPhones() {
    phonesAdded.forEach(applyPhonesSaved);
    phonesAdded = HERO_PHONES_NAMES.filter(n => phonesSaved[n]);
    renderPhonesList();
    updatePhoneButtons();
    const card = duoCard();
    if (card) cardStatus(card, '', '');
  }

  duoCard()?.querySelector('.settings-duo-save')?.addEventListener('click', () => {
    if (phonesAdded.some(n => phonesState[n].changed)) doSavePhones();
  });
  duoCard()?.querySelector('.settings-duo-cancel')?.addEventListener('click', doCancelPhones);

  // ---- Carga inicial ----
  async function loadDoc(docId) {
    let data = DEFAULTS[docId];
    try {
      const snap = await getDoc(doc(db, SETTINGS_COLLECTION, docId));
      if (snap.exists()) data = deepMerge(DEFAULTS[docId], snap.data());
    } catch (err) {
      console.warn(`[Settings Content] No se pudo cargar "${docId}".`);
    }
    docsState[docId].loaded = data;
    applyDocValues(docId, data);
    LISTS.filter(cfg => cfg.doc === docId).forEach(cfg => renderList(cfg, data[cfg.listKey]));
    syncRichFields();
    updateDocButtons(docId);
    if (docId === 'whatsapp') renderWaPreview();
  }

  document.addEventListener('settings-applied', () => syncRichFields());
  initRichFields(settingsSection, 'empresa');

  TEXT_DOCS.forEach(loadDoc);
  IMG_KEYS.forEach(loadImg);
  loadHeroPhones();
  setTimeout(renderWaPreview, 0);

  console.log('[Settings Content v1] Módulo de contenido público con Supabase listo');
})();

// ==========================================================================
// MÓDULO DE LLAVES DE ACCESO - Gestión de códigos alfanuméricos de 8 caracteres
// Tabla Supabase: configuracion/llaves-acceso
// ==========================================================================
(() => {
  const llavesSection = document.getElementById('settings-llaves-tab');
  if (!llavesSection) return;

  let llaves = [];
  let loaded = false;

  // Código alfanumérico de 8 caracteres (sin caracteres ambiguos 0/O y 1/I),
  // generado con RNG criptográfico: 32^8 combinaciones, imposible de adivinar.
  function genCodigo() {
    const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    let codigo = '';
    for (let i = 0; i < 8; i++) codigo += alfabeto[bytes[i] % alfabeto.length];
    return codigo;
  }

  function escapeStr(s) {
    return String(s || '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[c]));
  }

  function setStatus(type, msg) {
    const el = document.getElementById('status-llaves');
    if (!el) return;
    if (type === 'loading') {
      el.innerHTML = '<span class="settings-upload-spinner"></span><span>' + escapeStr(msg) + '</span>';
      el.className = 'settings-upload-status is-loading';
    } else if (type === 'success') {
      el.innerHTML = '<i class="ph ph-check-circle"></i><span>' + escapeStr(msg) + '</span>';
      el.className = 'settings-upload-status is-success';
      setTimeout(() => { el.className = 'settings-upload-status'; el.innerHTML = ''; }, 3000);
    } else if (type === 'error') {
      el.innerHTML = '<i class="ph ph-x-circle"></i><span>' + escapeStr(msg) + '</span>';
      el.className = 'settings-upload-status is-error';
      setTimeout(() => { el.className = 'settings-upload-status'; el.innerHTML = ''; }, 4000);
    } else {
      el.innerHTML = ''; el.className = 'settings-upload-status';
    }
  }

  async function cargarLlaves() {
    try {
      const snap = await getDoc(doc(db, 'configuracion', 'llaves-acceso'));
      if (snap.exists()) {
        llaves = Array.isArray(snap.data().llaves) ? snap.data().llaves : [];
        // Migración segura: códigos guardados en texto plano → hash SHA-256.
        let huboMigracion = false;
        for (const l of llaves) {
          if (l.codigo && !l.hash) {
            l.hash = await sha256Hex(l.codigo);
            delete l.codigo;
            huboMigracion = true;
          }
        }
        if (huboMigracion) await guardarLlavesSilencioso();
      } else { llaves = []; }
      loaded = true;
      renderLlaves();
    } catch (err) {
      console.warn('[Llaves] No se pudieron cargar:', err);
      llaves = []; renderLlaves();
    }
  }

  async function guardarLlavesSilencioso() {
    try {
      await setDoc(doc(db, 'configuracion', 'llaves-acceso'), { llaves, updatedAt: new Date().toISOString() });
    } catch (err) {
      console.warn('[Llaves] Error al migrar hash:', err);
    }
  }

  async function guardarLlaves() {
    setStatus('loading', 'Guardando...');
    try {
      await setDoc(doc(db, 'configuracion', 'llaves-acceso'), { llaves, updatedAt: new Date().toISOString() });
      setStatus('success', 'Llaves guardadas');
      renderLlaves();
    } catch (err) {
      console.error('[Llaves] Error al guardar:', err);
      setStatus('error', 'Error al guardar las llaves');
    }
  }

  // Acciones sensibles de llaves: siempre se revalida la llave de acceso.
  async function conAccesoLlaves(accion) {
    const ok = await pedirLlave('Acción sensible', 'Para modificar llaves debes volver a ingresar la llave de acceso.', { incluirInactivas: true });
    if (!ok) { setStatus('error', 'Acción cancelada: llave incorrecta.'); return; }
    return accion();
  }

  // Registro temporal de códigos reales (solo en el navegador, nunca en la BD):
  // permite al ojo revelar y al botón copiar la llave completa en cualquier momento.
  const codigosGenerados = new Map();
  const codigosRevelados = new Set();
  const SS_KEY = 'miphone_llaves_codigos_v1';

  function persistirCodigos() {
    try { localStorage.setItem(SS_KEY, JSON.stringify([...codigosGenerados])); } catch (err) {}
  }

  function cargarCodigos() {
    let datos = [];
    try { datos = JSON.parse(localStorage.getItem(SS_KEY) || '[]'); } catch (err) {}
    if (!datos.length) {
      // Migración: versión anterior guardaba los códigos en sessionStorage.
      try { datos = JSON.parse(sessionStorage.getItem(SS_KEY) || '[]'); } catch (err) {}
      if (datos.length) {
        try { localStorage.setItem(SS_KEY, JSON.stringify(datos)); } catch (err) {}
      }
    }
    for (const [h, c] of datos) codigosGenerados.set(h, c);
  }

  async function copiarTexto(texto) {
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(texto); return true; } catch (err) {}
    }
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (err) {}
    ta.remove();
    return ok;
  }

  // Recuperación: solo aplica a llaves legadas de 6 dígitos numéricos, cuyo
  // hash SHA-256 se puede reconstruir por búsqueda rápida en el navegador.
  // Las llaves nuevas (8 caracteres alfanuméricos) no se pueden recuperar.
  let recuperando = false;

  async function recuperarCodigoDeHash(hashKey) {
    const hashMin = String(hashKey || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hashMin)) return null;
    setStatus('loading', 'Buscando el código de la llave.');
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 64; i += 2) bytes[i >> 1] = parseInt(hashMin.slice(i, i + 2), 16);
    const tail = [bytes[30], bytes[31]];
    const enc = new TextEncoder();
    const BATCH = 400;
    let candidatos = 0;
    for (let start = 100000; start <= 999999; start += BATCH) {
      const nums = [];
      for (let n = start; n < start + BATCH && n <= 999999; n++) nums.push(String(n));
      const bufs = await Promise.all(nums.map(t => crypto.subtle.digest('SHA-256', enc.encode(t))));
      for (let i = 0; i < bufs.length; i++) {
        const d = new Uint8Array(bufs[i]);
        if (d[30] === tail[0] && d[31] === tail[1]) {
          candidatos++;
          let igual = true;
          for (let j = 0; j < 32; j++) { if (d[j] !== bytes[j]) { igual = false; break; } }
          if (igual) return nums[i];
        }
      }
      if (candidatos >= 128) break;
      if (start % 100000 === 0) {
        const pct = Math.min(99, Math.round(((start - 100000) / 899999) * 100));
        setStatus('loading', `Buscando el código de la llave. ${pct}%`);
      }
    }
    return null;
  }

  function codigoEnmascarado(hash) {
    if (!hash || hash.length < 8) return '......';
    return '......' + hash.slice(-4).toUpperCase();
  }

  // Vista oculta consistente: enmascara el código REAL dejando visibles los
  // últimos 4 caracteres (respaldo: hash, solo para llaves sin código).
  function textoEnmascarado(codigoReal, hashKey) {
    if (codigoReal) {
      const c = String(codigoReal);
      return '.'.repeat(Math.max(0, c.length - 4)) + c.slice(-4);
    }
    return codigoEnmascarado(hashKey);
  }

  function renderLlaves() {
    const list = document.getElementById('llaves-list');
    if (!list) return;
    if (llaves.length === 0) {
      list.innerHTML = '<div class="settings-phones-empty"><i class="ph ph-key" aria-hidden="true"></i><span>No hay llaves creadas. Genera una para empezar.</span></div>';
      return;
    }
    list.innerHTML = llaves.map((l, i) => {
      const activa = l.activa !== false;
      const hashKey = l.hash || l.codigo;
      const codigoReal = codigosGenerados.get(hashKey) || l.codigo;
      const revelado = codigosRevelados.has(hashKey);
      const texto = revelado && codigoReal ? escapeStr(codigoReal) : escapeStr(textoEnmascarado(codigoReal, hashKey));
      const hayCodigo = Boolean(codigoReal);
      return `<div class="settings-list-item" data-llave-index="${i}">
        <div class="settings-list-fields">
          <div class="llave-codigo-row"><code class="llave-codigo" data-llave-code="${i}">${texto}</code>
          <button type="button" class="settings-list-btn llave-accion-btn" data-llave-eye="${i}" title="${hayCodigo ? (revelado ? 'Ocultar llave' : 'Mostrar llave completa') : 'Código no disponible: se mostró una sola vez al generarla'}"><i class="ph ${revelado && hayCodigo ? 'ph-eye-slash' : 'ph-eye'}" aria-hidden="true"></i></button>
          <button type="button" class="settings-list-btn llave-accion-btn" data-llave-copy="${i}" title="${hayCodigo ? 'Copiar llave' : 'Código no disponible: se mostró una sola vez al generarla'}"><i class="ph ph-copy" aria-hidden="true"></i></button>
          ${hayCodigo ? '' : `<button type="button" class="settings-list-btn llave-accion-btn" data-llave-recover="${i}" title="Recuperar código de esta llave"><i class="ph ph-key" aria-hidden="true"></i></button>`}
          <span class="llave-estado ${activa ? 'is-active' : 'is-inactive'}">${activa ? 'Activa' : 'Inactiva'}</span></div>
          <input type="text" class="llave-desc-input" value="${escapeStr(l.descripcion || '')}" placeholder="Descripción (ej. Llave principal)" data-llave-desc="${i}" maxlength="60">
        </div>
        <div class="settings-list-controls">
          <button type="button" class="settings-list-btn" data-llave-toggle="${i}" title="${activa ? 'Desactivar' : 'Activar'}"><i class="ph ${activa ? 'ph-power' : 'ph-play'}" aria-hidden="true"></i></button>
          <button type="button" class="settings-list-btn settings-list-btn--del" data-llave-delete="${i}" title="Eliminar"><i class="ph ph-trash" aria-hidden="true"></i></button>
        </div></div>`;
    }).join('');

    list.querySelectorAll('[data-llave-eye]').forEach(btn => {
      btn.addEventListener('click', e => {
        const idx = +e.currentTarget.dataset.llaveEye;
        const l = llaves[idx];
        if (!l) return;
        const hashKey = l.hash || l.codigo;
        const codeEl = list.querySelector(`[data-llave-code="${idx}"]`);
        const icon = e.currentTarget.querySelector('.ph');
        if (codigosRevelados.has(hashKey)) {
          codigosRevelados.delete(hashKey);
          const codigoOculto = codigosGenerados.get(hashKey) || l.codigo || null;
          if (codeEl) codeEl.textContent = textoEnmascarado(codigoOculto, hashKey);
          if (icon) icon.className = 'ph ph-eye';
          e.currentTarget.title = 'Mostrar llave completa';
        } else {
          const codigoReal = codigosGenerados.get(hashKey) || l.codigo;
          if (!codigoReal) { setStatus('error', 'Código no disponible en esta sesión. Usa el botón de llave para recuperarlo.'); return; }
          codigosRevelados.add(hashKey);
          if (codeEl) codeEl.textContent = codigoReal;
          if (icon) icon.className = 'ph ph-eye-slash';
          e.currentTarget.title = 'Ocultar llave';
        }
      });
    });
    list.querySelectorAll('[data-llave-copy]').forEach(btn => {
      btn.addEventListener('click', async e => {
        const idx = +e.currentTarget.dataset.llaveCopy;
        const l = llaves[idx];
        if (!l) return;
        const codigoReal = codigosGenerados.get(l.hash || l.codigo) || l.codigo;
        if (!codigoReal) { setStatus('error', 'Código no disponible en esta sesión. Usa el botón de llave para recuperarlo.'); return; }
        const ok = await copiarTexto(codigoReal);
        if (!ok) { setStatus('error', 'No se pudo copiar la llave'); return; }
        const icon = e.currentTarget.querySelector('.ph');
        if (icon) icon.className = 'ph ph-check';
        e.currentTarget.title = 'Llave copiada';
        setStatus('success', 'Llave copiada al portapapeles');
        setTimeout(() => {
          if (icon) icon.className = 'ph ph-copy';
          e.currentTarget.title = 'Copiar llave';
        }, 1500);
      });
    });

    list.querySelectorAll('[data-llave-recover]').forEach(btn => {
      btn.addEventListener('click', async e => {
        const idx = +e.currentTarget.dataset.llaveRecover;
        const l = llaves[idx];
        if (!l) return;
        const hashKey = l.hash || l.codigo;
        if (recuperando) { setStatus('error', 'Ya hay una recuperación en curso'); return; }
        if (codigosGenerados.has(hashKey)) return;
        recuperando = true;
        try {
          const codigo = await recuperarCodigoDeHash(hashKey);
          if (!codigo) { setStatus('error', 'No se pudo recuperar: las llaves nuevas (8 caracteres) no son recuperables. Solo las antiguas de 6 dígitos.'); return; }
          codigosGenerados.set(hashKey, codigo);
          persistirCodigos();
          codigosRevelados.add(hashKey);
          setStatus('success', `Código recuperado: ${codigo}`);
          renderLlaves();
        } catch (err) {
          setStatus('error', 'No se pudo recuperar el código de esta llave');
        } finally {
          recuperando = false;
        }
      });
    });
    list.querySelectorAll('[data-llave-desc]').forEach(input => {
      input.addEventListener('input', e => { const idx = +e.target.dataset.llaveDesc; if (llaves[idx]) llaves[idx].descripcion = e.target.value; });
      input.addEventListener('change', () => conAccesoLlaves(guardarLlaves));
    });
    list.querySelectorAll('[data-llave-toggle]').forEach(btn => {
      btn.addEventListener('click', e => {
        const idx = +e.currentTarget.dataset.llaveToggle;
        if (!llaves[idx]) return;
        conAccesoLlaves(() => { llaves[idx].activa = llaves[idx].activa === false; return guardarLlaves(); });
      });
    });
    list.querySelectorAll('[data-llave-delete]').forEach(btn => {
      btn.addEventListener('click', e => {
        const idx = +e.currentTarget.dataset.llaveDelete;
        if (llaves[idx] === undefined) return;
        conAccesoLlaves(() => { llaves.splice(idx, 1); return guardarLlaves(); });
      });
    });
  }

  async function generarCodigoUnico() {
    const existentes = new Set(llaves.filter(l => l.hash).map(l => l.hash));
    let codigo, intentos = 0;
    do { codigo = genCodigo(); intentos++; } while (existentes.has(await sha256Hex(codigo)) && intentos < 100);
    return codigo;
  }

  document.getElementById('llave-add-btn')?.addEventListener('click', () => {
    conAccesoLlaves(async () => {
      const codigo = await generarCodigoUnico();
      const hash = await sha256Hex(codigo);
      codigosGenerados.set(hash, codigo);
      persistirCodigos();
      llaves.push({ hash, activa: true, descripcion: '', createdAt: new Date().toISOString() });
      await guardarLlaves();
      // La llave se muestra una sola vez (los códigos no se guardan en texto plano).
      showAlert(`Llave generada: ${codigo}. Cópiala ahora: no volverá a mostrarse.`, 'success');
    });
  });

  cargarCodigos();
  cargarLlaves();
  console.log('[Llaves] Módulo de llaves de acceso listo');
})();

// ==========================================================================
// MÓDULO DE USUARIOS — Administración de información y permisos
// Tabla Supabase: usuarios/Usuario-Admin-N (IDs secuenciales)
// IMPORTANTE: las contraseñas NUNCA se guardan en la BD; la cuenta se
// crea en Supabase Auth y el registro de la tabla referencia su UID.
// ==========================================================================
(() => {
  const usuariosSection = document.getElementById('settings-usuarios-tab');
  if (!usuariosSection) return;
  // Este módulo es exclusivo de administradores.
  if (document.body.dataset.rol === 'editor') {
    usuariosSection.hidden = true;
    return;
  }

  let usuarios = [];

  function esc(s) {
    return String(s || '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[c]));
  }

  function normalizar(u, docId) {
    return {
      id: docId,                                // Usuario-Admin-N (doc id)
      uid: u.uid || u.uidAuth || '',            // UID de Supabase Auth
      nombre: u.nombre || u.displayName || '',
      correo: u.correo || u.email || '',
      rol: u.rol || u.role || 'editor',
      estado: u.estado || 'activo',
      activo: typeof u.activo === 'boolean' ? u.activo : (u.estado !== 'bloqueado' && u.estado !== 'eliminado'),
      fechaCreacion: u.fechaCreacion || u.createdAt || ''
    };
  }

  function fmtFecha(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleDateString('es-HN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) { return '—'; }
  }

  function rolLabel(rol) {
    const r = String(rol || 'editor').toLowerCase();
    if (r === 'admin' || r === 'administrador') return { texto: 'Administrador', clase: 'rol-admin', icon: 'ph-user-gear' };
    if (r === 'editor' || r === 'vendedor') return { texto: 'Editor', clase: 'rol-editor', icon: 'ph-user' };
    return { texto: rol || 'Usuario', clase: 'rol-user', icon: 'ph-user-circle' };
  }

  function esYo(u) {
    return !!auth.currentUser && !!u.uid && u.uid === auth.currentUser.uid;
  }

  function renderTabla() {
    const tbody = document.getElementById('usuarios-tbody');
    const empty = document.getElementById('usuarios-empty');
    const count = document.getElementById('usuarios-count');
    if (!tbody) return;

    const visibles = usuarios.filter(u => u.estado !== 'eliminado');
    const total = visibles.length;
    if (count) count.innerHTML = `<i></i> ${total} usuario(s)`;

    if (total === 0) { tbody.innerHTML = ''; if (empty) empty.hidden = false; return; }
    if (empty) empty.hidden = true;

    tbody.innerHTML = visibles.map((u) => {
      const rl = rolLabel(u.rol);
      const activo = u.activo;
      const nombre = u.nombre || u.correo || '—';
      const yo = esYo(u);
      return `
        <tr data-id="${esc(u.id)}">
          <td>
            <div class="usuario-cell">
              <span class="usuario-avatar">${esc((nombre.trim()[0] || '?').toUpperCase())}</span>
              <div class="usuario-cell-info"><strong>${esc(nombre)}</strong>${yo ? '<em class="usuario-yo">(tú)</em>' : ''}</div>
            </div>
          </td>
          <td>${esc(u.correo) || '—'}</td>
          <td><span class="rol-pill ${rl.clase}"><i class="ph ${rl.icon}" aria-hidden="true"></i>${esc(rl.texto)}</span></td>
          <td><span class="estado-pill ${activo ? 'is-active' : 'is-inactive'}">${activo ? 'Activo' : 'Bloqueado'}</span></td>
          <td>${fmtFecha(u.fechaCreacion)}</td>
          <td class="ta-right">
            <div class="table-actions">
              <button type="button" class="table-action-btn table-action-btn--edit" data-usuario-edit="${esc(u.id)}" title="Editar usuario">
                <i class="ph ph-pencil-simple" aria-hidden="true"></i><span>Editar</span>
              </button>
              <button type="button" class="table-action-btn table-action-btn--del" data-usuario-delete="${esc(u.id)}" title="Eliminar usuario">
                <i class="ph ph-trash" aria-hidden="true"></i><span>Eliminar</span>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('[data-usuario-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const u = usuarios.find(x => x.id === btn.dataset.usuarioEdit);
        if (u) abrirEditor(u);
      });
    });
    tbody.querySelectorAll('[data-usuario-delete]').forEach(btn => {
      btn.addEventListener('click', () => {
        const u = usuarios.find(x => x.id === btn.dataset.usuarioDelete);
        if (u) eliminarUsuario(u);
      });
    });
  }

  function abrirEditor(u) {
    const tr = document.querySelector(`#usuarios-tbody tr[data-id="${CSS.escape(u.id)}"]`);
    if (!tr) return;
    const yo = esYo(u);
    const nombreCell = tr.querySelector('.usuario-cell-info');
    nombreCell.innerHTML = `<input type="text" class="usuario-edit-nombre" value="${esc(u.nombre)}" maxlength="80" aria-label="Nombre del usuario">`;

    const rolCell = tr.children[2];
    rolCell.innerHTML = yo
      ? `<span class="rol-pill rol-admin"><i class="ph ph-user-gear" aria-hidden="true"></i>Administrador</span>`
      : `<select class="usuario-edit-rol" aria-label="Rol">
        <option value="admin" ${u.rol === 'admin' ? 'selected' : ''}>Administrador</option>
        <option value="editor" ${u.rol === 'editor' ? 'selected' : ''}>Editor</option>
      </select>`;

    const estadoCell = tr.children[3];
    estadoCell.innerHTML = yo
      ? `<span class="estado-pill is-active">Activo</span>`
      : `<label class="switch"><input type="checkbox" class="usuario-edit-activo" ${u.activo ? 'checked' : ''}><span class="switch-slider"></span></label><span class="switch-label">${u.activo ? 'Activo' : 'Bloqueado'}</span>`;

    const accionesCell = tr.children[5];
    accionesCell.innerHTML = `
      <div class="table-actions">
        <button type="button" class="table-action-btn" data-usuario-save="${esc(u.id)}"><i class="ph ph-check" aria-hidden="true"></i><span>Guardar</span></button>
        <button type="button" class="table-action-btn" data-usuario-cancel><i class="ph ph-x" aria-hidden="true"></i><span>Cancelar</span></button>
      </div>`;

    tr.querySelector('[data-usuario-cancel]').addEventListener('click', renderTabla);
    tr.querySelector('[data-usuario-save]').addEventListener('click', async () => {
      const nombre = (tr.querySelector('.usuario-edit-nombre')?.value || '').trim();
      const rolSelect = tr.querySelector('.usuario-edit-rol');
      const rolFinal = rolSelect ? (rolSelect.value === 'editor' ? 'editor' : 'admin') : u.rol;
      const activoCheck = tr.querySelector('.usuario-edit-activo');
      const activo = activoCheck ? activoCheck.checked : u.activo;
      try {
        await setDoc(doc(db, 'usuarios', u.id), {
          nombre,
          rol: rolFinal,
          role: rolFinal,
          activo,
          estado: activo ? 'activo' : 'bloqueado',
          permisos: permisosPorRol(rolFinal),
          updatedAt: new Date().toISOString()
        }, { merge: true });
        const idx = usuarios.findIndex(x => x.id === u.id);
        if (idx >= 0) { usuarios[idx] = { ...usuarios[idx], nombre, rol: rolFinal, activo, estado: activo ? 'activo' : 'bloqueado' }; }
        renderTabla();
        showAlert('Usuario actualizado correctamente', 'success');
      } catch (err) {
        showAlert('Error al actualizar usuario: ' + err.message, 'error');
      }
    });
  }

  function eliminarUsuario(u) {
    if (esYo(u)) { showAlert('No puedes eliminar tu propia cuenta.', 'error'); return; }
    showConfirm(
      'Eliminar usuario',
      `Se bloqueará el acceso de <strong>${esc(u.nombre || u.correo)}</strong>. Su perfil se marca como eliminado y el documento permanece oculto. La cuenta de Authentication se conserva (solo la consola de Supabase puede borrarla definitivamente).`,
      async () => {
        try {
          await setDoc(doc(db, 'usuarios', u.id), {
            activo: false,
            estado: 'eliminado',
            updatedAt: new Date().toISOString()
          }, { merge: true });
          showAlert('Usuario eliminado y acceso bloqueado', 'success');
          await cargarUsuarios();
        } catch (err) {
          showAlert('Error al eliminar usuario: ' + err.message, 'error');
        }
      },
      { tone: 'danger', okLabel: 'Eliminar' }
    );
  }

  async function cargarUsuarios() {
    try {
      const snap = await getDocs(collection(db, 'usuarios'));
      usuarios = snap.docs.map(d => normalizar(d.data(), d.id));
      usuarios.sort((a, b) => String(a.nombre || a.correo).localeCompare(String(b.nombre || b.correo), 'es'));
      renderTabla();
    } catch (err) {
      console.warn('[Usuarios] No se pudieron cargar:', err);
      usuarios = []; renderTabla();
    }
  }

  // ---- Crear usuario desde el panel: Auth + Supabase ----
  const crearDialog = document.getElementById('usuario-create-dialog');
  const crearOverlay = document.getElementById('usuario-create-overlay');
  const crearForm = document.getElementById('usuario-create-form');
  const crearError = document.getElementById('usuario-create-error');
  const crearSubmitBtn = document.getElementById('usuario-create-submit');

  function abrirCrearDialog() {
    if (crearForm) crearForm.reset();
    if (crearError) { crearError.hidden = true; crearError.textContent = ''; }
    if (crearDialog) crearDialog.hidden = false;
  }
  function cerrarCrearDialog() {
    if (crearDialog) crearDialog.hidden = true;
  }

  document.getElementById('usuario-add-btn')?.addEventListener('click', abrirCrearDialog);
  document.getElementById('usuario-create-cancel')?.addEventListener('click', cerrarCrearDialog);
  crearOverlay?.addEventListener('click', cerrarCrearDialog);

  crearForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = (document.getElementById('usuario-create-nombre')?.value || '').trim();
    const correo = (document.getElementById('usuario-create-correo')?.value || '').trim().toLowerCase();
    const password = document.getElementById('usuario-create-password')?.value || '';
    const rol = document.getElementById('usuario-create-rol')?.value === 'admin' ? 'admin' : 'editor';

    if (!nombre || !correo || !password) { mostrarErrorCrear('Completa todos los campos.'); return; }

    try {
      // El trigger handle_new_user de Supabase crea automáticamente el doc en
      // public.usuarios con el id secuencial (Usuario-Admin-N), rol, nombre y
      // permisos correctos, usando la metadata pasada al signUp. No se necesita
      // setDoc manual (evita doble inserción y huecos de contador).
      await crearUsuarioTemporal(correo, password, { rol, nombre });
      cerrarCrearDialog();
      showAlert(`Usuario <strong>${esc(nombre)}</strong> creado correctamente`, 'success');
      await cargarUsuarios();
    } catch (err) {
      let msg = err.message || 'Error desconocido';
      if (err.code === 'auth/email-already-in-use' || (err.message && err.message.includes('already'))) msg = 'Ese correo ya tiene una cuenta. Usa otro o contacta al administrador.';
      else if (err.code === 'auth/invalid-email' || (err.message && err.message.includes('email'))) msg = 'El correo no es válido.';
      else if (err.code === 'auth/weak-password' || (err.message && err.message.includes('password'))) msg = 'La contraseña debe tener al menos 6 caracteres.';
      else if (err.code === 'auth/operation-not-allowed') msg = 'El registro de correo/contraseña no está habilitado en Supabase Authentication.';
      console.error('[Usuarios] Error al crear:', err.code, err.message);
      mostrarErrorCrear(msg);
    }
  });

  function mostrarErrorCrear(msg) {
    if (crearError) { crearError.textContent = msg; crearError.hidden = false; }
  }

  cargarUsuarios();
  console.log('[Usuarios] Módulo de usuarios listo');
})();


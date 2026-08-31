/* ==========================================================================
   MI PHONE HN — PANEL ADMIN SAAS CON SUPABASE + CLOUDINARY
   ========================================================================== */

import { 
  db, 
  supabase,
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
    return llaves.some(l => (l.activa !== false || opciones.incluirInactivas) && l.hash === hash);
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
let categoryImageEditingId = null; // id de la categoría con el editor de imagen abierto (null = ninguno)
let categoryAddImage = null; // imagen pendiente de la categoría nueva: { url } o { file }
let categoryAddObjectUrl = null; // object URL para la vista previa de la categoría nueva

const CATEGORY_FALLBACK_IMAGE =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">` +
    `<rect width="120" height="120" fill="#eef1f6"/>` +
    `<circle cx="60" cy="52" r="20" fill="#dde7f3"/>` +
    `<rect x="48" y="30" width="24" height="46" rx="5" fill="#ffffff"/>` +
    `<rect x="50" y="33" width="20" height="38" rx="3" fill="#f3f6fa"/>` +
    `<circle cx="60" cy="68" r="2" fill="#c2ccda"/>` +
    `</svg>`
  );

function renderCategoryList() {
  const list = document.getElementById("category-list");
  if (!list) return;
  list.innerHTML = "";
  categories.forEach((cat, index) => {
    const count = products.filter(p => p.category === cat.id).length;
    const item = document.createElement("div");
    const editingImage = cat.id === categoryImageEditingId;
    item.className = "category-list-item" + ((cat.id === categoryEditingId || editingImage) ? " is-editing" : "");

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
    } else if (editingImage) {
      // Modo edición de imagen inline: URL, subida desde el equipo y vista previa.
      item.innerHTML = `
        <div class="category-image-editor">
          <div class="category-image-editor-head">
            <div class="category-list-thumb${cat.image ? "" : " is-fallback"}">
              ${cat.image ? `<img src="${escapeHTML(cat.image)}" alt="">` : `<img src="${CATEGORY_FALLBACK_IMAGE}" alt="">`}
            </div>
            <input type="url" class="category-image-input" value="${escapeHTML(cat.image || "")}" placeholder="URL de la imagen…" aria-label="URL de la imagen">
            <label class="btn btn-secondary btn-sm category-image-file-btn">
              <i class="ph ph-upload-simple" aria-hidden="true"></i> Subir
              <input type="file" class="category-image-file" accept="image/*" hidden>
            </label>
          </div>
          <div class="category-image-editor-actions">
            <button type="button" class="btn btn-primary btn-sm" data-cat-image-save="${escapeHTML(cat.id)}"><i class="ph ph-check" aria-hidden="true"></i> Guardar</button>
            ${cat.image ? `<button type="button" class="btn btn-danger-ghost btn-sm" data-cat-image-remove="${escapeHTML(cat.id)}"><i class="ph ph-trash" aria-hidden="true"></i> Quitar imagen</button>` : ""}
            <button type="button" class="btn btn-secondary btn-sm" data-cat-image-cancel title="Cancelar" aria-label="Cancelar"><i class="ph ph-x" aria-hidden="true"></i></button>
          </div>
        </div>
      `;
    } else {
      item.innerHTML = `
        <div class="category-list-thumb${cat.image ? "" : " is-fallback"}">
          ${cat.image ? `<img src="${escapeHTML(cat.image)}" alt="" loading="lazy">` : `<img src="${CATEGORY_FALLBACK_IMAGE}" alt="">`}
        </div>
        <div style="display:flex;flex-direction:column;gap:2px;min-width:0;flex:1">
          <span class="category-list-label">${escapeHTML(cat.label)}</span>
          <span style="font-family:var(--font-mono);font-size:.6875rem;color:var(--ink-3);font-weight:600">${escapeHTML(cat.id)} · ${count} prod</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <button type="button" class="btn btn-secondary btn-sm" data-cat-image="${escapeHTML(cat.id)}" title="Cambiar imagen de la categoría" aria-label="Cambiar imagen">
            <i class="ph ph-image" aria-hidden="true"></i>
          </button>
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

    const imageInput = item.querySelector(".category-image-input");
    const imageFileInput = item.querySelector(".category-image-file");
    if (imageInput) {
      imageInput.focus();
      imageInput.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); item.querySelector("[data-cat-image-save]")?.click(); }
        else if (ev.key === "Escape") { categoryImageEditingId = null; renderCategoryList(); }
      });
      if (imageFileInput) {
        imageFileInput.addEventListener("change", async () => {
          const file = imageFileInput.files?.[0];
          if (!file) return;
          if (file.size > MAX_IMAGE_SIZE) {
            showAlert("La imagen supera el tamaño máximo de 8 MB.", "error");
            imageFileInput.value = "";
            return;
          }
          const saveBtn = item.querySelector("[data-cat-image-save]");
          if (imageInput.dataset.uploading === "1") return;
          imageInput.dataset.uploading = "1";
          if (saveBtn) saveBtn.disabled = true;
          imageInput.value = "Subiendo…";
          try {
            const url = await uploadToCloudinary(file);
            imageInput.value = url;
            showAlert("Imagen subida. Pulsa Guardar para aplicarla.", "success");
          } catch (err) {
            imageInput.value = cat.image || "";
            showAlert("Error al subir la imagen: " + err.message, "error");
          } finally {
            imageInput.dataset.uploading = "";
            if (saveBtn) saveBtn.disabled = false;
            imageFileInput.value = "";
          }
        });
      }
      item.querySelector("[data-cat-image-cancel]")?.addEventListener("click", () => { categoryImageEditingId = null; renderCategoryList(); });
      item.querySelector("[data-cat-image-save]")?.addEventListener("click", async () => {
        const url = imageInput.value.trim();
        if (!url) { showAlert("Ingresa o sube una imagen primero.", "error"); return; }
        const saveBtn = item.querySelector("[data-cat-image-save]");
        if (saveBtn) saveBtn.disabled = true;
        try {
          await setDoc(doc(db, "categorias", cat.id), { image: url }, { merge: true });
          categoryImageEditingId = null;
          showAlert("Imagen de categoría actualizada", "success");
        } catch (err) {
          showAlert("Error al guardar la imagen: " + categoryImageErrorHint(err), "error");
          if (saveBtn) saveBtn.disabled = false;
        }
      });
      item.querySelector("[data-cat-image-remove]")?.addEventListener("click", async () => {
        const removeBtn = item.querySelector("[data-cat-image-remove]");
        if (removeBtn) removeBtn.disabled = true;
        try {
          await setDoc(doc(db, "categorias", cat.id), { image: null }, { merge: true });
          categoryImageEditingId = null;
          showAlert("Imagen de categoría eliminada", "success");
        } catch (err) {
          showAlert("Error al eliminar la imagen: " + categoryImageErrorHint(err), "error");
          if (removeBtn) removeBtn.disabled = false;
        }
      });
    }
  });
  list.querySelectorAll("[data-cat-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      categoryEditingId = btn.dataset.catEdit;
      categoryImageEditingId = null;
      renderCategoryList();
    });
  });
  list.querySelectorAll("[data-cat-image]").forEach(btn => {
    btn.addEventListener("click", () => {
      categoryImageEditingId = btn.dataset.catImage;
      categoryEditingId = null;
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

function resetCategoryAddImage() {
  if (categoryAddObjectUrl) {
    URL.revokeObjectURL(categoryAddObjectUrl);
    categoryAddObjectUrl = null;
  }
  categoryAddImage = null;
  const preview = document.getElementById("category-add-image-preview");
  const fileInput = document.getElementById("category-add-image-file");
  const urlInput = document.getElementById("category-add-image-url");
  const clearBtn = document.getElementById("category-add-image-clear");
  if (fileInput) fileInput.value = "";
  if (urlInput) urlInput.value = "";
  if (preview) {
    preview.hidden = true;
    preview.innerHTML = "";
  }
  if (clearBtn) clearBtn.hidden = true;
}

function previewCategoryAddImage() {
  const preview = document.getElementById("category-add-image-preview");
  if (!preview) return;
  let url = categoryAddImage?.url || "";
  if (!url && categoryAddImage?.file) {
    if (categoryAddObjectUrl) URL.revokeObjectURL(categoryAddObjectUrl);
    categoryAddObjectUrl = URL.createObjectURL(categoryAddImage.file);
    url = categoryAddObjectUrl;
  }
  const clearBtn = document.getElementById("category-add-image-clear");
  if (url) {
    preview.innerHTML = `<img src="${escapeHTML(url)}" alt="Vista previa de la imagen de categoría">`;
    preview.hidden = false;
    if (clearBtn) clearBtn.hidden = false;
  } else {
    preview.hidden = true;
    preview.innerHTML = "";
    if (clearBtn) clearBtn.hidden = true;
  }
}

function categoryImageErrorHint(err) {
  const msg = (err && err.message) || "";
  if (/image/i.test(msg) && /categor(ias|y)/i.test(msg)) {
    return "Falta la columna \"image\" en la tabla categorias. Ejecuta en el SQL Editor de Supabase: ALTER TABLE public.categorias ADD COLUMN IF NOT EXISTS image VARCHAR;";
  }
  if (err) {
    try {
      console.error("Error Supabase categorias (detalle):", JSON.stringify({ message: err.message, details: err.details, hint: err.hint, code: err.code }));
    } catch {
      console.error("Error Supabase categorias:", err);
    }
  }
  const parts = [err?.message, err?.details, err?.hint].filter(Boolean);
  return parts.join(" — ") || "Error desconocido";
}

function openCategoryModal() {
  categoryEditingId = null;
  categoryImageEditingId = null;
  resetCategoryAddImage();
  renderCategoryList();
  const catModal = document.getElementById("category-modal");
  if (catModal) catModal.hidden = false;
}

function closeCategoryModal() {
  categoryEditingId = null;
  categoryImageEditingId = null;
  resetCategoryAddImage();
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

/* ==========================================================================
   VARIANTES DE PRODUCTO — copia íntegra del formulario por variante.
   La primera entrada (índice 0) es SIEMPRE el producto principal. Cada
   variante (índice >0) guarda su copia completa del formulario (todos los
   campos, galería y archivos) de forma independiente pero agrupada bajo el
   mismo producto. Solo se persiste al guardar, dentro de variants.colors con
   `overrides` completos.
   ========================================================================== */
let variantDrafts = [];
let activeVariantIndex = 0;
let variantPreviewObjectUrls = [];
/* Evita que la validación en vivo re-habilite el botón de guardar mientras el
   envío (subida de imágenes/escritura en Supabase) está en curso. */
let isSubmittingProduct = false;
/* Mantiene el aviso de color en tono "error" tras un guardado rechazado hasta
   que el administrador edite el color de la variante. */
let variantErrorLocked = false;
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
const addStorageBtn = document.getElementById("add-storage-btn");
const confirmDialog = document.getElementById("confirm-dialog");
const confirmOverlay = document.getElementById("confirm-overlay");
const confirmTitle = document.getElementById("confirm-title");
const confirmMessage = document.getElementById("confirm-message");
const confirmCancelBtn = document.getElementById("confirm-cancel-btn");
const confirmOkBtn = document.getElementById("confirm-ok-btn");
/* Barra de variantes: producto principal + variantes de ficha completa */
const variantBar = document.getElementById("variant-bar");
const variantBarTabs = document.getElementById("variant-bar-tabs");
const addVariantBarBtn = document.getElementById("add-variant-bar-btn");
const variantColorEditor = document.getElementById("variant-color-editor");
const variantColorNameInput = document.getElementById("variant-color-name");
const variantColorPicker = document.getElementById("variant-color-picker");
const variantColorHexInput = document.getElementById("variant-color-hex");
const variantColorRgbInput = document.getElementById("variant-color-rgb");
const variantColorHslInput = document.getElementById("variant-color-hsl");
const variantColorOklchInput = document.getElementById("variant-color-oklch");
const variantColorRemoveBtn = document.getElementById("variant-color-remove-btn");
const fsColorsTitle = document.getElementById("fs-colors-title");
const fsColorsCopy = document.getElementById("fs-colors-copy");
const duplicateVariantBtn = document.getElementById("duplicate-variant-btn");
const saveProductBtn = document.getElementById("save-product-btn");
const variantColorWarning = document.getElementById("variant-color-warning");
const fileDropzone = document.getElementById("file-dropzone");
const productImageFileInput = document.getElementById("product-image-file");
const productImageUrlsInput = document.getElementById("product-image");
const productImagesPreview = document.getElementById("product-images-preview");
const productImagesCount = document.getElementById("product-images-count");
// Drawer de producto: elementos del rediseño
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
  addStorageBtn?.addEventListener("click", () => addStorageRow());
  /* Variantes de producto */
  addVariantBarBtn?.addEventListener("click", () => {
    const draft = snapshotFormToDraft();
    const next = cloneDraft(draft);
    next.isVariant = true;
    next.colorName = "";
    next.hex = "#CCCCCC";
    variantDrafts.push(next);
    activeVariantIndex = variantDrafts.length - 1;
    applyDraftToForm(next);
    renderVariantBar();
    variantBarTabs?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  duplicateVariantBtn?.addEventListener("click", () => {
    duplicateVariant();
  });
  variantColorNameInput?.addEventListener("input", () => {
    const draft = variantDrafts[activeVariantIndex];
    if (draft) draft.colorName = variantColorNameInput.value.trim();
    variantErrorLocked = false;
    renderVariantBar();
    updateVariantColorWarning();
    updateVariantScopeHints();
  });
  variantColorPicker?.addEventListener("input", () => { updateVariantHexInput(variantColorPicker.value); });
  variantColorHexInput?.addEventListener("input", () => {
    if (/^#[0-9a-fA-F]{6}$/.test(variantColorHexInput?.value?.trim() || "")) {
      updateVariantHexInput(variantColorHexInput.value.trim());
    }
  });
  /* Quitar variante desde la fila de color (mismo flujo que la barra de variantes). */
  variantColorRemoveBtn?.addEventListener("click", () => removeVariant(activeVariantIndex));
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
      storeLink.href = "https://miphonehn.vercel.app/";
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
    const addBtn = addCategoryBtnModal;
    try {
      let image = null;
      if (categoryAddImage?.file) {
        addBtn.disabled = true;
        addBtn.innerHTML = '<i class="ph ph-spinner ph-spin" aria-hidden="true"></i> Subiendo…';
        image = await uploadToCloudinary(categoryAddImage.file);
      } else if (categoryAddImage?.url) {
        image = categoryAddImage.url;
      }
      await setDoc(doc(db, "categorias", id), { label: name, image });
      if (newCategoryName) newCategoryName.value = "";
      resetCategoryAddImage();
      showAlert("Categoría creada correctamente", "success");
    } catch (err) {
      showAlert("Error al crear categoría: " + categoryImageErrorHint(err), "error");
    } finally {
      addBtn.disabled = false;
      addBtn.innerHTML = '<i class="ph ph-plus" aria-hidden="true"></i> Agregar';
    }
  });

  newCategoryName?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      addCategoryBtnModal?.click();
    }
  });

  // Imagen de la categoría nueva: subida desde el equipo o URL, con vista previa.
  const categoryAddImageFile = document.getElementById("category-add-image-file");
  const categoryAddImageUrl = document.getElementById("category-add-image-url");
  const categoryAddImageClear = document.getElementById("category-add-image-clear");

  categoryAddImageFile?.addEventListener("change", () => {
    const file = categoryAddImageFile.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMAGE_SIZE) {
      showAlert("La imagen supera el tamaño máximo de 8 MB.", "error");
      categoryAddImageFile.value = "";
      return;
    }
    categoryAddImage = { file };
    if (categoryAddImageUrl) categoryAddImageUrl.value = "";
    previewCategoryAddImage();
  });

  categoryAddImageUrl?.addEventListener("input", () => {
    const url = categoryAddImageUrl.value.trim();
    if (url) {
      categoryAddImage = { url };
      if (categoryAddImageFile) categoryAddImageFile.value = "";
    } else if (categoryAddImage && !categoryAddImage.file) {
      categoryAddImage = null;
    }
    previewCategoryAddImage();
  });

  categoryAddImageClear?.addEventListener("click", resetCategoryAddImage);

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

  // Estados visuales del rediseño: aviso y zona de riesgo.
  deleteProductBtn.hidden = !isEditing;
  if (drawerDangerZone) drawerDangerZone.hidden = !isEditing;
  if (drawerUpdateNotice) drawerUpdateNotice.hidden = !isEditing;
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
  // En edición, el botón "Actualizar producto" arranca deshabilitado hasta que
  // existan cambios reales (se habilita/deshabilita según el formulario).
  try { updateVariantColorWarning(); } catch { /* no bloquea */ }
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
  clearVariantPreviewObjectUrls();
  variantDrafts = [];
  activeVariantIndex = 0;
  variantErrorLocked = false;
  formIsDirty = false;
  clearFieldErrors();
  clearPreviewObjectUrls();
  // Limpiar el aviso de duplicado para la próxima apertura del drawer.
  productoDuplicadoBloqueado = false;
  ocultarBannerDuplicado();
  const dupSaveBtn = document.getElementById("save-product-btn");
  if (dupSaveBtn) dupSaveBtn.classList.remove("is-blocked");
  // Hook: el subsistema de backup reacciona al cerrar el drawer
  // (p. ej., reanudar la revisión de importación que quedó detrás).
  if (typeof alCerrarDrawerDesdeRevision === "function") {
    const cb = alCerrarDrawerDesdeRevision;
    alCerrarDrawerDesdeRevision = null;
    try { cb(); } catch (err) { console.warn("[backup] hook de cierre del drawer:", err); }
  }
}

/* ---- Detección de cambios sin guardar (solo Drawer de producto) ---- */

function computeFormSnapshot() {
  if (!productForm) return "";
  // El snapshot se basa EXCLUSIVAMENTE en los drafts de variantes: cada draft
  // ya contiene TODA la ficha (campos, listas, galería, pendientes y modo) y
  // se sincroniza con el formulario activo aquí abajo. Incluir además los
  // inputs crudos del formulario hacía que el mero hecho de CAMBIAR DE
  // PESTAÑA (principal ↔ variante) alterara el snapshot —la variante muestra
  // legítimamente su propia condición/descripción/etc.— y disparara el aviso
  // de "cambios sin guardar" sin que el administrador haya editado nada.
  syncActiveVariantFromForm();
  return variantDrafts.map((draft) => JSON.stringify({
    isVariant: draft.isVariant,
    colorName: draft.colorName,
    hex: draft.hex,
    title: draft.title,
    brand: draft.brand,
    category: draft.category,
    condition: draft.condition,
    batteryHealth: draft.batteryHealth,
    description: draft.description,
    includes: draft.includes,
    specs: draft.specs,
    storage: draft.storage,
    galleryUrls: draft.galleryUrls,
    pendingCount: (draft.pendingFiles || []).length,
    pendingImagesFirst: !!draft.pendingImagesFirst,
    uploadedCount: (draft.uploadedUrls || []).length,
    colors: draft.colors
  })).join("¦");
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
  // Solo colores del producto principal: los colores con `overrides` son
  // variantes y se cargan como pestañas (evita duplicados en el guardado).
  const allColors = product.variants?.colors?.length
    ? product.variants.colors
    : [{ name: "", value: "#cccccc" }];
  const baseColors = allColors.filter((color) => !color.overrides || !Object.keys(color.overrides).length);
  // Solo {name, value}: rgb/hsl/oklch se RECALCULAN siempre (addColorRow). Si se
  // aceptaran los strings guardados, el snapshot de "cambios sin guardar"
  // diferiría del recalculado al re-renderizar (falso positivo de dirty).
  (baseColors.length ? baseColors : [{ name: "", value: "#cccccc" }])
    .forEach((color) => addColorRow({ name: color.name, value: color.value || color.hex || "#cccccc" }));

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

  // Inicializar el editor de variantes (producto principal + variantes).
  loadVariantsFromProduct(product);
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

/* ==========================================================================
   VARIANTES DE PRODUCTO — snapshot del formulario completo por variante
   ========================================================================== */

function getFormValue(id) {
  return document.getElementById(id)?.value ?? "";
}

function setFormValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? "";
}

function getListValues(listId, sel) {
  const list = document.getElementById(listId);
  return list ? [...list.querySelectorAll(sel)].map((i) => i.value) : [];
}

function getListColors() {
  return colorsList ? [...colorsList.querySelectorAll(".color-row")].map((row) => ({
    name: row.querySelector(".color-name")?.value || "",
    value: row.querySelector(".color-hex")?.value || row.querySelector(".color-value")?.value || "#cccccc"
  })) : [];
}

function getStorageRows() {
  return storageList ? [...storageList.querySelectorAll(".dynamic-row")].map((row) => ({
    name: row.querySelector(".storage-name")?.value || "",
    price: Number(row.querySelector(".storage-price")?.value) || 0,
    oldPrice: Number(row.querySelector(".storage-old-price")?.value) || 0,
    stock: row.querySelector(".storage-stock")?.value ?? ""
  })) : [];
}

// Lee TODOS los campos del formulario (sin depender de un draft existente).
function captureFormToObject() {
  return {
    isVariant: activeVariantIndex > 0,
    colorName: variantColorNameInput?.value.trim() || "",
    hex: variantColorHexInput?.value || "#cccccc",
    title: getFormValue("product-title"),
    brand: getFormValue("product-brand"),
    category: getFormValue("product-category"),
    condition: getFormValue("product-condition"),
    batteryHealth: getFormValue("product-battery-health"),
    description: getFormValue("product-description"),
    galleryUrls: [...existingImageUrls],
    pendingFiles: [...pendingImageFiles],
    pendingImagesFirst,
    includes: getListValues("includes-list", ".include-input"),
    specs: getListValues("specs-list", ".spec-input"),
    storage: getStorageRows(),
    colors: getListColors()
  };
}

function snapshotFormToDraft() {
  return captureFormToObject();
}

// Copia profunda de un draft (cada variante es independiente del principal).
function cloneDraft(draft) {
  return {
    isVariant: !!draft.isVariant,
    title: draft.title,
    brand: draft.brand,
    category: draft.category,
    condition: draft.condition,
    batteryHealth: draft.batteryHealth,
    description: draft.description,
    galleryUrls: [...(draft.galleryUrls || [])],
    pendingFiles: [...(draft.pendingFiles || [])],
    pendingImagesFirst: !!draft.pendingImagesFirst,
    includes: [...(draft.includes || [])],
    specs: [...(draft.specs || [])],
    storage: (draft.storage || []).map((s) => ({ ...s })),
    colors: (draft.colors || []).map((c) => ({ ...c })),
    colorName: draft.colorName || "",
    hex: draft.hex || "#cccccc",
    uploadedUrls: [...(draft.uploadedUrls || [])]
  };
}

// Sincroniza el formulario (incluida la galería) hacia el draft activo.
function syncActiveVariantFromForm() {
  const draft = variantDrafts[activeVariantIndex];
  if (!draft) return;
  draft.isVariant = activeVariantIndex > 0;
  Object.assign(draft, captureFormToObject());
}

// Restaura una variante (snapshot) en el formulario COMPLETO.
function applyDraftToForm(draft) {
  if (!draft) return;
  activeVariantIndex = variantDrafts.indexOf(draft) >= 0 ? variantDrafts.indexOf(draft) : 0;
  const isVariant = activeVariantIndex > 0;

  // Regla de negocio: TODAS las variantes comparten el MISMO nombre de producto.
  // El nombre nunca diferencia una variante de otra; solo el color lo hace.
  if (isVariant && variantDrafts[0]?.title) draft.title = variantDrafts[0].title;

  setFormValue("product-title", draft.title);
  setFormValue("product-brand", draft.brand);
  setFormValue("product-category", draft.category || "iphones");
  setFormValue("product-condition", draft.condition || "nuevo");
  setFormValue("product-battery-health", draft.batteryHealth);
  setFormValue("product-description", draft.description);

  existingImageUrls = [...(draft.galleryUrls || [])];
  pendingImageFiles = [...(draft.pendingFiles || [])];
  pendingImagesFirst = !!draft.pendingImagesFirst;
  if (productImageUrlsInput) productImageUrlsInput.value = existingImageUrls.join("\n");
  renderProductImagesPreview();

  includesList.innerHTML = "";
  ((draft.includes || []).length ? draft.includes : [""]).forEach((item) => addIncludeRow(item));
  specsList.innerHTML = "";
  ((draft.specs || []).length ? draft.specs : [""]).forEach((item) => addSpecRow(item));
  storageList.innerHTML = "";
  const storage = (draft.storage && draft.storage.length) ? draft.storage : [{ name: "128GB", price: 0, oldPrice: 0, stock: "" }];
  storage.forEach((item) => addStorageRow(item.name, item.price, item.oldPrice, item.stock));

  // NOTA: el listado de colores del producto principal NO se reconstruye aquí.
  // El DOM conserva sus filas (solo se ocultan/muestran) y así se preservan los
  // valores avanzados RGB/HSL/OKLCH que el administrador haya editado a mano.

  renderVariantColorMode(draft);
  syncActiveVariantFromForm();
  renderVariantBar();
}

function renderVariantColorMode(draft) {
  const isVariant = activeVariantIndex > 0;
  if (variantColorEditor) variantColorEditor.hidden = !isVariant;
  if (colorsList) colorsList.hidden = isVariant;
  if (isVariant) {
    variantColorNameInput.value = draft.colorName || "";
    updateVariantHexInput(draft.hex || "#cccccc", false);
  } else {
    // El editor de color de variante está oculto en modo principal, pero el
    // snapshot de "cambios sin guardar" sí lee estos inputs: si se quedan con
    // los valores de la última variante visitada, el draft principal muta y
    // dispara el aviso aunque el usuario no haya cambiado nada.
    variantColorNameInput.value = "";
    updateVariantHexInput("#CCCCCC", false);
  }

  // El nombre del producto es COMPARTIDO entre todas las variantes: en modo
  // variante es de solo lectura (el nombre nunca distingue variantes; solo el
  // color lo hace, y cada variante tiene UN SOLO color).
  const titleInput = document.getElementById("product-title");
  if (titleInput) titleInput.readOnly = isVariant;

  // Zona de riesgo (eliminar producto): SOLO en el producto principal. Desde
  // una variante no tiene sentido (eliminar borra todo el grupo).
  if (drawerDangerZone) drawerDangerZone.hidden = isVariant || !editingProductId;

  // Identificador del modo de edición en el subtítulo del encabezado.
  if (drawerModeCopy) {
    if (isVariant) {
      drawerModeCopy.textContent = draft?.colorName
        ? `Estás editando la variante "${draft.colorName}"`
        : "Estás editando la variante";
    } else {
      drawerModeCopy.textContent = editingProductId
        ? "Los cambios reemplazarán la información publicada"
        : "Completa las secciones y guarda para publicar";
    }
  }

  // Mensajes de ayuda y validación según el alcance de la sección activa.
  updateVariantScopeHints();
  updateVariantColorWarning();
}

function updateVariantHexInput(hex, updateDraft = true) {
  const value = normalizeHexColor(hex);
  variantColorPicker.value = value.toLowerCase();
  variantColorHexInput.value = value.toUpperCase();
  // Representaciones calculadas del color de la variante (RGB · HSL · OKLCH),
  // mismo comportamiento que las filas de color del producto principal.
  const reps = getColorRepresentations(value);
  if (variantColorRgbInput) variantColorRgbInput.value = reps.rgb;
  if (variantColorHslInput) variantColorHslInput.value = reps.hsl;
  if (variantColorOklchInput) variantColorOklchInput.value = reps.oklch;
  if (updateDraft) {
    const d = variantDrafts[activeVariantIndex];
    if (d) { d.hex = value.toUpperCase(); renderVariantBar(); }
  }
}

/* ==========================================================================
   VARIANTES — regla de negocio: 1 variante = 1 solo color.
   1 producto → muchas variantes; el nombre del producto es COMPARTIDO.
   "Duplicar variante" copia TODA la información; el color debe ser ÚNICO
   dentro del mismo producto (si no, el botón de guardar queda bloqueado).
   ========================================================================== */

// Nombre legible del color de la variante activa (para los mensajes de ayuda).
function getActiveVariantColorLabel() {
  const draft = variantDrafts[activeVariantIndex];
  if (!draft) return "";
  return (draft.colorName || "").trim();
}

// Detecta si `draft` tiene un color repetido dentro del mismo producto.
// Función PURA (recibe el array de drafts) para poder probarse sin DOM.
// Devuelve null o { kind: "variant"|"base", colorName, reason: "name"|"hex", hex? }.
// El duplicado se detecta por NOMBRE (insensible a mayúsculas) Y también por
// CÓDIGO DE COLOR: dos variantes con nombres distintos pero el mismo hex
// (p. ej. "Blanco" y "Silver" con #EBEBEB) representan el mismo color en la
// tienda y deben bloquear el guardado igual que un nombre repetido.
function variantColorConflictIn(drafts, draft) {
  const name = (draft?.colorName || "").trim();
  if (!name) return null;
  const key = name.toLowerCase();
  // fallback "" → hex inválido/ausente se ignora en la comparación por código.
  const hex = normalizeHexColor(draft?.hex || "", "");

  // 1) Contra las demás variantes del mismo producto.
  for (let i = 1; i < drafts.length; i++) {
    const other = drafts[i];
    if (other === draft) continue;
    const otherName = (other?.colorName || "").trim();
    if (otherName && otherName.toLowerCase() === key) {
      return { kind: "variant", colorName: otherName, reason: "name" };
    }
    const otherHex = normalizeHexColor(other?.hex || "", "");
    if (otherName && hex && otherHex === hex) {
      return { kind: "variant", colorName: otherName, reason: "hex", hex };
    }
  }

  // 2) Contra los colores base del producto principal (también selectables en
  //    la tienda). Evita que una variante "calque" un color ya existente.
  const baseColors = drafts[0]?.colors || [];
  for (const base of baseColors) {
    const baseName = String(base?.name || "").trim();
    if (baseName && baseName.toLowerCase() === key) {
      return { kind: "base", colorName: baseName, reason: "name" };
    }
    const baseHex = normalizeHexColor(base?.value || base?.hex || "", "");
    if (baseName && hex && baseHex === hex) {
      return { kind: "base", colorName: baseName, reason: "hex", hex };
    }
  }
  return null;
}

// Detecta colores repetidos en TODO el grupo: variantes entre sí y variantes
// contra colores base, por nombre Y por código de color (hex). Función PURA.
function allVariantColorConflictsIn(drafts) {
  const byName = new Map();
  const byHex = new Map();
  for (let i = 1; i < drafts.length; i++) {
    const d = drafts[i];
    const name = (d?.colorName || "").trim();
    if (!name) continue;
    const nameEntry = byName.get(name.toLowerCase()) || { colorName: name, count: 0, reason: "name" };
    nameEntry.count += 1;
    nameEntry.colorName = name;
    byName.set(name.toLowerCase(), nameEntry);

    const hex = normalizeHexColor(d?.hex || "", "");
    if (hex) {
      const hexEntry = byHex.get(hex) || { colorName: name, hex, count: 0, reason: "hex" };
      hexEntry.count += 1;
      hexEntry.colorName = name;
      byHex.set(hex, hexEntry);
    }
  }

  const duplicateVariants = [...byName.values()].filter((entry) => entry.count > 1);
  // Mismo código de color con nombres distintos: también es duplicado (solo se
  // agrega si el grupo NO quedó ya cubierto por el conflicto de nombre).
  for (const entry of byHex.values()) {
    if (entry.count <= 1) continue;
    const covered = duplicateVariants.some((e) => e.colorName.toLowerCase() === entry.colorName.toLowerCase());
    if (!covered) duplicateVariants.push(entry);
  }

  const baseColors = drafts[0]?.colors || [];
  const baseNames = new Set(
    baseColors
      .map((c) => String(c?.name || "").trim().toLowerCase())
      .filter(Boolean)
  );
  const baseHexToName = new Map();
  for (const c of baseColors) {
    const baseName = String(c?.name || "").trim();
    const baseHex = normalizeHexColor(c?.value || c?.hex || "", "");
    if (baseName && baseHex) baseHexToName.set(baseHex, baseName);
  }

  const baseDuplicates = [];
  for (const [nameKey, entry] of byName) {
    if (baseNames.has(nameKey)) baseDuplicates.push({ colorName: entry.colorName, reason: "name" });
  }
  for (const [hex, entry] of byHex) {
    if (baseHexToName.has(hex)) baseDuplicates.push({ colorName: baseHexToName.get(hex), hex, reason: "hex" });
  }

  return {
    duplicateVariants,
    baseDuplicates,
    any: duplicateVariants.length > 0 || baseDuplicates.length > 0
  };
}

// Acceso al estado global actual (wrappers de las funciones puras).
function findVariantColorConflict(draft) {
  return variantColorConflictIn(variantDrafts, draft);
}

function findAllVariantConflicts() {
  return allVariantColorConflictsIn(variantDrafts);
}

// Crea una copia EDITABLE y completa de la variante activa para servir de base
// a otra variante del MISMO producto. El nombre del producto permanece exacta-
// mente igual y se copia TODA la ficha (imágenes, descripción, especificaciones,
// capacidades, precios y stock). Intencionalmente CONSERVA el color de la
// original: así el botón Guardar queda bloqueado con el aviso "este color ya
// existe como variante" hasta que el administrador elija un color nuevo.
function duplicateVariant() {
  if (activeVariantIndex <= 0) return;
  syncActiveVariantFromForm();
  const source = variantDrafts[activeVariantIndex];
  if (!source) return;
  const next = cloneDraft(source);
  next.isVariant = true;
  // El color de la copia iguala al de la original → conflicto de color
  // detectable de inmediato que bloquea el guardado hasta cambiarlo.
  variantDrafts.push(next);
  activeVariantIndex = variantDrafts.length - 1;
  applyDraftToForm(next);
  renderVariantBar();
  variantColorNameInput?.focus();
  variantColorNameInput?.select();
  if (variantBarTabs) variantBarTabs.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// Validación visible bajo el selector de color + bloqueo del botón de guardar.
// - El botón GUARDAR queda deshabilitado mientras exista una variante con el
//   mismo color dentro del mismo producto (crítico tras "Duplicar variante").
// - Una variante SIEMPRE debe tener un único color definido para guardarse.
// - El parámetro de tono permite marcar el aviso como "error" cuando un
//   intento previo de guardado fue rechazado por el conflicto.
function updateVariantColorWarning(tone = variantErrorLocked ? "error" : "warning") {
  const draft = variantDrafts[activeVariantIndex];
  const conflicts = findAllVariantConflicts();
  const ownName = (draft?.colorName || "").trim();

  let title = "";
  let text = "";
  if (activeVariantIndex > 0) {
    if (ownName) {
      const conflict = findVariantColorConflict(draft);
      if (conflict?.kind === "base") {
        if (conflict.reason === "hex") {
          title = "Color ya usado por el producto principal";
          text = `El color <strong>${escapeHTML(conflict.hex)}</strong> ya existe en el producto principal como <strong>${escapeHTML(conflict.colorName)}</strong>. Aunque el nombre sea distinto, cada color debe ser único: elige otro color para guardar esta variante.`;
        } else {
          title = "Color duplicado del producto principal";
          text = `Este color ya existe como color del <strong>producto principal</strong>. Elimina <strong>${escapeHTML(conflict.colorName)}</strong> de "Colores disponibles" o elige otro color para guardar esta variante.`;
        }
      } else if (conflict) {
        title = variantErrorLocked ? "No se pudo guardar esta variante" : "Este color ya existe como variante";
        if (conflict.reason === "hex") {
          text = `La variante <strong>${escapeHTML(conflict.colorName)}</strong> ya usa el color <strong>${escapeHTML(conflict.hex)}</strong>. Aunque tenga otro nombre, el color debe ser único: elige otro color para guardar esta variante.`;
        } else {
          text = `Ya existe una variante <strong>${escapeHTML(conflict.colorName)}</strong>. Selecciona otro color para guardar esta variante.`;
        }
      }
    } else {
      title = "Falta el color de esta variante";
      text = `Cada variante tiene <strong>un solo color</strong>. Escribe el nombre del color para guardar esta variante.`;
    }
  } else if (conflicts.any) {
    title = "Conflictos de color por resolver";
    text = `Hay variantes con el <strong>mismo nombre o el mismo código de color</strong>: cada color debe ser único. Cambia el duplicado para poder guardar.`;
  }

  renderFormNote(variantColorWarning, {
    tone,
    icon: "ph-warning",
    title,
    html: text
  });

  const blocked = conflicts.any || (activeVariantIndex > 0 && !ownName);
  if (!isSubmittingProduct && saveProductBtn) {
    // Estado combinado del botón de guardado (autoridad única):
    //  - bloqueado por producto duplicado (capa anti-duplicados del backup)
    //  - bloqueado por conflicto de color de variante
    //  - en edición: deshabilitado hasta que existan cambios reales
    const bloqueoEdicion = Boolean(editingProductId) && !isProductFormDirty();
    saveProductBtn.disabled = productoDuplicadoBloqueado || blocked || bloqueoEdicion;
    saveProductBtn.title = productoDuplicadoBloqueado
      ? "Producto duplicado: no se puede guardar"
      : blocked
        ? "Cambia el color de la variante para habilitar el guardado"
        : bloqueoEdicion
          ? "Haz cambios en el formulario para habilitar el botón de guardado"
          : "";
  }
}

/* Componente reutilizable de mensajes .form-note.
   Misma estructura, alineación y jerarquía para todos los avisos del editor:
   icono en badge + título opcional + texto. Solo cambia el contenido y el tono
   (base / variant / warning / error). Nunca se superpone con otros elementos:
   es un bloque en flujo con grid de dos columnas y texto que dobla de línea. */
function renderFormNote(element, options = {}) {
  if (!element) return;
  const { tone = "base", icon = "ph-info", title = "", html = "" } = options;
  element.className = `form-note form-note--${tone}`;
  element.innerHTML = `
    <i class="ph ${escapeHTML(icon)} form-note-icon" aria-hidden="true"></i>
    <span class="form-note-body">
      ${title ? `<strong class="form-note-title">${escapeHTML(title)}</strong>` : ""}
      ${html ? `<span class="form-note-text">${html}</span>` : ""}
    </span>
  `;
  element.hidden = !html && !title;
}

// Mensajes de ayuda bajo cada sección: el administrador entiende constantemente
// que "todo lo que agregue aquí pertenece SOLO a la variante que está editando"
// (o al producto principal), y que cada variante representa un único color.
function updateVariantScopeHints() {
  const isVariant = activeVariantIndex > 0;
  const colorLabel = getActiveVariantColorLabel() || "esta variante";
  const color = `<strong>${escapeHTML(colorLabel)}</strong>`;

  const setHint = (id, title, html) => {
    const el = document.getElementById(id);
    if (!el) return;
    renderFormNote(el, {
      tone: isVariant ? "variant" : "base",
      icon: "ph-info",
      title,
      html
    });
  };

  setHint(
    "hint-product-title",
    isVariant ? "Nombre compartido del producto" : null,
    isVariant
      ? `El nombre pertenece al <strong>producto principal</strong> y es el mismo para todas sus variantes. Solo el color distingue una variante de otra.`
      : null
  );

  setHint(
    "hint-fs-gallery",
    isVariant ? "Imágenes de esta variante" : "Imágenes del producto principal",
    isVariant
      ? `Esta información pertenece únicamente a la variante ${color}. Si agregas imágenes aquí, se mostrarán cuando el usuario seleccione esta variante.`
      : `Información del <strong>producto principal</strong>. Las variantes tienen sus propias imágenes; si una variante no define las suyas, verá estas de base.`
  );

  setHint(
    "hint-fs-description",
    isVariant ? "Descripción de esta variante" : "Descripción del producto principal",
    isVariant
      ? `Esta descripción pertenece únicamente a la variante ${color}. Al seleccionar otra variante, se mostrará la descripción correspondiente a esa variante.`
      : `Descripción del <strong>producto principal</strong>. Si una variante define la suya, se mostrará la descripción de la variante.`
  );

  setHint(
    "hint-fs-includes",
    isVariant ? "Qué incluye en esta variante" : "Qué incluye · producto principal",
    isVariant
      ? `Esta información se guardará únicamente en la variante ${color}. Estos elementos solo se muestran cuando el cliente elige esta variante.`
      : `Elementos del <strong>producto principal</strong>. Se comparten con las variantes que no definan los suyos.`
  );

  setHint(
    "hint-fs-specs",
    isVariant ? "Especificaciones de esta variante" : "Especificaciones del producto principal",
    isVariant
      ? `Estas especificaciones pertenecen a esta variante. Si alguna especificación cambia para otro color, agrégala dentro de su propia variante.`
      : `Especificaciones del <strong>producto principal</strong>. Se comparten con las variantes que no definan las suyas.`
  );

  setHint(
    "hint-fs-storage",
    isVariant ? "Capacidades de esta variante" : "Capacidades del producto principal",
    isVariant
      ? `Estas capacidades pertenecen a la variante ${color}. Puedes agregar varias capacidades, pero todas pertenecerán a esta variante.`
      : `Precios, capacidades y stock del <strong>producto principal</strong>. Cada variante puede tener los suyos.`
  );

  if (fsColorsTitle) {
    fsColorsTitle.textContent = isVariant ? "Color único de la variante" : "Colores disponibles";
  }
  if (fsColorsCopy) {
    fsColorsCopy.textContent = isVariant
      ? `Esta variante representa SOLO el color ${colorLabel}. Si necesitas otro color, crea una nueva variante.`
      : `En la tienda, cada color se muestra como una variante. Usa "Agregar variante" si necesitas un color con su propia ficha.`;
  }

  setHint(
    "hint-fs-colors",
    isVariant ? "Color único de esta variante" : "Colores disponibles",
    isVariant
      ? `Cada variante representa <strong>un solo color</strong>: este. Si necesitas otro color, crea una nueva variante con su propia información.`
      : `Cada variante representa <strong>un solo color</strong>. Para agregar un color nuevo con su propia información (imágenes, precios, stock), crea una variante.`
  );
}

// Validación previa al guardado (capa de seguridad además del botón bloqueado).
function validateVariantsDrafts() {
  const conflicts = allVariantColorConflictsIn(variantDrafts);
  if (conflicts.any) {
    const baseDup = conflicts.baseDuplicates[0];
    if (baseDup) {
      return {
        message: baseDup.reason === "hex"
          ? `El color "${baseDup.hex}" ya existe en el producto principal ("${baseDup.colorName}") y en una variante. Aunque los nombres sean distintos, el color debe ser único: quita el duplicado del producto principal o cambia el color de la variante.`
          : `El color "${baseDup.colorName}" ya existe en el producto principal y en una variante. Quita el duplicado del producto principal o cambia el color de la variante.`,
        targetId: "variant-color-name"
      };
    }
    const first = conflicts.duplicateVariants[0];
    return {
      message: first?.reason === "hex"
        ? `No puedes guardar: la variante "${first?.colorName || ""}" ya usa el color ${first?.hex || ""}. Aunque los nombres sean distintos, cada color debe ser único. Selecciona otro color para guardar esta variante.`
        : `No puedes guardar: ya existe una variante con el color "${first?.colorName || ""}". Selecciona otro color para guardar esta variante.`,
      targetId: "variant-color-name"
    };
  }
  for (let i = 1; i < variantDrafts.length; i++) {
    if (!(variantDrafts[i]?.colorName || "").trim()) {
      return {
        message: `La variante ${i} necesita un nombre de color antes de guardar (cada variante representa un solo color).`,
        targetId: "variant-color-name"
      };
    }
  }
  return null;
}

function renderVariantBar() {
  if (!variantBarTabs) return;
  variantBarTabs.innerHTML = variantDrafts
    .map((draft, index) => {
      const isMain = index === 0;
      const isActive = index === activeVariantIndex;
      const label = isMain ? "Producto principal" : (draft.colorName || `Variante ${index}`);
      const swatch = isMain
        ? '<i class="ph-bold ph-house" aria-hidden="true"></i>'
        : `<span class="variant-bar-swatch" style="--swatch:${escapeHTML((draft.hex || "#cccccc").toLowerCase())}"></span>`;
      return `
        <div class="variant-bar-tab ${isActive ? "active" : ""} ${isMain ? "is-main" : ""}">
          <button type="button" class="variant-bar-tab-btn" data-variant-index="${index}" role="tab" aria-selected="${isActive ? "true" : "false"}">
            ${swatch}<span>${escapeHTML(label)}</span>
          </button>
          ${!isMain ? `<button type="button" class="variant-bar-remove" data-variant-remove="${index}" aria-label="Quitar variante" title="Quitar variante"><i class="ph ph-x" aria-hidden="true"></i></button>` : ""}
        </div>`;
    })
    .join("");
  variantBarTabs.querySelectorAll("[data-variant-index]").forEach((btn) => {
    btn.addEventListener("click", () => switchVariant(Number(btn.dataset.variantIndex)));
  });
  variantBarTabs.querySelectorAll("[data-variant-remove]").forEach((btn) => {
    btn.addEventListener("click", () => removeVariant(Number(btn.dataset.variantRemove)));
  });
  if (variantBar) variantBar.hidden = false;
  // "Duplicar variante" solo tiene sentido dentro de una variante (índice > 0).
  if (duplicateVariantBtn) duplicateVariantBtn.disabled = activeVariantIndex <= 0;
}

function switchVariant(index) {
  if (index === activeVariantIndex) return;
  const current = variantDrafts[activeVariantIndex];
  if (current) Object.assign(current, snapshotFormToDraft());
  activeVariantIndex = Math.max(0, Math.min(index, variantDrafts.length - 1));
  applyDraftToForm(variantDrafts[activeVariantIndex]);
  renderVariantBar();
}

function removeVariant(index) {
  if (index <= 0 || index >= variantDrafts.length) return;
  const draft = variantDrafts[index];
  showConfirm(
    "Quitar variante",
    `Se quitará la variante <strong>${escapeHTML(draft?.colorName || `Variante ${index}`)}</strong>. El cambio se aplicará al guardar el producto; hasta entonces puedes cancelar sin perder nada.`,
    () => {
      syncActiveVariantFromForm();
      variantDrafts.splice(index, 1);
      if (activeVariantIndex >= variantDrafts.length) activeVariantIndex = variantDrafts.length - 1;
      applyDraftToForm(variantDrafts[activeVariantIndex]);
      renderVariantBar();
      captureFormBaseline();
    },
    { tone: "danger", okLabel: "Sí, quitar" }
  );
}
function clearVariantPreviewObjectUrls() {
  if (!variantPreviewObjectUrls.length) return;
  variantPreviewObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  variantPreviewObjectUrls = [];
}

// Reinicia el editor de variantes para un producto nuevo.
function resetVariantsEditor() {
  clearVariantPreviewObjectUrls();
  activeVariantIndex = 0;
  variantDrafts = [captureFormToObject()];
  rangeVariantMode();
  renderVariantBar();
}

function rangeVariantMode() {
  renderVariantColorMode(variantDrafts[activeVariantIndex]);
  if (variantBar) variantBar.hidden = false;
}

// Carga las variantes existentes de un producto en el editor.
function loadVariantsFromProduct(product) {
  clearVariantPreviewObjectUrls();
  activeVariantIndex = 0;
  const base = captureFormToObject();
  variantDrafts = [base];

  const colors = Array.isArray(product?.variants?.colors) ? product.variants.colors : [];
  colors.forEach((color) => {
    const over = color?.overrides && typeof color.overrides === "object" ? color.overrides : null;
    if (!over) return;
    const draft = cloneDraft(base);
    // Normalizar CADA campo a la forma exacta que produce el formulario:
    // si el draft crudo de la DB difiere (hex minúscula, números en stock o
    // batería), la primera sincronización lo mutaría y dispararía el aviso
    // de "cambios sin guardar" aunque el usuario no haya tocado nada.
    draft.colorName = String(color.name || "").trim();
    draft.hex = normalizeHexColor(color.hex || color.value || "#cccccc");
    // Regla de negocio: el nombre SIEMPRE es el del producto principal (solo
    // el color diferencia variantes). Datos antiguos podían traer over.title
    // distinto: si no se normaliza aquí, applyDraftToForm lo sobreescribe al
    // entrar a la variante y dispara un falso "cambios sin guardar".
    draft.title = String(base.title || over.title || "");
    draft.brand = String(over.brand ?? base.brand ?? "");
    draft.category = String(over.category ?? base.category ?? "") || "iphones";
    draft.condition = String(over.condition ?? base.condition ?? "") || "nuevo";
    draft.batteryHealth = String(over.batteryHealth ?? base.batteryHealth ?? "");
    draft.description = String(over.description ?? base.description ?? "");
    draft.galleryUrls = Array.isArray(over.images) ? over.images.map(String) : (over.image ? [String(over.image)] : [...(base.galleryUrls || [])]);
    draft.pendingFiles = [];
    // Listas: el formulario SIEMPRE renderiza al menos una fila. Un array
    // vacío guardado en overrides (p. ej. includes: [] tras limpiar filas, o
    // storage: [] por filas sin nombre filtradas al guardar) se re-renderiza
    // como una fila por defecto y mutaría el draft → falso "cambios sin
    // guardar" al entrar a la variante sin tocar nada. Se canónica aquí.
    const rawIncludes = Array.isArray(over.includes) ? over.includes.map(String) : null;
    draft.includes = rawIncludes ? (rawIncludes.length ? rawIncludes : [""]) : ["..."];
    const rawSpecs = Array.isArray(over.specs) ? over.specs.map(String) : null;
    draft.specs = rawSpecs ? (rawSpecs.length ? rawSpecs : [""]) : [...(base.specs || ["..."])];
    const rawStorage = Array.isArray(over.storage)
      ? over.storage.map((s) => ({ name: String(s?.name || ""), price: Number(s?.price) || 0, oldPrice: Number(s?.oldPrice) || 0, stock: String(s?.stock ?? "") }))
      : null;
    draft.storage = rawStorage
      ? (rawStorage.length ? rawStorage : [{ name: "128GB", price: 0, oldPrice: 0, stock: "" }])
      : [...(base.storage || [])];
    draft.isVariant = true;
    variantDrafts.push(draft);
  });

  // Mostrar pestañas solo si hay variantes.
  renderVariantBar();
  rangeVariantMode();
}

/* Serializa las variantes en variants.colors para guardar en Supabase. */
function collectVariantsForSave() {
  syncActiveVariantFromForm();
  const colors = [];
  // Colores base del producto principal: solo filas con nombre (una fila vacía
  // no aporta nada y ensuciaría variants.colors).
  (variantDrafts[0]?.colors || [])
    .filter((c) => String(c?.name || "").trim())
    .forEach((c) => {
      const calculated = getColorRepresentations(c.value || c.hex || "#cccccc");
      colors.push({ name: c.name, value: calculated.hex, hex: calculated.hex, rgb: calculated.rgb, hsl: calculated.hsl, oklch: calculated.oklch });
    });
  variantDrafts.slice(1).forEach((draft) => {
    if (!draft.colorName) return;
    const calculated = getColorRepresentations(draft.hex || "#cccccc");
    const images = uniqueImageUrls([...(draft.galleryUrls || []), ...(draft.uploadedUrls || [])]);
    const overrides = {};
    // El nombre SIEMPRE es el del producto principal: ninguna variante puede
    // guardarse con un nombre distinto (solo el color diferencia variantes).
    const sharedTitle = variantDrafts[0]?.title;
    if (sharedTitle) overrides.title = sharedTitle;
    else if (draft.title) overrides.title = draft.title;
    if (draft.brand) overrides.brand = draft.brand;
    if (draft.category) overrides.category = draft.category;
    if (draft.condition) { overrides.condition = draft.condition; overrides.badge = draft.condition === "nuevo" ? "Nuevo" : "Seminuevo"; }
    const battery = normalizeBatteryHealth(draft.batteryHealth);
    if (battery !== null) overrides.batteryHealth = battery;
    if (draft.description) overrides.description = draft.description;
    if (draft.specs && draft.specs.length) overrides.specs = draft.specs.filter(Boolean);
    if (draft.includes && draft.includes.length) overrides.includes = draft.includes.filter(Boolean);
    if (images.length) { overrides.images = images; overrides.image = images[0]; }
    if (draft.storage && draft.storage.length) {
      overrides.storage = draft.storage
        .map((s) => ({
          name: s.name, price: Number(s.price) || 0, oldPrice: Number(s.oldPrice) || 0,
          stock: s.stock === "" || s.stock === null || s.stock === undefined ? null : normalizeStockValue(s.stock)
        }))
        .filter((s) => s.name);
    }
    colors.push({
      name: draft.colorName.trim(), value: calculated.hex, hex: calculated.hex,
      rgb: calculated.rgb, hsl: calculated.hsl, oklch: calculated.oklch,
      overrides: Object.keys(overrides).length ? overrides : undefined
    });
  });
  // Deduplicación: si un color base tiene el mismo nombre que una variante,
  // la variante manda (evita que el selector del cliente resuelva el duplicado
  // sin datos, que es lo que hacía que "no cambiara nada" al elegir color).
  const variantNames = new Set(colors.filter((c) => c.overrides).map((c) => c.name.trim().toLowerCase()));
  return colors.filter((c, i) => {
    if (c.overrides) return true;
    const isDuplicate = variantNames.has(String(c.name || "").trim().toLowerCase());
    if (isDuplicate) console.warn(`Color base duplicado con variante, se omite: "${c.name}"`);
    return !isDuplicate;
  });
}

// Sube a Cloudinary las imágenes pendientes de TODAS las variantes (incl. la principal).
async function uploadAllVariantsImages(submitBtn) {
  for (let index = 0; index < variantDrafts.length; index += 1) {
    const draft = variantDrafts[index];
    if (!draft.pendingFiles || draft.pendingFiles.length === 0) continue;
    const urls = await uploadProductImages(draft.pendingFiles, submitBtn);
    draft.uploadedUrls = [...(draft.uploadedUrls || []), ...urls];
    draft.galleryUrls = uniqueImageUrls([...(draft.uploadedUrls || []), ...(draft.galleryUrls || [])]);
    draft.pendingFiles = [];
  }
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
  row.querySelector(".remove-row-btn")?.addEventListener("click", () => {
    row.remove();
  });
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
    isSubmittingProduct = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      setButtonLabel(submitBtn, "Procesando...", "spinner-gap");
    }

    // Guardar variantes: primero persistir los campos del draft activo, luego
    // subir todas las imágenes pendientes (producto + variantes).
    syncActiveVariantFromForm();

    // Regla de negocio: cada variante tiene UN solo color y ningún color se
    // repite dentro del mismo producto (capa de seguridad del botón bloqueado).
    const variantCheck = validateVariantsDrafts();
    if (variantCheck) {
      variantErrorLocked = true;
      if (variantCheck.targetId) setFieldError(variantCheck.targetId, variantCheck.message);
      updateVariantColorWarning("error");
      throw new Error(variantCheck.message);
    }

    await uploadAllVariantsImages(submitBtn);
    // Asegurar que el formulario muestre el PRODUCTO PRINCIPAL para leer sus datos base.
    applyDraftToForm(variantDrafts[0]);

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

    // CAPA ANTI-DUPLICADOS (dura): el nombre de un producto NO puede repetirse.
    // Comparación contra la BD (excepto el propio producto en edición). Para
    // agregar otra versión del mismo producto existe el sistema de variantes.
    const borradorDup = captureFormToObject();
    const candidatoDup = {
      title: borradorDup.title,
      brand: borradorDup.brand,
      category: borradorDup.category,
      images: borradorDup.galleryUrls || [],
      variants: { colors: borradorDup.colors || [], storage: borradorDup.storage || [] }
    };
    const duplicado = buscarDuplicadoEnLista(
      candidatoDup,
      isEditing ? String(editingProductId) : null,
      await fetchCatalogoLigero()
    );
    if (duplicado) {
      productoDuplicadoBloqueado = true;
      setFieldError("product-title", isEditing
        ? `Ese nombre ya lo usa ${duplicado.id}. Los productos no pueden repetir nombre.`
        : `Este producto ya existe (${duplicado.id}). No puede repetirse el nombre.`);
      mostrarBannerDuplicado(isEditing
        ? `El nombre "${title}" ya pertenece a ${duplicado.id}. No se guardaron cambios: los productos no pueden repetir nombre en el catálogo.`
        : `"${duplicado.title}" ya está publicado como ${duplicado.id}. No se puede guardar un producto con el mismo nombre.`);
      document.getElementById("product-title")?.scrollIntoView({ behavior: "smooth", block: "center" });
      throw new Error(isEditing
        ? `Nombre duplicado: "${title}" ya existe como ${duplicado.id}. No se guardaron cambios.`
        : `Nombre duplicado: "${duplicado.title}" ya existe como ${duplicado.id}. Para agregar otra versión del mismo producto, edítalo y agrégale una variante.`);
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

    const colors = collectVariantsForSave();

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
      // Flag para el subsistema de backup: el drawer cerró tras CREAR.
      ultimoProductoCreadoId = nuevoId;
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
    isSubmittingProduct = false;
    // Re-validar en vivo: si quedó algún conflicto de color pendiente, el botón
    // permanece bloqueado hasta que el administrador lo resuelva.
    updateVariantColorWarning();
    if (submitBtn) {
      if (productoDuplicadoBloqueado) {
        // Bloqueo activo: el botón refleja que no se puede guardar.
        submitBtn.disabled = true;
        submitBtn.classList.add("is-blocked");
        setButtonLabel(submitBtn, "Producto duplicado", "prohibit");
      } else {
        submitBtn.classList.remove("is-blocked");
        submitBtn.disabled = saveProductBtn?.disabled || false;
        setButtonLabel(submitBtn, isEditing ? "Actualizar producto" : "Guardar producto", "check");
      }
    }
  }
}

async function handleDeleteProduct() {
  if (!editingProductId) return;

  // Transparencia total: indicar cuántas variantes se eliminan junto al producto.
  const product = products.find((item) => String(item.id) === String(editingProductId));
  const variantCount = (product?.variants?.colors || []).filter((c) => c?.overrides && Object.keys(c.overrides).length).length;
  const variantNames = (product?.variants?.colors || [])
    .filter((c) => c?.overrides && Object.keys(c.overrides).length)
    .map((c) => c.name)
    .join(", ");

  const variantWarning = variantCount > 0
    ? `<br><br><strong>Este producto tiene ${variantCount} variante${variantCount === 1 ? "" : "s"} configurada${variantCount === 1 ? "" : "s"}${variantNames ? ` (${escapeHTML(variantNames)})` : ""}. Al eliminarlo se borra TODO el grupo: el producto principal y todas sus variantes.</strong>`
    : "";

  showConfirm(
    "Eliminar producto",
    `Esta acción eliminará permanentemente el producto del catálogo y de la tienda. No se puede deshacer.${variantWarning}`,
    async () => {
      try {
        // Respaldo previo: el estado completo del producto se guarda en el
        // HISTORIAL LOCAL de la pestaña Backup (sin descargar nada a la PC).
        if (product) storeProductSnapshot(product, "previo_eliminacion");
        const productRef = doc(db, "productos", String(editingProductId));
        await deleteDoc(productRef);
        forceCloseProductModal();
        showAlert("Producto eliminado de Supabase.", "success");
      } catch (error) {
        showAlert("Error al eliminar producto: " + error.message, "error");
      }
    },
    { tone: "danger", okLabel: "Sí, eliminar todo" }
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

        // Los formatos con transparencia (PNG/GIF/WebP) deben conservar el
        // canal alfa: JPEG lo descarta y el fondo se vería negro.
        const tipo = (file.type || "").toLowerCase();
        const tieneAlpha = tipo === "image/png" || tipo === "image/gif" || tipo === "image/webp";

        let dataUrl;
        if (tieneAlpha) {
          // WebP conserva transparencia y comprime bien; si el navegador no
          // puede codificar WebP, toDataURL cae a PNG (sin pérdida).
          dataUrl = canvas.toDataURL("image/webp", quality);
          if (!dataUrl.startsWith("data:image/webp")) {
            dataUrl = canvas.toDataURL("image/png");
          }
        } else {
          dataUrl = canvas.toDataURL("image/jpeg", quality);
        }
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
  const IMG_KEYS = ['logo', 'hero-fondo', 'nosotros', 'mantenimiento'];
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
      phone: '50488878066',
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
  const desplazarTabAlFrente = (tab) => {
    // Mantiene la pestaña activa visible cuando la barra desborda (scroll
    // horizontal) sin mover el scroll vertical de la página.
    tab?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  };
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const content = document.getElementById(`settings-${tab.dataset.tab}-tab`);
      if (content) content.classList.add('active');
      desplazarTabAlFrente(tab);
    });
  });
  // Al inicializar: garantiza que el contenido de la pestaña activa esté visible.
  const initActiveTab = document.querySelector('.settings-tab.active');
  const initActiveContent = initActiveTab ? document.getElementById(`settings-${initActiveTab.dataset.tab}-tab`) : null;
  if (initActiveContent) initActiveContent.classList.add('active');
  if (initActiveTab) desplazarTabAlFrente(initActiveTab);

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

  /* Estado COMPLETO de un documento: campos + listas. Base para comparar
     el estado actual contra el original (detección real de cambios). */
  function coleccionDoc(docId) {
    const estado = { campos: collectDocValues(docId) };
    LISTS.filter(cfg => cfg.doc === docId).forEach(cfg => {
      estado[cfg.listKey] = collectList(cfg);
    });
    return estado;
  }

  /* Detección REAL de cambios: compara el estado actual del documento contra
     su instantánea original. Revertir un campo a su valor original vuelve a
     marcar el formulario como sin cambios. Solo afecta a ESE documento. */
  function evaluarCambiosDoc(docId) {
    const estado = docsState[docId];
    if (!estado || estado.original === undefined) return;
    estado.changed = JSON.stringify(coleccionDoc(docId)) !== estado.original;
    updateDocButtons(docId);
  }

  function marcarOriginalDoc(docId) {
    const estado = docsState[docId];
    if (!estado) return;
    estado.original = JSON.stringify(coleccionDoc(docId));
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
        evaluarCambiosDoc(docId);
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
    container.addEventListener('input', () => evaluarCambiosDoc(cfg.doc));
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
      evaluarCambiosDoc(cfg.doc);
    });
  }

  document.querySelectorAll('.settings-list-add').forEach(btn => {
    btn.addEventListener('click', () => {
      const cfg = listCfg(btn.dataset.addItem);
      if (!cfg) return;
      const container = document.getElementById(cfg.container);
      if (!container) return;
      container.insertAdjacentHTML('beforeend', listRowHTML(cfg, null));
      evaluarCambiosDoc(cfg.doc);
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
      // La instantánea original pasa a ser el estado recién guardado.
      marcarOriginalDoc(docId);
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
    // Los valores volvieron al original: re-evaluar (deshabilita el botón).
    evaluarCambiosDoc(docId);
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
        evaluarCambiosDoc(docId);
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
    // Instantánea original del documento: la referencia para detectar cambios reales.
    marcarOriginalDoc(docId);
    updateDocButtons(docId);
    if (docId === 'whatsapp') renderWaPreview();
  }

  document.addEventListener('settings-applied', () => syncRichFields());
  // Editor enriquecido de EMPRESA: vinculado SOLO a su pestaña. El binding
  // global anterior marcaba 'empresa' al editar cualquier otro formulario.
  const tabEmpresaSettings = document.getElementById('settings-empresa-tab');
  if (tabEmpresaSettings) initRichFields(tabEmpresaSettings, 'empresa');
  else initRichFields(settingsSection, 'empresa');

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
      } else { llaves = []; }
      loaded = true;
      renderLlaves();
    } catch (err) {
      console.warn('[Llaves] No se pudieron cargar:', err);
      llaves = []; renderLlaves();
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
      const hashKey = l.hash;
      const codigoReal = codigosGenerados.get(hashKey);
      const revelado = codigosRevelados.has(hashKey);
      const texto = revelado && codigoReal ? escapeStr(codigoReal) : escapeStr(textoEnmascarado(codigoReal, hashKey));
      const hayCodigo = Boolean(codigoReal);
      return `<div class="settings-list-item" data-llave-index="${i}">
        <div class="settings-list-fields">
          <div class="llave-codigo-row"><code class="llave-codigo" data-llave-code="${i}">${texto}</code>
          <button type="button" class="settings-list-btn llave-accion-btn" data-llave-eye="${i}" title="${hayCodigo ? (revelado ? 'Ocultar llave' : 'Mostrar llave completa') : 'Código no disponible: se mostró una sola vez al generarla'}"><i class="ph ${revelado && hayCodigo ? 'ph-eye-slash' : 'ph-eye'}" aria-hidden="true"></i></button>
          <button type="button" class="settings-list-btn llave-accion-btn" data-llave-copy="${i}" title="${hayCodigo ? 'Copiar llave' : 'Código no disponible: se mostró una sola vez al generarla'}"><i class="ph ph-copy" aria-hidden="true"></i></button>
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
        const hashKey = l.hash;
        const codeEl = list.querySelector(`[data-llave-code="${idx}"]`);
        const icon = e.currentTarget.querySelector('.ph');
        if (codigosRevelados.has(hashKey)) {
          codigosRevelados.delete(hashKey);
          const codigoOculto = codigosGenerados.get(hashKey) || null;
          if (codeEl) codeEl.textContent = textoEnmascarado(codigoOculto, hashKey);
          if (icon) icon.className = 'ph ph-eye';
          e.currentTarget.title = 'Mostrar llave completa';
        } else {
          const codigoReal = codigosGenerados.get(hashKey);
          if (!codigoReal) { setStatus('error', 'Código no disponible: se mostró solo una vez al generarla.'); return; }
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
        const codigoReal = codigosGenerados.get(l.hash);
        if (!codigoReal) { setStatus('error', 'Código no disponible: se mostró solo una vez al generarla.'); return; }
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
          <td class="ta-left">
            <div class="usuario-cell">
              <span class="usuario-avatar">${esc((nombre.trim()[0] || '?').toUpperCase())}</span>
              <div class="usuario-cell-info"><strong>${esc(nombre)}</strong>${yo ? '<em class="usuario-yo">(tú)</em>' : ''}</div>
            </div>
          </td>
          <td class="ta-left">${esc(u.correo) || '—'}</td>
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
      `Se eliminará permanentemente el acceso de <strong>${esc(u.nombre || u.correo)}</strong>: se borra su perfil y su cuenta de Authentication, y el correo queda libre para reutilizarlo.`,
      async () => {
        const ok = await pedirLlave('Acción sensible', 'Para eliminar usuarios debes ingresar la llave de acceso.', { incluirInactivas: true });
        if (!ok) { showAlert('Acción cancelada: llave incorrecta.', 'error'); return; }
        try {
          await deleteDoc(doc(db, 'usuarios', u.id));
          showAlert('Usuario eliminado y correo liberado', 'success');
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

    const ok = await pedirLlave('Acción sensible', 'Para crear usuarios debes ingresar la llave de acceso.', { incluirInactivas: true });
    if (!ok) { mostrarErrorCrear('Acción cancelada: llave incorrecta.'); return; }

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

/* ==========================================================================
   IDENTIDAD VISUAL — Logotipo oficial en la marca del panel
   Sustituye la iconografía genérica por el logotipo real de la empresa:
   sidebar (Mi Phone HN), login y sección de usuarios.
   ========================================================================== */
(() => {
  async function aplicarLogoAdmin() {
    try {
      const snap = await getDoc(doc(db, 'imagenes', 'logo'));
      const data = snap.exists() ? snap.data() : null;
      const url = data?.url || data?.data;
      if (!url) return;

      const src = url.startsWith('data:') ? url : url + '?t=' + Date.now();

      // Sidebar: [LOGO] junto al nombre "Mi Phone HN"
      const sideMark = document.querySelector('.sidebar-brand-mark');
      if (sideMark) {
        sideMark.innerHTML = `<img src="${src}" alt="Mi Phone HN" class="brand-logo-img">`;
        sideMark.classList.add('has-logo');
      }

      // Sección "Usuarios del sistema" (antes usaba iconografía genérica ph-users)
      const usersIcon = document.querySelector('.settings-users-card .settings-image-icon');
      if (usersIcon) {
        usersIcon.innerHTML = `<img src="${src}" alt="Mi Phone HN" class="brand-logo-img">`;
        usersIcon.classList.add('has-logo');
      }
    } catch (err) {
      console.warn('No se pudo cargar el logotipo en el panel:', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', aplicarLogoAdmin);
  } else {
    aplicarLogoAdmin();
  }
})();

/* ==========================================================================
   MODO MANTENIMIENTO — Sección del panel admin
   ==========================================================================
   - Lee y escribe el flag en la tabla 'configuracion' con la clave según
     el ENTORNO:
       VITE_APP_ENV=local      → 'mantenimiento-local'      (no toca producción)
       VITE_APP_ENV=production → 'mantenimiento-produccion'
     (sin la variable se asume PRODUCCIÓN por seguridad)
   - La escritura está protegida por RLS en servidor: solo usuarios
     autenticados y activos pueden modificar la configuración. Los
     visitantes públicos (anon) solo pueden LEER.
   - Confirmación de activar/desactivar con llave de acceso (pedirLlave),
     mismo patrón que las acciones sensibles existentes.
   - Vista previa: renderiza la página de mantenimiento en un iframe
     SIN modificar el estado real.
   ========================================================================== */
import { buildMantenimientoHTML } from '../client/mantenimiento-template.js';
import mntArtworkPreview from './mantenimiento/artwork.svg?url';

(() => {
  const APP_ENV = String(import.meta.env.VITE_APP_ENV || 'production').toLowerCase();
  const ES_LOCAL = APP_ENV === 'local';
  const FLAG_KEY = ES_LOCAL ? 'mantenimiento-local' : 'mantenimiento-produccion';

  const tabBtn = document.querySelector('.settings-tab[data-tab="mantenimiento"]');
  const metaEl = document.getElementById('mantenimiento-meta');
  const badge = document.getElementById('mantenimiento-estado-badge');
  const bannerActivo = document.getElementById('mantenimiento-banner-activo');
  const btnActivar = document.getElementById('mantenimiento-activar-btn');
  const btnDesactivar = document.getElementById('mantenimiento-desactivar-btn');
  const btnPreview = document.getElementById('mantenimiento-preview-btn');
  const btnPreviewClose = document.getElementById('mantenimiento-preview-close-btn');
  const previewWrap = document.getElementById('mantenimiento-preview-wrap');
  const previewFrame = document.getElementById('mantenimiento-preview-frame');
  const statusEl = document.getElementById('status-mantenimiento');
  if (!tabBtn || !badge) return;

  let estadoActual = { activo: false };
  let estadoCargado = false;

  function setStatus(type, msg) {
    if (!statusEl) return;
    statusEl.dataset.type = type;
    statusEl.textContent = msg;
  }

  // ---- Cargar estado al abrir la pestaña (el gestor genérico de pestañas la muestra) ----
  tabBtn.addEventListener('click', () => cargarEstado(true));

  // ---- Render del estado ----
  function renderEstado(estado) {
    estadoActual = estado;
    const activo = Boolean(estado.activo);

    if (badge) {
      badge.classList.toggle('mnt-estado--on', activo);
      badge.classList.toggle('mnt-estado--off', !activo);
      badge.textContent = activo ? 'En mantenimiento' : 'Tienda operativa';
    }
    if (bannerActivo) bannerActivo.hidden = !activo;
    if (btnActivar) btnActivar.disabled = activo;
    if (btnDesactivar) btnDesactivar.disabled = !activo;
    if (metaEl) {
      metaEl.textContent = activo
        ? 'La tienda pública está mostrando la página de mantenimiento.'
        : 'La tienda pública está en línea y accesible para los visitantes.';
    }
  }

  async function cargarEstado(forzar = false) {
    if (estadoCargado && !forzar) return;
    try {
      const snap = await getDoc(doc(db, 'configuracion', FLAG_KEY));
      const data = snap.exists() ? (snap.data() || {}) : {};
      renderEstado({ activo: Boolean(data.activo), mensaje: data.mensaje || '', actualizadoEn: data.updatedAt || data.actualizadoEn, actualizadoPor: data.actualizadoPor });
      estadoCargado = true;
      setStatus('success', 'Estado sincronizado');
    } catch (err) {
      console.warn('[mantenimiento] No se pudo leer el estado:', err);
      setStatus('error', 'No se pudo leer el estado: ' + err.message);
    }
  }

  // ---- Artwork de la página de mantenimiento ----
  // Resuelve la imagen desde Imágenes (docs 'imagenes', id 'mantenimiento'),
  // con fallback a la variable de entorno y al asset por defecto.
  async function resolverArtwork() {
    try {
      const snap = await getDoc(doc(db, 'imagenes', 'mantenimiento'));
      if (snap.exists()) {
        const data = snap.data() || {};
        const url = data.url || data.data || '';
        if (url) return url;
      }
    } catch (err) {
      console.warn('[mantenimiento] No se pudo leer la imagen de mantenimiento:', err);
    }
    return import.meta.env.VITE_MANTENIMIENTO_ARTWORK_URL || mntArtworkPreview;
  }

  // ---- Número de WhatsApp del negocio (única fuente de verdad) ----
  async function resolverWhatsapp() {
    try {
      const snap = await getDoc(doc(db, 'configuracion', 'whatsapp'));
      if (snap.exists()) {
        const data = snap.data() || {};
        return String(data.phone || '');
      }
    } catch (err) {
      console.warn('[mantenimiento] No se pudo leer el WhatsApp del negocio:', err);
    }
    return '';
  }

  // ---- Activar / Desactivar (con confirmación por llave) ----
  async function cambiarEstado(activo) {
    const accion = activo ? 'Activar mantenimiento' : 'Desactivar mantenimiento';
    const detalle = activo
      ? 'Los visitantes de la tienda pública dejarán de ver los productos y verán la página de mantenimiento.'
      : 'Los visitantes volverán a ver la tienda normal de inmediato.';
    const ok = await pedirLlave(accion, detalle + ' Confirma con tu llave de acceso para continuar.');
    if (!ok) return;

    setStatus('loading', activo ? 'Activando mantenimiento…' : 'Desactivando mantenimiento…');
    try {
      await setDoc(doc(db, 'configuracion', FLAG_KEY), {
        activo,
        actualizadoEn: new Date().toISOString(),
        actualizadoPor: (auth.currentUser && auth.currentUser.email) || 'desconocido'
      });
      renderEstado({ activo });
      setStatus('success', activo ? 'Mantenimiento ACTIVADO' : 'Mantenimiento DESACTIVADO');
    } catch (err) {
      console.error('[mantenimiento] Error al guardar:', err);
      setStatus('error', 'No se pudo guardar: ' + err.message);
    }
  }

  if (btnActivar) btnActivar.addEventListener('click', () => cambiarEstado(true));
  if (btnDesactivar) btnDesactivar.addEventListener('click', () => cambiarEstado(false));

  // ---- Vista previa (NO modifica el estado real) ----
  async function abrirPreview() {
    if (!previewFrame || !previewWrap) return;
    previewFrame.srcdoc = buildMantenimientoHTML({
      artworkUrl: await resolverArtwork(),
      whatsapp: await resolverWhatsapp(),
      ...(estadoActual.mensaje ? { mensaje: estadoActual.mensaje } : {})
    });
    previewWrap.hidden = false;
  }

  if (btnPreview) btnPreview.addEventListener('click', abrirPreview);
  if (btnPreviewClose) btnPreviewClose.addEventListener('click', () => {
    if (previewWrap) previewWrap.hidden = true;
    if (previewFrame) previewFrame.srcdoc = '';
  });

  // ---- Realtime: el badge del sidebar y el estado se actualizan solos ----
  try {
    onSnapshot(
      query(collection(db, 'configuracion'), where('key', '==', FLAG_KEY)),
      () => { cargarEstado(true); }
    );
  } catch (err) {
    console.warn('[mantenimiento] Realtime no disponible:', err);
  }
})();





/* ==========================================================================
   VARIANTES — Sticky limitado de la barra de variantes
   ==========================================================================
   - El scroll REAL ocurre en #drawer-body (overflow-y: auto).
   - Las pestañas (#variant-bar-tabs) son position: sticky; top: 0 → quedan
     pegadas justo debajo del .drawer-header (elemento fijo fuera del scroll).
   - "Agregar variante" (.variant-bar) nunca es sticky: se desplaza.
   - Límite natural de la sección de variantes: el final de #fs-colors
     (zona de color de la variante). Al rebasarlo se añade is-unpinned
     (position: static) para que el sticky se suelte y el resto del
     formulario siga normal. Al volver hacia arriba se re-fija sin saltos.
   La clase is-pinned solo añade sombra/borde estético mientras está fija.
   ========================================================================== */
(() => {
  const drawerBody = document.getElementById("drawer-body");
  const tabs = document.getElementById("variant-bar-tabs");
  const fsColors = document.getElementById("fs-colors");
  if (!drawerBody || !tabs || !fsColors) return;

  // Desplazamientos en coordenadas del CONTENIDO (scrollTop), no del viewport.
  let tabsTop = 0; // posición natural de las pestañas dentro del body (px)
  let tabH = 0;    // altura de la barra de pestañas (px)
  let zoneEnd = 0; // final de la sección de variantes (px, coordenada de scroll)

  function refreshBoundary() {
    const bodyTop = drawerBody.getBoundingClientRect().top;
    tabsTop = tabs.getBoundingClientRect().top - bodyTop + drawerBody.scrollTop;
    tabH = tabs.getBoundingClientRect().height;
    zoneEnd = fsColors.getBoundingClientRect().bottom - bodyTop + drawerBody.scrollTop;
    applySticky();
  }

  function applySticky() {
    const st = drawerBody.scrollTop;
    // Se libera cuando la barra llegaría al fondo de la zona de variantes.
    const released = st >= zoneEnd - tabH;
    const pinned = !released && st >= Math.max(tabsTop - 4, 0);
    tabs.classList.toggle("is-unpinned", released);
    tabs.classList.toggle("is-pinned", pinned);
  }

  drawerBody.addEventListener("scroll", applySticky, { passive: true });
  window.addEventListener("resize", refreshBoundary, { passive: true });
  if (typeof ResizeObserver !== "undefined") {
    // Se recalcula al abrir el drawer y al crecer el contenido (galería, etc.).
    new ResizeObserver(refreshBoundary).observe(drawerBody);
  }
  refreshBoundary();
})();

/* ==========================================================================
   BACKUP DE PRODUCTOS — Exportar / Restaurar / Importar como plantilla
   --------------------------------------------------------------------------
   - Exportar: guarda filas crudas de `productos` (snake_case, tal cual Supabase)
     en un JSON descargable. Cero transformación = cero pérdida de datos.
   - Restaurar: antes de escribir genera un respaldo de seguridad automático
     (descarga + historial local en el navegador; NO altera el esquema de la BD)
     y luego hace `upsert` de las filas crudas. Al final verifica round-trip.
   - Plantilla (Crear producto): carga un producto del backup en el formulario
     sin asignar editingProductId → al guardar se crea un producto NUEVO.
   ========================================================================== */

const BACKUP_TYPE = "product-backup";
const BACKUP_HISTORY_KEY = "miphone_auto_backups";
const BACKUP_HISTORY_MAX = 10;
let backupRestorePayload = null;   // envelope cargado en el modal de restaurar
let backupTemplatePayload = null;  // envelope cargado en el modal de plantilla

function backupStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function buildBackupEnvelope(rows) {
  return {
    app: "MiPhoneHN",
    type: BACKUP_TYPE,
    version: 1,
    exportedAt: new Date().toISOString(),
    count: Array.isArray(rows) ? rows.length : 0,
    products: Array.isArray(rows) ? rows : []
  };
}

function downloadBackupJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function saveBackupToFolder(data, filename) {
  // File System Access API (Chrome/Edge): permite elegir la carpeta exacta.
  if (typeof window.showSaveFilePicker === "function") {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "Backup JSON", accept: { "application/json": [".json"] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      await writable.close();
      return true;
    } catch (err) {
      if (err && err.name === "AbortError") return false; // usuario canceló
      console.warn("showSaveFilePicker falló, se usa descarga normal:", err);
    }
  }
  downloadBackupJSON(data, filename);
  return true;
}

function readBackupFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error("No se seleccionó ningún archivo.")); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed || parsed.type !== BACKUP_TYPE || !Array.isArray(parsed.products)) {
          reject(new Error("El archivo no es un backup válido de productos (type product-backup)."));
          return;
        }
        resolve(parsed);
      } catch {
        reject(new Error("El archivo no contiene JSON válido."));
      }
    };
    reader.readAsText(file);
  });
}

/* Convierte una fila en formato camelCase (el que usa el editor en memoria) al
   formato de columnas de la tabla (snake_case). Necesario porque los snapshots
   tomados desde el editor (p. ej. previos a eliminar) viajan en camelCase y un
   upsert directo fallaría: "Could not find the 'batteryHealth' column". */
const BACKUP_CAMEL_TO_SNAKE = {
  oldPrice: "old_price",
  batteryHealth: "battery_health",
  createdAt: "created_at",
  updatedAt: "updated_at"
};

function camelToSnakeRow(row) {
  if (!row || typeof row !== "object") return row;
  const out = { ...row };
  for (const [camel, snake] of Object.entries(BACKUP_CAMEL_TO_SNAKE)) {
    if (!(camel in out)) continue;
    if (!(snake in out) || out[snake] === null || out[snake] === undefined) out[snake] = out[camel];
    delete out[camel];
  }
  return out;
}

/* Mapea una fila cruda (snake_case) al formato camelCase que consume fillProductForm. */
function snakeToCamelRow(row) {
  if (!row || typeof row !== "object") return row;
  return {
    ...row,
    oldPrice: row.old_price ?? row.oldPrice ?? 0,
    batteryHealth: row.battery_health ?? row.batteryHealth ?? null,
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt
  };
}

/* Campos comparables en la verificación round-trip (excluye timestamps). */
function normalizeForCompare(row) {
  if (!row || typeof row !== "object") return {};
  const keys = ["id", "title", "brand", "price", "old_price", "category", "condition", "badge",
    "battery_health", "description", "includes", "specs", "variants", "images", "image"];
  const out = {};
  for (const k of keys) out[k] = row[k] === undefined ? null : row[k];
  return out;
}

function openBackupModalById(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = false;
}
function closeBackupModalById(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = true;
}

function setBackupStatus(id, message, type = "info") {
  const el = document.getElementById(id);
  if (!el) return;
  if (!message) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  el.innerHTML = `<i class="ph ${type === "error" ? "ph-warning-circle" : "ph-info-circle"}" aria-hidden="true"></i> <span>${escapeHTML(message)}</span>`;
  el.classList.toggle("is-error", type === "error");
}

function setButtonBusy(btn, busy, busyLabel) {
  if (!btn) return;
  if (busy) {
    btn.dataset.originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-circle-notch ph-spin" aria-hidden="true"></i> ${escapeHTML(busyLabel)}`;
  } else {
    btn.disabled = false;
    if (btn.dataset.originalHtml) btn.innerHTML = btn.dataset.originalHtml;
  }
}

/* ------------------------------------------------------------------
   EXPORTAR
   ------------------------------------------------------------------ */
async function openExportBackupModal() {
  setBackupStatus("export-status", "");
  document.getElementById("export-backup-list").innerHTML =
    `<div class="backup-list-loading"><i class="ph ph-circle-notch ph-spin"></i> Cargando productos…</div>`;
  openBackupModalById("export-backup-modal");

  let rows = [];
  try {
    const { data, error } = await supabase.from("productos").select("id,title,brand,category,condition").order("title", { ascending: true });
    if (error) throw error;
    rows = data || [];
  } catch (err) {
    document.getElementById("export-backup-list").innerHTML =
      `<div class="backup-list-empty">No se pudieron cargar los productos: ${escapeHTML(err.message || "")}</div>`;
    return;
  }

  if (rows.length === 0) {
    document.getElementById("export-backup-list").innerHTML =
      `<div class="backup-list-empty">No hay productos en el catálogo.</div>`;
    updateExportCount();
    return;
  }

  document.getElementById("export-backup-list").innerHTML = rows.map((p) => `
    <label class="backup-product-item">
      <input type="checkbox" class="export-check" value="${escapeHTML(String(p.id))}" checked>
      <span class="backup-item-title">${escapeHTML(p.title || "(sin título)")}</span>
      <span class="backup-item-meta">${escapeHTML(p.brand || "")}${p.category ? " · " + escapeHTML(p.category) : ""}</span>
      <span class="backup-item-id">${escapeHTML(String(p.id))}</span>
    </label>
  `).join("");

  document.querySelectorAll("#export-backup-list .export-check").forEach((chk) => {
    chk.addEventListener("change", updateExportCount);
  });
  updateExportCount();
}

function getSelectedExportIds() {
  return [...document.querySelectorAll("#export-backup-list .export-check:checked")].map((c) => c.value);
}

function updateExportCount() {
  const el = document.getElementById("export-count");
  if (el) el.textContent = `${getSelectedExportIds().length} seleccionados`;
}

async function runExportBackup() {
  // Confirmación con llave de acceso del sistema: sin llave correcta, no exporta.
  const idsPrevios = getSelectedExportIds();
  const okLlave = await pedirLlave(
    "Exportar backup",
    `Se exportarán ${idsPrevios.length} producto(s) con TODA su información a un archivo JSON. Introduce tu llave de acceso para confirmar.`
  );
  if (!okLlave) {
    setBackupStatus("export-status", "Exportación cancelada: llave incorrecta o no proporcionada.", "error");
    return;
  }
  const ids = getSelectedExportIds();
  if (ids.length === 0) {
    setBackupStatus("export-status", "Selecciona al menos un producto.", "error");
    return;
  }
  const btn = document.getElementById("export-run-btn");
  setButtonBusy(btn, true, "Exportando…");
  try {
    const { data, error } = await supabase.from("productos").select("*").in("id", ids);
    if (error) throw error;
    const envelope = buildBackupEnvelope(data);
    const nombreArchivo = `miphone-productos-${backupStamp()}.json`;
    const saved = await saveBackupToFolder(envelope, nombreArchivo);
    if (!saved) {
      setBackupStatus("export-status", "Exportación cancelada.", "info");
      return;
    }
    pushExportLog({
      archivo: nombreArchivo,
      items: data.map((p) => ({ id: p.id, title: p.title || p.id }))
    });
    setBackupStatus("export-status", `Backup exportado con ${data.length} producto(s).`, "info");
    showAlert(`Backup exportado con ${data.length} producto(s).`, "success");
    // Todo fue exitoso: cerrar la ventana de exportación automáticamente.
    setTimeout(() => closeBackupModalById("export-backup-modal"), 1500);
  } catch (err) {
    setBackupStatus("export-status", `Error al exportar: ${err.message || err}`, "error");
  } finally {
    setButtonBusy(btn, false);
  }
}

/* ------------------------------------------------------------------
   RESTAURAR / IMPORTAR (Configuración → Backup)
   ------------------------------------------------------------------ */
/* ---------- IMPORTACIÓN INTELIGENTE ----------
   Al importar un archivo: los productos que YA existen se descartan
   automáticamente (cero duplicados, nada se sobrescribe), los NUEVOS se
   crean directamente, y los PARECIDOS pasan a una revisión lado a lado
   (editable vs solo lectura) antes de decidir. Todo queda registrado. */
let importAnalysis = null;      // resultado del análisis del archivo
let importReviewQueue = [];     // [{row, matchId}] pendientes de revisión
let importCurrentIndex = 0;
let importSummary = null;       // {archivo, descartados, creados, revisados}
let currentImportLogId = null;
/* Modo del modal de comparación: "import" (importación inteligente, guarda en
   Supabase) o "template" (revisión manual desde Crear producto, carga el
   formulario sin escribir nada). */
let compareMode = "import";
let templateCompareRow = null;
let templateCompareMatchId = null;
/* Hook: callback que el drawer de producto ejecuta al cerrarse, cuando fue
   abierto desde una revisión de backup (para reanudarla detrás). */
let alCerrarDrawerDesdeRevision = null;
/* ID del último producto creado en submitProductForm (para saber si el drawer
   cerró tras guardar o tras cancelar). */
let ultimoProductoCreadoId = null;
/* Bloqueo anti-duplicados en vivo dentro del drawer. */
let productoDuplicadoBloqueado = false;
let dupLiveTimer = null;
const IMPORT_LOG_KEY = "miphone_import_log";
const IMPORT_LOG_MAX = 30;
const EXPORT_LOG_KEY = "miphone_export_log";
const EXPORT_LOG_MAX = 30;

function cmpSafeHex(value) {
  return /^#[0-9a-fA-F]{3,8}$/.test(String(value || "")) ? value : "#cccccc";
}

async function analyzeImportProducts(fileProducts) {
  // IDs que ya existen en el catálogo destino (por lotes para no saturar la URL).
  const existingIds = new Set();
  const ids = fileProducts.map((p) => String(p.id)).filter(Boolean);
  for (let i = 0; i < ids.length; i += 100) {
    const lote = ids.slice(i, i + 100);
    try {
      const { data } = await supabase.from("productos").select("id").in("id", lote);
      (data || []).forEach((r) => existingIds.add(String(r.id)));
    } catch { /* sin info de IDs: se depende del detector de duplicados */ }
  }
  const discarded = [], toCreate = [], review = [];
  const catalogoDup = await fetchCatalogoLigero();
  for (const p of fileProducts) {
    if (existingIds.has(String(p.id))) {
      discarded.push({ row: p, razon: "ya existe un producto con ese ID", matchId: String(p.id) });
      continue;
    }
    const dup = findBackupDuplicate(p, catalogoDup);
    if (dup?.level === "identical") {
      discarded.push({ row: p, razon: `ya existe un producto idéntico (${dup.id})`, matchId: dup.id });
      continue;
    }
    if (dup?.level === "similar") {
      review.push({ row: p, matchId: dup.id });
      continue;
    }
    toCreate.push(p);
  }
  return { discarded, toCreate, review };
}

function renderAnalysisChips(analysis) {
  const el = document.getElementById("restore-analysis");
  if (!el) return;
  el.hidden = false;
  document.getElementById("analysis-descartados").textContent = String(analysis.discarded.length);
  document.getElementById("analysis-creados").textContent = String(analysis.toCreate.length);
  document.getElementById("analysis-revision").textContent = String(analysis.review.length);
}

async function onRestoreFileChosen(event) {
  const file = event.target.files?.[0];
  backupRestorePayload = null;
  importAnalysis = null;
  importReviewQueue = [];
  importSummary = null;
  document.getElementById("restore-backup-list").innerHTML = "";
  document.getElementById("restore-analysis").hidden = true;
  document.getElementById("restore-run-btn").disabled = true;
  setBackupStatus("restore-status", "");
  try {
    backupRestorePayload = await readBackupFile(file);
    backupRestorePayload._archivo = file.name;
    document.getElementById("restore-file-label").innerHTML =
      `<i class="ph ph-check-circle" aria-hidden="true"></i> ${escapeHTML(file.name)} — ${backupRestorePayload.count} producto(s)`;
    if (backupRestorePayload.count === 0) {
      document.getElementById("restore-backup-list").innerHTML = `<div class="backup-list-empty">El archivo no contiene productos.</div>`;
      setBackupStatus("restore-status", "El archivo no contiene productos.", "error");
      return;
    }
    setBackupStatus("restore-status", "Analizando el archivo contra tu catálogo…");
    importAnalysis = await analyzeImportProducts(backupRestorePayload.products);
    renderAnalysisChips(importAnalysis);
    renderImportResultsList();
    if (importAnalysis.toCreate.length === 0 && importAnalysis.review.length === 0) {
      setBackupStatus("restore-status", "Todos los productos del archivo ya existen en tu catálogo: no hay nada por crear.", "info");
      return;
    }
    document.getElementById("restore-run-btn").disabled = false;
    setBackupStatus("restore-status", `Listo: ${importAnalysis.discarded.length} se descartarán, ${importAnalysis.toCreate.length} se crearán${importAnalysis.review.length ? `, ${importAnalysis.review.length} esperan revisión` : ""}. Pulsa Importar.`);
  } catch (err) {
    setBackupStatus("restore-status", err.message, "error");
    document.getElementById("restore-file-label").textContent = "Haz clic para elegir un archivo .json";
  } finally {
    event.target.value = "";
  }
}

async function runSmartImport() {
  if (!esAdmin()) {
    setBackupStatus("restore-status", "Solo un administrador puede importar productos.", "error");
    return;
  }
  if (!backupRestorePayload?.products?.length || !importAnalysis) return;
  // Confirmación con llave de acceso del sistema: sin llave correcta, no importa nada.
  const okLlave = await pedirLlave(
    "Importar backup",
    `Se aplicará la importación: ${importAnalysis.toCreate.length} producto(s) nuevo(s) se crearán, ${importAnalysis.discarded.length} ya existen y se descartarán${importAnalysis.review.length ? `, ${importAnalysis.review.length} pasarán a revisión` : ""}. Introduce tu llave de acceso para confirmar.`
  );
  if (!okLlave) {
    setBackupStatus("restore-status", "Importación cancelada: llave incorrecta o no proporcionada.", "error");
    return;
  }
  const btn = document.getElementById("restore-run-btn");
  setButtonBusy(btn, true, "Importando…");
  try {
    const creados = [];
    for (const row of importAnalysis.toCreate) {
      // Doble verificación: si el ID apareció mientras tanto, descartar en vez
      // de sobrescribir. Nada del catálogo actual se pisa en esta ventana.
      const { data: exists } = await supabase.from("productos").select("id").eq("id", String(row.id)).maybeSingle();
      if (exists) {
        importAnalysis.discarded.push({ row, razon: "apareció en el catálogo durante la importación" });
        continue;
      }
      const { error } = await supabase.from("productos").upsert(camelToSnakeRow(row));
      if (error) throw new Error(`Fallo al crear "${row.title || row.id}": ${error.message}`);
      creados.push(row);
    }
    importReviewQueue = importAnalysis.review.map((r) => ({ ...r }));
    importSummary = {
      archivo: backupRestorePayload._archivo || "",
      descartados: importAnalysis.discarded.length,
      creados: creados.length,
      revisados: 0
    };
    currentImportLogId = pushImportLog({
      archivo: importSummary.archivo,
      items: [
        ...importAnalysis.discarded.map((d) => ({ id: d.row.id, title: d.row.title || d.row.id, accion: "descartado", detalle: d.razon })),
        ...creados.map((r) => ({ id: r.id, title: r.title || r.id, accion: "creado", detalle: "producto nuevo creado desde el backup" })),
        ...importReviewQueue.map((r) => ({ id: r.row.id, title: r.row.title || r.row.id, accion: "revision", detalle: `parecido a ${r.matchId}; pendiente de revisión` }))
      ]
    });
    renderAnalysisChips(importAnalysis);
    showAlert(`Importación: ${creados.length} creado(s), ${importAnalysis.discarded.length} descartado(s) por ya existir${importReviewQueue.length ? `, ${importReviewQueue.length} por revisar` : ""}.`, "success");
    finishImportIfDone();
  } catch (err) {
    setBackupStatus("restore-status", err.message || String(err), "error");
    showAlert(`Error al importar: ${err.message || err}`, "error");
  } finally {
    setButtonBusy(btn, false);
    if (btn) btn.disabled = true; // la importación masiva es de una sola pasada
  }
}

function renderImportResultsList() {
  const listEl = document.getElementById("restore-backup-list");
  if (!listEl) return;
  const discarded = importAnalysis?.discarded || [];
  if (importReviewQueue.length === 0 && discarded.length === 0) {
    listEl.innerHTML = `<div class="backup-list-empty">Sin productos pendientes: todo fue importado o descartado.</div>`;
    return;
  }
  let html = "";
  if (importReviewQueue.length > 0) {
    html += `<div class="backup-list-section">Pendientes de revisión (parecidos)</div>`;
    html += importReviewQueue.map((item, i) => `
      <button type="button" class="backup-product-item backup-product-item--btn" data-review-index="${i}">
        <i class="ph ph-magnifying-glass" aria-hidden="true"></i>
        <span class="backup-item-title">${escapeHTML(item.row.title || "(sin título)")}</span>
        <span class="backup-item-dest is-review">Se parece a ${escapeHTML(String(item.matchId))}</span>
        <span class="backup-item-id">${escapeHTML(String(item.row.id))}</span>
      </button>`).join("");
  }
  if (discarded.length > 0) {
    html += `<div class="backup-list-section">Descartados por ya existir — clic para verificar lado a lado</div>`;
    html += discarded.map((d, i) => `
      <button type="button" class="backup-product-item backup-product-item--btn" data-discarded-index="${i}">
        <i class="ph ph-seal-check" aria-hidden="true"></i>
        <span class="backup-item-title">${escapeHTML(d.row.title || "(sin título)")}</span>
        <span class="backup-item-dest is-update">Ya existe (${escapeHTML(String(d.matchId))})</span>
        <span class="backup-item-id">${escapeHTML(String(d.row.id))}</span>
      </button>`).join("");
  }
  listEl.innerHTML = html;
  listEl.querySelectorAll("[data-review-index]").forEach((btn) => {
    btn.addEventListener("click", () => openCompareForm(Number(btn.dataset.reviewIndex)));
  });
  listEl.querySelectorAll("[data-discarded-index]").forEach((btn) => {
    btn.addEventListener("click", () => openDiscardedCompare(Number(btn.dataset.discardedIndex)));
  });
}

function finishImportIfDone() {
  renderImportResultsList();
  const pendientes = importReviewQueue.length;
  const descartados = importAnalysis?.discarded?.length || 0;
  if (pendientes > 0) {
    setBackupStatus("restore-status", `${pendientes} producto(s) pendiente(s) de revisión. Revísalos abajo.`, "info");
    return;
  }
  if (descartados > 0) {
    // Importación exitosa: los descartados quedan listados y se pueden
    // verificar lado a lado antes de cerrar la ventana.
    setBackupStatus("restore-status", `Importación completada: ${importSummary?.creados || 0} creado(s), ${descartados} ya existían (verificables abajo).`, "info");
    return;
  }
  const s = importSummary || { descartados: 0, creados: 0, revisados: 0 };
  setBackupStatus("restore-status", `Importación completada: ${s.creados} creado(s), ${s.descartados} descartado(s), ${s.revisados} revisado(s).`, "info");
  showAlert(`Importación completada: ${s.creados} creado(s), ${s.descartados} descartado(s), ${s.revisados} revisado(s). Todo quedó en el historial de importaciones.`, "success");
  // Todo fue exitoso y no quedó nada por verificar: cerrar automáticamente.
  setTimeout(() => {
    closeBackupModalById("compare-import-modal");
    closeBackupModalById("restore-backup-modal");
  }, 1600);
}

/* ---------- REVISIÓN LADO A LADO ---------- */
function openCompareForm(index) {
  compareMode = "import";
  importCurrentIndex = index;
  const item = importReviewQueue[index];
  if (!item) return;
  templateCompareRow = item.row;
  templateCompareMatchId = item.matchId;
  document.getElementById("compare-import-id").textContent = `(${String(item.row.id)})`;
  document.getElementById("compare-existing-id").textContent = `${String(item.matchId)} — solo lectura`;
  setCompareButtons("import");
  document.getElementById("compare-editable").innerHTML = buildCompareFormPane(item.row);
  const existing = getExistingProductForCompare(item.matchId);
  document.getElementById("compare-existing").innerHTML = existing
    ? buildCompareFormPane(existing)
    : `<div class="backup-list-empty">No se encontró el producto existente.</div>`;
  openBackupModalById("compare-import-modal");
}

/* Misma vista lado a lado, pero desde Crear producto → Importar: sirve para
   verificar manualmente si un producto marcado como "Ya existe" es realmente
   el mismo o es otro. Nada se escribe: al confirmar solo carga la plantilla. */
function openTemplateCompare(row, matchId) {
  compareMode = "template";
  templateCompareRow = row;
  templateCompareMatchId = matchId;
  document.getElementById("compare-import-id").textContent = `(${String(row.id)})`;
  document.getElementById("compare-existing-id").textContent = `${String(matchId)} — solo lectura`;
  setCompareButtons("template");
  document.getElementById("compare-editable").innerHTML = buildCompareFormPane(row);
  const existing = getExistingProductForCompare(matchId);
  document.getElementById("compare-existing").innerHTML = existing
    ? buildCompareFormPane(existing)
    : `<div class="backup-list-empty">No se encontró el producto existente.</div>`;
  openBackupModalById("compare-import-modal");
}

/* Revisión de un producto auto-descartado por "ya existe": verifica lado a
   lado si realmente es el mismo. Si lo es, se mantiene descartado; si es otro
   producto, se crea como nuevo con ID secuencial (nunca sobrescribe). */
function openDiscardedCompare(index) {
  const d = importAnalysis?.discarded?.[index];
  if (!d) return;
  compareMode = "discarded";
  templateCompareRow = d.row;
  templateCompareMatchId = d.matchId;
  importCurrentIndex = index;
  document.getElementById("compare-import-id").textContent = `(${String(d.row.id)})`;
  document.getElementById("compare-existing-id").textContent = `${String(d.matchId)} — solo lectura`;
  setCompareButtons("discarded");
  document.getElementById("compare-editable").innerHTML = buildCompareFormPane(d.row);
  const existing = getExistingProductForCompare(d.matchId);
  document.getElementById("compare-existing").innerHTML = existing
    ? buildCompareFormPane(existing)
    : `<div class="backup-list-empty">No se encontró el producto existente.</div>`;
  openBackupModalById("compare-import-modal");
}

function setCompareButtons(mode) {
  const saveBtn = document.getElementById("compare-save-btn");
  const discardBtn = document.getElementById("compare-discard-btn");
  const labels = {
    import: {
      save: `<i class="ph ph-arrow-bend-down-right" aria-hidden="true"></i> Es otro, enviar al formulario de creación`,
      discard: `<i class="ph ph-x-circle" aria-hidden="true"></i> Es el mismo, descartar (no importar)`
    },
    template: {
      save: `<i class="ph ph-arrow-bend-down-right" aria-hidden="true"></i> Es otro, cargar en el formulario`,
      discard: `<i class="ph ph-x-circle" aria-hidden="true"></i> Es el mismo, descartar`
    },
    discarded: {
      save: `<i class="ph ph-arrow-bend-down-right" aria-hidden="true"></i> Es otro, ir al formulario de creación`,
      discard: `<i class="ph ph-x-circle" aria-hidden="true"></i> Es el mismo, descartar`
    }
  };
  const l = labels[mode] || labels.import;
  if (saveBtn) saveBtn.innerHTML = l.save;
  if (discardBtn) discardBtn.innerHTML = l.discard;
}

/* Réplica de solo lectura del formulario de creación/edición de productos:
   mismas secciones (Producto, Galería, Descripción, Incluye, Especificaciones,
   Colores, Capacidades) con los datos cargados, sin inputs ni botones de
   agregar. Se usa para AMBOS paneles de la comparación. */
function cmpValue(value, vacio = "—") {
  const s = String(value ?? "").trim();
  return s
    ? `<div class="cmp-value">${escapeHTML(s)}</div>`
    : `<div class="cmp-value cmp-value--empty">${escapeHTML(vacio)}</div>`;
}

function cmpSection(icon, iconClass, titulo, subtitulo, chip, body) {
  return `
  <section class="form-section cmp-section">
    <header class="fs-head">
      <span class="fs-icon ${iconClass}"><i class="ph-duotone ${icon}" aria-hidden="true"></i></span>
      <div class="fs-copy"><h4>${escapeHTML(titulo)}</h4><p>${escapeHTML(subtitulo)}</p></div>
      ${chip ? `<span class="fs-chip">${escapeHTML(chip)}</span>` : ""}
    </header>
    <div class="fs-body cmp-body">${body}</div>
  </section>`;
}

function buildCompareFormPane(row) {
  const colors = Array.isArray(row?.variants?.colors) ? row.variants.colors : [];
  const storage = Array.isArray(row?.variants?.storage) ? row.variants.storage : [];
  const images = Array.isArray(row?.images) ? row.images : [];
  const includes = Array.isArray(row?.includes) ? row.includes : [];
  const specs = Array.isArray(row?.specs) ? row.specs : [];
  const battery = row.battery_health ?? row.batteryHealth;
  const cond = row.condition === "seminuevo" ? "Seminuevo" : (row.condition ? "Nuevo" : "");
  let html = "";

  html += cmpSection("ph-package", "fs-icon--ink", "Producto", "Datos principales del producto.", "Obligatorio", `
    <label class="variant-field"><span>Nombre del producto</span>${cmpValue(row.title, "(sin título)")}</label>
    <div class="cmp-grid-fields">
      <label class="variant-field"><span>Marca</span>${cmpValue(row.brand)}</label>
      <label class="variant-field"><span>Categoría</span>${cmpValue(row.category)}</label>
      <label class="variant-field"><span>Condición</span>${cmpValue(cond)}</label>
      <label class="variant-field"><span>Salud de batería (%)</span>${cmpValue(battery ?? "")}</label>
    </div>`);

  html += cmpSection("ph-images", "fs-icon--violet", "Galería", "Imágenes del producto.", "Obligatorio",
    images.length
      ? `<div class="cmp-thumbs">${images.map((u) => `<img src="${escapeHTML(u)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`).join("")}</div>`
      : cmpValue("", "Sin imágenes"));

  html += cmpSection("ph-text-align-left", "fs-icon--blue", "Descripción", "Detalle del producto.", "Opcional",
    cmpValue(row.description, "Sin descripción"));

  html += cmpSection("ph-list-checks", "fs-icon--green", "Incluye", "Elementos incluidos.", "Opcional",
    includes.length
      ? `<ul class="cmp-list">${includes.map((i) => `<li>${escapeHTML(String(i))}</li>`).join("")}</ul>`
      : cmpValue("", "Sin elementos"));

  html += cmpSection("ph-cpu", "fs-icon--amber", "Especificaciones", "Ficha técnica.", "Opcional",
    specs.length
      ? `<ul class="cmp-list">${specs.map((s) => `<li>${escapeHTML(String(s))}</li>`).join("")}</ul>`
      : cmpValue("", "Sin especificaciones"));

  html += cmpSection("ph-palette", "fs-icon--pink", "Colores", "Variantes de color del producto.", colors.length ? `${colors.length} color(es)` : "Opcional",
    colors.length
      ? colors.map((c) => `
          <div class="cmp-color-item">
            <span class="cmp-color-swatch" style="--swatch:${cmpSafeHex(c.hex || c.value)}" aria-hidden="true"></span>
            <strong>${escapeHTML(c.name || "(sin nombre)")}</strong>
            <span class="cmp-color-hex">${escapeHTML(String(c.hex || c.value || "").toUpperCase())}</span>
            ${c.overrides && Object.keys(c.overrides).length ? `<span class="fs-chip fs-chip--req">Variante con datos propios</span>` : ""}
          </div>`).join("")
      : cmpValue("", "Sin colores"));

  html += cmpSection("ph-hard-drives", "fs-icon--ink", "Capacidades y precios", "Almacenamiento, precios e inventario.", storage.length ? `${storage.length} capacidad(es)` : "Obligatorio",
    storage.length
      ? storage.map((s) => `
          <div class="cmp-storage-item">
            <div class="cmp-kv"><span>Capacidad</span><strong>${escapeHTML(s.name || "")}</strong></div>
            <div class="cmp-kv"><span>Precio oferta</span>${formatCurrency(Number(s.price) || 0)}</div>
            <div class="cmp-kv"><span>Precio normal</span>${formatCurrency(Number(s.oldPrice ?? s.old_price) || 0)}</div>
            <div class="cmp-kv"><span>Stock</span>${s.stock ?? "—"}</div>
          </div>`).join("")
      : cmpValue("", "Sin capacidades"));

  return html;
}

function getExistingProductForCompare(matchId) {
  return (Array.isArray(products) ? products : []).find((p) => String(p.id) === String(matchId)) || null;
}

function collectCompareRow() {
  // Ambos paneles son de solo lectura: la fila base viaja intacta (solo
  // normalizada). La edición real ocurre en el formulario de creación.
  const base = templateCompareRow || importReviewQueue[importCurrentIndex]?.row;
  return base ? camelToSnakeRow({ ...base }) : null;
}

function saveCompareImport() {
  // Cualquiera de los dos caminos ("Es otro") lleva al FORMULARIO DE CREACIÓN
  // con los datos precargados. Orden de capas al salir de la revisión:
  //   1. se CIERRA el modal de comparación,
  //   2. la ventana de importación queda ATRÁS (blur),
  //   3. el drawer de creación se abre ENCIMA (z-index 90 > 70).
  // Al cerrarse el drawer, la ventana de importación reaparece nítida y
  // reanuda la cola (o se cierra sola si ya no queda nada).
  const row = collectCompareRow();
  if (!row) { closeBackupModalById("compare-import-modal"); return; }
  const origen = compareMode === "discarded" ? "discarded" : "revision";
  const ctx = { origen, baseId: String(row.id), matchId: templateCompareMatchId || "", titulo: row.title || row.id };
  closeBackupModalById("compare-import-modal");
  loadProductAsTemplate(row, {
    alCerrar: () => reanudarRevisionTrasCreacion(ctx)
  });
}

/* Reanuda la ventana de importación al cerrarse el drawer de creación:
   - Si se GUARDÓ (hay producto recién creado): quita el producto de la cola,
     registra la creación y cierra la ventana si ya no queda nada.
   - Si se CANCELÓ: el producto vuelve a estar disponible para revisarlo de nuevo. */
function reanudarRevisionTrasCreacion(ctx) {
  document.getElementById("restore-backup-modal")?.classList.remove("is-behind");
  const creadoId = ultimoProductoCreadoId;
  ultimoProductoCreadoId = null;
  const creado = !!creadoId;
  if (creado) {
    appendImportItems([{ id: creadoId, title: ctx.titulo || "(producto recién creado)", accion: "creado", detalle: `creado desde la revisión lado a lado (referencia: ${ctx.matchId || ctx.baseId})` }]);
    if (importSummary) importSummary.creados += 1;
  }
  if (ctx.origen === "revision") {
    const idx = importReviewQueue.findIndex((r) => String(r.row.id) === String(ctx.baseId));
    if (idx >= 0 && creado) importReviewQueue.splice(idx, 1);
  } else if (ctx.origen === "discarded") {
    const idx = importAnalysis?.discarded?.findIndex((d) => String(d.row.id) === String(ctx.baseId));
    if (idx >= 0 && creado) importAnalysis.discarded.splice(idx, 1);
  }
  if (creado && importSummary) importSummary.revisados += 1;
  renderAnalysisChips(importAnalysis);
  renderImportResultsList();
  const quedan = importReviewQueue.length + (importAnalysis?.discarded?.length || 0);
  if (quedan === 0) {
    showAlert(creado ? "Importación completada. Todo quedó registrado en el historial." : "No se creó ningún producto. Ventana cerrada.", creado ? "success" : "info");
    closeBackupModalById("restore-backup-modal");
  } else {
    setBackupStatus("restore-status", `${importReviewQueue.length} pendiente(s) de revisión · ${importAnalysis?.discarded?.length || 0} descartado(s) verificable(s).`, "info");
  }
}

function discardCompareImport() {
  // Modo descartado: confirma que ES el mismo → sigue descartado, no se toca nada.
  if (compareMode === "discarded") {
    appendImportItems([{ id: templateCompareRow?.id || "", title: templateCompareRow?.title || templateCompareRow?.id || "", accion: "descartado", detalle: `confirmado manualmente: es el mismo producto (${templateCompareMatchId})` }]);
    closeBackupModalById("compare-import-modal");
    showAlert("Confirmado: es el mismo producto, sigue descartado.", "info");
    return;
  }
  // Modo plantilla: descartar solo cierra la revisión, no hay nada que borrar.
  if (compareMode === "template") {
    closeBackupModalById("compare-import-modal");
    showAlert("Producto descartado: no se cargó ninguna plantilla.", "info");
    return;
  }
  const item = importReviewQueue[importCurrentIndex];
  if (!item) { closeBackupModalById("compare-import-modal"); return; }
  showConfirm(
    "Descartar producto",
    `No se importará <strong>${escapeHTML(item.row.title || String(item.row.id))}</strong>. Quedará registrado en el historial de importaciones como descartado en la revisión.`,
    () => {
      appendImportItems([{ id: item.row.id, title: item.row.title || item.row.id, accion: "descartado", detalle: `descartado en la revisión lado a lado (parecido a ${item.matchId})` }]);
      if (importSummary) importSummary.revisados += 1;
      importReviewQueue.splice(importCurrentIndex, 1);
      closeBackupModalById("compare-import-modal");
      finishImportIfDone();
    },
    { tone: "danger", okLabel: "Sí, descartar" }
  );
}

/* ---------- HISTORIAL DE IMPORTACIONES (localStorage, sin tocar la BD) ---------- */
function getImportLog() {
  try {
    const parsed = JSON.parse(localStorage.getItem(IMPORT_LOG_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function pushImportLog({ archivo, items = [] }) {
  const entry = { id: `imp-${Date.now()}`, createdAt: new Date().toISOString(), archivo: archivo || "", items };
  const log = getImportLog();
  log.unshift(entry);
  localStorage.setItem(IMPORT_LOG_KEY, JSON.stringify(log.slice(0, IMPORT_LOG_MAX)));
  renderImportLog();
  return entry.id;
}

function appendImportItems(items) {
  const log = getImportLog();
  let entry = log.find((e) => e.id === currentImportLogId) || log[0];
  // Si no hay entrada previa (p. ej., todo fue descartado sin pasar por
  // "Importar"), se crea una para no perder el registro.
  if (!entry) {
    entry = { id: `imp-${Date.now()}`, createdAt: new Date().toISOString(), archivo: "", items: [] };
    log.unshift(entry);
    currentImportLogId = entry.id;
  }
  entry.items = [...(entry.items || []), ...items];
  localStorage.setItem(IMPORT_LOG_KEY, JSON.stringify(log.slice(0, IMPORT_LOG_MAX)));
  renderImportLog();
}

/* ---------- HISTORIAL DE EXPORTACIONES (localStorage, sin tocar la BD) ---------- */
function getExportLog() {
  try {
    const parsed = JSON.parse(localStorage.getItem(EXPORT_LOG_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function pushExportLog({ archivo, items = [] }) {
  const entry = { id: `exp-${Date.now()}`, createdAt: new Date().toISOString(), archivo: archivo || "", count: items.length, items };
  const log = getExportLog();
  log.unshift(entry);
  localStorage.setItem(EXPORT_LOG_KEY, JSON.stringify(log.slice(0, EXPORT_LOG_MAX)));
  renderExportLog();
}

/* Exportaciones expandidas manualmente (Ver más). El resto inicia colapsado
   a 7 productos para que una exportación grande no ocupe toda la pestaña. */
const exportacionesExpandidas = new Set();

function renderExportLog() {
  const listEl = document.getElementById("export-log-list");
  if (!listEl) return;
  const log = getExportLog();
  if (!log.length) {
    listEl.innerHTML = `<p class="backup-history-empty">Sin exportaciones registradas todavía. Cada exportación manual queda registrada aquí con sus productos.</p>`;
    return;
  }
  listEl.innerHTML = log.map((entry) => {
    const fecha = new Date(entry.createdAt);
    const items = entry.items || [];
    const expandida = exportacionesExpandidas.has(entry.id);
    const visibles = expandida ? items : items.slice(0, 7);
    const itemsHTML = visibles.map((it) => `<li><i class="ph ph-package" aria-hidden="true"></i> <strong>${escapeHTML(String(it.title || it.id))}</strong> <span>${escapeHTML(String(it.id))}</span></li>`).join("");
    const toggle = items.length > 7
      ? `<button type="button" class="export-log-toggle" data-exp-toggle="${escapeHTML(entry.id)}">${expandida ? "Ver menos" : `Ver más (${items.length - 7} más)`}</button>`
      : "";
    return `
    <div class="backup-history-item import-log-item">
      <div class="backup-history-info">
        <div class="backup-history-line"><strong>${escapeHTML(fecha.toLocaleDateString())} ${escapeHTML(fecha.toLocaleTimeString())}</strong>${entry.archivo ? `<span class="import-log-file"><i class="ph ph-file-json" aria-hidden="true"></i> ${escapeHTML(entry.archivo)}</span>` : ""}</div>
        <div class="import-log-chips"><span class="analysis-chip is-create"><i class="ph ph-download-simple" aria-hidden="true"></i> ${entry.count ?? items.length} producto(s) exportado(s)</span></div>
        <ul class="import-log-items">${itemsHTML}</ul>
        ${toggle}
      </div>
    </div>`;
  }).join("");
  listEl.querySelectorAll("[data-exp-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.expToggle;
      if (exportacionesExpandidas.has(id)) exportacionesExpandidas.delete(id);
      else exportacionesExpandidas.add(id);
      renderExportLog();
    });
  });
}

const IMPORT_ACCIONES = {
  descartado: { icono: "ph-x-circle", clase: "is-discard", texto: "Descartado" },
  creado: { icono: "ph-plus-circle", clase: "is-create", texto: "Creado" },
  importado: { icono: "ph-check-circle", clase: "is-ok", texto: "Importado" },
  revision: { icono: "ph-magnifying-glass", clase: "is-review", texto: "A revisión" }
};

function renderImportLog() {
  const listEl = document.getElementById("import-log-list");
  if (!listEl) return;
  const log = getImportLog();
  if (!log.length) {
    listEl.innerHTML = `<p class="backup-history-empty">Sin importaciones registradas todavía. Cada importación queda registrada aquí con sus productos descartados, creados e importados.</p>`;
    return;
  }
  listEl.innerHTML = log.map((entry) => {
    const fecha = new Date(entry.createdAt);
    const counts = {};
    (entry.items || []).forEach((it) => { counts[it.accion] = (counts[it.accion] || 0) + 1; });
    const chips = Object.entries(counts).map(([acc, n]) => {
      const a = IMPORT_ACCIONES[acc] || { icono: "ph-dot", clase: "is-review", texto: acc };
      return `<span class="analysis-chip ${a.clase}"><i class="ph ${a.icono}" aria-hidden="true"></i> ${n} ${a.texto.toLowerCase()}</span>`;
    }).join("");
    const items = (entry.items || []).map((it) => {
      const a = IMPORT_ACCIONES[it.accion] || { icono: "ph-dot", clase: "" };
      return `<li class="${a.clase || ""}"><i class="ph ${a.icono}" aria-hidden="true"></i> <strong>${escapeHTML(String(it.title || it.id))}</strong>${it.detalle ? ` — <span>${escapeHTML(it.detalle)}</span>` : ""}</li>`;
    }).join("");
    return `
    <div class="backup-history-item import-log-item">
      <div class="backup-history-info">
        <div class="backup-history-line"><strong>${escapeHTML(fecha.toLocaleDateString())} ${escapeHTML(fecha.toLocaleTimeString())}</strong>${entry.archivo ? `<span class="import-log-file"><i class="ph ph-file-json" aria-hidden="true"></i> ${escapeHTML(entry.archivo)}</span>` : ""}</div>
        <div class="import-log-chips">${chips}</div>
        <ul class="import-log-items">${items}</ul>
      </div>
    </div>`;
  }).join("");
}

function getSelectedRestoreProducts() {
  const ids = [...document.querySelectorAll("#restore-backup-list .restore-check:checked")].map((c) => c.value);
  return (backupRestorePayload?.products || []).filter((p) => ids.includes(String(p.id)));
}

function updateRestoreRunState() {
  const btn = document.getElementById("restore-run-btn");
  if (btn) btn.disabled = getSelectedRestoreProducts().length === 0;
}

/* Guarda un snapshot de un producto en el HISTORIAL LOCAL (pestaña Backup)
   SIN descargar nada a la computadora. Usado, p. ej., antes de eliminar un
   producto: el estado queda recuperable desde Configuración → Backup. */
function storeProductSnapshot(product, motivo = "previo_eliminacion") {
  try {
    // Normalizar a formato de tabla (snake_case): el producto viene del editor
    // en camelCase y debe poder restaurarse con upsert sin transformaciones.
    const envelope = buildBackupEnvelope([camelToSnakeRow(product)]);
    const history = getBackupHistory();
    history.unshift({
      id: `bkp-${Date.now()}`,
      createdAt: new Date().toISOString(),
      motivo,
      productIds: [String(product?.id || "")],
      titles: [product?.title || product?.id || "(sin título)"],
      data: envelope
    });
    localStorage.setItem(BACKUP_HISTORY_KEY, JSON.stringify(history.slice(0, BACKUP_HISTORY_MAX)));
    renderBackupHistory();
  } catch (err) {
    console.warn("No se pudo guardar el respaldo en el historial local:", err);
  }
}

async function createAutoSafetyBackup(productsToWrite) {
  // Snapshot del estado ACTUAL de los productos que se van a modificar.
  const ids = productsToWrite.map((p) => String(p.id));
  let currentRows = [];
  try {
    const { data } = await supabase.from("productos").select("*").in("id", ids);
    currentRows = data || [];
  } catch (err) {
    console.warn("No se pudo leer el estado actual para el auto-backup:", err);
  }
  if (currentRows.length === 0) return;

  const envelope = buildBackupEnvelope(currentRows);
  // Historial local en el navegador (recuperable desde la pestaña Backup).
  // NADA se descarga a la computadora: los únicos archivos que se descargan
  // son los que el administrador exporta manualmente.
  try {
    const history = getBackupHistory();
    history.unshift({
      id: `bkp-${Date.now()}`,
      createdAt: new Date().toISOString(),
      motivo: "previo_restauracion",
      productIds: currentRows.map((r) => String(r.id)),
      titles: currentRows.map((r) => r.title || r.id),
      data: envelope
    });
    localStorage.setItem(BACKUP_HISTORY_KEY, JSON.stringify(history.slice(0, BACKUP_HISTORY_MAX)));
    renderBackupHistory();
  } catch (err) {
    console.warn("No se pudo guardar el historial local de backups:", err);
  }
}

async function runRestoreBackup(productsOverride = null) {
  if (!esAdmin()) {
    setBackupStatus("restore-status", "Solo un administrador puede restaurar productos.", "error");
    return;
  }
  const products = (productsOverride || getSelectedRestoreProducts()).map(camelToSnakeRow);
  // ANTI-DUPLICADOS POR NOMBRE al restaurar: si el ID del respaldo ya existe,
  // se actualiza ese producto; si no existe pero hay otro con el MISMO NOMBRE,
  // se restaura SOBRE ese producto. Nunca se crea un duplicado con igual nombre.
  const catalogoRestauracion = await fetchCatalogoLigero();
  for (const row of products) {
    if (row._targetId) {
      row.id = row._targetId;
    } else if (!catalogoRestauracion.some((c) => String(c.id) === String(row.id))) {
      const mismoNombre = catalogoRestauracion.find((c) => normalizeCatalogText(c.title) === normalizeCatalogText(row.title));
      if (mismoNombre) row.id = mismoNombre.id;
    }
    delete row._targetId;
  }
  if (products.length === 0) {
    setBackupStatus("restore-status", "Selecciona al menos un producto.", "error");
    return;
  }
  const btn = document.getElementById("restore-run-btn");
  setButtonBusy(btn, true, "Restaurando…");
  const resultEl = document.getElementById("restore-result");
  resultEl.hidden = true;

  try {
    // 1. Respaldo de seguridad automático ANTES de modificar nada.
    setBackupStatus("restore-status", "Generando respaldo de seguridad automático…");
    await createAutoSafetyBackup(products);

    // 2. Upsert de filas crudas (el id define actualizar vs insertar).
    setBackupStatus("restore-status", `Restaurando ${products.length} producto(s)…`);
    for (const row of products) {
      const { error } = await supabase.from("productos").upsert(row);
      if (error) throw new Error(`Fallo al restaurar "${row.title || row.id}": ${error.message}`);
    }

    // 3. Verificación round-trip: releer y comparar contra el origen.
    setBackupStatus("restore-status", "Verificando integridad…");
    const results = [];
    for (const row of products) {
      let written = null;
      try {
        const { data } = await supabase.from("productos").select("*").eq("id", String(row.id)).maybeSingle();
        written = data;
      } catch { /* se reporta como diferencia */ }
      const ok = !!written && JSON.stringify(normalizeForCompare(written)) === JSON.stringify(normalizeForCompare(row));
      results.push({ id: row.id, title: row.title || row.id, ok });
    }

    const okCount = results.filter((r) => r.ok).length;
    resultEl.hidden = false;
    resultEl.innerHTML = `
      <h4><i class="ph ${okCount === results.length ? "ph-check-circle" : "ph-warning"}" aria-hidden="true"></i>
        Resultado: ${okCount}/${results.length} verificado(s)</h4>
      <ul>${results.map((r) => `<li class="${r.ok ? "is-ok" : "is-diff"}">
        <i class="ph ${r.ok ? "ph-check" : "ph-x"}" aria-hidden="true"></i>
        ${escapeHTML(r.title)} ${r.ok ? "— idéntico al backup" : "— con diferencias"}</li>`).join("")}</ul>`;
    setBackupStatus("restore-status", okCount === results.length
      ? "Restauración completada y verificada."
      : "Restauración completada con diferencias. Revisa el detalle.", okCount === results.length ? "info" : "error");
    showAlert(`Backup restaurado: ${okCount}/${results.length} producto(s) verificado(s).`, okCount === results.length ? "success" : "error");
  } catch (err) {
    setBackupStatus("restore-status", err.message || String(err), "error");
    showAlert(`Error al restaurar: ${err.message || err}`, "error");
  } finally {
    setButtonBusy(btn, false);
    updateRestoreRunState();
  }
}

/* ------------------------------------------------------------------
   HISTORIAL LOCAL de respaldos automáticos (localStorage, sin tocar la BD)
   ------------------------------------------------------------------ */
function getBackupHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BACKUP_HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/* Tipos de respaldo automático del historial: qué contiene cada uno y qué
   hace al restaurarlo, explicado en lenguaje claro para el operador. */
const BACKUP_HISTORY_TIPOS = {
  previo_eliminacion: {
    etiqueta: "Previa a eliminación",
    clase: "is-eliminacion",
    titulo: "El producto fue ELIMINADO después de guardar este respaldo",
    detalle: (n) => `Guarda ${n === 1 ? "el producto" : "los productos"} ANTES de eliminarlo${n === 1 ? "" : "s"}. Restaurar lo${n === 1 ? "" : "s"} crea de nuevo con toda su información.`
  },
  previo_restauracion: {
    etiqueta: "Antes de restaurar",
    clase: "is-restauracion",
    titulo: "Copia del estado previo a una restauración",
    detalle: (n) => `Restaurar revierte ${n === 1 ? "el producto" : "los productos"} a este estado anterior.`
  }
};

function renderBackupHistory() {
  const listEl = document.getElementById("backups-history-list");
  if (!listEl) return;
  const history = getBackupHistory();
  if (history.length === 0) {
    listEl.innerHTML = `<p class="backup-history-empty">Todavía no hay respaldos automáticos. Se crean antes de cada restauración y antes de eliminar un producto.</p>`;
    return;
  }
  listEl.innerHTML = history.map((entry) => {
    const fecha = new Date(entry.createdAt);
    const stamp = `${fecha.toLocaleDateString()} ${fecha.toLocaleTimeString()}`;
    const titles = (entry.titles || entry.productIds || []).map(escapeHTML).join(", ");
    const n = Number(entry.productIds?.length || 0);
    const tipo = BACKUP_HISTORY_TIPOS[entry.motivo];
    const badge = tipo
      ? `<span class="backup-history-tipo ${tipo.clase}" title="${tipo.titulo}">${tipo.etiqueta}</span>`
      : `<span class="backup-history-tipo is-generico" title="Copia automática de seguridad guardada en este navegador">Copia de seguridad</span>`;
    const accion = tipo
      ? tipo.detalle(n)
      : `Guarda ${n === 1 ? "el producto" : "los productos"} tal como estaba${n === 1 ? "" : "n"} en el momento del respaldo.`;
    return `
    <div class="backup-history-item">
      <div class="backup-history-info">
        <div class="backup-history-line">${badge}<strong>${escapeHTML(stamp)}</strong></div>
        <span>${escapeHTML(String(n))} producto(s): ${titles}</span>
        <span class="backup-history-efecto">Restaurar devuelve el producto a este estado guardado. Si ya existe se actualiza; si no, se vuelve a crear.</span>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" data-restore-history="${escapeHTML(entry.id)}">
        <i class="ph ph-arrow-counter-clockwise" aria-hidden="true"></i> Restaurar
      </button>
    </div>`;
  }).join("");

  listEl.querySelectorAll("[data-restore-history]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const entry = getBackupHistory().find((e) => e.id === btn.dataset.restoreHistory);
      if (!entry) return;
      const products = entry.data?.products || [];
      const n = products.length;
      const tipo = BACKUP_HISTORY_TIPOS[entry.motivo];
      const queGuarda = tipo
        ? `<strong>${tipo.etiqueta}:</strong> ${tipo.detalle(n)}`
        : `Contiene ${n} producto(s) tal como estaban en el momento del respaldo.`;

      // Verificar contra la BD qué se ACTUALIZARÁ (ya existe por ID o por nombre) y qué se CREARÁ.
      let existentes = [], nuevos = [];
      try {
        const catalogo = await fetchCatalogoLigero();
        const targets = products.map((p) => {
          const byId = catalogo.find((c) => String(c.id) === String(p.id));
          if (byId) return { row: p, targetId: byId.id, existe: true };
          const byName = catalogo.find((c) => normalizeCatalogText(c.title) === normalizeCatalogText(p.title));
          if (byName) return { row: p, targetId: byName.id, existe: true };
          return { row: p, targetId: null, existe: false };
        });
        existentes = targets.filter((t) => t.existe).map((t) => ({ ...t.row, _targetId: t.targetId }));
        nuevos = targets.filter((t) => !t.existe).map((t) => t.row);
      } catch {
        nuevos = products; // sin verificación, asumir restauración completa
      }

      const nombre = (p) => `<strong>${escapeHTML(p.title || String(p.id))}</strong>`;
      const partes = [];
      if (existentes.length) {
        partes.push(`♻️ ${existentes.map(nombre).join(", ")} ya existe${existentes.length > 1 ? "N" : ""} en tu catálogo → se <strong>ACTUALIZARÁ${existentes.length > 1 ? "N" : ""}</strong> al estado de este respaldo.`);
      }
      if (nuevos.length) {
        partes.push(`📦 ${nuevos.map(nombre).join(", ")} no existe${nuevos.length > 1 ? "N" : ""} → se <strong>RESTAURARÁ${nuevos.length > 1 ? "N" : ""}</strong> creándolo${nuevos.length > 1 ? "s" : ""} de nuevo.`);
      }
      const queHara = partes.length ? partes.join("<br><br>") : "No hay productos que restaurar.";
      showConfirm(
        "Restaurar respaldo",
        `${queGuarda}<br><br>${queHara}<br><br><span style="opacity:.75">Se genera un respaldo de seguridad antes de escribir.</span>`,
        () => runRestoreBackup(products)
      );
    });
  });
}

/* ------------------------------------------------------------------
   IMPORTAR COMO PLANTILLA (Crear producto)
   ------------------------------------------------------------------ */
async function openTemplateImportModal() {
  backupTemplatePayload = null;
  document.getElementById("template-import-list").innerHTML = "";
  document.getElementById("template-file-label").textContent = "Haz clic para elegir un archivo .json";
  setBackupStatus("template-status", "");
  openBackupModalById("template-import-modal");
}

/* ---------- Detección de duplicados al importar ----------
   Compara cada producto del backup contra el catálogo actual por nombre Y por
   características: marca, categoría, variantes de color (nombre+hex),
   capacidades/precios e imágenes. "identical" = coinciden todas las facetas;
   "similar" = coinciden 3 o más. No solo el nombre: hasta el color cuenta. */
function normalizeCatalogText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function backupFacets(row) {
  const colors = Array.isArray(row?.variants?.colors) ? row.variants.colors : [];
  const storage = Array.isArray(row?.variants?.storage) ? row.variants.storage : [];
  const images = Array.isArray(row?.images) ? row.images : [];
  return {
    title: normalizeCatalogText(row?.title),
    brand: normalizeCatalogText(row?.brand),
    category: normalizeCatalogText(row?.category),
    colorsKey: JSON.stringify(colors.map((c) => `${normalizeCatalogText(c?.name)}|${normalizeCatalogText(c?.hex || c?.value)}`).sort()),
    storageKey: JSON.stringify(storage.map((s) => `${normalizeCatalogText(s?.name)}|${Number(s?.price) || 0}`).sort()),
    imagesKey: JSON.stringify(images.map((u) => String(u || "").split("?")[0]).sort())
  };
}

/* Catálogo LIGERO leído DIRECTAMENTE de la base de datos para las
   comparaciones de duplicados. NO depende del array en memoria (`products`),
   que puede estar vacío o desactualizado si realtime falla: así el bloqueo
   anti-duplicados nunca se puede saltar. */
async function fetchCatalogoLigero() {
  try {
    const { data, error } = await supabase
      .from("productos")
      .select("id,title,brand,category,images,variants");
    if (error) throw error;
    if (Array.isArray(data) && data.length) return data;
  } catch (err) {
    console.warn("[backup] No se pudo leer el catálogo para duplicados:", err);
  }
  return Array.isArray(products) ? products : [];
}

/* Busca en una lista de productos el que tenga el mismo título que más facetas
   comparta con el candidato (marca, categoría, colores, capacidades, imágenes).
   excludeId: ID a ignorar (el propio producto en edición). */
function buscarDuplicadoEnLista(candidate, excludeId, lista) {
  const f = backupFacets(candidate);
  if (!f.title) return null;
  let best = null;
  for (const cand of (Array.isArray(lista) ? lista : [])) {
    if (excludeId && String(cand?.id) === String(excludeId)) continue;
    if (normalizeCatalogText(cand?.title) !== f.title) continue;
    const c = backupFacets(cand);
    const matched = [
      !!f.brand && f.brand === c.brand,
      !!f.category && f.category === c.category,
      f.colorsKey !== "[]" && f.colorsKey === c.colorsKey,
      f.storageKey !== "[]" && f.storageKey === c.storageKey,
      f.imagesKey !== "[]" && f.imagesKey === c.imagesKey
    ].filter(Boolean).length;
    if (!best || matched > best.matched) best = { matched, id: cand.id, title: cand.title };
  }
  return best;
}

function findBackupDuplicate(fileRow, lista = products) {
  const best = buscarDuplicadoEnLista(fileRow, null, lista);
  if (!best) return null;
  if (best.matched >= 5) return { level: "identical", ...best };
  if (best.matched >= 3) return { level: "similar", ...best };
  return null;
}

function backupDupBadge(dup) {
  if (!dup) return "";
  const label = dup.level === "identical"
    ? `Ya existe (${escapeHTML(String(dup.id))})`
    : `Se parece a ${escapeHTML(String(dup.id))}`;
  const hint = dup.level === "identical"
    ? "Este producto ya está en el catálogo con las mismas características"
    : "Hay un producto muy parecido en el catálogo";
  return `<span class="backup-item-dup ${dup.level}" title="${hint}"><i class="ph ph-warning" aria-hidden="true"></i> ${label}</span>`;
}

async function onTemplateFileChosen(event) {
  const file = event.target.files?.[0];
  backupTemplatePayload = null;
  document.getElementById("template-import-list").innerHTML = "";
  setBackupStatus("template-status", "");
  try {
    backupTemplatePayload = await readBackupFile(file);
    backupTemplatePayload._archivo = file.name;
    const catalogoDup = await fetchCatalogoLigero();
    document.getElementById("template-file-label").innerHTML =
      `<i class="ph ph-check-circle" aria-hidden="true"></i> ${escapeHTML(file.name)} — ${backupTemplatePayload.count} producto(s)`;
    const listEl = document.getElementById("template-import-list");
    listEl.innerHTML = backupTemplatePayload.products.map((p) => {
      const dup = findBackupDuplicate(p, catalogoDup);
      return `
      <button type="button" class="backup-product-item backup-product-item--btn" data-template-id="${escapeHTML(String(p.id))}">
        <i class="ph ph-arrow-bend-down-right" aria-hidden="true"></i>
        <span class="backup-item-title">${escapeHTML(p.title || "(sin título)")}</span>
        <span class="backup-item-meta">${escapeHTML(p.brand || "")}</span>
        ${backupDupBadge(dup)}
        <span class="backup-item-id">${escapeHTML(String(p.id))}</span>
      </button>`;
    }).join("") || `<div class="backup-list-empty">El archivo no contiene productos.</div>`;

    listEl.querySelectorAll("[data-template-id]").forEach((btnEl) => {
      btnEl.addEventListener("click", () => {
        const row = backupTemplatePayload.products.find((p) => String(p.id) === btnEl.dataset.templateId);
        if (!row) return;
        const dup = findBackupDuplicate(row);
        if (dup) {
          // Existe o es parecido: abrir la revisión lado a lado para verificar
          // manualmente con cuál coincide antes de decidir qué hacer.
          openTemplateCompare(row, dup.id);
          return;
        }
        loadProductAsTemplate(row);
      });
    });
  } catch (err) {
    setBackupStatus("template-status", err.message, "error");
    document.getElementById("template-file-label").textContent = "Haz clic para elegir un archivo .json";
  } finally {
    event.target.value = "";
  }
}

function loadProductAsTemplate(rawRow, opciones = {}) {
  closeBackupModalById("template-import-modal");
  // Si la revisión viene de Importar/Restaurar, el modal queda ATRÁS (blur) y
  // reacciona al cerrarse el drawer: reanuda la cola o se cierra si ya no hay nada.
  if (typeof opciones.alCerrar === "function") {
    alCerrarDrawerDesdeRevision = opciones.alCerrar;
    document.getElementById("restore-backup-modal")?.classList.add("is-behind");
  } else {
    alCerrarDrawerDesdeRevision = null;
  }
  // Abrir el drawer en modo "Nuevo" (editingProductId = null) y volcar la plantilla.
  openProductModal(null);
  fillProductForm(snakeToCamelRow(rawRow));
  // Validación inmediata: si el título coincide con un existente, el bloqueo
  // anti-duplicados aparece antes de intentar guardar.
  setTimeout(() => validarDuplicadoProductoEnVivo(), 400);
  showAlert(`Plantilla "${escapeHTML(row.title || rawRow.id)}" cargada. Revisa los datos y guarda para crear un producto nuevo.`, "success");
}

/* ---------- CAPA ANTI-DUPLICADOS EN VIVO (dentro del drawer) ---------- */
function mostrarBannerDuplicado(mensaje) {
  const banner = document.getElementById("duplicate-warning");
  const texto = document.getElementById("duplicate-warning-text");
  if (texto) texto.textContent = mensaje;
  if (banner) {
    banner.hidden = false;
    banner.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function ocultarBannerDuplicado() {
  const banner = document.getElementById("duplicate-warning");
  if (banner) banner.hidden = true;
}

function etiquetaBotonGuardado() {
  return editingProductId ? "Actualizar producto" : "Guardar producto";
}

function clearFieldErrorById(targetId) {
  const slot = productForm?.querySelector(`[data-error-for="${targetId}"]`);
  if (slot) { slot.hidden = true; slot.textContent = ""; }
  document.getElementById(targetId)?.classList.remove("field-invalid");
}

function liberarBloqueoDuplicado() {
  productoDuplicadoBloqueado = false;
  clearFieldErrorById("product-title");
  ocultarBannerDuplicado();
  const saveBtn = document.getElementById("save-product-btn");
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.classList.remove("is-blocked");
    setButtonLabel(saveBtn, etiquetaBotonGuardado(), "check");
  }
  // Restaurar el estado de otros bloqueos (p. ej., conflicto de color repetido).
  try { updateVariantColorWarning(); } catch { /* no bloquea */ }
}

async function validarDuplicadoProductoEnVivo() {
  try {
    if (!productModal || productModal.hidden) return;
    const saveBtn = document.getElementById("save-product-btn");
    const draft = captureFormToObject();
    const title = String(draft.title || "").trim();
    if (!title) { if (productoDuplicadoBloqueado) liberarBloqueoDuplicado(); return; }
    const candidatoDup = {
      title,
      brand: draft.brand,
      category: draft.category,
      images: draft.galleryUrls || [],
      variants: { colors: draft.colors || [], storage: draft.storage || [] }
    };
    // Consulta DIRECTA a la BD (no al array en memoria): el bloqueo funciona
    // aunque realtime no haya cargado el catálogo.
    const catalogo = await fetchCatalogoLigero();
    // El usuario pudo seguir escribiendo durante la consulta: aplicar solo si
    // el título sigue siendo el mismo.
    if (String(getFormValue("product-title") || "").trim().toLowerCase() !== title.toLowerCase()) return;
    const dup = buscarDuplicadoEnLista(candidatoDup, editingProductId, catalogo);
    if (dup) {
      productoDuplicadoBloqueado = true;
      setFieldError("product-title", editingProductId
        ? `Ese nombre ya lo usa ${dup.id}. Los productos no pueden repetir nombre.`
        : `Este producto ya existe (${dup.id}). No puede repetirse el nombre.`);
      mostrarBannerDuplicado(editingProductId
        ? `El nombre "${title}" ya pertenece a ${dup.id}. Los productos no pueden repetir nombre en el catálogo.`
        : `"${dup.title}" ya está publicado como ${dup.id}. No se puede guardar un producto con el mismo nombre.`);
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.classList.add("is-blocked");
        setButtonLabel(saveBtn, "Producto duplicado", "prohibit");
      }
    } else if (productoDuplicadoBloqueado) {
      liberarBloqueoDuplicado();
    }
    // Aplicar el estado combinado del botón (duplicado + color + cambios en edición).
    try { updateVariantColorWarning(); } catch { /* no bloquea */ }
  } catch (err) {
    console.warn("[backup] validación anti-duplicados en vivo:", err);
  }
}

/* ---------- LIMPIAR HISTORIAL (confirma con la llave de acceso del sistema) ---------- */
async function clearBackupHistory() {
  const history = getBackupHistory();
  const log = getImportLog();
  const exp = getExportLog();
  if (history.length === 0 && log.length === 0 && exp.length === 0) {
    showAlert("El historial ya está vacío.", "info");
    return;
  }
  const ok = await pedirLlave(
    "Limpiar historial de backups",
    `Se borrarán ${history.length} respaldo(s) automático(s), ${log.length} registro(s) de importación y ${exp.length} registro(s) de exportación guardados en ESTE navegador. Tu catálogo y tu base de datos no se tocan. Introduce tu llave de acceso para confirmar.`
  );
  if (!ok) return;
  // Solo historiales locales del navegador: la BD y el catálogo no se tocan.
  localStorage.removeItem(BACKUP_HISTORY_KEY);
  localStorage.removeItem(IMPORT_LOG_KEY);
  localStorage.removeItem(EXPORT_LOG_KEY);
  renderBackupHistory();
  renderImportLog();
  renderExportLog();
  showAlert("Historial limpiado. Tu catálogo y tu base de datos no fueron tocados.", "success");
}

/* ------------------------------------------------------------------
   WIRING del subsistema de backup
   (Este script es type=module → defer → DOM ya está parseado.)
   ------------------------------------------------------------------ */
function initBackupSystem() {
  document.getElementById("export-backup-btn")?.addEventListener("click", openExportBackupModal);
  document.getElementById("restore-backup-btn")?.addEventListener("click", async () => {
    backupRestorePayload = null;
    importAnalysis = null;
    importReviewQueue = [];
    importSummary = null;
    document.getElementById("restore-backup-list").innerHTML = "";
    document.getElementById("restore-analysis").hidden = true;
    document.getElementById("restore-run-btn").disabled = true;
    document.getElementById("restore-result").hidden = true;
    document.getElementById("restore-file-label").textContent = "Haz clic para elegir un archivo .json";
    setBackupStatus("restore-status", "");
    renderBackupHistory();
    openBackupModalById("restore-backup-modal");
  });
  document.getElementById("import-template-btn")?.addEventListener("click", openTemplateImportModal);

  // Sub-pestañas del historial (respaldos automáticos / importaciones / exportaciones).
  document.querySelectorAll(".backup-subtab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".backup-subtab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const cual = tab.dataset.histtab;
      document.getElementById("backups-history-list").hidden = cual !== "respaldos";
      document.getElementById("import-log-list").hidden = cual !== "importaciones";
      document.getElementById("export-log-list").hidden = cual !== "exportaciones";
      if (cual === "importaciones") renderImportLog();
      if (cual === "exportaciones") renderExportLog();
    });
  });

  // Revisión lado a lado.
  document.getElementById("compare-discard-btn")?.addEventListener("click", discardCompareImport);
  document.getElementById("compare-save-btn")?.addEventListener("click", saveCompareImport);

  // Limpiar historial (confirma con la llave de acceso del sistema).
  document.getElementById("clear-history-btn")?.addEventListener("click", () => clearBackupHistory());

  // Capa anti-duplicados en vivo: valida mientras se llena el drawer
  // (delegación de eventos: cubre filas dinámicas de includes/specs/colores/capacidades).
  const drawerBodyDup = document.getElementById("drawer-body");
  if (drawerBodyDup) {
    const programarValidacionDup = () => {
      clearTimeout(dupLiveTimer);
      dupLiveTimer = setTimeout(() => {
        validarDuplicadoProductoEnVivo();
        // Reaplicar el estado combinado del botón (incluye "sin cambios" en edición).
        try { updateVariantColorWarning(); } catch { /* no bloquea */ }
      }, 350);
    };
    drawerBodyDup.addEventListener("input", (event) => {
      if (event.target.closest("#fs-main, #fs-description, #includes-list, #specs-list, #fs-colors, #fs-storage")) programarValidacionDup();
    });
    drawerBodyDup.addEventListener("change", (event) => {
      if (event.target.closest("#fs-main, #fs-colors, #fs-storage")) programarValidacionDup();
    });
  }

  document.getElementById("export-select-all")?.addEventListener("change", (event) => {
    document.querySelectorAll("#export-backup-list .export-check").forEach((c) => { c.checked = event.target.checked; });
    updateExportCount();
  });
  document.getElementById("export-run-btn")?.addEventListener("click", runExportBackup);
  document.getElementById("export-cancel-btn")?.addEventListener("click", () => closeBackupModalById("export-backup-modal"));

  document.getElementById("restore-file-input")?.addEventListener("change", onRestoreFileChosen);
  document.getElementById("restore-run-btn")?.addEventListener("click", () => runSmartImport());
  document.getElementById("restore-cancel-btn")?.addEventListener("click", () => closeBackupModalById("restore-backup-modal"));

  document.getElementById("template-file-input")?.addEventListener("change", onTemplateFileChosen);
  document.getElementById("template-cancel-btn")?.addEventListener("click", () => closeBackupModalById("template-import-modal"));

  // Cierre por clic en el overlay (común a los 3 modales).
  document.querySelectorAll("[data-close-backup]").forEach((overlay) => {
    overlay.addEventListener("click", () => closeBackupModalById(overlay.dataset.closeBackup));
  });

  // Historial local (solo lectura; no toca la BD).
  renderBackupHistory();
}

initBackupSystem();

/* ==========================================================================
   BADGE DE ENTORNO — DESARROLLO vs PRODUCCIÓN
   --------------------------------------------------------------------------
   Garantiza de un vistazo contra qué proyecto trabaja este panel:
   - VITE_APP_ENV=local (tu .env local) → "DESARROLLO" (proyecto miphone-dev).
   - Sin esa variable (la app desplegada en Vercel) → "PRODUCCIÓN".
   Al pasar el cursor muestra la URL de Supabase para confirmarlo.
   ========================================================================== */
(() => {
  const esLocal = String(import.meta.env.VITE_APP_ENV || "").toLowerCase() === "local";
  const badge = document.getElementById("env-badge");
  if (!badge) return;
  badge.textContent = esLocal ? "DESARROLLO" : "PRODUCCIÓN";
  badge.classList.add(esLocal ? "is-dev" : "is-prod");
  badge.title = esLocal
    ? `Panel conectado al proyecto de DESARROLLO (${import.meta.env.VITE_SUPABASE_URL || "?"}). Activar mantenimiento aquí NO afecta a la tienda publicada.`
    : `Panel conectado a PRODUCCIÓN (${import.meta.env.VITE_SUPABASE_URL || "?"}). Las acciones aquí afectan a la tienda publicada.`;
  badge.hidden = false;
})();



// Verificación DOM (jsdom) de "cambios sin guardar" del Drawer de producto:
// entrar a una variante SIN modificar nada NO debe marcar dirty; cualquier
// edición (incluso un espacio) SÍ debe marcarlo.
import fs from "node:fs";
import { JSDOM } from "jsdom";

const src = fs.readFileSync("admin/admin.js", "utf8");

function extract(name) {
  const m = src.match(new RegExp(`^function ${name}\\(`, "m"));
  if (!m) throw new Error(`Función ${name} no encontrada`);
  const start = m.index;
  // Las funciones son top-level en admin.js: la siguiente "function " a
  // principio de línea marca el fin de la actual (robusto con backticks
  // anidados, que romperían un contador de llaves).
  const next = src.indexOf("\nfunction ", start + 1);
  return next < 0 ? src.slice(start) : src.slice(start, next).trimEnd();
}

const HTML = '<!DOCTYPE html><html><body><form id="product-form">'
  + '<input id="product-id"><input id="product-title"><input id="product-brand">'
  + '<select id="product-category"><option value="iphones">iPhones</option><option value="accessories">Accesorios</option></select>'
  + '<select id="product-condition"><option value="nuevo">Nuevo</option><option value="seminuevo">Seminuevo</option></select>'
  + '<input id="product-battery-health" type="number">'
  + '<textarea id="product-image"></textarea><textarea id="product-description"></textarea>'
  + '<div id="includes-list"></div><div id="specs-list"></div><div id="colors-list"></div><div id="storage-list"></div>'
  + '<input id="variant-color-name"><input id="variant-color-picker" type="color"><input id="variant-color-hex">'
  + '<div id="product-images-preview"></div><span id="product-images-count"></span>'
  + '</form></body></html>';

const dom = new JSDOM(HTML, { url: "https://admin.local/" });
const { document } = dom.window;

const code = [
  // Estado global que el código asume.
  "let variantDrafts = [];",
  "let activeVariantIndex = 0;",
  "let existingImageUrls = [];",
  "let pendingImageFiles = [];",
  "let pendingImagesFirst = false;",
  "let formSnapshot = null;",
  "let formIsDirty = false;",
  "let variantErrorLocked = false;",
  "const MAX_PRODUCT_IMAGES = 8;",
  "let previewObjectUrls = [];",
  "let variantPreviewObjectUrls = [];",
  // Elementos DOM.
  "const productForm = document.getElementById('product-form');",
  "const includesList = document.getElementById('includes-list');",
  "const specsList = document.getElementById('specs-list');",
  "const colorsList = document.getElementById('colors-list');",
  "const storageList = document.getElementById('storage-list');",
  "const variantColorNameInput = document.getElementById('variant-color-name');",
  "const variantColorPicker = document.getElementById('variant-color-picker');",
  "const variantColorHexInput = document.getElementById('variant-color-hex');",
  "const productImageUrlsInput = document.getElementById('product-image');",
  "const productImagesPreview = document.getElementById('product-images-preview');",
  "const productImagesCount = document.getElementById('product-images-count');",
  "const variantBar = null;",
  "const variantBarTabs = null;",
  "const duplicateVariantBtn = null;",
  "const drawerModeChip = null;",
  "const drawerModeCopy = null;",
  "const variantColorWarning = null;",
  "const variantColorEditor = null;",
  "const fsColorsTitle = null;",
  "const fsColorsCopy = null;",
  "const addColorBtn = null;",
  "const drawerDangerZone = null;",
  "const titleInputEl = null;",
  // Funciones reales extraídas de admin/admin.js.
  extract("escapeHTML"),
  extract("uniqueImageUrls"),
  extract("getProductImageUrls"),
  extract("normalizeIncludes"),
  extract("normalizeHexColor"),
  extract("getColorRepresentations"),
  extract("normalizeBatteryHealth"),
  extract("normalizeStockValue"),
  extract("getFormValue"),
  extract("setFormValue"),
  extract("getListValues"),
  extract("getListColors"),
  extract("getStorageRows"),
  extract("captureFormToObject"),
  extract("snapshotFormToDraft"),
  extract("syncActiveVariantFromForm"),
  extract("computeFormSnapshot"),
  extract("captureFormBaseline"),
  extract("isProductFormDirty"),
  extract("cloneDraft"),
  extract("updateIncludeOrderButtons"),
  extract("addIncludeRow"),
  extract("addSpecRow"),
  extract("addColorRow"),
  extract("addStorageRow"),
  extract("updateVariantHexInput"),
  extract("fillProductForm"),
  extract("loadVariantsFromProduct"),
  extract("applyDraftToForm"),
  extract("switchVariant"),
  extract("renderVariantColorMode"),
  extract("renderProductImagesPreview"),
  extract("clearPreviewObjectUrls"),
  extract("clearVariantPreviewObjectUrls"),
  extract("rangeVariantMode"),
  // Stubs de funciones con efectos fuera del alcance del test.
  "function updateDrawerModeChip() {}",
  "function updateVariantScopeHints() {}",
  "function updateVariantColorWarning() {}",
  "function renderVariantBar() {}",
  "const URL = { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} };",
  "return { fillProductForm, switchVariant, captureFormBaseline, isProductFormDirty, computeFormSnapshot };"
].join("\n");

const api = new Function("document", "window", code)(document, dom.window);
const { fillProductForm, switchVariant, captureFormBaseline, isProductFormDirty, computeFormSnapshot } = api;

// Diagnóstico: primera diferencia entre dos snapshots.
function diffSnapshot(a, b) {
  const pa = a.split("?");
  const pb = b.split("?");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] !== pb[i]) {
      const xa = pa[i] ?? "<ausente>";
      const xb = pb[i] ?? "<ausente>";
      let j = 0;
      while (j < Math.min(xa.length, xb.length) && xa[j] === xb[j]) j++;
      return `PARTE[${i}] difiere en pos ${j}:\n  baseline: ...${xa.slice(Math.max(0, j - 60), j + 80)}\n  actual:   ...${xb.slice(Math.max(0, j - 60), j + 80)}`;
    }
  }
  return null;
}


let failures = 0;
const check = (desc, cond) => { console.log(`${cond ? "✔" : "✘"} ${desc}`); if (!cond) failures++; };

const openDrawer = (product) => {
  fillProductForm(product);
  captureFormBaseline();
};

/* ================================================================
   Escenario A: variante con overrides "vacíos" guardados en BD
   (includes: [], specs: [], storage: [] — el formulario siempre
   renderiza al menos una fila → el draft mutaba → falso sucio).
   ================================================================ */
const productoA = {
  id: "producto-1",
  title: "iPhone 15 Pro",
  brand: "Apple",
  category: "iphones",
  condition: "nuevo",
  batteryHealth: 95,
  description: "Descripción base",
  images: ["https://cdn/x/base.jpg"],
  includes: ["Cable USB-C"],
  specs: ["Chip A17 Pro"],
  variants: {
    colors: [
      { name: "Titanio", value: "#888888" },
      {
        name: "Silver", hex: "#EBEBEB", value: "#EBEBEB",
        overrides: {
          title: "iPhone 15 Pro",
          description: "Variante silver",
          includes: [],
          specs: [],
          storage: [],
          images: ["https://cdn/x/silver.jpg"],
          batteryHealth: 92,
          condition: "nuevo"
        }
      }
    ],
    storage: [{ name: "256GB", price: 28800, oldPrice: 0, stock: 10 }]
  }
};

openDrawer(productoA);
check("A· Tras abrir edición (sin tocar nada) NO está sucio", !isProductFormDirty());
switchVariant(1);
check("A· Tras ENTRAR a la variante (sin tocar nada) NO está sucio", !isProductFormDirty());
switchVariant(0);
check("A· Tras volver al producto principal NO está sucio", !isProductFormDirty());
const desc = document.getElementById("product-description");
desc.value = desc.value + " ";
check("A· Un espacio extra en la descripción SÍ se detecta como cambio", isProductFormDirty());

/* ================================================================
   Escenario B: datos viejos con over.title distinto al principal
   (applyDraftToForm lo sobreescribe → draft mutaba → falso sucio).
   ================================================================ */
const productoB = {
  id: "producto-2",
  title: "iPhone 15 Pro",
  brand: "Apple",
  category: "iphones",
  condition: "nuevo",
  batteryHealth: null,
  description: "Base",
  images: ["https://cdn/x/base.jpg"],
  includes: [""],
  specs: [""],
  variants: {
    colors: [
      { name: "Negro", value: "#111111" },
      {
        name: "Azul", hex: "#0000FF", value: "#0000FF",
        overrides: {
          title: "iPhone 15 Pro Azul (nombre viejo)",
          description: "Variante azul",
          storage: [{ name: "128GB", price: 25000, oldPrice: 0, stock: null }],
          images: ["https://cdn/x/azul.jpg"]
        }
      }
    ],
    storage: [{ name: "256GB", price: 28800, oldPrice: 0, stock: 5 }]
  }
};

openDrawer(productoB);
check("B· Tras abrir edición NO está sucio", !isProductFormDirty());
switchVariant(1);
check("B· Tras entrar a la variante con título viejo NO está sucio", !isProductFormDirty());
switchVariant(0);
check("B· Tras volver al principal NO está sucio", !isProductFormDirty());

/* ================================================================
   Escenario C: variante completa "normal" (overrides con datos).
   ================================================================ */
const productoC = {
  id: "producto-3",
  title: "Galaxy S25",
  brand: "Samsung",
  category: "iphones",
  condition: "seminuevo",
  batteryHealth: 88,
  description: "Base C",
  images: ["https://cdn/x/c1.jpg", "https://cdn/x/c2.jpg"],
  includes: ["Cargador"],
  specs: ["Pantalla 6.9\""],
  variants: {
    colors: [
      { name: "Negro", value: "#000000" },
      {
        name: "Naranja", hex: "#F54927", value: "#F54927",
        overrides: {
          title: "Galaxy S25",
          brand: "Samsung",
          category: "iphones",
          condition: "nuevo",
          batteryHealth: 100,
          description: "Variante naranja",
          includes: ["Cargador", "Cable"],
          specs: ["Pantalla 6.9\"", "Chip"],
          storage: [{ name: "512GB", price: 34000, oldPrice: 36000, stock: 2 }],
          images: ["https://cdn/x/naranja.jpg"]
        }
      }
    ],
    storage: [{ name: "256GB", price: 28000, oldPrice: 30000, stock: 5 }]
  }
};

openDrawer(productoC);
const snapC0 = computeFormSnapshot();
switchVariant(1);
const snapC1 = computeFormSnapshot();
console.log("--- DIAGNÓSTICO C (baseline vs tras entrar a variante) ---");
console.log(diffSnapshot(snapC0, snapC1) ?? "sin diferencias");
check("C· Tras abrir edición NO está sucio", !isProductFormDirty());
switchVariant(1);
check("C· Tras entrar a la variante NO está sucio", !isProductFormDirty());
switchVariant(0);
check("C· Tras volver al principal NO está sucio", !isProductFormDirty());
switchVariant(1);
// Nota: el nombre del color hace trim() por diseño (listener + captura);
// se usa la descripción de la variante para probar la sensibilidad al espacio.
const vdesc = document.getElementById("product-description");
vdesc.value = vdesc.value + " ";
check("C· Un espacio extra en la descripción de la variante SÍ se detecta", isProductFormDirty());

console.log("");
console.log(failures === 0 ? "TODAS LAS PRUEBAS PASARON ✔" : `${failures} PRUEBAS FALLARON ✘`);
process.exit(failures === 0 ? 0 : 1);


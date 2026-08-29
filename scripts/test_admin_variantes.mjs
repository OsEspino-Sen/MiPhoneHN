// Prueba del flujo de variantes del ADMIN: copia íntegra y alternancia.
import fs from "node:fs";

const src = fs.readFileSync("admin/admin.js", "utf8");

function extract(name) {
  const idx = src.indexOf(`function ${name}(`);
  if (idx < 0) throw new Error(`Función ${name} no encontrada`);
  const start = src.indexOf("{", idx);
  let depth = 0;
  let inStr = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (c === inStr && src[i - 1] !== "\\") inStr = null; continue; }
    if (c === "'" || c === "\"" || c === "`") { inStr = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return src.slice(idx, i + 1); }
  }
  throw new Error(`Llaves desbalanceadas en ${name}`);
}

const code = [
  extract("normalizeHexColor"),
  extract("cloneDraft"),
  extract("variantColorConflictIn"),
  extract("allVariantColorConflictsIn"),
  "return { cloneDraft, variantColorConflictIn, allVariantColorConflictsIn };"
].join("\n");

const fns = new Function(code)();

let failures = 0;
const check = (desc, cond) => { console.log(`${cond ? "✔" : "✘"} ${desc}`); if (!cond) failures++; };

/* Escenario: el usuario llena el producto principal y pulsa "Agregar variante".
   Se copia TODA la información (copia íntegra) a la variante, que luego se
   edita de forma independiente. */
const principal = {
  isVariant: false, colorName: "", hex: "#cccccc",
  title: "Samsung Galaxy S25 Ultra", brand: "Samsung", category: "galaxy", condition: "nuevo",
  batteryHealth: "100", description: "Descripción base",
  galleryUrls: ["base-1.jpg", "base-2.jpg"], pendingFiles: [{ name: "f.png" }],
  includes: ["Cargador", "Cable"], specs: ["Pantalla 6.9\"", "Chip"],
  storage: [{ name: "256GB", price: 28000, oldPrice: 30000, stock: "5" }],
  colors: [{ name: "Negro", value: "#111" }]
};

// El botón crea una copia íntegra (cloneDraft) y luego se edita como variante.
const variante = fns.cloneDraft(principal);
variante.title = "Samsung S25 Ultra (Edición Naranja)";
variante.brand = "Samsung";         // copiado
variante.category = "galaxy";
variante.condition = "seminuevo";   // cambio
variante.colorName = "Naranja";     // color nuevo
variante.hex = "#F54927";
variante.galleryUrls = ["naranja-1.jpg"]; // galería propia
variante.storage = [{ name: "512GB", price: 34000, oldPrice: 0, stock: "2" }];

/* 1. El principal NO fue mutado al crear la variante */
check("El producto principal conserva su título", principal.title === "Samsung Galaxy S25 Ultra");
check("El producto principal conserva su galería", principal.galleryUrls.join("|") === "base-1.jpg|base-2.jpg");
check("El producto principal conserva sus capacidades", principal.storage[0].name === "256GB" && principal.storage[0].price === 28000);

/* 2. La variante copió TODA la información del principal */
check("La variante copia marca/categoría/condición del principal", variante.brand === "Samsung" && variante.category === "galaxy");
check("La variante copió descripción, includes y specs", variante.description === "Descripción base" && variante.includes.join(",") === "Cargador,Cable" && variante.specs.join(",") === 'Pantalla 6.9",Chip');
check("La variante copió los archivos pendientes", variante.pendingFiles.length === 1 && variante.pendingFiles[0].name === "f.png");

/* 3. La variante tiene datos independientes */
check("La variante puede tener título, galería, capacidades y condición distintos", variante.title === "Samsung S25 Ultra (Edición Naranja)" && variante.galleryUrls[0] === "naranja-1.jpg" && variante.storage[0].name === "512GB" && variante.storage[0].price === 34000 && variante.condition === "seminuevo");
check("La variante tiene color propio", variante.colorName === "Naranja" && variante.hex === "#F54927");

/* 4. Cada variante mantiene su propio estado al alternar:
   estar en la variante, volver al principal → se restauran sus datos completos */
const principal2 = fns.cloneDraft(principal);
const variante2 = fns.cloneDraft(principal2);
variante2.title = "Edición Roja";
variante2.hex = "#e11";
variante2.storage = [{ name: "128GB", price: 22000, oldPrice: 0, stock: "1" }];
// Cambio a la variante, luego regreso al principal.
const principalRestaurado = fns.cloneDraft(principal2);
check("Al regresar al Producto principal se restauran sus datos completos", principalRestaurado.title === "Samsung Galaxy S25 Ultra" && principalRestaurado.storage[0].price === 28000 && principalRestaurado.condition === "nuevo" && principalRestaurado.galleryUrls[0] === "base-1.jpg");

/* 5. "Duplicar variante" copia TODA la ficha y conserva el nombre del producto */
const baseDelDup = { isVariant: false, title: "iPhone 15 Pro", brand: "Apple", category: "iphones", description: "Base", galleryUrls: ["base.jpg"], includes: ["Cable"], specs: ["Chip"], storage: [{ name: "128GB", price: 25000, oldPrice: 0, stock: "3" }], colors: [], uploadedUrls: ["subida.jpg"] };
const negro = fns.cloneDraft(baseDelDup);
negro.isVariant = true; negro.colorName = "Negro"; negro.hex = "#111"; negro.galleryUrls = ["negro.jpg"]; negro.storage = [{ name: "512GB", price: 30000, oldPrice: 0, stock: "1" }];
// Acción del botón Duplicar variante: copia íntegra con el MISMO nombre.
const duplicado = fns.cloneDraft(negro);
duplicado.isVariant = true; // conserva el color de la original (Negro) → bloquea el guardado
check("Duplicar variante conserva el MISMO nombre del producto", duplicado.title === "iPhone 15 Pro" && duplicado.title === negro.title);
check("Duplicar variante copia toda la ficha (galería, capacidades, archivos)", duplicado.galleryUrls[0] === "negro.jpg" && duplicado.storage[0].name === "512GB" && duplicado.uploadedUrls[0] === "subida.jpg");
check("Duplicar variante CONSERVA el color de la original (conflicto→se bloquea guardar)", duplicado.colorName === "Negro" && duplicado.hex === "#111");
check("Duplicar variante genera conflicto de color al instante (variante vs variante)", fns.variantColorConflictIn([baseDelDup, negro, duplicado], duplicado)?.kind === "variant");

/* 6. Validación de colores únicos por producto (regla: 1 variante = 1 color) */
const draftsValidos = [
  { isVariant: false, title: "iPhone 15 Pro", colors: [{ name: "Estándar", value: "#ccc" }] },
  { isVariant: true, colorName: "Negro", title: "iPhone 15 Pro" },
  { isVariant: true, colorName: "Azul", title: "iPhone 15 Pro" },
  { isVariant: true, colorName: "Blanco", title: "iPhone 15 Pro" }
];
check("Colores distintos: no hay conflicto en la variante activa", fns.variantColorConflictIn(draftsValidos, draftsValidos[1]) === null);
check("Colores distintos: no hay conflictos globales", fns.allVariantColorConflictsIn(draftsValidos).any === false);

/* 6b. Duplicar Negro y mantener el color → debe bloquearse el guardado */
const draftsConDuplicado = [...draftsValidos, { isVariant: true, colorName: "Negro", title: "iPhone 15 Pro" }];
const duplicada = draftsConDuplicado[draftsConDuplicado.length - 1];
const conflict = fns.variantColorConflictIn(draftsConDuplicado, duplicada);
check("Duplicado de color detectado (variante vs variante)", conflict !== null && conflict.kind === "variant" && conflict.colorName === "Negro");
const globalDup = fns.allVariantColorConflictsIn(draftsConDuplicado);
check("Conflicto global detectado (any=true)", globalDup.any === true && globalDup.duplicateVariants.length === 1 && globalDup.duplicateVariants[0].colorName === "Negro");

/* 6c. Variante que "calca" un color base del producto principal → conflicto */
const draftsVsBase = [
  { isVariant: false, title: "iPhone 15 Pro", colors: [{ name: "Titanio", value: "#888" }] },
  { isVariant: true, colorName: "Negro", title: "iPhone 15 Pro" },
  { isVariant: true, colorName: "titanio", title: "iPhone 15 Pro" } // insensible a mayúsculas
];
const conflictBase = fns.variantColorConflictIn(draftsVsBase, draftsVsBase[2]);
check("Variante con color base repetido detectada (case-insensitive)", conflictBase !== null && conflictBase.kind === "base" && conflictBase.colorName === "Titanio");
check("Conflicto base también bloquea a nivel global", fns.allVariantColorConflictsIn(draftsVsBase).any === true);

/* 6d. Variante sin color (copia recién duplicada) no genera conflicto */
const draftsSinColor = [draftsValidos[0], draftsValidos[1], { isVariant: true, colorName: "", title: "iPhone 15 Pro" }];
check("Variante sin nombre de color no cuenta como conflicto (pero exige color al guardar)", fns.variantColorConflictIn(draftsSinColor, draftsSinColor[2]) === null && fns.allVariantColorConflictsIn(draftsSinColor).any === false);

/* 6e. Mismo CÓDIGO de color con nombres distintos → conflicto (no solo el nombre) */
const draftsMismoHex = [
  { isVariant: false, title: "iPhone 15 Pro", colors: [{ name: "Estándar", value: "#ccc" }] },
  { isVariant: true, colorName: "Blanco", hex: "#EBEBEB", title: "iPhone 15 Pro" },
  { isVariant: true, colorName: "Silver", hex: "#ebebeb", title: "iPhone 15 Pro" } // mismo hex, otro nombre
];
const conflictoHex = fns.variantColorConflictIn(draftsMismoHex, draftsMismoHex[2]);
check("Mismo hex (#EBEBEB) con nombres distintos detectado (variante vs variante, case-insensitive)", conflictoHex !== null && conflictoHex.kind === "variant" && conflictoHex.reason === "hex" && conflictoHex.colorName === "Blanco");
const globalHex = fns.allVariantColorConflictsIn(draftsMismoHex);
check("Conflicto global por hex detectado (any=true)", globalHex.any === true && globalHex.duplicateVariants.length === 1 && globalHex.duplicateVariants[0].reason === "hex");

/* 6f. Variante cuyo hex iguala un color BASE aunque el nombre difiera */
const draftsHexVsBase = [
  { isVariant: false, title: "iPhone 15 Pro", colors: [{ name: "Plata", value: "#EBEBEB" }] },
  { isVariant: true, colorName: "Gris claro", hex: "#EBEBEB", title: "iPhone 15 Pro" }
];
const conflictoHexBase = fns.variantColorConflictIn(draftsHexVsBase, draftsHexVsBase[1]);
check("Variante con hex de un color base detectada aunque el nombre difiera", conflictoHexBase !== null && conflictoHexBase.kind === "base" && conflictoHexBase.reason === "hex");
check("Conflicto hex vs base también bloquea a nivel global", fns.allVariantColorConflictsIn(draftsHexVsBase).any === true);

/* 6g. Hex distintos con nombres distintos → SIN conflicto */
const draftsSanos = [
  { isVariant: false, title: "iPhone 15 Pro", colors: [{ name: "Estándar", value: "#cccccc" }] },
  { isVariant: true, colorName: "Blanco", hex: "#EBEBEB", title: "iPhone 15 Pro" },
  { isVariant: true, colorName: "Silver", hex: "#C0C0C0", title: "iPhone 15 Pro" }
];
check("Colores con hex y nombres distintos: sin conflicto", fns.variantColorConflictIn(draftsSanos, draftsSanos[1]) === null && fns.allVariantColorConflictsIn(draftsSanos).any === false);

/* 6h. Nombre repetido Y hex repetido: se reporta una sola vez (por nombre) */
const draftsNombreYHex = [
  { isVariant: false, title: "iPhone 15 Pro", colors: [] },
  { isVariant: true, colorName: "Negro", hex: "#111111", title: "iPhone 15 Pro" },
  { isVariant: true, colorName: "Negro", hex: "#111111", title: "iPhone 15 Pro" }
];
const globalDoble = fns.allVariantColorConflictsIn(draftsNombreYHex);
check("Nombre+hex duplicados se reportan una sola vez", globalDoble.any === true && globalDoble.duplicateVariants.length === 1 && globalDoble.duplicateVariants[0].reason === "name");

console.log("");
console.log(failures === 0 ? "TODAS LAS PRUEBAS PASARON ✔" : `${failures} PRUEBAS FALLARON ✘`);
process.exit(failures === 0 ? 0 : 1);
// Prueba temporal de las funciones de guardado de variantes del ADMIN
// usando el código real de admin/admin.js (funciones puras sin DOM).
import fs from "node:fs";

const src = fs.readFileSync("admin/admin.js", "utf8");

function extract(name) {
  const idx = src.indexOf(`function ${name}(`);
  if (idx < 0) throw new Error(`Función ${name} no encontrada`);
  const start = src.indexOf("{", idx);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(idx, i + 1); }
  }
  throw new Error(`Llaves desbalanceadas en ${name}`);
}

const code = [
  "const MAX_PRODUCT_IMAGES = 8;",
  extract("normalizeBatteryHealth"),
  extract("normalizeStockValue"),
  extract("uniqueImageUrls"),
  extract("getColorRepresentations"),
  extract("buildVariantOverrides"),
  "return { buildVariantOverrides };"
].join("\n");

const fns = new Function(code)();
let failures = 0;
const check = (desc, cond) => { console.log(`${cond ? "✔" : "✘"} ${desc}`); if (!cond) failures++; };

/* 1. Variante con ficha completa */
const draftCompleta = {
  brand: "Samsung", category: "galaxy-s", condition: "seminuevo",
  batteryHealth: 92, description: "Desc variante",
  specs: ["Pantalla 6.9"], includes: ["Cargador"],
  images: ["a.jpg", "b.jpg", "a.jpg"], storage: [{ name: "256GB", price: 28500, oldPrice: 30000, stock: "3" }]
};
const o1 = fns.buildVariantOverrides(draftCompleta);
check("Ficha completa: todos los campos presentes", o1.brand === "Samsung" && o1.category === "galaxy-s" && o1.condition === "seminuevo");
check("Badge derivado de condición", o1.badge === "Seminuevo");
check("Batería normalizada", o1.batteryHealth === 92);
check("Imágenes deduplicadas con portada", o1.images.join("|") === "a.jpg|b.jpg" && o1.image === "a.jpg");
check("Capacidad con stock numérico", o1.storage[0].name === "256GB" && o1.storage[0].price === 28500 && o1.storage[0].stock === 3);

/* 2. Variante vacía → sin overrides (hereda del base, compatibilidad total) */
const draftVacia = { brand: "", category: "", condition: "", batteryHealth: "", description: "", specs: [], includes: [], images: [], storage: [] };
check("Variante vacía → overrides null (sin overrides en BD)", fns.buildVariantOverrides(draftVacia) === null);

/* 3. Variante con solo imágenes → overrides solo con imágenes */
const o3 = fns.buildVariantOverrides({ ...draftVacia, images: ["x.jpg"] });
check("Solo imágenes → overrides con images+image, nada más", o3.images.join("|") === "x.jpg" && o3.image === "x.jpg" && !o3.brand && !o3.storage);

/* 4. Stock vacío → null (compatibilidad con inventario indefinido) */
const o4 = fns.buildVariantOverrides({ ...draftVacia, storage: [{ name: "128GB", price: 100, oldPrice: 0, stock: "" }] });
check("Stock vacío → null", o4.storage[0].stock === null);

console.log("");
console.log(failures === 0 ? "TODAS LAS PRUEBAS DEL ADMIN PASARON ✔" : `${failures} PRUEBAS FALLARON ✘`);
process.exit(failures === 0 ? 0 : 1);
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
  extract("cloneDraft"),
  "return { cloneDraft };"
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

console.log("");
console.log(failures === 0 ? "TODAS LAS PRUEBAS PASARON ✔" : `${failures} PRUEBAS FALLARON ✘`);
process.exit(failures === 0 ? 0 : 1);
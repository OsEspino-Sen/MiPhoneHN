// Prueba temporal del resolvedor de variantes usando el código REAL de client/app.js.
import fs from "node:fs";

const src = fs.readFileSync("client/app.js", "utf8");

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
  "const FALLBACK_IMAGE = 'FALLBACK';",
  extract("uniqueStrings"),
  extract("optimizeCloudinaryUrl"),
  extract("getProductImages"),
  extract("resolveVariantProduct"),
  extract("normalizeNullableStock"),
  extract("getStorageOptions"),
  extract("getStockInfo"),
  extract("getVariantStorageOptions"),
  "return { resolveVariantProduct, getProductImages, getStorageOptions, getStockInfo, getVariantStorageOptions };"
].join("\n");

const fns = new Function(code)();

/* ---------- Datos de prueba ---------- */

// Producto ANTIGUO (sin overrides): debe comportarse exactamente igual que hoy.
const productoAntiguo = {
  id: "producto-1", title: "iPhone 15 Pro", brand: "Apple", category: "iphones",
  price: 25000, description: "Desc base", specs: ["Pantalla 6.1"], includes: ["Cable"],
  images: ["base1.jpg", "base2.jpg"],
  variants: {
    colors: [{ name: "Negro", value: "#111" }, { name: "Azul", value: "#00f" }],
    storage: [{ name: "128GB", price: 25000, oldPrice: 27000, stock: 5 }]
  }
};

// Producto NUEVO con variantes de ficha completa.
const productoConVariantes = {
  id: "producto-2", title: "Samsung Galaxy S25 Ultra", brand: "Samsung (base)", category: "galaxy-base",
  description: "Desc base", specs: ["Spec base"], includes: ["Incluye base"], images: ["base-1.jpg"],
  batteryHealth: 95, condition: "nuevo", badge: "Nuevo",
  variants: {
    colors: [
      { name: "Naranja", value: "#f54927", overrides: {
        brand: "Samsung", category: "galaxy-s", description: "Desc naranja",
        specs: ["Pantalla 6.9"], includes: ["Cargador naranja"],
        images: ["naranja-1.jpg", "naranja-2.jpg"],
        batteryHealth: 100, condition: "seminuevo", badge: "Seminuevo",
        storage: [{ name: "256GB", price: 28500, oldPrice: 30000, stock: 3 }]
      } },
      { name: "Negro", value: "#111", overrides: {
        brand: "Samsung Negra", category: "galaxy-n", description: "Desc negra",
        specs: ["512GB UFS"], includes: ["Funda"],
        images: ["negro-1.jpg"],
        storage: [{ name: "512GB", price: 34000, oldPrice: 0, stock: 0 }]
      } },
      { name: "Azul", value: "#17e" }  // sin overrides → hereda todo
    ],
    storage: [{ name: "128GB", price: 20000, oldPrice: 0, stock: 10 }]
  }
};

let failures = 0;
function check(desc, cond) {
  console.log(`${cond ? "✔" : "✘"} ${desc}`);
  if (!cond) failures++;
}

/* 1. Compatibilidad: producto antiguo se resuelve a sí mismo */
const r1 = fns.resolveVariantProduct(productoAntiguo, "Negro");
check("Producto antiguo: resolver devuelve el MISMO objeto (sin cambios)", r1 === productoAntiguo);
check("Producto antiguo: imágenes intactas", fns.getProductImages(productoAntiguo, "Azul").join("|") === "base1.jpg|base2.jpg");
check("Producto antiguo: precio/capacidad intactos", fns.getVariantStorageOptions(productoAntiguo, "Azul")[0].price === 25000);

/* 2. Variante con ficha completa independiente */
const r2 = fns.resolveVariantProduct(productoConVariantes, "Naranja");
check("Marca cambia a la de la variante", r2.brand === "Samsung");
check("Categoría cambia", r2.category === "galaxy-s");
check("Descripción cambia", r2.description === "Desc naranja");
check("Especificaciones cambian", r2.specs.join(",") === "Pantalla 6.9");
check("Includes cambian", r2.includes.join(",") === "Cargador naranja");
check("Imágenes cambian (galería de la variante)", fns.getProductImages(r2, "Naranja")[0] === "naranja-1.jpg" && fns.getProductImages(r2).length === 2);
check("Batería/condición/badge cambian", r2.batteryHealth === 100 && r2.condition === "seminuevo" && r2.badge === "Seminuevo");
check("Capacidad/precio/stock son propios de la variante", fns.getStorageOptions(r2)[0].name === "256GB" && fns.getStorageOptions(r2)[0].price === 28500);
check("Stock de la variante aplica en getStockInfo", fns.getStockInfo(r2, "256GB").label === "Pocas unidades");
check("Los colores del grupo se conservan (3)", r2.variants.colors.length === 3);

/* 3. Cambio a otra variante y regreso */
const rNegro = fns.resolveVariantProduct(productoConVariantes, "Negro");
check("Variante Negro: ficha completamente distinta", rNegro.brand === "Samsung Negra" && rNegro.category === "galaxy-n" && rNegro.description === "Desc negra");
check("Variante Negro: capacidad 512GB a 34000", fns.getStorageOptions(rNegro)[0].name === "512GB" && fns.getStorageOptions(rNegro)[0].price === 34000);
check("Variante Negro: agotada (stock 0)", fns.getStockInfo(rNegro, "512GB").isOut === true);
check("Variante Negro: su propia imagen", fns.getProductImages(rNegro, "Negro")[0] === "negro-1.jpg");
const rAzul = fns.resolveVariantProduct(productoConVariantes, "Azul");
check("Variante Azul (sin overrides): hereda TODO del base", rAzul.brand === "Samsung (base)" && rAzul.category === "galaxy-base" && fns.getStorageOptions(rAzul)[0].name === "128GB");
const rNaranjaDeNuevo = fns.resolveVariantProduct(productoConVariantes, "Naranja");
check("Regreso a Naranja restaura sus datos exactos", rNaranjaDeNuevo.brand === "Samsung" && fns.getStorageOptions(rNaranjaDeNuevo)[0].price === 28500 && fns.getProductImages(rNaranjaDeNuevo, "Naranja")[0] === "naranja-1.jpg");

/* 4. Overrides vacíos nunca degradan el base */
const productoConVacios = { ...productoConVariantes, variants: { ...productoConVariantes.variants, colors: [{ name: "X", overrides: { brand: null, images: [], storage: [] } }] } };
const rVacio = fns.resolveVariantProduct(productoConVacios, "X");
check("Overrides vacíos: base se conserva (brand, images, storage)", rVacio.brand === "Samsung (base)" && fns.getStorageOptions(rVacio)[0].price === 20000 && fns.getProductImages(rVacio).join("|") === "base-1.jpg");

/* 5. REGRESIÓN (producto-11): color duplicado — el que tiene overrides manda */
const productoDuplicado = {
  id: "producto-11", title: "iPhone 17 Pro", brand: "Apple", category: "iphones", price: 28800,
  description: "Desc base", images: ["silver-1.jpg"],
  variants: {
    storage: [{ name: "256GB", price: 28800, oldPrice: 0, stock: 10 }],
    colors: [
      { name: "Silver", value: "#EBEBEB" },
      { name: "Naranja", value: "#FF7B00" },                                  // duplicado SIN overrides
      { name: "Naranja", value: "#FF7B00", overrides: {                       // variante real
        title: "iPhone 17 Pro", storage: [{ name: "128GB", price: 25000, oldPrice: 27000, stock: 3 }],
        description: "Edición naranja", images: ["naranja-1.jpg"], specs: ["Spec naranja"], brand: "Apple"
      } }
    ]
  }
};
const rDup = fns.resolveVariantProduct(productoDuplicado, "Naranja");
check("Duplicado: el resolver encuentra la VARIANTE (no el color plano)", rDup !== productoDuplicado);
check("Duplicado: storage de la variante (128GB @ 25000)", fns.getStorageOptions(rDup)[0].name === "128GB" && fns.getStorageOptions(rDup)[0].price === 25000);
check("Duplicado: descripción de la variante", rDup.description === "Edición naranja");
check("Duplicado: imágenes de la variante", fns.getProductImages(productoDuplicado, "Naranja")[0] === "naranja-1.jpg");
const rSilver = fns.resolveVariantProduct(productoDuplicado, "Silver");
check("Color base sin duplicar sigue heredando normal", rSilver === productoDuplicado && fns.getStorageOptions(rSilver)[0].price === 28800);

console.log("");
console.log(failures === 0 ? "TODAS LAS PRUEBAS PASARON ✔" : `${failures} PRUEBAS FALLARON ✘`);
process.exit(failures === 0 ? 0 : 1);
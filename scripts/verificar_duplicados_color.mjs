// Diagnóstico READ-ONLY: detecta en los datos reales de Supabase
//  1) variantes con el mismo NOMBRE de color (case-insensitive)
//  2) variantes con el mismo CÓDIGO de color (hex normalizado)
//  3) variantes que chocan con un color base por nombre o por hex
//  4) overrides con arrays vacíos (includes/specs/storage: []) que provocaban
//     el falso aviso de "cambios sin guardar" al entrar a la variante.
import { loadEnvFile } from "node:process";

loadEnvFile(".env");
const { VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY } = process.env;
const headers = { apikey: VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${VITE_SUPABASE_ANON_KEY}` };

const normHex = (v) => {
  let hex = String(v || "").trim().toUpperCase();
  if (/^#[0-9A-F]{3}$/.test(hex)) hex = `#${hex.slice(1).split("").map((c) => c + c).join("")}`;
  return /^#[0-9A-F]{6}$/.test(hex) ? hex : null;
};

const res = await fetch(`${VITE_SUPABASE_URL}/rest/v1/productos?select=id,title,variants&order=id.asc`, { headers });
if (!res.ok) { console.error("Error HTTP", res.status, await res.text()); process.exit(1); }
const rows = await res.json();

let productosConProblemas = 0;
for (const p of rows) {
  const colors = p?.variants?.colors;
  if (!Array.isArray(colors) || colors.length === 0) continue;
  const variantes = colors.filter((c) => c.overrides);
  if (variantes.length === 0) continue;

  const problemas = [];
  const baseColors = colors.filter((c) => !c.overrides);

  // 1) nombre duplicado entre variantes
  const porNombre = new Map();
  // 2) hex duplicado entre variantes
  const porHex = new Map();
  for (const v of variantes) {
    const name = String(v.name || "").trim();
    if (name) {
      const key = name.toLowerCase();
      porNombre.set(key, [...(porNombre.get(key) || []), name]);
    }
    const hex = normHex(v.hex || v.value);
    if (hex) porHex.set(hex, [...(porHex.get(hex) || []), name]);
  }
  for (const [key, names] of porNombre) if (names.length > 1) problemas.push(`  · NOMBRE de color duplicado entre variantes: "${names.join('" = "')}"`);
  for (const [hex, names] of porHex) if (names.length > 1) problemas.push(`  · CÓDIGO de color duplicado entre variantes: ${hex} (${names.join(", ")})`);

  // 3) choque variante vs color base (nombre o hex)
  for (const v of variantes) {
    const vName = String(v.name || "").trim();
    const vHex = normHex(v.hex || v.value);
    for (const b of baseColors) {
      const bName = String(b.name || "").trim();
      const bHex = normHex(b.value || b.hex);
      if (vName && bName && vName.toLowerCase() === bName.toLowerCase()) problemas.push(`  · Variante "${vName}" repite el NOMBRE del color base "${bName}"`);
      else if (vName && vHex && bHex && vHex === bHex) problemas.push(`  · Variante "${vName}" repite el CÓDIGO ${vHex} del color base "${bName}"`);
    }
  }

  // 4) overrides con arrays vacíos (falso "cambios sin guardar" antes del fix)
  const vacios = [];
  for (const v of variantes) {
    const o = v.overrides || {};
    const lista = [];
    if (Array.isArray(o.includes) && o.includes.length === 0) lista.push("includes: []");
    if (Array.isArray(o.specs) && o.specs.length === 0) lista.push("specs: []");
    if (Array.isArray(o.storage) && o.storage.length === 0) lista.push("storage: []");
    if (lista.length) vacios.push(`  · Variante "${v.name}": overrides con ${lista.join(", ")}`);
  }

  if (problemas.length || vacios.length) {
    productosConProblemas++;
    console.log(`\n=== ${p.id} · ${p.title} ===`);
    problemas.forEach((x) => console.log(x));
    vacios.forEach((x) => console.log(x));
  }
}

console.log(productosConProblemas === 0
  ? "\nSin duplicados de color (por nombre o por código) y sin arrays vacíos en overrides. ✔"
  : `\n${productosConProblemas} producto(s) con hallazgos (ver arriba).`);

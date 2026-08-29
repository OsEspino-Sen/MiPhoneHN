// BACKUP READ-ONLY de Supabase + inventario de Cloudinary para MiPhone HN.
//
// Este script NO escribe, NO modifica y NO elimina NADA en Supabase ni en
// Cloudinary. Solo usa la anon key con las políticas de lectura pública
// ("Lectura publica de productos" / "Lectura publica de categorias").
//
// Genera, en backup/supabase/<timestamp>/ :
//   - productos.json            → TODOS los registros completos de productos
//   - categorias.json           → TODOS los registros completos de categorías
//   - cloudinary_inventory.json → inventario de imágenes Cloudinary usadas
//   - verificacion.json         → comparativa de cantidades + verificación profunda
//   - RESUMEN.txt               → reporte legible para el operador
// Y además copia la carpeta completa a un destino EXTERNO al repo
// (EXTERNAL_BACKUP_DIR, por defecto D:\Oscar Espino\MiPhoneBackups).
//
// Uso (PowerShell):
//   node scripts/export_backup_supabase.mjs
//
// IMPORTANTE: los backups previos NUNCA se sobrescriben (cada corrida crea su
// propia carpeta con timestamp).

import { loadEnvFile } from "node:process";
import path from "node:path";
import fs from "node:fs";

const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) loadEnvFile(envPath);

const {
  VITE_SUPABASE_URL: SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY
} = process.env;

// Con la SERVICE ROLE KEY el export funciona incluso con el modo mantenimiento
// activo (las políticas RLS bloquean la lectura anónima del catálogo, pero la
// service key las omite). Sin ella, sigue funcionando en modo público.
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const READ_KEY = SERVICE_KEY || VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !READ_KEY) {
  console.error("Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en .env");
  process.exit(1);
}

const EXTERNAL_BACKUP_DIR = process.env.EXTERNAL_BACKUP_DIR || "D:\\Oscar Espino\\MiPhoneBackups";
const PAGE_SIZE = 500;

const headers = {
  apikey: READ_KEY,
  Authorization: `Bearer ${READ_KEY}`,
  "Content-Type": "application/json"
};

/* ---------- Lectura REST (solo GET) ---------- */

// Cantidad EXACTA de filas según el servidor (header content-range).
async function countExact(table) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`, {
    headers: { ...headers, Prefer: "count=exact" }
  });
  if (!res.ok) throw new Error(`COUNT ${table}: ${res.status} ${await res.text()}`);
  const range = res.headers.get("content-range"); // ej: "0-0/42" o "*/42"
  const total = range ? Number(range.split("/")[1]) : NaN;
  if (!Number.isFinite(total)) throw new Error(`COUNT ${table}: content-range ausente`);
  return total;
}

// Descarga TODAS las filas (select=*) paginando por offset.
async function fetchAll(table) {
  const orderCol = table === "configuracion" ? "key" : "id";
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=*&order=${orderCol}.asc&limit=${PAGE_SIZE}&offset=${offset}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`GET ${table}: ${res.status} ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

// Re-lee un registro individual por id y lo devuelve (verificación independiente).
async function fetchOne(table, id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=*`, { headers });
  if (!res.ok) throw new Error(`GET ${table}/${id}: ${res.status} ${await res.text()}`);
  return res.json();
}

/* ---------- Inventario Cloudinary (solo lectura de URLs) ---------- */

// Extrae public_id, versión y formato desde una URL de Cloudinary (o null).
function parseCloudinaryUrl(url) {
  const match = url.match(/\/image\/upload\/(?:v(\d+)\/)?(.+)\.(\w{2,5})(?:\?.*)?$/);
  if (!match) return null;
  return {
    version: match[1] ? `v${match[1]}` : null,
    public_id: match[2],
    format: match[3],
    secure_url: url.split("?")[0]
  };
}

const IMAGE_URL_RE = /^(https?:\/\/[^\s"')]+\.(?:jpe?g|png|webp|gif|avif|svg)(?:\?[^\s"')]*)?|https?:\/\/[^\s"')]+\/image\/upload\/[^\s"')]+)$/i;

const isImageUrl = (value) => {
  if (!/^https?:\/\//i.test(value)) return false;
  if (value.includes("res.cloudinary.com") && value.includes("/image/upload/")) return true;
  return IMAGE_URL_RE.test(value.split("#")[0].trim());
};

// Recorre recursivamente cualquier estructura y devuelve cada URL de imagen con
// su ruta de referencia (tabla/registro → campo → índice) para reconstruir
// relaciones. Detecta Cloudinary Y cualquier otro host de imágenes.
function collectImageRefs(value, refPath, out) {
  if (typeof value === "string") {
    if (isImageUrl(value)) {
      out.push({
        reference: refPath,
        url: value,
        host: (() => { try { return new URL(value).host; } catch { return null; } })(),
        cloudinary: value.includes("res.cloudinary.com") ? parseCloudinaryUrl(value) : null
      });
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => collectImageRefs(item, `${refPath}[${i}]`, out));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => collectImageRefs(item, `${refPath}.${key}`, out));
  }
  return out;
}

// Verifica que cada imagen única responde HTTP 200 (HEAD). Solo lectura.
async function checkImageReachable(url) {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok ? "ok" : `http_${res.status}`;
  } catch (err) {
    return `error: ${String(err.message).slice(0, 80)}`;
  }
}

/* ---------- Utilidades ---------- */

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function pad(n) { return String(n).padStart(2, "0"); }

/* ---------- Proceso principal ---------- */

const timestamp = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
})();

const outDir = path.resolve(process.cwd(), "backup", "supabase", timestamp);
fs.mkdirSync(outDir, { recursive: true });

console.log("=== BACKUP READ-ONLY SUPABASE + INVENTARIO CLOUDINARY ===");
console.log(`Modo       : ${SERVICE_KEY ? "service role key (lectura completa, ignora mantenimiento)" : "read-only (anon key, políticas de lectura pública)"}`);
console.log(`Destino repo : ${outDir}`);
console.log(`Destino ext. : ${EXTERNAL_BACKUP_DIR}\\${timestamp}`);
console.log("");

const tables = ["productos", "categorias", "configuracion", "imagenes"];
const report = {
  generatedAt: new Date().toISOString(),
  supabaseUrl: SUPABASE_URL,
  mode: SERVICE_KEY ? "service role key (lectura completa, ignora mantenimiento)" : "read-only (anon key, políticas de lectura pública)",
  tables: {},
  deepVerification: null,
  cloudinary: null
};

const lines = [];
const log = (msg) => { console.log(msg); lines.push(msg); };

try {
  // 1) Export completo + comparativa de cantidades por tabla.
  for (const table of tables) {
    const expected = await countExact(table);
    const rows = await fetchAll(table);
    const ok = rows.length === expected;
    fs.writeFileSync(path.join(outDir, `${table}.json`), JSON.stringify(rows, null, 2), "utf8");
    report.tables[table] = { expectedCount: expected, exportedCount: rows.length, match: ok };
    log(`[${ok ? "OK" : "MISMATCH"}] ${table}: esperados ${expected} · exportados ${rows.length}`);
    if (!ok) throw new Error(`Conteo no coincide en ${table}: ${rows.length} != ${expected}`);
  }

  const productos = JSON.parse(fs.readFileSync(path.join(outDir, "productos.json"), "utf8"));

  // 2) Verificación profunda: re-lectura individual de una muestra y comparación
  //    canónica campo por campo. Si alguna difiere, el backup se marca INVÁLIDO.
  const sampleSize = Math.min(5, Math.max(1, productos.length));
  const sample = productos.filter((_, i) => i % Math.max(1, Math.ceil(productos.length / sampleSize)) === 0).slice(0, sampleSize);
  const deepResults = [];
  for (const row of sample) {
    const fresh = await fetchOne("productos", row.id);
    const match = fresh.length === 1 && stableStringify(fresh[0]) === stableStringify(row);
    deepResults.push({ id: row.id, title: row.title, match });
    log(`[VERIFICACIÓN PROFUNDA] ${row.id} (${row.title}): ${match ? "idéntico" : "¡DIFIERE!"}`);
  }
  const deepOk = deepResults.length > 0 && deepResults.every((r) => r.match);
  report.deepVerification = { sampleSize: deepResults.length, results: deepResults, allMatch: deepOk };
  if (!deepOk) throw new Error("Verificación profunda falló: el backup NO es válido.");

  // 3) Inventario de TODAS las imágenes referenciadas (Cloudinary u otros hosts)
  //    + verificación de disponibilidad HTTP. Solo lectura.
  const refs = [];
  const allRows = {};
  tables.forEach((t) => {
    allRows[t] = JSON.parse(fs.readFileSync(path.join(outDir, `${t}.json`), "utf8"));
  });
  allRows.productos.forEach((p) => collectImageRefs(p, `productos/${p.id}`, refs));
  allRows.categorias.forEach((c) => collectImageRefs(c, `categorias/${c.id}`, refs));
  allRows.configuracion.forEach((c) => collectImageRefs(c, `configuracion/${c.key}`, refs));
  allRows.imagenes.forEach((im) => collectImageRefs(im, `imagenes/${im.id}`, refs));
  const uniqueUrls = [...new Set(refs.map((r) => r.url))];
  const cloudinaryCount = uniqueUrls.filter((u) => u.includes("res.cloudinary.com")).length;
  const reachability = {};
  const CONCURRENCY = 8;
  for (let i = 0; i < uniqueUrls.length; i += CONCURRENCY) {
    const batch = uniqueUrls.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (url) => { reachability[url] = await checkImageReachable(url); }));
  }
  const inventory = {
    generatedAt: report.generatedAt,
    totalReferences: refs.length,
    uniqueImages: uniqueUrls.length,
    cloudinaryImages: cloudinaryCount,
    externalImages: uniqueUrls.length - cloudinaryCount,
    reachableOk: Object.values(reachability).filter((s) => s === "ok").length,
    reachabilityProblems: Object.entries(reachability).filter(([, s]) => s !== "ok"),
    images: uniqueUrls.map((url) => {
      const referenceData = refs.find((r) => r.url === url);
      const references = refs.filter((r) => r.url === url).map((r) => r.reference);
      return {
        cloudinary: referenceData?.cloudinary || null,
        host: referenceData?.host,
        url,
        status: reachability[url],
        referencedBy: references
      };
    })
  };
  fs.writeFileSync(path.join(outDir, "inventario_imagenes.json"), JSON.stringify(inventory, null, 2), "utf8");
  report.cloudinary = {
    totalReferences: inventory.totalReferences,
    uniqueImages: inventory.uniqueImages,
    cloudinaryImages: inventory.cloudinaryImages,
    externalImages: inventory.externalImages,
    reachableOk: inventory.reachableOk,
    problems: inventory.reachabilityProblems.length
  };
  log(`[INVENTARIO IMÁGENES] ${inventory.totalReferences} referencias · ${inventory.uniqueImages} únicas (${inventory.cloudinaryImages} Cloudinary + ${inventory.externalImages} externas) · ${inventory.reachableOk} responden OK · ${inventory.reachabilityProblems.length} con problemas`);

  // 4) Resumen legible para el operador.
  const summary = [
    "BACKUP MIPHONE HN — SUPABASE + CLOUDINARY (READ-ONLY)",
    `Generado: ${report.generatedAt}`,
    `Supabase: ${SUPABASE_URL}`,
    "",
    "COMPARATIVA DE CANTIDADES (servidor vs backup):",
    ...tables.map((t) => `  ${t}: ${report.tables[t].expectedCount} existentes → ${report.tables[t].exportedCount} exportados  [${report.tables[t].match ? "COINCIDE" : "¡MISMATCH!"}]`),
    "",
    `VERIFICACIÓN PROFUNDA (re-lectura + comparación canónica): ${deepResults.length}/${deepResults.length} idénticos [${deepOk ? "OK" : "FALLÓ"}]`,
    `INVENTARIO IMÁGENES: ${inventory.uniqueImages} únicas (${inventory.cloudinaryImages} Cloudinary + ${inventory.externalImages} externas) · ${inventory.reachableOk} responden HTTP OK · ${inventory.reachabilityProblems.length} problemas`,
    "",
    "ARCHIVOS: productos.json, categorias.json, configuracion.json, imagenes.json,",
    "          inventario_imagenes.json, verificacion.json, RESUMEN.txt",
    "",
    "Este backup contiene todos los campos e IDs necesarios para reconstruir las",
    "relaciones productos ↔ variantes ↔ imágenes ↔ precios ↔ stock ↔ specs.",
    "Restauración: scripts/restore_backup_supabase.mjs (requiere service role key)."
  ].join("\r\n");
  fs.writeFileSync(path.join(outDir, "RESUMEN.txt"), summary, "utf8");
  log("");
  log(summary);

  // 5) Copia EXTERNA independiente (nunca sobrescribe: carpeta con timestamp).
  const externalDir = path.join(EXTERNAL_BACKUP_DIR, timestamp);
  try {
    fs.cpSync(outDir, externalDir, { recursive: true });
    log("");
    log(`[COPIA EXTERNA] Backup duplicado en: ${externalDir}`);
    report.externalCopy = externalDir;
    fs.writeFileSync(path.join(outDir, "verificacion.json"), JSON.stringify(report, null, 2), "utf8");
    fs.writeFileSync(path.join(externalDir, "verificacion.json"), JSON.stringify(report, null, 2), "utf8");
  } catch (copyErr) {
    log(`[AVISO] No se pudo crear la copia externa en ${externalDir}: ${copyErr.message}`);
    log("        El backup en el repo es válido; copia manualmente la carpeta a tu unidad externa.");
    report.externalCopy = `FALLO: ${copyErr.message}`;
    fs.writeFileSync(path.join(outDir, "verificacion.json"), JSON.stringify(report, null, 2), "utf8");
  }

  fs.writeFileSync(path.join(outDir, "verificacion.json"), JSON.stringify(report, null, 2), "utf8");
  log("");
  log("RESULTADO: BACKUP VÁLIDO Y VERIFICADO ✔");
} catch (err) {
  console.error("ERROR: el backup NO es válido:", err.message);
  process.exitCode = 1;
}
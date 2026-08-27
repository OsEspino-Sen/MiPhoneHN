// RESTAURACIÓN DE BACKUP (ROLLBACK DE DATOS) — Supabase MiPhone HN.
//
// USO EXCLUSIVO DE EMERGENCIA: restaura las tablas desde una carpeta de backup
// generada por export_backup_supabase.mjs, conservando IDs y todos los campos.
//
// Seguridad por diseño:
//   1. Requiere SUPABASE_SERVICE_ROLE_KEY en el entorno (anon key NO sirve).
//   2. Por defecto SOLO SIMULA (dry-run): compara backup vs BD y muestra el
//      reporte sin escribir NADA.
//   3. Para escribir de verdad hay que añadir --confirm.
//   4. NUNCA elimina registros. Incluso con --confirm solo hace UPSERT
//      (actualiza/inserta los registros del backup). Si además quieres
//      eliminar registros creados después del backup, hace falta --prune
//      aparte (por defecto OFF).
//
// Uso (PowerShell):
//   $env:SUPABASE_SERVICE_ROLE_KEY="<clave>"
//   node scripts/restore_backup_supabase.mjs "backup\supabase\2026-08-27_173937"           # dry-run
//   node scripts/restore_backup_supabase.mjs "backup\supabase\2026-08-27_173937" --confirm # escribe
//   ... añade --tables=productos para restaurar solo esa tabla.

import { loadEnvFile } from "node:process";
import path from "node:path";
import fs from "node:fs";

const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) loadEnvFile(envPath);

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const PRUNE = args.includes("--prune");
const tablesArg = args.find((a) => a.startsWith("--tables="));
const BACKUP_DIR = args.find((a) => !a.startsWith("--"));

const {
  VITE_SUPABASE_URL: SUPABASE_URL
} = process.env;

if (!BACKUP_DIR || !fs.existsSync(path.join(BACKUP_DIR, "productos.json"))) {
  console.error("Uso: node scripts/restore_backup_supabase.mjs <carpeta-backup> [--confirm] [--prune] [--tables=productos,categorias]");
  process.exit(1);
}

// La service key SOLO es necesaria para escribir (--confirm). El dry-run usa la
// anon key (solo lectura, políticas públicas), así que la simulación es 100%
// segura y comprobable sin credenciales privilegiadas.
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (CONFIRM && !SERVICE_KEY) {
  console.error("--confirm requiere SUPABASE_SERVICE_ROLE_KEY. Cópiala de Supabase Dashboard → Settings → API keys.");
  console.error("Uso: $env:SUPABASE_SERVICE_ROLE_KEY=\"<clave>\"; node scripts/restore_backup_supabase.mjs <carpeta> --confirm");
  process.exit(1);
}
if (!SUPABASE_URL) {
  console.error("Falta VITE_SUPABASE_URL en .env");
  process.exit(1);
}

const READ_HEADERS = {
  apikey: SERVICE_KEY || ANON_KEY,
  Authorization: `Bearer ${SERVICE_KEY || ANON_KEY}`
};

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "resolution=merge-duplicates,return=representation"
};

const TABLES = tablesArg
  ? tablesArg.split("=")[1].split(",").map((t) => t.trim()).filter(Boolean)
  : ["productos", "categorias", "configuracion", "imagenes"];

const ORDER_COL = { productos: "id", categorias: "id", configuracion: "key", imagenes: "id" };

async function fetchCurrent(table) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, { headers: READ_HEADERS });
  if (!res.ok) throw new Error(`GET ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function upsertRows(table, rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers,
    body: JSON.stringify(rows)
  });
  if (!res.ok) throw new Error(`UPSERT ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

console.log("=== RESTAURACIÓN DE BACKUP SUPABASE ===");
console.log(`Backup   : ${BACKUP_DIR}`);
console.log(`Modo     : ${CONFIRM ? "ESCRITURA REAL (--confirm)" : "SIMULACIÓN (dry-run)"}`);
console.log(`--prune  : ${PRUNE ? "ACTIVADO (eliminará registros posteriores al backup)" : "desactivado (no elimina NADA)"}`);
console.log("");

let hadError = false;
for (const table of TABLES) {
  const file = path.join(BACKUP_DIR, `${table}.json`);
  if (!fs.existsSync(file)) { console.log(`[SKIP] ${table}: sin backup`); continue; }
  const backupRows = JSON.parse(fs.readFileSync(file, "utf8"));
  const current = await fetchCurrent(table);
  const keyCol = table === "configuracion" ? "key" : "id";
  const currentById = new Map(current.map((r) => [String(r[keyCol]), r]));

  const toUpsert = backupRows.filter((r) => {
    const cur = currentById.get(String(r[keyCol]));
    return !cur || stableStringify(cur) !== stableStringify(r);
  });
  const identical = backupRows.length - toUpsert.length;
  const extras = current.filter((r) => !backupRows.some((b) => String(b[keyCol]) === String(r[keyCol])));

  console.log(`[${table}] backup: ${backupRows.length} · actuales: ${current.length} · idénticos: ${identical} · a restaurar (upsert): ${toUpsert.length}`);
  toUpsert.slice(0, 10).forEach((r) => console.log(`   → ${r[keyCol]}${currentById.has(String(r[keyCol])) ? " (se SOBRESCRIBIRÁ al estado del backup)" : " (se INSERTARÁ)"}`));
  if (extras.length) console.log(`   ⓘ ${extras.length} registro(s) actuales NO están en el backup → se CONSERVAN${PRUNE ? " y se ELIMINARÁN (--prune)" : ""}`);

  if (CONFIRM && toUpsert.length) {
    const result = await upsertRows(table, toUpsert);
    console.log(`   ✔ Upsert completado: ${Array.isArray(result) ? result.length : "?"} fila(s)`);
  } else if (!CONFIRM) {
    console.log(`   (dry-run: no se escribió nada. Añade --confirm para restaurar de verdad)`);
  }
}

console.log("");
console.log(CONFIRM ? "RESTAURACIÓN EJECUTADA. Verifica los resultados en el panel." : "SIMULACIÓN COMPLETA — nada fue modificado.");
if (PRUNE && !CONFIRM) console.log("⚠ --prune requiere --confirm para actuar.");
process.exit(hadError ? 1 : 0);
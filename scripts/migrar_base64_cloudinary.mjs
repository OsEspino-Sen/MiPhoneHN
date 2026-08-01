// Migra imágenes base64 guardadas en Supabase hacia Cloudinary y guarda las URLs.
//
// Uso (PowerShell):
//   $env:SUPABASE_SERVICE_ROLE_KEY="<tu_service_role_key>"
//   node scripts/migrar_base64_cloudinary.mjs
//
// La service role key se copia de Supabase Dashboard → Settings → API keys (se usa
// porque las políticas RLS exigen autenticación para escribir en imagenes,
// configuracion y productos). Sin esa variable el script corre en modo auditoría
// (solo reporta qué se migraría, sin modificar nada).
import { loadEnvFile } from "node:process";
import path from "node:path";
import fs from "node:fs";

const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) loadEnvFile(envPath);

const {
  VITE_SUPABASE_URL: SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY,
  VITE_CLOUDINARY_CLOUD_NAME: CLOUD_NAME,
  VITE_CLOUDINARY_UPLOAD_PRESET: PRESET
} = process.env;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const DRY_RUN = !SERVICE_KEY;
const KEY = SERVICE_KEY || VITE_SUPABASE_ANON_KEY;

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json"
};

const isBase64 = (v) => typeof v === "string" && v.startsWith("data:image");

async function restGet(table, select) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`, { headers });
  if (!res.ok) throw new Error(`GET ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function restPatch(table, idCol, id, payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${idCol}=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`PATCH ${table} ${id}: ${res.status} ${await res.text()}`);
}

const uploaded = new Map();

async function uploadBase64(dataUrl) {
  if (uploaded.has(dataUrl)) return uploaded.get(dataUrl);
  const blob = await (await fetch(dataUrl)).blob();
  const form = new FormData();
  form.append("file", blob, "miphone_migracion.png");
  form.append("upload_preset", PRESET);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
    method: "POST",
    body: form
  });
  if (!res.ok) throw new Error(`Cloudinary ${res.status}: ${await res.text()}`);
  const json = await res.json();
  uploaded.set(dataUrl, json.secure_url);
  return json.secure_url;
}

function collectBase64(value, set) {
  if (isBase64(value)) {
    set.add(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectBase64(item, set));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectBase64(item, set));
  }
}

async function replaceBase64(value) {
  if (isBase64(value)) {
    return await uploadBase64(value);
  }
  if (Array.isArray(value)) {
    return await Promise.all(value.map((item) => replaceBase64(item)));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, item] of Object.entries(value)) {
      out[k] = await replaceBase64(item);
    }
    return out;
  }
  return value;
}

function hasBase64(value) {
  if (isBase64(value)) return true;
  if (Array.isArray(value)) return value.some(hasBase64);
  if (value && typeof value === "object") return Object.values(value).some(hasBase64);
  return false;
}

async function migrateProducts(stats) {
  const rows = await restGet("productos", "id,image,images");
  for (const row of rows) {
    if (!hasBase64(row.image) && !hasBase64(row.images)) continue;
    stats.imagenesBase64.found += countBase64(row.image) + countBase64(row.images);
    if (DRY_RUN) { stats.productos.pending++; continue; }
    const patch = {};
    if (hasBase64(row.image)) patch.image = await replaceBase64(row.image);
    if (hasBase64(row.images)) patch.images = await replaceBase64(row.images);
    await restPatch("productos", "id", row.id, patch);
    stats.productos.migrated++;
  }
}

async function migrateImagenes(stats) {
  const rows = await restGet("imagenes", "id,data,url,type");
  for (const row of rows) {
    if (!isBase64(row.data)) continue;
    stats.imagenesBase64.found++;
    if (DRY_RUN) { stats.imagenes.pending++; continue; }
    const finalUrl = await uploadBase64(row.data);
    await restPatch("imagenes", "id", row.id, { url: finalUrl, data: null });
    stats.imagenes.migrated++;
  }
}

async function migrateConfiguracion(stats) {
  const rows = await restGet("configuracion", "key,data");
  for (const row of rows) {
    if (!hasBase64(row.data)) continue;
    stats.imagenesBase64.found += countBase64(row.data);
    if (DRY_RUN) { stats.configuracion.pending++; continue; }
    const patch = { data: await replaceBase64(row.data) };
    await restPatch("configuracion", "key", row.key, patch);
    stats.configuracion.migrated++;
  }
}

function countBase64(value, n = 0) {
  if (isBase64(value)) return n + 1;
  if (Array.isArray(value)) return value.reduce((acc, item) => acc + countBase64(item), 0);
  if (value && typeof value === "object") return Object.values(value).reduce((acc, item) => acc + countBase64(item), 0);
  return 0;
}

const stats = {
  imagenesBase64: { found: 0 },
  productos: { migrated: 0, pending: 0 },
  imagenes: { migrated: 0, pending: 0 },
  configuracion: { migrated: 0, pending: 0 }
};

if (DRY_RUN) {
  console.log("SUPABASE_SERVICE_ROLE_KEY no encontrada en el entorno.");
  console.log("Modo AUDITORÍA: se listará lo que se migraría, sin modificar la base de datos.");
  console.log("Para migrar, ejecuta:  $env:SUPABASE_SERVICE_ROLE_KEY=\"<tu_service_role_key>\"; node scripts/migrar_base64_cloudinary.mjs\n");
} else {
  console.log("Migrando base64 → Cloudinary...");
}

try {
  await migrateProducts(stats);
  await migrateImagenes(stats);
  await migrateConfiguracion(stats);
} catch (err) {
  console.error("Error durante la migración:", err.message);
  console.error("Verifica la service role key, la conexión y que el preset de Cloudinary sea unsigned.");
  process.exit(1);
}

const totalBase64 = stats.imagenesBase64.found;
console.log("\n--- Resumen ---");
console.log(`Imágenes base64 encontradas: ${totalBase64}`);
if (DRY_RUN) {
  console.log(`- productos por migrar:   ${stats.productos.pending}`);
  console.log(`- imagenes por migrar:    ${stats.imagenes.pending}`);
  console.log(`- configuracion por migrar: ${stats.configuracion.pending}`);
  console.log("Nada fue modificado (auditoría).");
} else {
  console.log(`- productos migrados:     ${stats.productos.migrated}`);
  console.log(`- imagenes migradas:      ${stats.imagenes.migrated}`);
  console.log(`- configuracion migradas: ${stats.configuracion.migrated}`);
  console.log(`- uploads a Cloudinary:   ${uploaded.size} (con deduplicación)`);
  console.log("Listo. Las filas ahora guardan URLs de Cloudinary y el base64 fue eliminado.");
}

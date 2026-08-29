// Backup fisico de Cloudinary a partir de las URLs ya exportadas de Supabase.
// Solo GET: no borra ni sobrescribe nada en Cloudinary.
// usa: node scripts/backup_cloudinary.mjs
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const supabaseDir = path.resolve(root, "backup", "supabase");
const outFiles = path.resolve(root, "backup", "cloudinary", "files");
const outInv = path.resolve(root, "backup", "cloudinary", "inventario.json");
fs.mkdirSync(outFiles, { recursive: true });

// 1) Recolectar todas las URLs de Cloudinary dentro de los JSON exportados.
const urlRegex = /https:\/\/res\.cloudinary\.com\/[^"')\s]+/g;
const publicIdRegex = /\/image\/upload\/(?:v\d+\/)?([^.]+)\.(\w+)(?:\?.*)?$/;

const collected = new Map(); // url -> firstSeen (tabla)
function scanFile(file, table) {
  const text = fs.readFileSync(file, "utf8");
  const matches = text.match(urlRegex) || [];
  for (const u of matches) {
    if (!u.includes("res.cloudinary.com")) continue;
    if (!collected.has(u)) collected.set(u, table);
  }
}

for (const name of fs.readdirSync(supabaseDir)) {
  if (!name.endsWith(".json")) continue;
  const table = name.replace(/\-\d{4}-\d{2}-\d{2}\.json$/, "");
  scanFile(path.join(supabaseDir, name), table);
}

// 2) Descargar cada imagen una vez (dedupe por public_id).
const inventory = [];
let ok = 0;
let skip = 0;
let fail = 0;

for (const [url, table] of collected) {
  const m = url.match(publicIdRegex);
  if (!m) { skip++; continue; }
  const publicId = m[1];
  const ext = m[2];
  const dest = path.join(outFiles, `${publicId}.${ext}`);
  inventory.push({ public_id: publicId, format: ext, table, url });

  if (fs.existsSync(dest)) { ok++; continue; }
  try {
    const res = await fetch(url);
    if (!res.ok) { console.error(`  HTTP ${res.status}: ${url}`); fail++; continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    ok++;
  } catch (e) {
    console.error(`  ERR ${url}: ${e.message}`);
    fail++;
  }
}

fs.writeFileSync(outInv, JSON.stringify(inventory, null, 2));
console.log(`URLs Cloudinary encontradas: ${collected.size}`);
console.log(`  descargadas/ok: ${ok} | omitidas (sin public_id): ${skip} | fallidas: ${fail}`);
console.log(`Inventario: ${outInv}`);
console.log(`Archivos en: ${outFiles}`);

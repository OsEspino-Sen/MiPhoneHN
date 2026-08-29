// Backup de solo lectura de Supabase (exporta datos, no modifica nada).
// Usa la anon key: productos/categorias/configuracion/imagenes son de lectura publica (RLS SELECT true).
// usa: node scripts/backup_supabase.mjs
import { loadEnvFile } from "node:process";
import path from "node:path";
import fs from "node:fs";

const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) loadEnvFile(envPath);

const { VITE_SUPABASE_URL: SUPABASE_URL, VITE_SUPABASE_ANON_KEY: KEY } = process.env;
if (!SUPABASE_URL || !KEY) {
  console.error("Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en .env");
  process.exit(1);
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
// NOTA: 'usuarios' requiere service_role (RLS lo bloquea al anon) -> se omite con aviso.
const tables = ["productos", "categorias", "configuracion", "imagenes"];

const outDir = path.resolve(process.cwd(), "backup", "supabase");
fs.mkdirSync(outDir, { recursive: true });
const ts = new Date().toISOString().slice(0, 10);

async function exportTable(table) {
  const all = [];
  let offset = 0;
  const limit = 1000;
  for (;;) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=*&limit=${limit}&offset=${offset}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.error(`ERROR ${table}: ${res.status} ${await res.text()}`);
      return null;
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    all.push(...rows);
    if (rows.length < limit) break;
    offset += limit;
  }
  return all;
}

for (const table of tables) {
  console.log(`Exportando ${table}...`);
  const rows = await exportTable(table);
  if (rows === null) continue;
  const file = path.join(outDir, `${table}-${ts}.json`);
  fs.writeFileSync(file, JSON.stringify(rows, null, 2));
  console.log(`  ${table}: ${rows.length} filas -> ${file}`);
}

console.log("Listo. Los archivos de respaldo estan en backup/supabase/.");
console.log("NOTA: la tabla 'usuarios' no se exporta con anon key. Si la necesitas, usa SUPABASE_SERVICE_ROLE_KEY.");

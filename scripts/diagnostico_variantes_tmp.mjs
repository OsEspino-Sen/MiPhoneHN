// Diagnóstico READ-ONLY: inspecciona variants.colors de todos los productos.
import { loadEnvFile } from "node:process";

loadEnvFile(".env");
const { VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY } = process.env;
const headers = { apikey: VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${VITE_SUPABASE_ANON_KEY}` };

const res = await fetch(`${VITE_SUPABASE_URL}/rest/v1/productos?select=id,title,price,variants&order=id.asc`, { headers });
const rows = await res.json();

for (const p of rows) {
  const colors = p?.variants?.colors;
  if (!Array.isArray(colors) || colors.length === 0) continue;
  const hasOverrides = colors.some((c) => c.overrides);
  if (!hasOverrides) continue;
  console.log(`\n=== ${p.id} · ${p.title} (precio base: ${p.price}) ===`);
  colors.forEach((c, i) => {
    console.log(`  [${i}] color: "${c.name}" hex=${c.value || c.hex}`);
    if (c.overrides) {
      const o = c.overrides;
      console.log(`      overrides: ${Object.keys(o).join(", ")}`);
      console.log(`      storage: ${JSON.stringify(o.storage ?? "(NO DEFINIDO)")}`);
      console.log(`      precio 1ra capacidad: ${o.storage?.[0]?.price ?? "—"}`);
      console.log(`      brand=${o.brand ?? "—"} category=${o.category ?? "—"} title=${o.title ?? "—"}`);
    } else {
      console.log(`      overrides: (ninguno — color base)`);
    }
  });
}
/* ==========================================================================
   MI PHONE HN — PLANTILLA COMPARTIDA DE LA PÁGINA DE MANTENIMIENTO
   ==========================================================================
   Fuente única de verdad del diseño de la página de mantenimiento.
   La consumen:
     - middleware.js (Vercel Routing Middleware → HTTP 503 en producción)
     - client/mantenimiento-cliente.js (gate en tiempo real de la tienda)
     - admin/admin.js (vista previa dentro del panel)

   El artwork NO se recrea con CSS: es un asset real (<img>) apuntado por
   URL. Reemplaza el archivo del artwork (o define la variable de entorno
   MANTENIMIENTO_ARTWORK_URL / VITE_MANTENIMIENTO_ARTWORK_URL) y la página
   lo usará intacto, sin deformarlo ni recortarlo.
   ========================================================================== */

export const MANTENIMIENTO_DEFAULTS = {
  artworkUrl: '/mantenimiento/artwork.svg',
  artworkAlt: 'Ilustración de mantenimiento de Mi Phone HN',
  eyebrow: 'Mantenimiento programado',
  titulo: 'Estamos dando el toque final',
  resaltado: 'a tu tienda',
  mensaje:
    'Estamos actualizando Mi Phone HN para brindarte una mejor experiencia. ' +
    'Volvemos en unos minutos. Si necesitas hacer un pedido, escríbenos por WhatsApp y te atendemos de inmediato.',
  whatsapp: '50488878066',
  whatsappTexto: 'Escríbenos por WhatsApp',
  pieNota: 'Gracias por tu paciencia',
  marca: 'Mi Phone HN'
};

// Normaliza el número de WhatsApp (Honduras +504) sin duplicar el prefijo.
// Usado por middleware, gate del cliente y página de mantenimiento.
export function normalizarWhatsapp(numero) {
  let d = String(numero || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 8) d = '504' + d;
  return d;
}

/* ---- CSS inline (autocontenido: funciona en middleware sin hojas externas) ---- */
export const MANTENIMIENTO_CSS = `
:root {
  --mnt-bg: #f5f5f7;
  --mnt-surface: #ffffff;
  --mnt-text: #1d1d1f;
  --mnt-muted: #6e6e73;
  --mnt-accent: #0071e3;
  --mnt-accent-2: #2997ff;
  --mnt-border: #e5e5ea;
  --mnt-font-body: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --mnt-font-heading: "Outfit", "Inter", -apple-system, sans-serif;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; }
body {
  font-family: var(--mnt-font-body);
  color: var(--mnt-text);
  background:
    radial-gradient(900px 480px at 12% -10%, rgba(0, 113, 227, 0.10), transparent 60%),
    radial-gradient(760px 420px at 105% 110%, rgba(41, 151, 255, 0.12), transparent 60%),
    var(--mnt-bg);
  -webkit-font-smoothing: antialiased;
}
.mnt-page {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: clamp(24px, 5vw, 64px);
}
.mnt-container {
  width: 100%;
  max-width: 1120px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
  align-items: center;
  gap: clamp(40px, 6vw, 88px);
}
/* --- Artwork (asset real, nunca recreado) --- */
.mnt-artwork {
  grid-column: 1;
  grid-row: 1;
  margin: 0;
  display: flex;
  justify-content: center;
}
.mnt-artwork img {
  width: 100%;
  max-width: 520px;
  height: auto;
  object-fit: contain;
  filter: drop-shadow(0 32px 48px rgba(0, 0, 0, 0.12));
  animation: mnt-flotar 6s ease-in-out infinite;
}
@keyframes mnt-flotar {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-12px); }
}
@media (prefers-reduced-motion: reduce) {
  .mnt-artwork img { animation: none; }
}
/* --- Contenido --- */
.mnt-contenido { grid-column: 2; grid-row: 1; }
.mnt-badge {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 8px 18px;
  border-radius: 999px;
  background: var(--mnt-surface);
  border: 1px solid var(--mnt-border);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--mnt-muted);
}
.mnt-badge-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--mnt-accent);
  box-shadow: 0 0 0 0 rgba(0, 113, 227, 0.45);
  animation: mnt-pulso 1.8s ease-out infinite;
}
@keyframes mnt-pulso {
  0% { box-shadow: 0 0 0 0 rgba(0, 113, 227, 0.45); }
  70% { box-shadow: 0 0 0 12px rgba(0, 113, 227, 0); }
  100% { box-shadow: 0 0 0 0 rgba(0, 113, 227, 0); }
}
.mnt-titulo {
  font-family: var(--mnt-font-heading);
  font-size: clamp(2.1rem, 4.6vw, 3.5rem);
  font-weight: 800;
  line-height: 1.08;
  letter-spacing: -0.02em;
  margin: 22px 0 18px;
}
.mnt-titulo .mnt-resaltado {
  background: linear-gradient(92deg, var(--mnt-accent), var(--mnt-accent-2));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.mnt-mensaje {
  font-size: clamp(1rem, 1.4vw, 1.125rem);
  line-height: 1.7;
  color: var(--mnt-muted);
  max-width: 46ch;
}
.mnt-acciones {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  margin-top: 34px;
}
.mnt-btn-wa {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 15px 28px;
  border-radius: 999px;
  background: var(--mnt-accent);
  color: #ffffff;
  font-weight: 700;
  font-size: 0.9375rem;
  text-decoration: none;
  box-shadow: 0 12px 24px rgba(0, 113, 227, 0.28);
  transition: transform 0.25s ease, box-shadow 0.25s ease, background 0.25s ease;
}
.mnt-btn-wa:hover { background: #0077ed; transform: translateY(-2px); box-shadow: 0 16px 32px rgba(0, 113, 227, 0.34); }
.mnt-btn-wa svg { width: 20px; height: 20px; fill: currentColor; }
.mnt-btn-refrescar {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 15px 22px;
  border-radius: 999px;
  border: 1px solid var(--mnt-border);
  background: var(--mnt-surface);
  color: var(--mnt-text);
  font-weight: 600;
  font-size: 0.9375rem;
  font-family: var(--mnt-font-body);
  cursor: pointer;
  transition: border-color 0.25s ease, transform 0.25s ease;
}
.mnt-btn-refrescar:hover { border-color: var(--mnt-accent); transform: translateY(-2px); }
.mnt-pie {
  margin-top: 42px;
  padding-top: 22px;
  border-top: 1px solid var(--mnt-border);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 0.8125rem;
  color: var(--mnt-muted);
}
.mnt-pie strong { color: var(--mnt-text); font-weight: 700; }
/* --- Responsive: en móvil el contenido va primero, luego el artwork --- */
@media (max-width: 880px) {
  .mnt-container { grid-template-columns: 1fr; gap: 34px; }
  .mnt-contenido { grid-column: 1; grid-row: 1; text-align: center; }
  .mnt-mensaje { margin-inline: auto; }
  .mnt-acciones { justify-content: center; }
  .mnt-pie { justify-content: center; text-align: center; }
  .mnt-artwork { grid-column: 1; grid-row: 2; }
  .mnt-artwork img { max-width: min(78vw, 400px); }
}
@media (max-width: 640px) {
  .mnt-acciones { flex-direction: column; align-items: stretch; }
  /* Cuando los botones quedan apilados verticalmente (tablet/móvil), ambos
     adoptan EXACTAMENTE el mismo ancho y alto: el de "Actualizar página"
     se iguala al de "Escríbenos por WhatsApp" (referencia de dimensiones),
     manteniendo su diseño interno intacto. En >= 641px siguen lado a lado
     con su comportamiento actual. */
  .mnt-btn-wa, .mnt-btn-refrescar { width: 100%; justify-content: center; }
  .mnt-producto { grid-template-columns: 1fr; text-align: center; }
  .mnt-producto-colores, .mnt-producto-nota { justify-content: center; }
}
/* --- Producto compartido (enlace ?producto= durante el mantenimiento) --- */
.mnt-producto {
  width: min(660px, 100%);
  margin: 34px auto 0;
  padding: 18px;
  display: grid;
  grid-template-columns: minmax(0, 210px) minmax(0, 1fr);
  gap: 18px;
  text-align: left;
  border: 1px solid color-mix(in srgb, var(--mnt-text) 14%, transparent);
  border-radius: 22px;
  background: #fff;
  box-shadow: 0 16px 40px rgba(2, 12, 26, .10);
  animation: mntProductoIn .35s cubic-bezier(.16, 1, .3, 1);
}
@keyframes mntProductoIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.mnt-producto-img {
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  border-radius: 15px;
  background: var(--mnt-muted);
  display: block;
}
.mnt-producto-info { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.mnt-producto-fila { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mnt-producto-badge {
  display: inline-flex; align-items: center;
  font-size: .64rem; font-weight: 800; letter-spacing: .05em; text-transform: uppercase;
  border-radius: 999px; padding: 3px 10px;
  color: #116e51; background: #e8f7f0; border: 1px solid #bce4d3;
}
.mnt-producto-badge.is-used { color: #85540f; background: #fff3df; border-color: #efd4ab; }
.mnt-producto-nombre { font-family: var(--mnt-font-heading); font-size: 1.05rem; font-weight: 800; color: var(--mnt-text); line-height: 1.25; }
.mnt-producto-marca { font-size: .72rem; font-weight: 600; color: var(--mnt-muted); }
.mnt-producto-precio { font-family: var(--mnt-font-heading); font-size: 1.15rem; font-weight: 800; color: var(--mnt-accent); }
.mnt-producto-desc { font-size: .78rem; color: var(--mnt-muted); line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.mnt-producto-colores { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.mnt-producto-color {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: .68rem; font-weight: 700; color: var(--mnt-text);
  border: 1px solid color-mix(in srgb, var(--mnt-text) 16%, transparent);
  border-radius: 999px; padding: 3px 9px 3px 4px;
}
.mnt-producto-color i { width: 14px; height: 14px; border-radius: 50%; background: var(--swatch, #ccc); border: 1px solid rgba(0,0,0,.14); }
.mnt-producto-nota {
  display: inline-flex; align-items: center; gap: 6px;
  margin-top: 4px; padding: 8px 12px; border-radius: 10px;
  background: color-mix(in srgb, var(--mnt-accent) 8%, transparent);
  font-size: .72rem; font-weight: 600; color: var(--mnt-text);
}
.mnt-producto-nota i { flex-shrink: 0; color: var(--mnt-accent); }
`.trim();

/* ---- Ícono WhatsApp (SVG inline) ---- */
const ICONO_WHATSAPP = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.87 9.87 0 0 0 4.74 1.21h.01c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.14-2.9-7.01A9.83 9.83 0 0 0 12.04 2Zm0 18.03h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.36c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.21-8.23 8.21Zm4.52-6.16c-.25-.13-1.47-.72-1.69-.8-.23-.09-.4-.13-.56.12-.17.25-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.13-1.05-.39-2-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.51.11-.11.25-.29.37-.43.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.13-.56-1.35-.77-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29Z"/></svg>`;

/* ---- Markup interno (usado por el gate del cliente) ---- */
export function buildMantenimientoMarkup(opciones = {}) {
  const o = { ...MANTENIMIENTO_DEFAULTS, ...opciones };
  const waDigits = normalizarWhatsapp(o.whatsapp);
  const botonWa = waDigits
    ? `<a class="mnt-btn-wa" href="https://wa.me/${waDigits}" target="_blank" rel="noopener noreferrer">${ICONO_WHATSAPP}${o.whatsappTexto}</a>`
    : '';
  return `
  <div class="mnt-container">
    <figure class="mnt-artwork">
      <img src="${o.artworkUrl}" alt="${o.artworkAlt}" draggable="false" />
    </figure>
    <div class="mnt-contenido">
      <span class="mnt-badge"><span class="mnt-badge-dot" aria-hidden="true"></span>${o.eyebrow}</span>
      <h1 class="mnt-titulo">${o.titulo} <span class="mnt-resaltado">${o.resaltado}</span></h1>
      <p class="mnt-mensaje">${o.mensaje}</p>
      <div class="mnt-acciones">
        ${botonWa}
        <button type="button" class="mnt-btn-refrescar" onclick="window.location.reload()">Actualizar página</button>
      </div>
      <footer class="mnt-pie">
        <span>${o.pieNota}</span>
        <strong>${o.marca}</strong>
      </footer>
    </div>
  </div>`.trim();
}

/* ---- Documento HTML completo (usado por middleware y vista previa) ---- */
export function buildMantenimientoHTML(opciones = {}) {
  const o = { ...MANTENIMIENTO_DEFAULTS, ...opciones };
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <meta name="theme-color" content="#0071e3">
  <title>Estamos en mantenimiento — ${o.marca}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@600;700;800&display=swap" rel="stylesheet">
  <style>${MANTENIMIENTO_CSS}</style>
</head>
<body>
  <main class="mnt-page" role="main">
    ${buildMantenimientoMarkup(o)}
  </main>
</body>
</html>`.trim();
}


/* ==========================================================================
   MI PHONE HN — GATE DE MANTENIMIENTO PARA LA TIENDA (CLIENTE)
   ==========================================================================
   Segunda capa de bloqueo, client-side pero con el estado real almacenado
   en Supabase (server-side truth) y actualización en tiempo real.

   Responsabilidades:
   - LOCAL: es la capa PRINCIPAL (el middleware de Vercel no corre en el
     dev server). Lee/escribe SOLO la fila 'mantenimiento-local', por lo
     que es imposible que el entorno local afecte a producción.
   - PRODUCCIÓN: capa redundante + reacción en tiempo real. Si un cliente
     tiene la tienda abierta y el admin activa el mantenimiento, ve la
     página sin recargar (y vuelve sola al desactivarlo).

   Scope por entorno (separación LOCAL / PRODUCCIÓN):
     VITE_APP_ENV=local       → flag 'mantenimiento-local'
     VITE_APP_ENV=production  → flag 'mantenimiento-produccion'
     (sin la variable se asume PRODUCCIÓN por seguridad)
   ========================================================================== */

import { MANTENIMIENTO_CSS, buildMantenimientoMarkup } from './mantenimiento-template.js';

let FLAG_KEY = null;
let overlayCreado = false;

export function resolveFlagKey() {
  if (FLAG_KEY) return FLAG_KEY;
  const env = String(import.meta.env.VITE_APP_ENV || 'production').toLowerCase();
  FLAG_KEY = env === 'local' ? 'mantenimiento-local' : 'mantenimiento-produccion';
  return FLAG_KEY;
}

export function esEntornoLocal() {
  return resolveFlagKey() === 'mantenimiento-local';
}

export function artworkUrl() {
  return import.meta.env.VITE_MANTENIMIENTO_ARTWORK_URL || '/mantenimiento/artwork.svg';
}

async function leerEstado() {
  const { db, doc, getDoc } = await import('./supabase-config.js');
  const [snap, imgSnap, waSnap] = await Promise.all([
    getDoc(doc(db, 'configuracion', resolveFlagKey())),
    // Imagen de mantenimiento subida desde el panel (Imágenes).
    getDoc(doc(db, 'imagenes', 'mantenimiento')),
    // Número de WhatsApp del negocio (única fuente de verdad).
    getDoc(doc(db, 'configuracion', 'whatsapp'))
  ]);
  const data = snap.exists() ? (snap.data() || {}) : {};
  const imgData = imgSnap.exists() ? (imgSnap.data() || {}) : {};
  const waData = waSnap.exists() ? (waSnap.data() || {}) : {};
  return {
    activo: Boolean(data.activo),
    mensaje: data.mensaje || '',
    artwork: imgData.url || imgData.data || artworkUrl(),
    whatsapp: waData.phone || ''
  };
}

function crearOverlay(estado) {
  if (overlayCreado) return;

  const style = document.createElement('style');
  style.id = 'mnt-inline-style';
  style.textContent = MANTENIMIENTO_CSS;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.id = 'mantenimiento-overlay';
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Sitio en mantenimiento');
  overlay.innerHTML = `<main class="mnt-page">${buildMantenimientoMarkup({
    artworkUrl: estado.artwork,
    whatsapp: estado.whatsapp,
    ...(estado.mensaje ? { mensaje: estado.mensaje } : {})
  })}</main>`;
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;overflow:auto;background:#f5f5f7;';
  document.body.appendChild(overlay);
  overlayCreado = true;
  document.title = 'Estamos en mantenimiento — Mi Phone HN';
}

function quitarOverlay() {
  document.getElementById('mantenimiento-overlay')?.remove();
  document.getElementById('mnt-inline-style')?.remove();
  overlayCreado = false;
}

function aplicarEstado(estado) {
  if (estado.activo) {
    crearOverlay(estado);
  } else {
    quitarOverlay();
  }
}

/* Arranque del gate: chequeo inicial + suscripción realtime. */
export function quitarBoot() {
  // Revela la tienda (o la página de mantenimiento, en el mismo tick) una vez
  // verificado el estado. Lo ocultó el <head> con html.mnt-boot.
  document.documentElement.classList.remove('mnt-boot');
}

export async function iniciarMantenimientoCliente() {
  let estado = null;
  try {
    estado = await leerEstado();
  } catch (err) {
    console.warn('[mantenimiento] No se pudo verificar el estado inicial:', err);
    // Fail-open: si no se puede verificar, se muestra la tienda.
  }

  // Aplicar overlay y revelar en el MISMO tick: nunca se alcanza a pintar el
  // contenido real de la tienda durante la verificación (sin transición lenta).
  if (estado) aplicarEstado(estado);
  quitarBoot();

  // Producto compartido (?producto=<id>): mostrar su ficha sobre la página de
  // mantenimiento leyéndolo vía función pública (el catálogo está cerrado por
  // RLS, pero un enlace compartido no debe morir durante el cierre).
  await mostrarProductoCompartidoEnMantenimiento();

  try {
    const { supabase } = await import('./supabase-config.js');
    const canal = supabase
      .channel('mantenimiento_' + resolveFlagKey())
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'configuracion', filter: `key=eq.${resolveFlagKey()}` },
        async () => {
          try {
            aplicarEstado(await leerEstado());
          } catch (err) {
            console.warn('[mantenimiento] Error al actualizar estado:', err);
          }
        }
      )
      .subscribe();
    // Limpieza al cerrar (SPA multipágina: no estrictamente necesario).
    window.addEventListener('pagehide', () => supabase.removeChannel(canal), { once: true });
  } catch (err) {
    console.warn('[mantenimiento] Realtime no disponible:', err);
  }
}

/* ==========================================================================
   PRODUCTO COMPARTIDO DURANTE EL MANTENIMIENTO
   Un enlace ?producto=<id> abierto mientras la tienda está cerrada muestra
   la ficha de ESE producto sobre la página de mantenimiento, leyéndolo por
   la función pública producto_publico (el catálogo sigue bloqueado por RLS).
   ========================================================================== */

let productoCompartidoAtendido = false;

/* IDs legados → actuales (tras la renumeración del catálogo). Enlaces
   compartidos antes de la renumeración siguen funcionando. */
const PRODUCTO_IDS_LEGADO = {
  'producto-2': 'producto-1', 'producto-3': 'producto-2', 'producto-4': 'producto-3',
  'producto-6': 'producto-4', 'producto-7': 'producto-5', 'producto-8': 'producto-6',
  'producto-41': 'producto-7', 'producto-13': 'producto-8', 'producto-14': 'producto-9',
  'producto-15': 'producto-10', 'producto-16': 'producto-11', 'producto-17': 'producto-12',
  'producto-18': 'producto-13', 'producto-19': 'producto-14', 'producto-20': 'producto-15',
  'producto-21': 'producto-16', 'producto-22': 'producto-17', 'producto-23': 'producto-18',
  'producto-24': 'producto-19', 'producto-25': 'producto-20', 'producto-26': 'producto-21',
  'producto-27': 'producto-22', 'producto-28': 'producto-23', 'producto-29': 'producto-24',
  'producto-30': 'producto-25', 'producto-31': 'producto-26', 'producto-32': 'producto-27',
  'producto-33': 'producto-28', 'producto-34': 'producto-29', 'producto-35': 'producto-30',
  'producto-36': 'producto-31', 'producto-37': 'producto-32', 'producto-38': 'producto-33'
};

function mntEsc(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function traerProductoPublico(id) {
  const { supabase } = await import('./supabase-config.js');
  const { data, error } = await supabase.rpc('producto_publico', { p_id: String(id) });
  if (error) throw error;
  return data || null;
}

async function mostrarProductoCompartidoEnMantenimiento() {
  if (productoCompartidoAtendido) return;
  const params = new URLSearchParams(window.location.search);
  let id = params.get('producto');
  if (!id) return;
  productoCompartidoAtendido = true;

  try {
    let producto = await traerProductoPublico(id);
    // Compatibilidad: enlaces compartidos antes de la renumeración del catálogo.
    if (!producto) {
      const legado = PRODUCTO_IDS_LEGADO[String(id).trim().toLowerCase()];
      if (legado) producto = await traerProductoPublico(legado);
    }
    if (!producto || !producto.title) return;
    // Sembrar el catálogo en el historial: Atrás desde la ficha mantiene al
    // usuario dentro del sitio (la página de mantenimiento se mantiene).
    try {
      const urlCatalogo = new URL(window.location.href);
      urlCatalogo.searchParams.delete('producto');
      history.replaceState({ tienda: true }, '', urlCatalogo.toString());
      history.pushState(
        { vistaProducto: { id: String(producto.id) }, profundidad: 1 },
        '',
        window.location.href
      );
    } catch { /* sin historial interno disponible */ }
    renderProductoCompartido(producto);
  } catch (err) {
    console.warn('[mantenimiento] No se pudo mostrar el producto compartido:', err);
  }
}

function mntColoresHTML(colores) {
  if (!Array.isArray(colores) || colores.length === 0) return '';
  const items = colores
    .filter((c) => c && c.name)
    .slice(0, 8)
    .map((c) => {
      const hex = /^#[0-9a-fA-F]{3,8}$/.test(String(c.hex || c.value || '')) ? (c.hex || c.value) : '#cccccc';
      return `<span class="mnt-producto-color"><i style="--swatch:${mntEsc(hex)}" aria-hidden="true"></i>${mntEsc(c.name)}</span>`;
    })
    .join('');
  return items ? `<div class="mnt-producto-colores">${items}</div>` : '';
}

function renderProductoCompartido(p) {
  const pagina = document.querySelector('#mantenimiento-overlay .mnt-page');
  if (!pagina) return;

  const imagenes = Array.isArray(p.images) ? p.images : [];
  const imagen = imagenes[0] || p.image || '';
  const storage = Array.isArray(p.variants?.storage) ? p.variants.storage : [];
  const precio = storage.length ? Number(storage[0].price) || 0 : Number(p.price) || 0;
  const colores = Array.isArray(p.variants?.colors) ? p.variants.colors : [];
  const condicion = String(p.condition || '').toLowerCase() === 'seminuevo' ? 'Seminuevo' : 'Nuevo';

  const tarjeta = `
    <article class="mnt-producto" aria-label="Producto compartido">
      ${imagen ? `<img class="mnt-producto-img" src="${mntEsc(imagen)}" alt="${mntEsc(p.title || 'Producto')}" loading="lazy" onerror="this.style.display='none'">` : ''}
      <div class="mnt-producto-info">
        <div class="mnt-producto-fila">
          <span class="mnt-producto-badge ${condicion === 'Nuevo' ? '' : 'is-used'}">${mntEsc(condicion)}</span>
          <span class="mnt-producto-marca">${mntEsc(p.brand || '')}</span>
        </div>
        <h2 class="mnt-producto-nombre">${mntEsc(p.title || 'Producto')}</h2>
        <span class="mnt-producto-precio">L ${precio.toLocaleString('es-HN')}</span>
        ${p.description ? `<p class="mnt-producto-desc">${mntEsc(p.description)}</p>` : ''}
        ${mntColoresHTML(colores)}
        <span class="mnt-producto-nota"><i class="ph ph-clock-countdown" aria-hidden="true"></i> La tienda está temporalmente cerrada. Este producto estará disponible cuando reabramos.</span>
      </div>
    </article>`;
  pagina.insertAdjacentHTML('beforeend', tarjeta);
}

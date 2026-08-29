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

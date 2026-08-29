/* ==========================================================================
   MI PHONE HN — ROUTING MIDDLEWARE (VERCEL)
   ==========================================================================
   Bloqueo SERVER-SIDE del modo mantenimiento para la TIENDA PÚBLICA
   (proyecto de Vercel "mi-phone-hn").

   Cuando el flag de producción está ACTIVO, cualquier ruta pública
   (/, /tienda.html, /soporte.html, y cualquier otra) responde
   HTTP 503 con la página de mantenimiento (compartida desde
   client/mantenimiento-template.js).

   SEGURIDAD Y SEPARACIÓN DE ENTORNOS:
   - Este middleware SIEMPRE controla el scope de PRODUCCIÓN
     (fila 'mantenimiento-produccion' de la tabla configuracion).
   - El entorno LOCAL nunca pasa por aquí: usa el gate del cliente
     (client/mantenimiento-cliente.js) contra la fila
     'mantenimiento-local'. Local no puede tocar producción.
   - Solo LECTURA con la anon key (RLS: lectura pública). Nunca escribe.
   - Fail-open: si Supabase no responde, se sirve la tienda normal
     (disponibilidad primero). Ajustable con MANTENIMIENTO_FAIL_CLOSED=true.

   Variables de entorno (configuradas en Vercel → proyecto mi-phone-hn):
   - VITE_SUPABASE_URL / SUPABASE_URL
   - VITE_SUPABASE_ANON_KEY / SUPABASE_ANON_KEY
   - MANTENIMIENTO_ARTWORK_URL      (opcional, URL del artwork)
   - MANTENIMIENTO_CACHE_S          (opcional, TTL caché, default 20s)
   - MANTENIMIENTO_KILL_SWITCH=true (opcional, desactiva el bloqueo ya
                                     desplegado sin redeploys)
   ========================================================================== */

import { buildMantenimientoHTML, MANTENIMIENTO_DEFAULTS } from './client/mantenimiento-template.js';

export const config = {
  runtime: 'edge'
};

const FLAG_KEY = 'mantenimiento-produccion';
const CACHE_TTL_MS = (Number(process.env.MANTENIMIENTO_CACHE_S) || 20) * 1000;

// Caché en memoria de la instancia edge (evita consultar Supabase en
// cada request; el toggle tarda como máximo este TTL en propagarse).
let cacheFlag = { activo: false, artworkUrl: '', whatsapp: '', expira: 0 };

function envValue(...nombres) {
  for (const n of nombres) {
    const v = process.env[n];
    if (v) return v;
  }
  return '';
}

async function leerEstadoProduccion() {
  const ahora = Date.now();
  if (ahora < cacheFlag.expira) return cacheFlag;

  const url = envValue('VITE_SUPABASE_URL', 'SUPABASE_URL');
  const apiKey = envValue('VITE_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY');

  if (!url || !apiKey) {
    console.warn('[mantenimiento] Faltan variables de Supabase; fail-open.');
    return { activo: false, artworkUrl: '' };
  }

  const base = url.replace(/\/+$/, '');
  const headers = { apikey: apiKey, Authorization: `Bearer ${apiKey}` };

  try {
    const [resFlag, resImg, resWa] = await Promise.all([
      fetch(`${base}/rest/v1/configuracion?select=data&key=eq.${encodeURIComponent(FLAG_KEY)}`, {
        headers, signal: AbortSignal.timeout(5000)
      }),
      // Imagen de mantenimiento subida desde el panel (Imágenes).
      fetch(`${base}/rest/v1/imagenes?select=url,data&id=eq.mantenimiento`, {
        headers, signal: AbortSignal.timeout(5000)
      }),
      // Número de WhatsApp del negocio: única fuente de verdad configurada
      // en el panel (Configuración → WhatsApp). La página de mantenimiento
      // usa el MISMO número, nunca uno hardcodeado.
      fetch(`${base}/rest/v1/configuracion?select=data&key=eq.whatsapp`, {
        headers, signal: AbortSignal.timeout(5000)
      })
    ]);
    if (!resFlag.ok) throw new Error(`HTTP ${resFlag.status}`);

    const filas = await resFlag.json();
    const activo = Boolean(filas?.[0]?.data?.activo);

    let artworkUrl = '';
    if (resImg.ok) {
      const imgFilas = await resImg.json();
      artworkUrl = String(imgFilas?.[0]?.url || imgFilas?.[0]?.data || '');
    }

    let whatsapp = '';
    if (resWa.ok) {
      const waFilas = await resWa.json();
      whatsapp = String(waFilas?.[0]?.data?.phone || '');
    }

    cacheFlag = { activo, artworkUrl, whatsapp, expira: Date.now() + CACHE_TTL_MS };
    return { activo, artworkUrl, whatsapp };
  } catch (err) {
    console.warn('[mantenimiento] No se pudo leer el flag:', err.message);
    if (String(process.env.MANTENIMIENTO_FAIL_CLOSED).toLowerCase() === 'true') {
      // Fail-closed: ante error se muestra mantenimiento (evita vender
      // con el catálogo a medias durante una actualización delicada).
      return { activo: true, artworkUrl: cacheFlag.artworkUrl || '', whatsapp: cacheFlag.whatsapp || '' };
    }
    return { activo: false, artworkUrl: '', whatsapp: '' }; // fail-open por defecto
  }
}

function esRutaExcluida(pathname) {
  if (pathname.startsWith('/api/')) return true;
  // El artwork de mantenimiento debe seguir servible: el HTML 503 lo
  // referencia desde /mantenimiento/ (client/public/mantenimiento/).
  if (pathname.startsWith('/mantenimiento/')) return true;
  return false;
  // NOTA: con mantenimiento activo TAMBIÉN quedan bloqueados /assets/,
  // /fonts/, favicon y cualquier otro estático (incluidos los bundles JS
  // que contienen la anon key de Supabase). El navegador de un visitante
  // no recibe HTML, JS, CSS ni datos de la tienda: solo la página 503.
}

export default async function middleware(request) {
  // Kill-switch de emergencia configurable desde Vercel sin redeploy.
  if (String(process.env.MANTENIMIENTO_KILL_SWITCH).toLowerCase() === 'true') {
    return;
  }

  const { pathname } = new URL(request.url);
  if (esRutaExcluida(pathname)) return;

  const estado = await leerEstadoProduccion();
  if (!estado.activo) return; // Tienda normal (continúa el enrutamiento normal).

  const html = buildMantenimientoHTML({
    // Prioridad: imagen subida desde el panel (Imágenes) → variable de
    // entorno → asset por defecto (client/public/mantenimiento/artwork.svg).
    artworkUrl:
      estado.artworkUrl ||
      process.env.MANTENIMIENTO_ARTWORK_URL ||
      MANTENIMIENTO_DEFAULTS.artworkUrl,
    // WhatsApp: número configurado del negocio (única fuente de verdad).
    whatsapp: estado.whatsapp
  });

  return new Response(html, {
    status: 503,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'retry-after': '600',
      'x-mantenimiento': 'activo'
    }
  });
}

-- ==========================================
-- MODO MANTENIMIENTO — Inicialización de flags
-- Proyecto: Mi Phone HN
-- ==========================================
-- Ejecutar en Supabase → SQL Editor (base de datos de PRODUCCIÓN).
--
-- Crea las dos filas de configuración con el mantenimiento DESACTIVADO:
--   - 'mantenimiento-produccion' : controla la tienda pública desplegada.
--   - 'mantenimiento-local'      : exclusivo del desarrollo local.
--
-- La tabla 'configuracion' ya tiene las políticas RLS necesarias
-- (lectura pública + escritura solo para usuarios autenticados activos),
-- por lo que NO se requieren cambios de permisos.
--
-- Realtime ya está habilitado para 'configuracion' (ALTER PUBLICATION
-- supabase_realtime ADD TABLE public.configuracion en setup_database.sql).
-- ==========================================

INSERT INTO public.configuracion (key, data, updated_at) VALUES
  ('mantenimiento-produccion', '{"activo": false, "actualizadoEn": null, "actualizadoPor": null}', now()),
  ('mantenimiento-local',      '{"activo": false, "actualizadoEn": null, "actualizadoPor": null}', now())
ON CONFLICT (key) DO NOTHING;

-- Verificación (opcional):
-- SELECT key, data FROM public.configuracion WHERE key LIKE 'mantenimiento-%';

-- ==========================================
-- 2. BLOQUEO REAL A NIVEL DE BASE DE DATOS (RLS)
-- ==========================================
-- Con mantenimiento ACTIVO, la API de Supabase (PostgREST) deja de
-- entregar el catálogo público a visitantes anónimos: las consultas a
-- 'productos' y 'categorias' devuelven CERO filas (RLS), incluyendo
-- realtime (postgres_changes respeta RLS).
--
-- Esto es bloqueo server-side real: aunque un atacante conozca la anon
-- key y llame directamente a la API REST (productos, variantes, precios,
-- inventario, búsqueda), NO recibirá datos del catálogo.
--
-- El PANEL ADMIN no se ve afectado: sus consultas usan una sesión
-- autenticada (TO authenticated), cubierta por las políticas de escritura
-- "FOR ALL TO authenticated" que ya incluyen SELECT.
--
-- NOTA: 'configuracion' e 'imagenes' permanecen de lectura pública a
-- propósito (el middleware y la página de mantenimiento los necesitan
-- para conocer el propio flag y el artwork).
-- ==========================================

-- Función: ¿mantenimiento de producción activo? (SECURITY DEFINER evita
-- recursión de RLS al leer 'configuracion').
CREATE OR REPLACE FUNCTION public.mantenimiento_activo_prod()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT (data->>'activo')::boolean
       FROM public.configuracion
      WHERE key = 'mantenimiento-produccion'
      LIMIT 1),
    FALSE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- Productos: lectura pública SOLO si el mantenimiento está desactivado.
DROP POLICY IF EXISTS "Lectura publica de productos" ON public.productos;
CREATE POLICY "Lectura publica de productos" ON public.productos
    FOR SELECT TO anon USING (NOT public.mantenimiento_activo_prod());

-- Categorías: ídem.
DROP POLICY IF EXISTS "Lectura publica de categorias" ON public.categorias;
CREATE POLICY "Lectura publica de categorias" ON public.categorias
    FOR SELECT TO anon USING (NOT public.mantenimiento_activo_prod());

-- Verificación (opcional): con mantenimiento activo, esta consulta hecha
-- con la anon key debe devolver 0 filas:
--   SELECT count(*) FROM public.productos;  -- desde el cliente anon


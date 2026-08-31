-- ============================================================
-- FUNCIÓN: producto_publico(p_id)
-- Expone UN producto por ID para los enlaces compartidos
-- (?producto=<id>), incluso mientras el mantenimiento está activo.
-- ⚠️ EJECUTAR EN AMBOS PROYECTOS: miphone-dev Y PRODUCCIÓN.
-- Pegar TODO y pulsar Run una vez por proyecto.
-- ============================================================

CREATE OR REPLACE FUNCTION public.producto_publico(p_id text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT to_jsonb(p)
  FROM public.productos p
  WHERE p.id = p_id
  LIMIT 1;
$$;

-- Solo anon/authenticated pueden ejecutarla (nunca el rol PUBLIC por defecto)
REVOKE ALL ON FUNCTION public.producto_publico(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.producto_publico(text) TO anon, authenticated;

-- ============================================================
-- VERIFICACIÓN (solo lectura): debe devolver un JSONB con el producto
-- ============================================================
SELECT public.producto_publico('producto-7') AS producto_prueba;

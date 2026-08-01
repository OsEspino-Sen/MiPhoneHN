-- ==========================================
-- SCRIPT DE CONFIGURACIÓN DE BASE DE DATOS
-- PROYECTO: Mi Phone HN
-- ==========================================

-- 1. Tabla de Categorías
CREATE TABLE IF NOT EXISTS public.categorias (
    id VARCHAR PRIMARY KEY,
    label VARCHAR NOT NULL
);

-- Sembrar categorías por defecto
INSERT INTO public.categorias (id, label) VALUES
('iphones', 'iPhones'),
('samsung', 'Samsung'),
('ipads', 'iPads'),
('accessories', 'Accesorios')
ON CONFLICT (id) DO NOTHING;

-- 2. Tabla de Metadatos / Contadores
CREATE TABLE IF NOT EXISTS public._meta (
    key VARCHAR PRIMARY KEY,
    ultimo INTEGER DEFAULT 0 NOT NULL
);

-- 3. Función para obtener el siguiente ID secuencial atómicamente
CREATE OR REPLACE FUNCTION public.obtener_siguiente_id(p_coleccion TEXT, p_contador_doc TEXT, p_prefijo TEXT)
RETURNS TEXT AS $$
DECLARE
  v_ultimo INT;
BEGIN
  INSERT INTO public._meta (key, ultimo)
  VALUES (p_contador_doc, 0)
  ON CONFLICT (key) DO NOTHING;

  UPDATE public._meta
  SET ultimo = ultimo + 1
  WHERE key = p_contador_doc
  RETURNING ultimo INTO v_ultimo;

  RETURN p_prefijo || v_ultimo;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Tabla de Usuarios (Relacionada con auth.users de Supabase Auth)
CREATE TABLE IF NOT EXISTS public.usuarios (
    id VARCHAR PRIMARY KEY,
    uid UUID NOT NULL UNIQUE,
    nombre VARCHAR,
    correo VARCHAR,
    email VARCHAR,
    rol VARCHAR DEFAULT 'editor' CHECK (rol IN ('admin', 'editor')),
    role VARCHAR DEFAULT 'editor',
    activo BOOLEAN DEFAULT TRUE,
    estado VARCHAR DEFAULT 'activo',
    fecha_creacion TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    last_login TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    permisos JSONB
);

-- Función para verificar si un usuario es administrador (evita recursión infinita en RLS)
CREATE OR REPLACE FUNCTION public.es_admin(user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT rol = 'admin' AND activo = TRUE AND estado = 'activo' FROM public.usuarios WHERE uid = user_id LIMIT 1),
    FALSE
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Función para verificar si un usuario está activo
CREATE OR REPLACE FUNCTION public.es_usuario_activo(user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT activo = TRUE AND estado = 'activo' FROM public.usuarios WHERE uid = user_id LIMIT 1),
    FALSE
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Trigger para sincronizar automáticamente nuevos registros de auth.users a public.usuarios
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  v_nuevo_id TEXT;
  v_rol TEXT;
  v_permisos JSONB;
BEGIN
  v_rol := COALESCE(new.raw_user_meta_data->>'rol', 'editor');
  
  IF v_rol = 'admin' THEN
    v_permisos := '{"crearProductos": true, "editarProductos": true, "eliminarProductos": true, "gestionarUsuarios": true, "gestionarLlaves": true, "configuracion": true}'::jsonb;
  ELSE
    v_permisos := '{"crearProductos": false, "editarProductos": true, "eliminarProductos": false, "gestionarUsuarios": false, "gestionarLlaves": false, "configuracion": false}'::jsonb;
  END IF;

  v_nuevo_id := public.obtener_siguiente_id('usuarios', 'contador_usuarios', 'Usuario-Admin-');
  
  INSERT INTO public.usuarios (
    id, uid, nombre, correo, email, rol, role, activo, estado, fecha_creacion, created_at, last_login, permisos
  )
  VALUES (
    v_nuevo_id,
    new.id,
    COALESCE(new.raw_user_meta_data->>'nombre', ''),
    new.email,
    new.email,
    v_rol,
    v_rol,
    TRUE,
    'activo',
    now(),
    now(),
    now(),
    v_permisos
  )
  ON CONFLICT (uid) DO UPDATE
  SET 
    nombre = EXCLUDED.nombre,
    correo = EXCLUDED.correo,
    email = EXCLUDED.email,
    rol = EXCLUDED.rol,
    role = EXCLUDED.role,
    permisos = EXCLUDED.permisos,
    last_login = now();
    
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Eliminar trigger si existe para recrearlo limpiamente
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 5. Tabla de Productos
CREATE TABLE IF NOT EXISTS public.productos (
    id VARCHAR PRIMARY KEY,
    title VARCHAR NOT NULL,
    brand VARCHAR NOT NULL,
    price NUMERIC NOT NULL,
    old_price NUMERIC,
    category VARCHAR REFERENCES public.categorias(id),
    condition VARCHAR CHECK (condition IN ('nuevo', 'seminuevo')),
    badge VARCHAR,
    battery_health INTEGER,
    description TEXT,
    includes TEXT[],
    specs TEXT[],
    variants JSONB DEFAULT '{"colors": [], "storage": []}'::jsonb,
    images TEXT[],
    image VARCHAR,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Tabla de Configuración (Almacena documentos de configuración en JSONB)
CREATE TABLE IF NOT EXISTS public.configuracion (
    key VARCHAR PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 7. Tabla de Imágenes de Configuración (Logo, Banners, etc.)
CREATE TABLE IF NOT EXISTS public.imagenes (
    id VARCHAR PRIMARY KEY,
    url TEXT,
    data TEXT,
    type VARCHAR,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ==========================================
-- POLÍTICAS DE SEGURIDAD (Row Level Security)
-- ==========================================

-- Habilitar RLS en todas las tablas
ALTER TABLE public.productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imagenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._meta ENABLE ROW LEVEL SECURITY;

-- _meta: sin políticas (denegar acceso directo a todos).
-- La única vía de acceso es la función obtener_siguiente_id (SECURITY DEFINER),
-- que corre con privilegios del owner y no necesita RLS.
REVOKE ALL ON public._meta FROM anon, authenticated;

-- Restringir la ejecución de la función de contadores solo a usuarios autenticados
REVOKE EXECUTE ON FUNCTION public.obtener_siguiente_id FROM anon;
GRANT EXECUTE ON FUNCTION public.obtener_siguiente_id TO authenticated;

-- Eliminar políticas previas para evitar duplicados
DROP POLICY IF EXISTS "Lectura publica de productos" ON public.productos;
DROP POLICY IF EXISTS "Escritura de productos por usuarios activos" ON public.productos;
DROP POLICY IF EXISTS "Lectura publica de categorias" ON public.categorias;
DROP POLICY IF EXISTS "Escritura de categorias por usuarios activos" ON public.categorias;
DROP POLICY IF EXISTS "Lectura publica de configuracion" ON public.configuracion;
DROP POLICY IF EXISTS "Escritura de configuracion por usuarios activos" ON public.configuracion;
DROP POLICY IF EXISTS "Lectura publica de imagenes" ON public.imagenes;
DROP POLICY IF EXISTS "Escritura de imagenes por usuarios activos" ON public.imagenes;
DROP POLICY IF EXISTS "Lectura de perfiles por el propio usuario o admin" ON public.usuarios;
DROP POLICY IF EXISTS "Insercion de perfiles solo por admins" ON public.usuarios;
DROP POLICY IF EXISTS "Actualizacion de perfil propio o por admin" ON public.usuarios;
DROP POLICY IF EXISTS "Eliminacion de perfiles solo por admins" ON public.usuarios;

-- 1. Políticas para Productos
CREATE POLICY "Lectura publica de productos" ON public.productos FOR SELECT USING (true);
CREATE POLICY "Escritura de productos por usuarios activos" ON public.productos 
    FOR ALL TO authenticated USING (public.es_usuario_activo(auth.uid())) WITH CHECK (public.es_usuario_activo(auth.uid()));

-- 2. Políticas para Categorías
CREATE POLICY "Lectura publica de categorias" ON public.categorias FOR SELECT USING (true);
CREATE POLICY "Escritura de categorias por usuarios activos" ON public.categorias 
    FOR ALL TO authenticated USING (public.es_usuario_activo(auth.uid())) WITH CHECK (public.es_usuario_activo(auth.uid()));

-- 3. Políticas para Configuración
CREATE POLICY "Lectura publica de configuracion" ON public.configuracion FOR SELECT USING (true);
CREATE POLICY "Escritura de configuracion por usuarios activos" ON public.configuracion 
    FOR ALL TO authenticated USING (public.es_usuario_activo(auth.uid())) WITH CHECK (public.es_usuario_activo(auth.uid()));

-- 4. Políticas para Imágenes de Configuración
CREATE POLICY "Lectura publica de imagenes" ON public.imagenes FOR SELECT USING (true);
CREATE POLICY "Escritura de imagenes por usuarios activos" ON public.imagenes 
    FOR ALL TO authenticated USING (public.es_usuario_activo(auth.uid())) WITH CHECK (public.es_usuario_activo(auth.uid()));

-- 5. Políticas para la tabla de Usuarios
CREATE POLICY "Lectura de perfiles por el propio usuario o admin" ON public.usuarios
    FOR SELECT TO authenticated USING (auth.uid() = uid OR public.es_admin(auth.uid()));

CREATE POLICY "Insercion de perfiles solo por admins" ON public.usuarios
    FOR INSERT TO authenticated WITH CHECK (public.es_admin(auth.uid()));

CREATE POLICY "Actualizacion de perfil propio o por admin" ON public.usuarios
    FOR UPDATE TO authenticated 
    USING (auth.uid() = uid OR public.es_admin(auth.uid()))
    WITH CHECK (
        public.es_admin(auth.uid())
        OR (
            auth.uid() = uid
            AND rol = (SELECT rol FROM public.usuarios WHERE uid = auth.uid())
            AND role = (SELECT role FROM public.usuarios WHERE uid = auth.uid())
            AND activo = (SELECT activo FROM public.usuarios WHERE uid = auth.uid())
            AND estado = (SELECT estado FROM public.usuarios WHERE uid = auth.uid())
        )
    );

CREATE POLICY "Eliminacion de perfiles solo por admins" ON public.usuarios
    FOR DELETE TO authenticated USING (public.es_admin(auth.uid()));

-- ==========================================
-- REALTIME: habilitar para las tablas que el frontend observa con onSnapshot
-- ==========================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.productos;
ALTER PUBLICATION supabase_realtime ADD TABLE public.categorias;
ALTER PUBLICATION supabase_realtime ADD TABLE public.configuracion;
ALTER PUBLICATION supabase_realtime ADD TABLE public.imagenes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.usuarios;

-- ============================================================
-- RENUMERAR IDS DE PRODUCTOS (orden por fecha de creación)
-- ⚠️ EJECUTAR SOLO EN EL PROYECTO: miphone-dev
-- Pegar TODO este archivo en el SQL Editor y pulsar Run UNA VEZ.
-- Transaccional: si algo no cuadra, revierte solo.
-- ============================================================
BEGIN;

-- Guarda: aborta si el conteo del catálogo no es exactamente 33
DO $$
BEGIN
  IF (SELECT count(*) FROM public.productos) <> 33 THEN
    RAISE EXCEPTION 'El catalogo no tiene 33 productos. Ejecucion abortada (no se cambio nada).';
  END IF;
END $$;

-- FASE 1: mover a IDs temporales (evita colisiones de clave primaria)
UPDATE productos SET id='tmp-1'  WHERE id='producto-2';
UPDATE productos SET id='tmp-2'  WHERE id='producto-3';
UPDATE productos SET id='tmp-3'  WHERE id='producto-4';
UPDATE productos SET id='tmp-4'  WHERE id='producto-6';
UPDATE productos SET id='tmp-5'  WHERE id='producto-7';
UPDATE productos SET id='tmp-6'  WHERE id='producto-8';
UPDATE productos SET id='tmp-7'  WHERE id='producto-41';
UPDATE productos SET id='tmp-8'  WHERE id='producto-13';
UPDATE productos SET id='tmp-9'  WHERE id='producto-14';
UPDATE productos SET id='tmp-10' WHERE id='producto-15';
UPDATE productos SET id='tmp-11' WHERE id='producto-16';
UPDATE productos SET id='tmp-12' WHERE id='producto-17';
UPDATE productos SET id='tmp-13' WHERE id='producto-18';
UPDATE productos SET id='tmp-14' WHERE id='producto-19';
UPDATE productos SET id='tmp-15' WHERE id='producto-20';
UPDATE productos SET id='tmp-16' WHERE id='producto-21';
UPDATE productos SET id='tmp-17' WHERE id='producto-22';
UPDATE productos SET id='tmp-18' WHERE id='producto-23';
UPDATE productos SET id='tmp-19' WHERE id='producto-24';
UPDATE productos SET id='tmp-20' WHERE id='producto-25';
UPDATE productos SET id='tmp-21' WHERE id='producto-26';
UPDATE productos SET id='tmp-22' WHERE id='producto-27';
UPDATE productos SET id='tmp-23' WHERE id='producto-28';
UPDATE productos SET id='tmp-24' WHERE id='producto-29';
UPDATE productos SET id='tmp-25' WHERE id='producto-30';
UPDATE productos SET id='tmp-26' WHERE id='producto-31';
UPDATE productos SET id='tmp-27' WHERE id='producto-32';
UPDATE productos SET id='tmp-28' WHERE id='producto-33';
UPDATE productos SET id='tmp-29' WHERE id='producto-34';
UPDATE productos SET id='tmp-30' WHERE id='producto-35';
UPDATE productos SET id='tmp-31' WHERE id='producto-36';
UPDATE productos SET id='tmp-32' WHERE id='producto-37';
UPDATE productos SET id='tmp-33' WHERE id='producto-38';

-- FASE 2: asignar IDs definitivos producto-1..33 (por fecha de creación)
UPDATE productos SET id='producto-1'  WHERE id='tmp-1';  -- iPhone 11
UPDATE productos SET id='producto-2'  WHERE id='tmp-2';  -- iPhone 13
UPDATE productos SET id='producto-3'  WHERE id='tmp-3';  -- iPhone 13 Pro
UPDATE productos SET id='producto-4'  WHERE id='tmp-4';  -- Samsung Galaxy S26 Ultra
UPDATE productos SET id='producto-5'  WHERE id='tmp-5';  -- iPhone 13
UPDATE productos SET id='producto-6'  WHERE id='tmp-6';  -- Apple Cable USB-C
UPDATE productos SET id='producto-7'  WHERE id='tmp-7';  -- iPhone 17 Pro
UPDATE productos SET id='producto-8'  WHERE id='tmp-8';  -- iPhone 16 Plus
UPDATE productos SET id='producto-9'  WHERE id='tmp-9';  -- iPhone 17 Pro Max
UPDATE productos SET id='producto-10' WHERE id='tmp-10'; -- iPhone 14 Pro Max
UPDATE productos SET id='producto-11' WHERE id='tmp-11'; -- iPhone 15
UPDATE productos SET id='producto-12' WHERE id='tmp-12'; -- iPhone 15 Plus
UPDATE productos SET id='producto-13' WHERE id='tmp-13'; -- iPhone 15 Plus
UPDATE productos SET id='producto-14' WHERE id='tmp-14'; -- iPhone 15 Plus
UPDATE productos SET id='producto-15' WHERE id='tmp-15'; -- iPhone 16 Pro
UPDATE productos SET id='producto-16' WHERE id='tmp-16'; -- iPhone 12
UPDATE productos SET id='producto-17' WHERE id='tmp-17'; -- iPHone 17 (Nuevo)
UPDATE productos SET id='producto-18' WHERE id='tmp-18'; -- Samsung S23 Ultra
UPDATE productos SET id='producto-19' WHERE id='tmp-19'; -- Samsung A36
UPDATE productos SET id='producto-20' WHERE id='tmp-20'; -- Samsung A07
UPDATE productos SET id='producto-21' WHERE id='tmp-21'; -- CablE Lightning
UPDATE productos SET id='producto-22' WHERE id='tmp-22'; -- Samsung Galaxy S21 Ultra
UPDATE productos SET id='producto-23' WHERE id='tmp-23'; -- Apple Pencil Type C
UPDATE productos SET id='producto-24' WHERE id='tmp-24'; -- EarPods Type C
UPDATE productos SET id='producto-25' WHERE id='tmp-25'; -- EarPods Type Lightning
UPDATE productos SET id='producto-26' WHERE id='tmp-26'; -- Apple Watch SE 3th GEN/ 44mm
UPDATE productos SET id='producto-27' WHERE id='tmp-27'; -- Apple Watch Series 11/ 42mm
UPDATE productos SET id='producto-28' WHERE id='tmp-28'; -- iPhone 13 Pro Max
UPDATE productos SET id='producto-29' WHERE id='tmp-29'; -- iPhone 14 Pro
UPDATE productos SET id='producto-30' WHERE id='tmp-30'; -- iPhone 16
UPDATE productos SET id='producto-31' WHERE id='tmp-31'; -- iPhone 16 Plus
UPDATE productos SET id='producto-32' WHERE id='tmp-32'; -- iPhone 16 Pro Max
UPDATE productos SET id='producto-33' WHERE id='tmp-33'; -- Apple Adaptador USB-C 20W

-- Contador al día: los próximos productos serán producto-34 en adelante
INSERT INTO _meta (key, ultimo) VALUES ('contador_productos', 33)
ON CONFLICT (key) DO UPDATE SET ultimo = 33;

COMMIT;

-- ============================================================
-- VERIFICACIÓN (solo lectura, se ejecuta sola al final)
-- ============================================================
SELECT count(*) AS total_productos FROM productos;
SELECT id, title FROM productos ORDER BY id ASC LIMIT 5;
SELECT id, title FROM productos ORDER BY id ASC OFFSET 28;
SELECT * FROM _meta WHERE key = 'contador_productos';

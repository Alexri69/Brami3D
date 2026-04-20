-- Brami3D — Configuración internacional
-- Formato de fecha, separador decimal, segundo impuesto y prefijos de numeración
-- Ejecutar en Supabase SQL Editor una sola vez.

ALTER TABLE public.config
  ADD COLUMN IF NOT EXISTS formato_fecha       text         NOT NULL DEFAULT 'DD/MM/YYYY',
  ADD COLUMN IF NOT EXISTS separador_decimal   text         NOT NULL DEFAULT '.',
  ADD COLUMN IF NOT EXISTS tipo_iva2           numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nombre_impuesto2    text         NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS prefijo_presupuesto text         NOT NULL DEFAULT 'B3D',
  ADD COLUMN IF NOT EXISTS prefijo_factura     text         NOT NULL DEFAULT 'B3D-F';

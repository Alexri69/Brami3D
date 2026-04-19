-- Brami3D — Fiscalidad configurable por usuario
-- Permite usar IVA (España), VAT (UK/EU), GST (Australia/India), Sales Tax (EEUU), etc.
-- Ejecutar en Supabase SQL Editor una sola vez.

ALTER TABLE public.config
  ADD COLUMN IF NOT EXISTS tipo_iva        numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nombre_impuesto text         NOT NULL DEFAULT 'IVA';

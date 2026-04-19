-- Brami3D — Fecha de entrega prometida en pedidos
-- Ejecutar en Supabase SQL Editor una sola vez.

ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS fecha_entrega date;

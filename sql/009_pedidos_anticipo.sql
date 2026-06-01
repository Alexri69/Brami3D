-- Brami3D — Anticipo / señal cobrada por adelantado en pedidos
-- Permite registrar pagos parciales: lo ya cobrado a cuenta y, por diferencia,
-- el importe pendiente. La app detecta la columna automáticamente; hasta
-- ejecutar esto el campo de anticipo no se muestra.
-- Ejecutar en Supabase SQL Editor una sola vez.

ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS anticipo numeric DEFAULT 0;

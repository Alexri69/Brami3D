-- Brami3D — Mantenimiento programado de impresoras
-- Cada impresora avisa cuando lleva X horas desde el último mantenimiento.
-- Ejecutar en Supabase SQL Editor una sola vez.

alter table public.impresoras add column if not exists mantenimiento_cada integer not null default 250;
alter table public.impresoras add column if not exists ultimo_mant_h     numeric not null default 0;

-- Que las impresoras existentes empiecen "al día" (contador desde sus horas actuales),
-- para que no salgan todas como "toca mantenimiento" de golpe.
update public.impresoras set ultimo_mant_h = horas_uso where ultimo_mant_h = 0;

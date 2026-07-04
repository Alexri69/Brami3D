-- ============================================================================
-- Brami3D — sql/023: serie propia para facturas rectificativas
-- ============================================================================
-- Ejecutar en Supabase SQL Editor una sola vez. Es idempotente.
--
-- Las rectificativas (nueva UI en Registro fiscal) llevan su PROPIA serie de
-- numeración (p. ej. B3D-F-R-2026-001), como exige la normativa. Esto amplía
-- la RPC atómica de sql/020 para aceptar el contador 'rectnum'.
-- Mientras no se aplique, la app usa el fallback leer+escribir (funciona,
-- pero sin garantía atómica entre dos dispositivos a la vez).
-- ============================================================================

create or replace function public.siguiente_contador(p_tipo text, p_anio int)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_val integer;
begin
  if v_uid is null then
    raise exception 'no autenticado' using errcode = '42501';
  end if;
  if p_tipo not in ('presnum','factnum','rectnum') then
    raise exception 'tipo de contador no válido' using errcode = '22023';
  end if;

  insert into public.contadores (user_id, tipo, anio, valor)
  values (v_uid, p_tipo, p_anio, 1)
  on conflict (user_id, tipo, anio)
  do update set valor = contadores.valor + 1
  returning valor into v_val;

  return v_val;
end;
$$;

revoke all on function public.siguiente_contador(text, int) from public;
grant execute on function public.siguiente_contador(text, int) to authenticated;

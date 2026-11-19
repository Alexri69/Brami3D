-- ============================================================================
-- Brami3D — sql/030: borrar cuenta cuando solo hay eventos del SIF, sin facturas
-- ============================================================================
-- Ejecutar en Supabase SQL Editor una sola vez. Es idempotente.
--
-- Problema: facturas_eventos es inmutable (trigger tg_no_update_delete) y tiene
-- FK a auth.users con ON DELETE CASCADE. Al empezar a usar la facturación se
-- apunta un evento «inicio» aunque no se emita ninguna factura, así que borrar
-- ese usuario fallaba (el cascade chocaba con el trigger).
--
-- Solución: el trigger deja pasar el DELETE solo si la sesión lleva la marca
-- local brami3d.borrar_eventos = 'on', y esa marca solo la pone la función
-- borrar_eventos_sin_facturas(), que comprueba antes que el usuario NO tiene
-- ninguna factura. Con facturas sigue todo igual: la cuenta se anonimiza.
-- Solo la puede ejecutar service_role (Edge Function borrar-cuenta).
-- ============================================================================

create or replace function public.tg_no_update_delete()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE'
     and tg_table_name = 'facturas_eventos'
     and current_setting('brami3d.borrar_eventos', true) = 'on' then
    return old;
  end if;
  raise exception 'Tabla inmutable: no se permiten % sobre %',
    tg_op, tg_table_name;
end; $$;

create or replace function public.borrar_eventos_sin_facturas(p_uid uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if p_uid is null then raise exception 'falta el usuario'; end if;
  if exists (select 1 from public.facturas_registro where user_id = p_uid) then
    raise exception 'El usuario tiene facturas: no se borra su registro fiscal';
  end if;
  perform set_config('brami3d.borrar_eventos', 'on', true);   -- solo esta transacción
  delete from public.facturas_eventos where user_id = p_uid;
  get diagnostics v_n = row_count;
  perform set_config('brami3d.borrar_eventos', 'off', true);
  return v_n;
end $$;
revoke execute on function public.borrar_eventos_sin_facturas(uuid) from public, anon, authenticated;
grant  execute on function public.borrar_eventos_sin_facturas(uuid) to service_role;

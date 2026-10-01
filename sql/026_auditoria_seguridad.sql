-- ============================================================================
-- Brami3D — sql/026: correcciones de la auditoría de seguridad (2026-10-01)
-- ============================================================================
-- Ejecutar en Supabase SQL Editor una sola vez. Es idempotente.
--
-- 1) Quita el permiso de ejecución a funciones internas SECURITY DEFINER que
--    quedaron expuestas a anon/authenticated. En Supabase `revoke ... from
--    public` NO basta: anon y authenticated tienen grants propios.
--      · _sumar_trial      → cualquiera (¡incluso sin cuenta!) podía darse Pro
--      · es_pro            → filtraba el plan de cualquier uid
--      · email_envio_check → permitía agotar la cuota de emails de otro usuario
--    Las funciones que las usan (aplicar_referido, check_limites_free) corren
--    como owner y la Edge Function enviar-doc usa service_role: siguen igual.
-- 2) Referidos: la recompensa al que invita se limita a 12 (≈1 año de Pro) y
--    el invitado debe tener el email confirmado (frena el farmeo con cuentas
--    desechables).
-- 3) is_admin(): incluye brami3d@gmail.com, igual que ADMIN_EMAILS de la app.
-- 4) Cadena VeriFactu: índice único (user_id, hash_anterior) → dos facturas
--    emitidas a la vez (doble clic, dos dispositivos) ya no pueden colgar del
--    mismo eslabón; la segunda falla y la app reintenta con el hash nuevo.
-- ============================================================================

-- 1) Permisos ----------------------------------------------------------------
revoke execute on function public._sumar_trial(uuid, int)      from public, anon, authenticated;
revoke execute on function public.es_pro(uuid)                 from public, anon, authenticated;
revoke execute on function public.email_envio_check(uuid, int) from public, anon, authenticated;
grant  execute on function public.es_pro(uuid)                 to service_role;
grant  execute on function public.email_envio_check(uuid, int) to service_role;

-- 2) Referidos con tope ------------------------------------------------------
create or replace function public.aplicar_referido(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_new uuid := auth.uid();
  v_ref uuid;
  v_created timestamptz;
  v_confirmed timestamptz;
  v_n int;
begin
  if v_new is null then return json_build_object('ok', false, 'error', 'no auth'); end if;
  select user_id into v_ref from public.user_plans where ref_code = upper(p_code) limit 1;
  if v_ref is null then return json_build_object('ok', false, 'error', 'codigo no valido'); end if;
  if v_ref = v_new then return json_build_object('ok', false, 'error', 'autoinvitacion'); end if;
  select created_at, email_confirmed_at into v_created, v_confirmed from auth.users where id = v_new;
  if v_created < now() - interval '3 days' then return json_build_object('ok', false, 'error', 'cuenta no nueva'); end if;
  if v_confirmed is null then return json_build_object('ok', false, 'error', 'email sin confirmar'); end if;
  if exists (select 1 from public.referidos where referred_user_id = v_new) then
    return json_build_object('ok', false, 'error', 'ya referido');
  end if;
  select count(*) into v_n from public.referidos where referrer_user_id = v_ref;
  insert into public.referidos(referrer_user_id, referred_user_id) values (v_ref, v_new);
  perform public._sumar_trial(v_new, 30);
  if v_n < 12 then
    perform public._sumar_trial(v_ref, 30);
  end if;
  return json_build_object('ok', true);
end; $$;
revoke execute on function public.aplicar_referido(text) from public, anon;
grant  execute on function public.aplicar_referido(text) to authenticated;

-- 3) is_admin con los dos emails del owner -----------------------------------
create or replace function public.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    return false;
  end if;
  if exists (
    select 1 from auth.users u
    where u.id = caller_id
      and lower(u.email) in ('alexri69@gmail.com','brami3d@gmail.com')
  ) then
    return true;
  end if;
  return coalesce(
    (select (p.plan = 'admin') from public.user_plans p where p.user_id = caller_id),
    false
  );
end;
$$;

-- 4) Un solo sucesor por eslabón de la cadena de facturas --------------------
do $$
begin
  if exists (
    select 1 from public.facturas_registro
    group by user_id, hash_anterior having count(*) > 1
  ) then
    raise notice 'AVISO: ya hay cadenas bifurcadas; no se crea el índice. Revisa con: select user_id, hash_anterior, count(*) from facturas_registro group by 1,2 having count(*)>1;';
  else
    create unique index if not exists facturas_registro_user_prev_uidx
      on public.facturas_registro(user_id, hash_anterior);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Comprobaciones (ejecutar a mano y revisar):
--
-- ¿Alguien se dio Pro con _sumar_trial?
--   select u.email, p.trial_until from public.user_plans p
--   join auth.users u on u.id = p.user_id
--   where p.trial_until > now() + interval '60 days';
--
-- Políticas del bucket `archivos` (deben limitar a la carpeta {uid}/ del
-- usuario: (storage.foldername(name))[1] = auth.uid()::text):
--   select policyname, cmd, roles, qual, with_check from pg_policies
--   where schemaname = 'storage' and tablename = 'objects';
--   select id, public from storage.buckets;   -- archivos debe ser public=false
-- ----------------------------------------------------------------------------

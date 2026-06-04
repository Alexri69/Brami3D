-- Brami3D — Programa de referidos (recompensa: +30 días de Pro a ambos)
-- Sin Edge Functions: todo con RPCs SECURITY DEFINER que llama la app.
-- Ejecutar en Supabase SQL Editor una sola vez.

-- 1) Código de invitación por usuario (en user_plans)
alter table public.user_plans add column if not exists ref_code text;
create unique index if not exists user_plans_ref_code_uidx on public.user_plans(ref_code) where ref_code is not null;

-- 2) Registro de referidos (1 recompensa por usuario referido)
create table if not exists public.referidos (
  id                uuid primary key default gen_random_uuid(),
  referrer_user_id  uuid not null references auth.users(id) on delete cascade,
  referred_user_id  uuid not null unique references auth.users(id) on delete cascade,
  created_at        timestamptz not null default now()
);
alter table public.referidos enable row level security;
-- el que invita puede ver a quién ha referido (para contar)
drop policy if exists "referidos_select_own" on public.referidos;
create policy "referidos_select_own" on public.referidos
  for select to authenticated using (auth.uid() = referrer_user_id);

-- 3) Helper interno: suma N días de prueba/Pro a un usuario
create or replace function public._sumar_trial(p_uid uuid, p_dias int)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_plans(user_id, trial_until)
  values (p_uid, now() + (p_dias || ' days')::interval)
  on conflict (user_id) do update
    set trial_until = greatest(coalesce(user_plans.trial_until, now()), now()) + (p_dias || ' days')::interval;
end; $$;

-- 4) Devuelve (y crea si no existe) el código de invitación del usuario actual
create or replace function public.mi_ref_code()
returns text language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_code text;
begin
  if v_uid is null then return null; end if;
  select ref_code into v_code from public.user_plans where user_id = v_uid;
  if v_code is null then
    v_code := upper(substr(md5(random()::text || v_uid::text), 1, 6));
    insert into public.user_plans(user_id, ref_code) values (v_uid, v_code)
      on conflict (user_id) do update set ref_code = coalesce(user_plans.ref_code, excluded.ref_code);
    select ref_code into v_code from public.user_plans where user_id = v_uid;
  end if;
  return v_code;
end; $$;
grant execute on function public.mi_ref_code() to authenticated;

-- 5) Aplica un referido: lo llama el usuario NUEVO con el código de quien le invitó
create or replace function public.aplicar_referido(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare v_new uuid := auth.uid(); v_ref uuid; v_created timestamptz;
begin
  if v_new is null then return json_build_object('ok', false, 'error', 'no auth'); end if;
  select user_id into v_ref from public.user_plans where ref_code = upper(p_code) limit 1;
  if v_ref is null then return json_build_object('ok', false, 'error', 'codigo no valido'); end if;
  if v_ref = v_new then return json_build_object('ok', false, 'error', 'autoinvitacion'); end if;
  select created_at into v_created from auth.users where id = v_new;
  if v_created < now() - interval '3 days' then return json_build_object('ok', false, 'error', 'cuenta no nueva'); end if;
  if exists (select 1 from public.referidos where referred_user_id = v_new) then
    return json_build_object('ok', false, 'error', 'ya referido');
  end if;
  insert into public.referidos(referrer_user_id, referred_user_id) values (v_ref, v_new);
  perform public._sumar_trial(v_new, 30);
  perform public._sumar_trial(v_ref, 30);
  return json_build_object('ok', true);
end; $$;
grant execute on function public.aplicar_referido(text) to authenticated;

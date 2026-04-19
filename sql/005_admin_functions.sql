-- ============================================================================
-- Brami3D — Panel de administración (RPC SECURITY DEFINER)
-- ============================================================================
-- Ejecutar en Supabase SQL Editor UNA sola vez. Es idempotente.
--
-- Qué hace:
--   1) Añade columnas `blocked` y `notes` a user_plans (notes ya existe en 002,
--      la añadimos con IF NOT EXISTS por si alguien empezó antes de 002).
--   2) Crea helper is_admin() que comprueba si auth.uid() es admin, vía:
--        a) email del caller está en ADMIN_EMAILS_SQL (hardcoded aquí)
--        b) user_plans.plan = 'admin'
--   3) admin_list_users()  — lista usuarios con plan, stats, flags.
--   4) admin_set_plan()    — cambia plan / expires_at / trial_until.
--   5) admin_set_blocked() — bloquea/desbloquea login de un usuario.
--   6) admin_set_notes()   — guarda notas internas libres del usuario.
--
-- Seguridad:
--   - Todas las funciones SECURITY DEFINER pero EL PRIMER THING que hacen es
--     llamar a is_admin() y si no, raise exception. Sin esto cualquier usuario
--     autenticado podría llamarlas vía RPC y escalar privilegios.
--   - admin_set_plan() NO permite fijar plan='admin' desde RPC para evitar
--     promoción de admin por accidente/compromiso — el owner lo hace con SQL.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Columnas nuevas en user_plans
-- ----------------------------------------------------------------------------
alter table public.user_plans
  add column if not exists blocked boolean not null default false;

alter table public.user_plans
  add column if not exists notes text;

comment on column public.user_plans.blocked is
  'Si true, el cliente fuerza logout al detectarlo (enforced en JS).';

-- ----------------------------------------------------------------------------
-- Helper: emails admin hardcoded (refleja ADMIN_EMAILS de brami3d_supabase.html)
-- ----------------------------------------------------------------------------
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

  -- Comprobar email whitelist (ADMIN_EMAILS_SQL)
  if exists (
    select 1 from auth.users u
    where u.id = caller_id
      and lower(u.email) = 'alexri69@gmail.com'
  ) then
    return true;
  end if;

  -- Comprobar plan='admin' en user_plans
  return coalesce(
    (select (p.plan = 'admin') from public.user_plans p where p.user_id = caller_id),
    false
  );
end;
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ----------------------------------------------------------------------------
-- admin_list_users()
-- Devuelve una fila por usuario registrado con plan y métricas básicas.
-- ----------------------------------------------------------------------------
create or replace function public.admin_list_users()
returns table (
  user_id       uuid,
  email         text,
  created_at    timestamptz,
  last_sign_in_at timestamptz,
  plan          text,
  expires_at    timestamptz,
  trial_until   timestamptz,
  blocked       boolean,
  notes         text,
  n_pedidos     bigint,
  n_clientes    bigint,
  n_impresoras  bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  return query
  select
    u.id                                           as user_id,
    u.email::text                                  as email,
    u.created_at,
    u.last_sign_in_at,
    coalesce(p.plan, 'free')                       as plan,
    p.expires_at,
    p.trial_until,
    coalesce(p.blocked, false)                     as blocked,
    p.notes,
    (select count(*) from public.pedidos    x where x.user_id = u.id) as n_pedidos,
    (select count(*) from public.clientes   x where x.user_id = u.id) as n_clientes,
    (select count(*) from public.impresoras x where x.user_id = u.id) as n_impresoras
  from auth.users u
  left join public.user_plans p on p.user_id = u.id
  order by u.created_at desc;
end;
$$;

revoke all on function public.admin_list_users() from public;
grant execute on function public.admin_list_users() to authenticated;

-- ----------------------------------------------------------------------------
-- admin_set_plan(target_user, new_plan, new_expires_at, new_trial_until)
-- NOTE: No acepta 'admin' — para evitar que el RPC pueda promocionar admin.
-- ----------------------------------------------------------------------------
create or replace function public.admin_set_plan(
  target_user      uuid,
  new_plan         text,
  new_expires_at   timestamptz default null,
  new_trial_until  timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  if new_plan not in ('free','pro') then
    raise exception 'plan must be free or pro (admin only via dashboard SQL)'
      using errcode = '22023';
  end if;

  insert into public.user_plans (user_id, plan, expires_at, trial_until, updated_at)
  values (target_user, new_plan, new_expires_at, new_trial_until, now())
  on conflict (user_id) do update
    set plan        = excluded.plan,
        expires_at  = excluded.expires_at,
        trial_until = excluded.trial_until,
        updated_at  = now();
end;
$$;

revoke all on function public.admin_set_plan(uuid, text, timestamptz, timestamptz) from public;
grant execute on function public.admin_set_plan(uuid, text, timestamptz, timestamptz) to authenticated;

-- ----------------------------------------------------------------------------
-- admin_set_blocked(target_user, blocked)
-- ----------------------------------------------------------------------------
create or replace function public.admin_set_blocked(
  target_user uuid,
  new_blocked boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  insert into public.user_plans (user_id, plan, blocked, updated_at)
  values (target_user, 'free', new_blocked, now())
  on conflict (user_id) do update
    set blocked    = excluded.blocked,
        updated_at = now();
end;
$$;

revoke all on function public.admin_set_blocked(uuid, boolean) from public;
grant execute on function public.admin_set_blocked(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- admin_set_notes(target_user, notes)
-- ----------------------------------------------------------------------------
create or replace function public.admin_set_notes(
  target_user uuid,
  new_notes   text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  insert into public.user_plans (user_id, plan, notes, updated_at)
  values (target_user, 'free', new_notes, now())
  on conflict (user_id) do update
    set notes      = excluded.notes,
        updated_at = now();
end;
$$;

revoke all on function public.admin_set_notes(uuid, text) from public;
grant execute on function public.admin_set_notes(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Verificación rápida (ejecutar tras correr lo anterior, debería devolver filas):
--
--   select * from public.admin_list_users();
-- ----------------------------------------------------------------------------

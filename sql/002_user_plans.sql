-- ============================================================================
-- Brami3D — Planes de usuario (free / pro / admin)
-- ============================================================================
-- Ejecutar en Supabase SQL Editor una sola vez.
--
-- Modelo:
--   - Una fila por usuario en user_plans.
--   - RLS permite al usuario LEER su propio plan pero NO modificarlo.
--   - Solo el owner del proyecto puede cambiar el plan desde:
--       a) el dashboard de Supabase (Table editor), o
--       b) una Edge Function autenticada con service_role,
--       o c) un endpoint backend futuro con validación de pago.
--   - Trigger on auth.users INSERT → crea fila 'free' automáticamente al signup.
--
-- Complemento en cliente:
--   - Whitelist ADMIN_EMAILS en JS da plan='admin' al owner (alexri69@gmail.com)
--     sin depender de esta tabla, por si la fila no existe.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tabla: user_plans
-- ----------------------------------------------------------------------------
create table if not exists public.user_plans (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  plan        text not null default 'free'
              check (plan in ('free','pro','admin')),
  started_at  timestamptz not null default now(),
  expires_at  timestamptz,                          -- null = sin expiración (admin o free)
  trial_until timestamptz,                          -- null o fecha fin de trial 30d
  notes       text,
  updated_at  timestamptz not null default now()
);

create index if not exists idx_user_plans_expires on public.user_plans(expires_at)
  where expires_at is not null;

comment on table  public.user_plans is 'Plan activo por usuario. Modificable solo por service_role.';
comment on column public.user_plans.plan         is 'free | pro | admin';
comment on column public.user_plans.expires_at   is 'Fecha hasta la que el plan Pro está activo; null si es free o admin.';
comment on column public.user_plans.trial_until  is 'Fecha hasta la que el usuario puede actuar como Pro gratis (30 días desde signup).';

-- ----------------------------------------------------------------------------
-- RLS: el cliente solo puede LEER su propio plan
-- (no hay policy para INSERT/UPDATE/DELETE → bloqueado para anon/authenticated)
-- ----------------------------------------------------------------------------
alter table public.user_plans enable row level security;

drop policy if exists "user_plans_select_own" on public.user_plans;
create policy "user_plans_select_own"
  on public.user_plans for select
  to authenticated
  using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- Trigger: al crear un usuario en auth.users, crear fila free + trial 30 días
-- ----------------------------------------------------------------------------
create or replace function public.tg_create_default_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_plans (user_id, plan, started_at, trial_until)
  values (NEW.id, 'free', now(), now() + interval '30 days')
  on conflict (user_id) do nothing;
  return NEW;
end;
$$;

drop trigger if exists on_auth_user_created_plan on auth.users;
create trigger on_auth_user_created_plan
  after insert on auth.users
  for each row execute function public.tg_create_default_plan();

-- ----------------------------------------------------------------------------
-- Backfill: crear fila para usuarios ya existentes que no la tengan
-- ----------------------------------------------------------------------------
insert into public.user_plans (user_id, plan, started_at, trial_until)
select u.id, 'free', coalesce(u.created_at, now()),
       coalesce(u.created_at, now()) + interval '30 days'
from auth.users u
left join public.user_plans p on p.user_id = u.id
where p.user_id is null;

-- ----------------------------------------------------------------------------
-- Conveniencia: marcar a Alexander como admin (opcional — el whitelist en JS
-- ya le da acceso, pero así también queda reflejado en BD por consistencia).
-- Descomenta si quieres:
-- ----------------------------------------------------------------------------
-- update public.user_plans
-- set plan='admin', trial_until=null, expires_at=null, notes='Owner / creador de Brami3D'
-- where user_id = (select id from auth.users where email='alexri69@gmail.com');

-- ----------------------------------------------------------------------------
-- Uso (desde dashboard Supabase, pestaña SQL):
--
--   -- Dar Pro a un usuario por 1 año:
--   update public.user_plans
--     set plan='pro', expires_at=now()+interval '1 year', notes='Pago anual 2026'
--     where user_id=(select id from auth.users where email='cliente@ejemplo.com');
--
--   -- Volver a free al expirar:
--   update public.user_plans set plan='free', expires_at=null
--     where user_id='<uuid>';
--
--   -- Ver planes activos:
--   select u.email, p.plan, p.expires_at, p.trial_until
--   from public.user_plans p join auth.users u on u.id=p.user_id
--   order by p.plan, u.email;
-- ----------------------------------------------------------------------------

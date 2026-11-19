-- ============================================================================
-- Brami3D — sql/029: gastos desde Telegram (foto del tique → gasto)
-- ============================================================================
-- Ejecutar en Supabase SQL Editor una sola vez. Es idempotente.
--
-- · telegram_vinculos   → qué chat de Telegram es de qué usuario (1 a 1).
-- · telegram_codigos    → código de un solo uso (15 min) para vincular el chat.
-- · telegram_pendientes → tique leído y esperando «Guardar» en el chat; también
--                          sirve para el límite diario de fotos.
-- · gastos.foto_path    → ruta del tique en Storage (archivos/{uid}/tiques/…).
-- · telegram_codigo()   → la app pide un código. De momento SOLO administradores
--                          (is_admin()); para abrirlo al plan Pro, cambiar esa
--                          comprobación por public.es_pro(v_uid).
-- La Edge Function telegram-gastos usa service_role: no necesita políticas.
-- ============================================================================

create table if not exists public.telegram_vinculos (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chat_id bigint not null unique,
  creado  timestamptz not null default now()
);
alter table public.telegram_vinculos enable row level security;
drop policy if exists tv_select on public.telegram_vinculos;
create policy tv_select on public.telegram_vinculos for select to authenticated using (user_id = auth.uid());
drop policy if exists tv_delete on public.telegram_vinculos;
create policy tv_delete on public.telegram_vinculos for delete to authenticated using (user_id = auth.uid());

create table if not exists public.telegram_codigos (
  codigo  text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expira  timestamptz not null
);
alter table public.telegram_codigos enable row level security;   -- sin políticas: solo service_role

create table if not exists public.telegram_pendientes (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) on delete cascade,
  chat_id   bigint not null,
  datos     jsonb not null default '{}'::jsonb,
  foto_path text,
  estado    text not null default 'pendiente',   -- pendiente | guardado | descartado | error
  creado    timestamptz not null default now()
);
create index if not exists telegram_pendientes_user_creado on public.telegram_pendientes (user_id, creado desc);
alter table public.telegram_pendientes enable row level security; -- sin políticas: solo service_role

alter table public.gastos add column if not exists foto_path text;

create or replace function public.telegram_codigo()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_cod text;
begin
  if v_uid is null then raise exception 'no auth'; end if;
  if not public.is_admin() then raise exception 'Función todavía no disponible'; end if;
  delete from public.telegram_codigos where user_id = v_uid or expira < now();
  v_cod := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.telegram_codigos (codigo, user_id, expira) values (v_cod, v_uid, now() + interval '15 minutes');
  return v_cod;
end $$;
revoke execute on function public.telegram_codigo() from public, anon;
grant  execute on function public.telegram_codigo() to authenticated;

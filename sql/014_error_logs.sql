-- Brami3D — Tabla de registro de errores del cliente (visibilidad para el owner)
-- La app inserta aquí cuando un error global escapa de los try/catch (best-effort).
-- Ejecutar en Supabase SQL Editor una sola vez.

create table if not exists public.error_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  message    text,
  stack      text,
  url        text,
  ua         text,
  created_at timestamptz not null default now()
);

create index if not exists error_logs_created_idx on public.error_logs(created_at desc);

alter table public.error_logs enable row level security;

-- Cada usuario solo puede INSERTAR errores propios.
drop policy if exists "error_logs_insert_own" on public.error_logs;
create policy "error_logs_insert_own" on public.error_logs
  for insert to authenticated
  with check (auth.uid() = user_id);

-- Solo el admin/owner puede LEERLOS (usa el helper is_admin() de sql/005).
drop policy if exists "error_logs_select_admin" on public.error_logs;
create policy "error_logs_select_admin" on public.error_logs
  for select to authenticated
  using (public.is_admin());

-- Ver los últimos errores:  select created_at, message, url from public.error_logs order by created_at desc limit 50;

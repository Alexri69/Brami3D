-- Brami3D — Suscripciones Web Push (un dispositivo = una fila)
-- La app guarda aquí la suscripción del navegador al activar notificaciones.
-- La Edge Function "enviar-push" lee de aquí (service role) para mandar el push.
-- Ejecutar en Supabase SQL Editor una sola vez.

create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subs_user_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

-- Cada usuario gestiona solo sus propias suscripciones.
drop policy if exists "push_subs_own" on public.push_subscriptions;
create policy "push_subs_own" on public.push_subscriptions
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

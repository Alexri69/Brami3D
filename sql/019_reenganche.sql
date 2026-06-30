-- Brami3D — Automatización de la campaña de reenganche
-- Tabla de control para enviar el email de bienvenida/ayuda UNA sola vez a cada
-- usuario inactivo (registrado pero sin pedidos). La Edge Function "reenganche"
-- escribe aquí con la service role tras cada envío para no repetir.
-- Ejecutar en Supabase SQL Editor una sola vez.

create table if not exists public.reenganche_enviado (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  sent_at    timestamptz not null default now()
);

alter table public.reenganche_enviado enable row level security;

-- Nadie escribe/lee desde el cliente: la Edge Function usa la service role (que
-- ignora RLS). Solo el admin/owner puede consultarla (helper is_admin() de sql/005).
drop policy if exists "reenganche_select_admin" on public.reenganche_enviado;
create policy "reenganche_select_admin" on public.reenganche_enviado
  for select to authenticated
  using (public.is_admin());

-- Ver a quién se ha contactado:
--   select email, sent_at from public.reenganche_enviado order by sent_at desc;


-- ── Programar la Edge Function "reenganche" (semanal) ───────────────────────
-- Requiere pg_cron + pg_net (Database → Extensions). Despliega antes la función
-- "reenganche" (Verify JWT OFF) y ten el secreto CRON_SECRET puesto.
-- Sustituye <CRON_SECRET> por el valor real y ejecuta.
-- Alternativa sin SQL: Dashboard → Integrations → Cron → Create job → tipo
--   "Supabase Edge Function" → reenganche → schedule "0 9 * * 1" → cabecera x-cron-secret.

-- Lunes a las 09:00 UTC (una hora después de "recordatorios", para no solapar).
select cron.schedule(
  'brami3d-reenganche-semanal',
  '0 9 * * 1',
  $$
  select net.http_post(
    url     := 'https://uzgzfxizpoigzcnlunpr.supabase.co/functions/v1/reenganche',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Quitar:  select cron.unschedule('brami3d-reenganche-semanal');
-- Ver:     select * from cron.job;

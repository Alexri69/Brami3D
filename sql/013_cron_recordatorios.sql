-- Brami3D — Programar la Edge Function "recordatorios" (resumen semanal por email)
-- Ejecuta la función una vez por semana. Requiere las extensiones pg_cron y pg_net
-- (Supabase las trae; actívalas en Database → Extensions si no lo están).
--
-- PASOS:
--   1) Despliega la Edge Function "recordatorios" (Edge Functions → Via Editor,
--      "Verify JWT" OFF). Secreto RESEND_API_KEY ya existe; añade CRON_SECRET con
--      un valor secreto (Settings → Edge Functions → Secrets).
--   2) Sustituye <CRON_SECRET> abajo por ese mismo valor y ejecuta este SQL.
--
-- Alternativa sin SQL: Dashboard → Integrations → Cron → Create job → tipo
--   "Supabase Edge Function" → recordatorios → schedule "0 8 * * 1" → añade la
--   cabecera x-cron-secret. (Más cómodo que este SQL.)

-- Lunes a las 08:00 UTC
select cron.schedule(
  'brami3d-recordatorios-semanal',
  '0 8 * * 1',
  $$
  select net.http_post(
    url     := 'https://uzgzfxizpoigzcnlunpr.supabase.co/functions/v1/recordatorios',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Para cambiar la hora/frecuencia: vuelve a ejecutar cron.schedule con el mismo
-- nombre. Para quitarlo:  select cron.unschedule('brami3d-recordatorios-semanal');
-- Para ver los jobs:      select * from cron.job;

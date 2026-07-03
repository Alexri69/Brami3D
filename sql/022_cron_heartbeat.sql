-- ============================================================================
-- Brami3D — sql/022: latidos de los crons (detección de crons caídos)
-- ============================================================================
-- Ejecutar en Supabase SQL Editor una sola vez. Es idempotente.
--
-- Problema: si `recordatorios` o `reenganche` dejan de ejecutarse (secreto
-- rotado, función caída, cron borrado), nadie se entera. Los emails de fallo
-- solo cubren errores DENTRO de la función, no el "no se ejecutó".
--
-- Solución: cada cron, al terminar bien, upserta su latido aquí. Un workflow
-- de GitHub (`verificar-crons.yml`, martes) comprueba que los latidos son
-- recientes; si no, el workflow falla y GitHub envía email al owner.
--
-- La tabla es de solo-lectura pública (nombres + timestamps, nada sensible):
-- así el chequeo usa la clave publishable sin meter secretos en GitHub.
-- ============================================================================

create table if not exists public.cron_heartbeat (
  nombre    text primary key,          -- 'recordatorios' | 'reenganche'
  ultimo    timestamptz not null default now(),
  resultado jsonb                      -- resumen de la última ejecución
);

alter table public.cron_heartbeat enable row level security;

drop policy if exists "heartbeat_lectura_publica" on public.cron_heartbeat;
create policy "heartbeat_lectura_publica"
  on public.cron_heartbeat for select
  to anon, authenticated
  using (true);

-- Sin policies de escritura: solo el service role (las Edge Functions) escribe.

-- ----------------------------------------------------------------------------
-- Verificación rápida:
--   select * from public.cron_heartbeat;   -- (vacío hasta el primer latido)
-- ----------------------------------------------------------------------------

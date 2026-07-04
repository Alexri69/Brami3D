-- Brami3D — Push automático cuando un cliente acepta un presupuesto
-- Cuando pedidos.aceptado pasa a true (vía la RPC pública aceptar_presupuesto),
-- este trigger llama a la Edge Function "enviar-push" (con pg_net, asíncrono) y
-- el owner recibe una notificación al instante.
-- Requiere: pg_net activo (ya lo está por el cron) y la función enviar-push desplegada.
-- ⚠️ Sustituye <CRON_SECRET> por el valor real ANTES de ejecutar y NUNCA
--    commitees el secreto: este repo es público (aquí estuvo hardcodeado y
--    hubo que rotarlo el 2026-07-04).
-- Ejecutar en Supabase SQL Editor una sola vez.

create or replace function public.notificar_presupuesto_aceptado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  precio numeric := coalesce(NEW.precio_publico, NEW.precio_final);
  cuerpo text;
begin
  if NEW.aceptado is true and (OLD.aceptado is distinct from true) then
    cuerpo := coalesce(NEW.proyecto, 'Presupuesto');
    if precio is not null then
      cuerpo := cuerpo || ' — ' || to_char(precio, 'FM999999990.00') || '€';
    end if;
    perform net.http_post(
      url     := 'https://uzgzfxizpoigzcnlunpr.supabase.co/functions/v1/enviar-push',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', '<CRON_SECRET>'
      ),
      body    := jsonb_build_object(
        'user_id', NEW.user_id,
        'title',   '✅ Presupuesto aceptado',
        'body',    cuerpo
      )
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_presupuesto_aceptado on public.pedidos;
create trigger trg_presupuesto_aceptado
  after update of aceptado on public.pedidos
  for each row execute function public.notificar_presupuesto_aceptado();

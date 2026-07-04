-- ============================================================================
-- Brami3D — sql/025: aviso al owner cuando se registra un usuario nuevo
-- ============================================================================
-- Trigger en auth.users (AFTER INSERT, como el del plan free de sql/002) que
-- llama vía pg_net a la Edge Function `avisar-registro`, la cual envía email a
-- brami3d@gmail.com y push a los dispositivos de los admins.
--
-- ⚠️ Sustituye <CRON_SECRET> por el valor real ANTES de ejecutar y NUNCA lo
--    commitees (este repo es público; ver el incidente de sql/016).
-- ⚠️ El bloque EXCEPTION es intencional y NO se puede quitar: si pg_net o la
--    función fallan, el registro del usuario debe completarse igual.
-- Ejecutar en Supabase SQL Editor una sola vez.
-- ============================================================================

create or replace function public.notificar_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url     := 'https://uzgzfxizpoigzcnlunpr.supabase.co/functions/v1/avisar-registro',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body    := jsonb_build_object(
      'user_id', NEW.id,
      'email',   NEW.email,
      -- uuids de los admins (para el push): así la función no consulta auth.
      'admins',  (
        select coalesce(jsonb_agg(u.id), '[]'::jsonb)
        from auth.users u
        where lower(u.email) in ('alexri69@gmail.com','brami3d@gmail.com')
      )
    )
  );
  return NEW;
exception when others then
  -- El aviso jamás debe romper un signup.
  return NEW;
end;
$$;

drop trigger if exists on_auth_user_created_avisar on auth.users;
create trigger on_auth_user_created_avisar
  after insert on auth.users
  for each row execute function public.notificar_nuevo_usuario();

-- Quitar el aviso:
--   drop trigger if exists on_auth_user_created_avisar on auth.users;

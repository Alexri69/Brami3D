-- ============================================================================
-- Brami3D — sql/021: marca persistente de stock descontado + rate limit email
-- ============================================================================
-- Ejecutar en Supabase SQL Editor una sola vez. Es idempotente.
--
-- Qué hace:
--   1) pedidos.stock_descontado — marca en BD de "el filamento de este pedido
--      ya se restó del stock". Hasta ahora la marca vivía en localStorage, por
--      dispositivo: crear el pedido en el móvil y cobrarlo en el PC podía
--      descontar el stock dos veces. Backfill a TRUE para los pedidos
--      existentes (su descuento ya ocurrió al crearlos).
--   2) email_envios + email_envio_check() — contador diario de emails por
--      usuario para la Edge Function enviar-doc (tope 50/día). Frena que una
--      cuenta cualquiera use hola@brami3d.app como cañón de spam.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Marca de stock descontado por pedido
-- ----------------------------------------------------------------------------
alter table public.pedidos
  add column if not exists stock_descontado boolean not null default false;

comment on column public.pedidos.stock_descontado is
  'true si el filamento de este pedido ya se restó del stock (evita doble descuento multi-dispositivo).';

-- Backfill: los pedidos existentes ya descontaron su stock al crearse
-- (comportamiento histórico de saveO), así que se marcan para que un cobro
-- posterior no vuelva a restar.
update public.pedidos set stock_descontado = true where stock_descontado = false;

-- ----------------------------------------------------------------------------
-- 2) Rate limit de enviar-doc (contador diario por usuario)
-- ----------------------------------------------------------------------------
create table if not exists public.email_envios (
  user_id uuid not null,
  dia     date not null,
  n       int  not null default 0,
  primary key (user_id, dia)
);

-- RLS sin policies: la tabla solo es accesible con service role (la Edge
-- Function); el cliente no puede leerla ni tocarla.
alter table public.email_envios enable row level security;

-- Incrementa el contador del día y devuelve si el envío está dentro del tope.
-- La llama enviar-doc con service role ANTES de enviar (cuenta también los
-- intentos fallidos: mejor para frenar abuso).
create or replace function public.email_envio_check(p_uid uuid, p_limite int default 50)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v int;
begin
  insert into public.email_envios (user_id, dia, n)
  values (p_uid, current_date, 1)
  on conflict (user_id, dia)
  do update set n = email_envios.n + 1
  returning n into v;
  return v <= p_limite;
end;
$$;

-- Sin grant a anon/authenticated: solo service role puede llamarla.
revoke all on function public.email_envio_check(uuid, int) from public;

-- Limpieza opcional (los contadores viejos no molestan, pero por higiene se
-- pueden purgar de vez en cuando):
--   delete from public.email_envios where dia < current_date - 90;

-- ----------------------------------------------------------------------------
-- Verificación rápida:
--   select count(*) from public.pedidos where stock_descontado = false;  -- 0
--   select public.email_envio_check('00000000-0000-0000-0000-000000000000'); -- true
-- ----------------------------------------------------------------------------

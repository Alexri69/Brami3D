-- ============================================================================
-- Brami3D — sql/027: el precio que acepta el cliente es el que se factura
-- ============================================================================
-- Ejecutar en Supabase SQL Editor una sola vez. Es idempotente.
--
-- 1) aceptar_presupuesto: al aceptar desde p.html se congela el precio del
--    enlace (precio_publico) en precio_final. Antes el precio no quedaba fijado
--    y al facturar se recalculaba con el margen/precios del día.
-- 2) Trigger: en un pedido ya aceptado, precio_publico no cambia y precio_final
--    no puede quedar vacío (evita que una edición en curso en la app, hecha
--    justo mientras el cliente aceptaba, borre el precio aceptado). El dueño
--    sí puede poner a mano otro precio_final si lo pacta con el cliente.
-- 3) Pedidos ya aceptados sin precio fijado y sin facturar: se les fija ahora.
-- ============================================================================

-- 1) Aceptar = congelar precio ------------------------------------------------
create or replace function public.aceptar_presupuesto(tok text)
returns json
language sql
security definer
set search_path = public
as $$
  update pedidos
     set aceptado       = true,
         aceptado_fecha = coalesce(aceptado_fecha, now()),
         precio_final   = case when aceptado then precio_final
                               else coalesce(precio_final, precio_publico) end
   where share_token = tok
     and tok is not null
  returning json_build_object('ok', true, 'aceptado_fecha', aceptado_fecha);
$$;

revoke execute on function public.aceptar_presupuesto(text) from public;
grant  execute on function public.aceptar_presupuesto(text) to anon, authenticated;

-- 2) Proteger el precio aceptado ----------------------------------------------
create or replace function public.proteger_precio_aceptado()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.aceptado is true then
    new.precio_publico := old.precio_publico;
    if new.precio_final is null and old.precio_final is not null then
      new.precio_final := old.precio_final;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_proteger_precio_aceptado on public.pedidos;
create trigger trg_proteger_precio_aceptado
  before update on public.pedidos
  for each row execute function public.proteger_precio_aceptado();

-- 3) Arreglar los ya aceptados -------------------------------------------------
update public.pedidos
   set precio_final = precio_publico
 where aceptado is true
   and precio_final is null
   and precio_publico is not null
   and factura_num is null;

-- Comprobación: debe devolver 0
--   select count(*) from public.pedidos
--   where aceptado and precio_final is null and precio_publico is not null and factura_num is null;

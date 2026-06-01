-- Brami3D — Aceptación pública de presupuestos
-- El cliente abre un enlace con un token, ve el presupuesto y lo acepta online.
-- Seguridad: NO se abre la tabla `pedidos` a anónimos. Se exponen solo dos
-- funciones RPC (SECURITY DEFINER) que devuelven/actualizan campos seguros por
-- token exacto — nunca costes, márgenes ni beneficio.
-- Ejecutar en Supabase SQL Editor una sola vez.

-- 1) Columnas
alter table public.pedidos add column if not exists share_token     text;
alter table public.pedidos add column if not exists precio_publico   numeric;     -- precio de venta congelado al compartir
alter table public.pedidos add column if not exists aceptado         boolean default false;
alter table public.pedidos add column if not exists aceptado_fecha   timestamptz;

create unique index if not exists pedidos_share_token_idx
  on public.pedidos(share_token) where share_token is not null;

-- 2) Lectura pública por token (solo campos seguros, sin costes)
create or replace function public.get_presupuesto_publico(tok text)
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'proyecto',        p.proyecto,
    'pres_num',        p.pres_num,
    'lineas',          p.lineas,
    'material',        p.material,
    'peso',            p.peso,
    'tiempo',          p.tiempo_impresion,
    'notas',           p.notas,
    'precio',          coalesce(p.precio_publico, p.precio_final),
    'tipo_iva',        cfg.tipo_iva,
    'nombre_impuesto', cfg.nombre_impuesto,
    'moneda',          cfg.moneda,
    'aceptado',        p.aceptado,
    'aceptado_fecha',  p.aceptado_fecha,
    'cliente_nombre',  c.nombre,
    'empresa',         cfg.empresa,
    'logo',            cfg.logo,
    'telefono',        cfg.telefono,
    'email',           cfg.email
  )
  from pedidos p
  left join clientes c   on c.id = p.cliente_id
  left join config   cfg on cfg.user_id = p.user_id
  where p.share_token = tok
  limit 1;
$$;

-- 3) Aceptación pública por token (idempotente)
create or replace function public.aceptar_presupuesto(tok text)
returns json
language sql
security definer
set search_path = public
as $$
  update pedidos
     set aceptado = true,
         aceptado_fecha = coalesce(aceptado_fecha, now())
   where share_token = tok
  returning json_build_object('ok', true, 'aceptado_fecha', aceptado_fecha);
$$;

-- 4) Permisos: el rol anónimo (clave publishable) solo puede llamar a estas dos RPC
grant execute on function public.get_presupuesto_publico(text) to anon, authenticated;
grant execute on function public.aceptar_presupuesto(text)     to anon, authenticated;

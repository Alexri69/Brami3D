-- ============================================================================
-- Brami3D — sql/028: web del taller en el enlace público del presupuesto
-- ============================================================================
-- Ejecutar en Supabase SQL Editor una sola vez. Es idempotente.
--
-- 1) config.web: URL de la web del taller (Configuración → Datos de empresa).
-- 2) get_presupuesto_publico devuelve también `web`: p.html muestra al cliente,
--    al aceptar, un agradecimiento con botón a la web del taller (y WhatsApp si
--    hay teléfono). Si el taller no la rellena, no sale el botón.
-- ============================================================================

alter table public.config add column if not exists web text;

create or replace function public.get_presupuesto_publico(tok text)
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'proyecto',         p.proyecto,
    'pres_num',         p.pres_num,
    'lineas',           p.lineas,
    'material',         p.material,
    'peso',             p.peso,
    'tiempo',           p.tiempo_impresion,
    'notas',            p.notas,
    'precio',           coalesce(p.precio_publico, p.precio_final),
    'tipo_iva',         cfg.tipo_iva,
    'nombre_impuesto',  cfg.nombre_impuesto,
    'tipo_iva2',        cfg.tipo_iva2,
    'nombre_impuesto2', cfg.nombre_impuesto2,
    'moneda',           cfg.moneda,
    'aceptado',         p.aceptado,
    'aceptado_fecha',   p.aceptado_fecha,
    'estado',           p.estado,
    'fecha_entrega',    p.fecha_entrega,
    'cliente_nombre',   c.nombre,
    'empresa',          cfg.empresa,
    'logo',             cfg.logo,
    'telefono',         cfg.telefono,
    'email',            cfg.email,
    'web',              cfg.web
  )
  from pedidos p
  left join clientes c   on c.id = p.cliente_id
  left join config   cfg on cfg.user_id = p.user_id
  where p.share_token = tok
  limit 1;
$$;

grant execute on function public.get_presupuesto_publico(text) to anon, authenticated;

-- Taller del owner (opcional, ajustar el email si hace falta):
--   update public.config set web = 'https://brami3d.app'
--    where user_id = (select id from auth.users where email = 'brami3d@gmail.com');

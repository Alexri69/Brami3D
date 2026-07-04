-- ============================================================================
-- Brami3D — sql/024: "sigue tu pedido" (estado en el enlace público) + backup
-- ============================================================================
-- Ejecutar en Supabase SQL Editor una sola vez. Es idempotente.
--
-- 1) get_presupuesto_publico devuelve también `estado` y `fecha_entrega`:
--    p.html muestra al cliente un tracker (En cola → Imprimiendo → Terminado →
--    Entregado) cuando el presupuesto ya está aceptado. Mismo enlace/token de
--    siempre — el presupuesto se convierte en página de seguimiento.
--    (Sigue sin exponer costes, márgenes ni datos de otros usuarios.)
--
-- 2) Cron mensual del backup (Edge Function `backup-mensual`): se programa
--    con cron.schedule — ver bloque comentado al final (necesita CRON_SECRET).
-- ============================================================================

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
    'email',            cfg.email
  )
  from pedidos p
  left join clientes c   on c.id = p.cliente_id
  left join config   cfg on cfg.user_id = p.user_id
  where p.share_token = tok
  limit 1;
$$;

grant execute on function public.get_presupuesto_publico(text) to anon, authenticated;

-- ── Programar la Edge Function "backup-mensual" (día 1 de cada mes) ─────────
-- Igual que sql/013 y sql/019: sustituye <CRON_SECRET> y ejecuta UNA vez
-- (o deja que Claude lo programe por la Management API).
--
-- select cron.schedule(
--   'brami3d-backup-mensual',
--   '0 6 1 * *',
--   $cron$
--   select net.http_post(
--     url     := 'https://uzgzfxizpoigzcnlunpr.supabase.co/functions/v1/backup-mensual',
--     headers := jsonb_build_object(
--       'Content-Type',  'application/json',
--       'x-cron-secret', '<CRON_SECRET>'
--     ),
--     body    := '{}'::jsonb
--   );
--   $cron$
-- );
-- Quitar:  select cron.unschedule('brami3d-backup-mensual');

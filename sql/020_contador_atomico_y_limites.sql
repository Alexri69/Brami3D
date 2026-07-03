-- ============================================================================
-- Brami3D — sql/020: numeración atómica, 2º impuesto en enlace público,
--                    límites del plan Free en servidor y bloqueo real
-- ============================================================================
-- Ejecutar en Supabase SQL Editor una sola vez. Es idempotente.
--
-- Qué hace:
--   1) siguiente_contador(tipo, año) — incrementa el contador de presupuestos/
--      facturas de forma ATÓMICA (un solo UPDATE en servidor). El viejo flujo
--      leer→+1→upsert del cliente podía duplicar números con dos dispositivos.
--   2) get_presupuesto_publico — ahora devuelve también tipo_iva2 y
--      nombre_impuesto2 para que p.html muestre el mismo total que la factura.
--   3) Límites del plan Free aplicados EN SERVIDOR (trigger BEFORE INSERT en
--      pedidos y clientes): hasta ahora solo los aplicaba el JS del cliente y
--      cualquiera podía saltárselos con la consola/REST. Mismos números que
--      FREE_LIMITS en la app: 10 pedidos/mes, 5 clientes.
--   4) admin_set_blocked ahora también pone banned_until en auth.users:
--      el bloqueo corta el refresh del token (antes era solo un logout en JS
--      que un cliente modificado podía ignorar).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Contador atómico de numeración (presupuestos y facturas)
-- ----------------------------------------------------------------------------
-- La tabla `contadores` ya existe en producción (la usa la app con upsert por
-- user_id,tipo,anio); estas sentencias defensivas solo actúan si faltara algo.
create table if not exists public.contadores (
  user_id uuid not null references auth.users(id) on delete cascade,
  tipo    text not null,
  anio    int  not null,
  valor   int  not null default 0
);

create unique index if not exists contadores_user_tipo_anio_idx
  on public.contadores(user_id, tipo, anio);

create or replace function public.siguiente_contador(p_tipo text, p_anio int)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_val integer;
begin
  if v_uid is null then
    raise exception 'no autenticado' using errcode = '42501';
  end if;
  if p_tipo not in ('presnum','factnum') then
    raise exception 'tipo de contador no válido' using errcode = '22023';
  end if;

  insert into public.contadores (user_id, tipo, anio, valor)
  values (v_uid, p_tipo, p_anio, 1)
  on conflict (user_id, tipo, anio)
  do update set valor = contadores.valor + 1
  returning valor into v_val;

  return v_val;
end;
$$;

revoke all on function public.siguiente_contador(text, int) from public;
grant execute on function public.siguiente_contador(text, int) to authenticated;

-- ----------------------------------------------------------------------------
-- 2) Enlace público: incluir el 2º impuesto (recargo, etc.)
--    Misma función de sql/010 + tipo_iva2 / nombre_impuesto2.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 3) Límites del plan Free en servidor
-- ----------------------------------------------------------------------------
-- Plan efectivo de un usuario (réplica en SQL de resolvePlan() del cliente):
-- admin whitelist > plan admin > pro no vencido > trial vigente > free.
create or replace function public.es_pro(p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
begin
  if exists (
    select 1 from auth.users u
    where u.id = p_uid
      and lower(u.email) in ('alexri69@gmail.com','brami3d@gmail.com')
  ) then
    return true;
  end if;

  select plan, expires_at, trial_until into r
  from public.user_plans where user_id = p_uid;
  if not found then return false; end if;

  if r.plan = 'admin' then return true; end if;
  if r.plan = 'pro' and (r.expires_at is null or r.expires_at > now()) then return true; end if;
  if r.trial_until is not null and r.trial_until > now() then return true; end if;
  return false;
end;
$$;

revoke all on function public.es_pro(uuid) from public;

-- Trigger BEFORE INSERT en pedidos/clientes. Detalles importantes:
--   · La app guarda con UPSERT, así que las EDICIONES también entran por aquí
--     como INSERT ... ON CONFLICT. Si la fila (id) ya existe es una edición y
--     se deja pasar SIEMPRE — si no, un usuario free con 10+ pedidos no podría
--     ni editar los que ya tiene.
--   · Los mensajes de error llegan al cliente tal cual (showToast los muestra).
create or replace function public.check_limites_free()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  -- Bloqueo duro: un usuario suspendido no escribe, ni siquiera por REST.
  if exists (select 1 from public.user_plans p where p.user_id = new.user_id and p.blocked) then
    raise exception 'Cuenta suspendida. Contacta con soporte.' using errcode = '42501';
  end if;

  if public.es_pro(new.user_id) then
    return new;
  end if;

  if tg_table_name = 'pedidos' then
    if exists (select 1 from public.pedidos x where x.id = new.id) then return new; end if; -- edición vía upsert
    select count(*) into n from public.pedidos x
     where x.user_id = new.user_id and x.created_at >= date_trunc('month', now());
    if n >= 10 then
      raise exception 'Límite del plan Free: 10 pedidos al mes. Pásate a Pro para seguir creando.' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'clientes' then
    if exists (select 1 from public.clientes x where x.id = new.id) then return new; end if; -- edición vía upsert
    select count(*) into n from public.clientes x where x.user_id = new.user_id;
    if n >= 5 then
      raise exception 'Límite del plan Free: 5 clientes. Pásate a Pro para añadir más.' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_limite_free_pedidos on public.pedidos;
create trigger trg_limite_free_pedidos
  before insert on public.pedidos
  for each row execute function public.check_limites_free();

drop trigger if exists trg_limite_free_clientes on public.clientes;
create trigger trg_limite_free_clientes
  before insert on public.clientes
  for each row execute function public.check_limites_free();

-- ----------------------------------------------------------------------------
-- 4) Bloqueo real: admin_set_blocked también banea la sesión en auth
--    (reemplaza la versión de sql/005; misma firma).
-- ----------------------------------------------------------------------------
create or replace function public.admin_set_blocked(
  target_user uuid,
  new_blocked boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  insert into public.user_plans (user_id, plan, blocked, updated_at)
  values (target_user, 'free', new_blocked, now())
  on conflict (user_id) do update
    set blocked    = excluded.blocked,
        updated_at = now();

  -- banned_until corta el refresh del token en GoTrue: el access token vigente
  -- muere solo (~1h) y no se puede renovar ni volver a entrar.
  update auth.users
     set banned_until = case when new_blocked then now() + interval '100 years' else null end
   where id = target_user;
end;
$$;

revoke all on function public.admin_set_blocked(uuid, boolean) from public;
grant execute on function public.admin_set_blocked(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- Verificación rápida:
--   select public.siguiente_contador('presnum', 2099);  -- debe devolver 1, luego 2…
--   select public.es_pro(auth.uid());
-- ----------------------------------------------------------------------------

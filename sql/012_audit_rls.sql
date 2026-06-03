-- ============================================================================
-- Brami3D — AUDITORÍA de Row Level Security (solo lectura, no cambia nada)
-- ============================================================================
-- Pégalo en Supabase → SQL Editor y ejecuta cada bloque (1, 2, 3, 4) por
-- separado (selecciona el bloque y pulsa Run, o ejecútalos uno a uno).
-- Copia/pega los resultados de vuelta y los interpreto.
-- ============================================================================


-- ── BLOQUE 1 ── ¿Tiene RLS cada tabla? (lo más importante) ───────────────────
-- Veredicto por tabla: queremos que TODAS las tablas con columna user_id
-- tengan rls_activado = true y al menos 1 política.
select
  c.relname                                              as tabla,
  c.relrowsecurity                                       as rls_activado,
  c.relforcerowsecurity                                  as rls_forzado,
  (select count(*) from pg_policies p
     where p.schemaname = 'public' and p.tablename = c.relname) as n_politicas,
  exists (select 1 from information_schema.columns col
            where col.table_schema='public' and col.table_name=c.relname
              and col.column_name='user_id')             as tiene_user_id,
  case
    when exists (select 1 from information_schema.columns col
                   where col.table_schema='public' and col.table_name=c.relname
                     and col.column_name='user_id')
         and not c.relrowsecurity
      then '🔴 PELIGRO: user_id pero SIN RLS'
    when c.relrowsecurity
         and (select count(*) from pg_policies p
                where p.schemaname='public' and p.tablename=c.relname)=0
      then '🟠 RLS activo pero SIN políticas (bloquea todo)'
    when c.relrowsecurity then '🟢 OK'
    else '⚪ sin RLS (¿tabla pública/sin datos privados?)'
  end                                                    as veredicto
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by tiene_user_id desc, c.relname;


-- ── BLOQUE 2 ── Definición de cada política (¿filtra por auth.uid()=user_id?) ─
-- Revisa que 'using_expr' y 'check_expr' sean (auth.uid() = user_id) y que el
-- rol NO sea solo 'anon'. cmd: SELECT/INSERT/UPDATE/DELETE/ALL.
select
  tablename                       as tabla,
  policyname                      as politica,
  cmd                             as operacion,
  roles                           as roles,
  qual                            as using_expr,
  with_check                      as check_expr
from pg_policies
where schemaname = 'public'
order by tablename, cmd;


-- ── BLOQUE 3 ── Funciones SECURITY DEFINER y quién puede ejecutarlas ─────────
-- Toda función SECURITY DEFINER expuesta a 'anon'/'authenticated' debe validar
-- por dentro (token o is_admin()). Confirma que no hay ninguna inesperada.
select
  p.proname                                              as funcion,
  pg_get_function_identity_arguments(p.oid)              as args,
  p.prosecdef                                            as security_definer,
  coalesce(
    (select string_agg(distinct acl.grantee, ', ')
       from information_schema.role_routine_grants acl
      where acl.specific_schema='public'
        and acl.routine_name=p.proname),
    '(sin grants explícitos)')                           as puede_ejecutar
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef = true
order by p.proname;


-- ── BLOQUE 4 ── ¿El rol anónimo tiene acceso DIRECTO a tablas? (no debería) ──
-- El rol 'anon' (clave publishable sin login) NO debería poder leer/escribir
-- ninguna tabla de datos directamente; solo vía las RPC públicas por token.
select
  table_name                      as tabla,
  grantee                         as rol,
  string_agg(privilege_type, ', ' order by privilege_type) as permisos
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon')
group by table_name, grantee
order by table_name;

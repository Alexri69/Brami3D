-- ============================================================================
-- Brami3D — Habilitar Supabase Realtime en tablas de usuario
-- ============================================================================
-- Supabase Realtime envía eventos INSERT/UPDATE/DELETE al cliente si y solo si:
--   1) La tabla está añadida a la publication `supabase_realtime`.
--   2) El usuario tiene una policy SELECT que le permita ver esa fila.
--
-- Brami3D ya cumple (2): todas las tablas tienen RLS con user_id=auth.uid().
-- Este script cubre (1). Es idempotente: si una tabla ya está añadida no
-- hace nada, y si alguna no existiera tampoco rompe.
--
-- Ejecutar una sola vez en Supabase → SQL Editor.
-- ============================================================================

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'clientes',
    'pedidos',
    'impresoras',
    'filamentos',
    'piezas',
    'archivos',
    'gastos',
    'config',
    'user_plans'
  ])
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;  -- ya estaba en la publication
      when undefined_table then null;   -- tabla no creada todavía (no-op)
      when undefined_object then null;  -- publication no existe en este proyecto
    end;
  end loop;
end $$;

-- Comprobar qué tablas tienes publicadas:
--   select schemaname, tablename
--   from pg_publication_tables
--   where pubname = 'supabase_realtime'
--   order by tablename;

-- ============================================================================
-- Brami3D — Fase 1: Registro de facturación y registro de eventos
-- Cumplimiento RD 1007/2023 + Orden HAC/1177/2024 (modo No-Verifactu)
-- ============================================================================
-- Ejecutar en Supabase SQL Editor (una sola vez).
-- Crea dos tablas inmutables (SELECT + INSERT permitidos; UPDATE/DELETE bloqueados
-- por ausencia de policy y por trigger defensivo).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tabla: facturas_registro
-- Snapshot inalterable de cada factura emitida. Una fila por evento de alta
-- (emisión, rectificativa o anulación). Incluye hash encadenado SHA-256.
-- ----------------------------------------------------------------------------
create table if not exists public.facturas_registro (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  -- Identificación de la factura
  factura_num      text not null,
  factura_serie    text,                          -- opcional si el num ya contiene serie
  factura_fecha    date not null,
  pedido_id        uuid,                          -- referencia informativa al pedido origen
  tipo             text not null default 'emision'
                   check (tipo in ('emision','rectificativa','anulacion')),
  rectifica_id     uuid references public.facturas_registro(id),
  motivo_rectificacion text,
  -- Datos del emisor (copiados desde config en el momento de emisión)
  emisor_nif       text not null,
  emisor_nombre    text not null,
  -- Datos del receptor (copiados desde clientes)
  receptor_nif     text,
  receptor_nombre  text,
  -- Importes
  base_imponible   numeric(12,2) not null,
  tipo_iva         numeric(5,2) not null default 0,
  cuota_iva        numeric(12,2) not null default 0,
  importe_total    numeric(12,2) not null,
  -- Snapshot completo: líneas + cualquier dato que se quiera conservar para
  -- garantizar que el hash es reproducible si algún día hay inspección.
  lineas           jsonb not null,
  datos_json       jsonb not null,
  -- Encadenado SHA-256 hex (64 chars). hash_anterior = '' en la primera factura.
  hash_anterior    text not null default '',
  hash             text not null check (length(hash) = 64),
  huella           text,                          -- reservado para firma futura
  -- Metadatos del sistema emisor
  modalidad        text not null default 'no-verifactu'
                   check (modalidad in ('verifactu','no-verifactu')),
  sif_nombre       text not null default 'Brami3D',
  sif_version      text,
  sif_id           text,                          -- identificador del SIF asignado al usuario
  -- Timestamps
  ts_emision       timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

-- Índices
create unique index if not exists facturas_registro_user_num_uidx
  on public.facturas_registro(user_id, factura_num);
create index if not exists facturas_registro_user_ts_idx
  on public.facturas_registro(user_id, ts_emision desc);
create index if not exists facturas_registro_pedido_idx
  on public.facturas_registro(pedido_id);

-- ----------------------------------------------------------------------------
-- Tabla: facturas_eventos
-- Registro inmutable de eventos del sistema (creación, rectificación,
-- exportación, anomalías, arranque/parada del SIF). También encadenado.
-- ----------------------------------------------------------------------------
create table if not exists public.facturas_eventos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  tipo          text not null
                check (tipo in ('inicio','fin','creacion','rectificacion',
                                'anulacion','exportacion','anomalia','otro')),
  registro_id   uuid references public.facturas_registro(id),
  descripcion   text,
  datos_json    jsonb not null default '{}'::jsonb,
  hash_anterior text not null default '',
  hash          text not null check (length(hash) = 64),
  ts            timestamptz not null default now()
);

create index if not exists facturas_eventos_user_ts_idx
  on public.facturas_eventos(user_id, ts desc);
create index if not exists facturas_eventos_registro_idx
  on public.facturas_eventos(registro_id);

-- ----------------------------------------------------------------------------
-- Trigger defensivo: prohibir UPDATE y DELETE a nivel de base de datos.
-- RLS ya lo bloquea (no hay policies para UPDATE/DELETE), pero este trigger
-- cubre incluso el rol `service_role` / supabase-admin.
-- ----------------------------------------------------------------------------
create or replace function public.tg_no_update_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'Tabla inmutable: no se permiten % sobre %',
    tg_op, tg_table_name;
end; $$;

drop trigger if exists no_update_delete_facturas_registro on public.facturas_registro;
create trigger no_update_delete_facturas_registro
  before update or delete on public.facturas_registro
  for each row execute function public.tg_no_update_delete();

drop trigger if exists no_update_delete_facturas_eventos on public.facturas_eventos;
create trigger no_update_delete_facturas_eventos
  before update or delete on public.facturas_eventos
  for each row execute function public.tg_no_update_delete();

-- ----------------------------------------------------------------------------
-- Row Level Security
-- SELECT + INSERT sólo para el propietario. No hay policies de UPDATE/DELETE.
-- ----------------------------------------------------------------------------
alter table public.facturas_registro enable row level security;
alter table public.facturas_eventos  enable row level security;

drop policy if exists "registro_select_own" on public.facturas_registro;
create policy "registro_select_own" on public.facturas_registro
  for select using (auth.uid() = user_id);

drop policy if exists "registro_insert_own" on public.facturas_registro;
create policy "registro_insert_own" on public.facturas_registro
  for insert with check (auth.uid() = user_id);

drop policy if exists "eventos_select_own" on public.facturas_eventos;
create policy "eventos_select_own" on public.facturas_eventos
  for select using (auth.uid() = user_id);

drop policy if exists "eventos_insert_own" on public.facturas_eventos;
create policy "eventos_insert_own" on public.facturas_eventos
  for insert with check (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- Comprobación rápida: listar las tablas con RLS activo
-- ----------------------------------------------------------------------------
-- select tablename, rowsecurity from pg_tables
--   where schemaname='public' and tablename like 'facturas%';

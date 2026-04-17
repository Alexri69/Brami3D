-- ============================================================================
-- Brami3D — Añade campo `logo` a la tabla `config` (marca blanca)
-- ============================================================================
-- Permite a cada usuario subir su propio logo que aparecerá en presupuestos,
-- facturas e informes mensuales. Se guarda como data URL base64 (string).
--
-- Si `logo` es null o vacío, los PDFs usan el logo B3D por defecto.
-- Si `empresa` es null o vacío, los PDFs usan el texto "B3D Print Studio".
-- Así, un usuario sin configurar ve el branding B3D; uno que configure ambos
-- campos ve su marca completa (marca blanca).
-- ============================================================================

alter table public.config
  add column if not exists logo text;

comment on column public.config.logo is
  'Data URL base64 del logo del usuario (marca blanca). Null = usar logo B3D por defecto.';

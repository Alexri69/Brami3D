-- Brami3D — Columnas para suscripción de Stripe en user_plans
-- El webhook de Stripe escribe aquí cuando un taller paga/renueva/cancela.
-- Ejecutar en Supabase SQL Editor una sola vez.

alter table public.user_plans add column if not exists stripe_customer_id     text;
alter table public.user_plans add column if not exists stripe_subscription_id text;

-- El webhook hace upsert por user_id; aseguramos que es único.
create unique index if not exists user_plans_user_id_uidx on public.user_plans(user_id);

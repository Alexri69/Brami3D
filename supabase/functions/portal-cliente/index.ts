// Brami3D — Edge Function "portal-cliente"
// Abre el Portal de Cliente de Stripe para que el taller gestione/cancele su
// suscripción solo (cambiar tarjeta, ver facturas, cancelar renovación).
// Auth: x-user-token (igual que crear-checkout). "Verify JWT" debe estar OFF.
// Secreto necesario: STRIPE_SECRET_KEY.
// Requisito: activar el Customer Portal una vez en Stripe →
//   Settings → Billing → Customer portal → Activate.

import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-user-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PUBLISHABLE = "sb_publishable_4gEjOV3kyfh8_I0f861iow__6b1ueIi";
const APP_URL = "https://brami3d.app/brami3d_supabase.html";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    // Validar usuario logueado de la app
    const userToken = req.headers.get("x-user-token") || "";
    if (!userToken) return json({ error: "No autorizado" }, 401);
    const uResp = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${userToken}`, apikey: PUBLISHABLE },
    });
    if (!uResp.ok) return json({ error: "Sesión no válida" }, 401);
    const user = await uResp.json();

    // Buscar el stripe_customer_id del usuario (con la service role, sin depender de RLS)
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const pResp = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/rest/v1/user_plans?user_id=eq.${user.id}&select=stripe_customer_id`,
      { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } },
    );
    const rows = await pResp.json().catch(() => []);
    const customer = Array.isArray(rows) && rows[0]?.stripe_customer_id;
    if (!customer) return json({ error: "No tienes una suscripción de pago activa" }, 404);

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { httpClient: Stripe.createFetchHttpClient() });
    const session = await stripe.billingPortal.sessions.create({
      customer,
      return_url: APP_URL,
    });
    return json({ url: session.url });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

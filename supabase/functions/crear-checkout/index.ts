// Brami3D — Edge Function "crear-checkout"
// Crea una sesión de Stripe Checkout (suscripción) para el usuario logueado.
// Auth: x-user-token (igual que enviar-doc). "Verify JWT" debe estar OFF.
// Secreto necesario: STRIPE_SECRET_KEY.

import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-user-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PUBLISHABLE = "sb_publishable_4gEjOV3kyfh8_I0f861iow__6b1ueIi";
const APP_URL = "https://brami3d.app/brami3d_supabase.html";
const PRICES: Record<string, string> = {
  mensual: "price_1TdvFePrM5C0gGgh2I0Gr6LC",
  anual:   "price_1TdvFePrM5C0gGgh4liis6Os",
};

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

    const { plan } = await req.json();
    const price = PRICES[plan];
    if (!price) return json({ error: "Plan no válido" }, 400);

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { httpClient: Stripe.createFetchHttpClient() });
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      client_reference_id: user.id,
      customer_email: user.email,
      subscription_data: { metadata: { user_id: user.id } },
      metadata: { user_id: user.id },
      success_url: `${APP_URL}?pago=ok`,
      cancel_url: `${APP_URL}?pago=cancel`,
      allow_promotion_codes: true,
      locale: "es",
    });
    return json({ url: session.url });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

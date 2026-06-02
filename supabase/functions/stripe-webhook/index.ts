// Brami3D — Edge Function "stripe-webhook"
// Recibe eventos de Stripe y actualiza user_plans (activa/baja el plan Pro).
// Auth: la firma de Stripe (NO lleva JWT de usuario) → "Verify JWT" debe estar OFF.
// Secretos necesarios: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.
// (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase solos.)

import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { httpClient: Stripe.createFetchHttpClient() });
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function setPlan(userId: string, fields: Record<string, unknown>) {
  await fetch(`${SUPABASE_URL}/rest/v1/user_plans?on_conflict=user_id`, {
    method: "POST",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ user_id: userId, ...fields }),
  });
}

Deno.serve(async (req) => {
  const sig = req.headers.get("stripe-signature");
  const body = await req.text();
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body, sig!, Deno.env.get("STRIPE_WEBHOOK_SECRET")!, undefined, cryptoProvider,
    );
  } catch (e) {
    return new Response("firma no válida: " + (e as Error).message, { status: 400 });
  }

  try {
    const obj: any = event.data.object;
    if (event.type === "checkout.session.completed") {
      const userId = obj.client_reference_id || obj.metadata?.user_id;
      if (userId) await setPlan(userId, { plan: "pro", stripe_customer_id: obj.customer, stripe_subscription_id: obj.subscription });
    } else if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
      const userId = obj.metadata?.user_id;
      const active = ["active", "trialing", "past_due"].includes(obj.status);
      const expires = obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString() : null;
      if (userId) await setPlan(userId, { plan: active ? "pro" : "free", expires_at: expires, stripe_customer_id: obj.customer, stripe_subscription_id: obj.id });
    } else if (event.type === "customer.subscription.deleted") {
      const userId = obj.metadata?.user_id;
      if (userId) await setPlan(userId, { plan: "free", expires_at: null });
    }
  } catch (e) {
    console.error("webhook handler error", e);
  }

  return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });
});

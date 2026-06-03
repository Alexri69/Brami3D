// Brami3D — Edge Function "enviar-push"
// Envía una notificación Web Push a todos los dispositivos de un usuario.
// "Verify JWT" debe estar OFF. Secretos: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
//   y opcionalmente CRON_SECRET (para envíos desde el servidor/cron).
//
// Dos formas de llamarla:
//   a) desde la app (botón de prueba): cabecera x-user-token → manda al propio usuario.
//   b) desde el servidor/cron: cabecera x-cron-secret → manda a body.user_id.
// Body JSON: { title, body, url?, user_id? }

import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-user-token, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const PUBLISHABLE = "sb_publishable_4gEjOV3kyfh8_I0f861iow__6b1ueIi";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

webpush.setVapidDetails(
  "mailto:brami3d@gmail.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const payload = await req.json().catch(() => ({}));
    let userId = "";

    const userToken = req.headers.get("x-user-token") || "";
    if (userToken) {
      const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${userToken}`, apikey: PUBLISHABLE },
      });
      if (!ur.ok) return json({ error: "Sesión no válida" }, 401);
      userId = (await ur.json()).id;
    } else if (CRON_SECRET && req.headers.get("x-cron-secret") === CRON_SECRET) {
      userId = payload.user_id;
    } else {
      return json({ error: "No autorizado" }, 401);
    }
    if (!userId) return json({ error: "Falta user_id" }, 400);

    const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };
    const subsResp = await fetch(
      `${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${userId}&select=endpoint,p256dh,auth`,
      { headers: H },
    );
    const subs = await subsResp.json().catch(() => []);
    if (!Array.isArray(subs) || !subs.length) return json({ ok: true, enviados: 0, motivo: "sin dispositivos" });

    const body = JSON.stringify({
      title: payload.title || "Brami3D",
      body: payload.body || "",
      url: payload.url || "https://brami3d.app/brami3d_supabase.html",
    });

    let sent = 0;
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
        sent++;
      } catch (err: any) {
        // 404/410 = suscripción caducada → la borramos
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, {
            method: "DELETE", headers: H,
          });
        }
      }
    }
    return json({ ok: true, enviados: sent, dispositivos: subs.length });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

// Brami3D — Edge Function "avisar-registro"
// Avisa al owner (email + push) cada vez que se registra un usuario nuevo.
// La dispara el trigger notificar_nuevo_usuario de auth.users (sql/025) vía
// pg_net, con el mismo x-cron-secret que los crons.
//
// Auth: x-cron-secret (obligatorio). "Verify JWT" debe estar OFF.
// Secretos: RESEND_API_KEY (ya existe), CRON_SECRET.
// Body: { user_id, email, admins: [uuid, …] }  ← admins los resuelve el trigger
//       (los uuid de ADMIN_EMAILS) para poder mandarles push sin consultar auth.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const RESEND = Deno.env.get("RESEND_API_KEY") || "";
const OWNER_EMAIL = "brami3d@gmail.com";

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

  try {
    const { user_id, email, admins } = await req.json().catch(() => ({}));
    if (!email) return json({ error: "Falta email" }, 400);

    // Total de usuarios (detalle bonito para el email). Best-effort.
    let total: number | null = null;
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/user_plans?select=user_id`, {
        method: "HEAD",
        headers: {
          apikey: SERVICE, Authorization: `Bearer ${SERVICE}`,
          Prefer: "count=exact", Range: "0-0",
        },
      });
      const cr = r.headers.get("content-range");             // p. ej. "0-0/12"
      if (cr && cr.includes("/")) total = parseInt(cr.split("/")[1]) || null;
    } catch (_) { /* sin total no pasa nada */ }

    // 1) Email al buzón del negocio.
    let emailOk = false;
    if (RESEND) {
      const fecha = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" });
      const texto =
        `Nuevo usuario registrado en Brami3D 🎉\n\n` +
        `Email:  ${email}\n` +
        `ID:     ${user_id || "?"}\n` +
        `Fecha:  ${fecha}\n` +
        (total ? `\nYa sois ${total} usuarios.\n` : "") +
        `\nPanel admin: https://brami3d.app/brami3d_supabase.html`;
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Brami3D <hola@brami3d.app>",
          to: OWNER_EMAIL,
          subject: `🎉 Nuevo registro en Brami3D — ${email}`,
          text: texto,
        }),
      });
      emailOk = r.ok;
    }

    // 2) Push a los dispositivos de los admins (reutiliza enviar-push).
    let pushes = 0;
    for (const id of (Array.isArray(admins) ? admins : [])) {
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/enviar-push`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-cron-secret": CRON_SECRET },
          body: JSON.stringify({ user_id: id, title: "🎉 Nuevo usuario en Brami3D", body: String(email) }),
        });
        if (r.ok) { const j = await r.json().catch(() => ({})); pushes += j.enviados || 0; }
      } catch (_) { /* push best-effort */ }
    }

    return json({ ok: true, email_enviado: emailOk, pushes, total });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

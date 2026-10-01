// Brami3D — Edge Function "enviar-doc"
// Envía presupuestos/facturas por email (PDF adjunto) vía Resend.
// Seguridad: exige un token de usuario válido (x-user-token) → solo usuarios
// logueados de la app pueden enviar. La clave pública (PUBLISHABLE) es segura de
// incrustar; la API key de Resend va en el secreto RESEND_API_KEY.
// Despliegue: pegar este código en la función "enviar-doc" del panel de Supabase
// (Verify JWT debe estar OFF; la autorización real la hace este código).

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-user-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PUBLISHABLE = "sb_publishable_4gEjOV3kyfh8_I0f861iow__6b1ueIi";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (o, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    // ── Seguridad: validar que quien llama es un usuario logueado de la app ──
    const userToken = req.headers.get("x-user-token") || "";
    if (!userToken) return json({ error: "No autorizado" }, 401);
    const uResp = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${userToken}`, apikey: PUBLISHABLE },
    });
    if (!uResp.ok) return json({ error: "Sesión no válida" }, 401);
    const user = await uResp.json();

    // ── Rate limit por usuario y día (email_envio_check, sql/021) ──
    // Frena que una cuenta cualquiera use hola@brami3d.app como cañón de spam o
    // phishing (reputación del dominio). Cuentas Pro con más de 7 días: 50/día;
    // cuentas nuevas o gratuitas: 15/día. Si la comprobación falla NO se envía
    // (antes fallaba en abierto y el límite desaparecía).
    if (!user?.id || !user?.email_confirmed_at) return json({ error: "Confirma tu email antes de enviar documentos" }, 403);
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const SB = Deno.env.get("SUPABASE_URL");
    const HS = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
    let limite = 15;
    try {
      const nueva = !user.created_at || Date.now() - new Date(user.created_at).getTime() < 7 * 864e5;
      if (!nueva) {
        const pr = await fetch(`${SB}/rest/v1/rpc/es_pro`, { method: "POST", headers: HS, body: JSON.stringify({ p_uid: user.id }) });
        if (pr.ok && (await pr.json()) === true) limite = 50;
      }
      const rl = await fetch(`${SB}/rest/v1/rpc/email_envio_check`, {
        method: "POST", headers: HS, body: JSON.stringify({ p_uid: user.id, p_limite: limite }),
      });
      if (!rl.ok) throw new Error("HTTP " + rl.status);
      if ((await rl.json()) === false) {
        return json({ error: `Límite diario de envíos alcanzado (${limite}). Inténtalo mañana.` }, 429);
      }
    } catch (_) {
      return json({ error: "El servicio de email no está disponible ahora mismo. Inténtalo en unos minutos." }, 503);
    }

    // ── Datos del email ──
    const { to, subject, text, fromName, replyTo, filename, pdfBase64 } = await req.json();
    if (!to || !subject) return json({ error: "Faltan datos" }, 400);

    // ── Saneamiento de entrada (evita usar el dominio brami3d.app como relay de
    //    spam: un solo destinatario, con formato de email válido) ──
    const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
    const toClean = String(to).trim();
    if (!EMAIL_RE.test(toClean)) return json({ error: "Destinatario no válido" }, 400);
    if (replyTo && !EMAIL_RE.test(String(replyTo).trim())) {
      return json({ error: "Reply-To no válido" }, 400);
    }
    if (String(subject).length > 300) return json({ error: "Asunto demasiado largo" }, 400);
    if (text && String(text).length > 20000) return json({ error: "Mensaje demasiado largo" }, 400);
    // Límite del adjunto (~7 MB en base64 ≈ 5 MB de PDF) para no abusar de Resend.
    if (pdfBase64 && String(pdfBase64).length > 7_000_000) {
      return json({ error: "Adjunto demasiado grande" }, 400);
    }

    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) return json({ error: "Falta el secreto RESEND_API_KEY" }, 500);

    const nombre = String(fromName || "").replace(/[<>"\r\n]/g, "").trim().slice(0, 60) || "Brami3D";
    const from = `${nombre} <hola@brami3d.app>`;
    const payload = { from, to: [toClean], subject, text: text || "" };
    if (replyTo) payload.reply_to = String(replyTo).trim();
    if (pdfBase64) payload.attachments = [{ filename: filename || "documento.pdf", content: pdfBase64 }];

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: j.message || ("Resend " + r.status) }, 400);
    return json({ ok: true, id: j.id });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

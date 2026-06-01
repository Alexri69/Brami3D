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

    // ── Datos del email ──
    const { to, subject, text, fromName, replyTo, filename, pdfBase64 } = await req.json();
    if (!to || !subject) return json({ error: "Faltan datos" }, 400);

    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) return json({ error: "Falta el secreto RESEND_API_KEY" }, 500);

    const from = `${(fromName || "Brami3D").replace(/[<>]/g, "")} <hola@brami3d.app>`;
    const payload = { from, to: [to], subject, text: text || "" };
    if (replyTo) payload.reply_to = replyTo;
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

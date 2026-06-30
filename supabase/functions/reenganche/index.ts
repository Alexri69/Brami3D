// Brami3D — Edge Function programada "reenganche"
// Envía UNA sola vez un email de bienvenida/ayuda (con la guía PDF adjunta) a los
// usuarios registrados hace >= DIAS días que aún NO han creado ningún pedido, y
// que no han sido contactados antes. Registra cada envío en `reenganche_enviado`
// (tabla de sql/019) para no repetir.
//
// Auth: NO lleva token de usuario (es un cron). "Verify JWT" debe estar OFF.
// Protección OBLIGATORIA: secreto CRON_SECRET (cabecera x-cron-secret); sin él → 403.
// Secretos: RESEND_API_KEY (ya existe), CRON_SECRET.
// (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase solos.)

import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND = Deno.env.get("RESEND_API_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

const FROM = "Brami3D <hola@brami3d.app>";
const REPLY_TO = "brami3d@gmail.com";
const GUIA_URL = "https://brami3d.app/guia-brami3d.pdf";
const DIAS = 7;                 // antigüedad mínima de la cuenta para contactar
const MAX_POR_EJECUCION = 200;  // tope de seguridad (rate limit de Resend)
const EXCLUDE = ["alexri69@gmail.com", "brami3d@gmail.com", "demo@brami3d.app"];

const ASUNTO = "¿Te echamos una mano para empezar con Brami3D? \u{1F5A8}️";
const TEXTO =
  "Hola \u{1F44B}\n\n" +
  "Soy Alexander, de Brami3D. Vi que hace un tiempo creaste tu cuenta en Brami3D " +
  "—la app para gestionar tu taller de impresión 3D (pedidos, costes, presupuestos " +
  "y facturas)— pero que todavía no has tenido ocasión de estrenarla.\n\n" +
  "¿Hubo algo que no te encajó o que no viste cómo hacer? Me encantaría ayudarte: " +
  "responde a este correo y te echo una mano personalmente, sin compromiso.\n\n" +
  "Para ponértelo fácil, te adjunto una guía rápida para sacarle partido en 5 minutos.\n\n" +
  "Y recuerda que tienes Pro gratis durante 30 días para probarlo todo sin límites.\n\n" +
  "Un saludo,\nAlexander — Brami3D\nbrami3d.app";

Deno.serve(async (req) => {
  // Protección obligatoria del cron.
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

  if (!RESEND) return json({ error: "Falta RESEND_API_KEY" }, 500);

  const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };

  try {
    // 1) Usuarios que YA tienen algún pedido (set de user_id) → no contactar.
    const pedidos = await fetch(`${SUPABASE_URL}/rest/v1/pedidos?select=user_id`, { headers: H })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
    const conPedido = new Set<string>((pedidos as { user_id: string }[]).map((p) => p.user_id));

    // 2) Usuarios ya contactados antes → no repetir.
    const previos = await fetch(`${SUPABASE_URL}/rest/v1/reenganche_enviado?select=user_id`, { headers: H })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
    const yaEnviado = new Set<string>((previos as { user_id: string }[]).map((p) => p.user_id));

    // 3) Listar usuarios (Admin API, paginado).
    const corte = Date.now() - DIAS * 864e5;
    type U = { id: string; email?: string; created_at?: string };
    const candidatos: U[] = [];
    for (let page = 1; page <= 50; page++) {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: H });
      if (!r.ok) break;
      const data = await r.json();
      const users: U[] = data.users || [];
      if (!users.length) break;
      for (const u of users) {
        if (!u.email || EXCLUDE.includes(u.email.toLowerCase())) continue;
        if (conPedido.has(u.id) || yaEnviado.has(u.id)) continue;
        if (u.created_at && new Date(u.created_at).getTime() > corte) continue; // demasiado reciente
        candidatos.push(u);
      }
      if (users.length < 200) break; // última página
    }

    if (!candidatos.length) return json({ ok: true, candidatos: 0, enviados: 0 });

    // 4) Descargar la guía una sola vez y adjuntarla en base64.
    let pdfB64 = "";
    try {
      const g = await fetch(GUIA_URL);
      if (g.ok) pdfB64 = encodeBase64(new Uint8Array(await g.arrayBuffer()));
    } catch (_) { /* si falla la descarga, enviamos sin adjunto */ }

    // 5) Enviar + registrar (uno a uno, respetando el tope).
    let enviados = 0;
    for (const u of candidatos.slice(0, MAX_POR_EJECUCION)) {
      const payload: Record<string, unknown> = {
        from: FROM, to: u.email, reply_to: REPLY_TO, subject: ASUNTO, text: TEXTO,
      };
      if (pdfB64) payload.attachments = [{ filename: "guia-brami3d.pdf", content: pdfB64 }];

      const rs = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!rs.ok) continue; // si Resend falla, no lo marcamos → se reintenta la próxima vez

      enviados++;
      await fetch(`${SUPABASE_URL}/rest/v1/reenganche_enviado`, {
        method: "POST",
        headers: { ...H, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ user_id: u.id, email: u.email }),
      }).catch(() => {});
    }

    return json({ ok: true, candidatos: candidatos.length, enviados });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

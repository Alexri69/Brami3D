// Brami3D — Edge Function programada "recordatorios"
// Envía a cada taller (owner) un email-resumen con sus PRESUPUESTOS sin aceptar
// y sus PEDIDOS pendientes de cobro. Pensada para ejecutarse por Cron (semanal).
//
// Auth: NO lleva token de usuario (es un cron). "Verify JWT" debe estar OFF.
// Protección: si defines el secreto CRON_SECRET, hay que llamarla con la cabecera
//   x-cron-secret: <ese valor>  (recomendado, para que nadie la dispare a mano).
// Secretos: RESEND_API_KEY (ya existe de enviar-doc), CRON_SECRET (opcional).
// (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase solos.)

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND = Deno.env.get("RESEND_API_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const FROM = "Brami3D <hola@brami3d.app>";
const PUSH_URL = `${Deno.env.get("SUPABASE_URL")}/functions/v1/enviar-push`;

const QUOTE_DAYS = 3;    // presupuestos compartidos sin aceptar con más de N días
const COLLECT_DAYS = 7;  // pedidos terminados/entregados sin cobrar (igual que la app)

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const isoDaysAgo = (d: number) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);

Deno.serve(async (req) => {
  if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

  const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };
  const get = async (q: string) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${q}`, { headers: H });
    return r.ok ? await r.json() : [];
  };

  try {
    // 1) Presupuestos compartidos, sin aceptar y sin cobrar, con cierta antigüedad
    const quotes = await get(
      `pedidos?select=user_id,proyecto,pres_num,precio_final,precio_publico,fecha` +
      `&aceptado=eq.false&cobrado=eq.false&share_token=not.is.null&fecha=lt.${isoDaysAgo(QUOTE_DAYS)}`,
    );
    // 2) Pedidos terminados/entregados, sin cobrar, de hace más de 7 días
    const collect = await get(
      `pedidos?select=user_id,proyecto,pres_num,precio_final,fecha,estado` +
      `&cobrado=eq.false&estado=in.(terminado,entregado)&fecha=lt.${isoDaysAgo(COLLECT_DAYS)}`,
    );

    // Config por usuario (moneda + nombre de empresa)
    const cfgs = await get(`config?select=user_id,moneda,empresa`);
    const cfgBy: Record<string, { moneda?: string; empresa?: string }> = {};
    for (const c of cfgs) cfgBy[c.user_id] = c;

    // Agrupar por usuario
    const byUser: Record<string, { quotes: any[]; collect: any[] }> = {};
    const slot = (u: string) => (byUser[u] ??= { quotes: [], collect: [] });
    for (const r of quotes) slot(r.user_id).quotes.push(r);
    for (const r of collect) slot(r.user_id).collect.push(r);

    let sent = 0;
    const users = Object.keys(byUser);
    for (const uid of users) {
      const d = byUser[uid];
      if (!d.quotes.length && !d.collect.length) continue;

      // Email de login del taller
      const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, { headers: H });
      if (!ur.ok) continue;
      const user = await ur.json();
      const to = user?.email;
      if (!to) continue;

      const mon = (cfgBy[uid]?.moneda) || "€";
      const empresa = cfgBy[uid]?.empresa || "tu taller";
      const price = (r: any) => {
        const v = r.precio_final ?? r.precio_publico;
        return v != null ? `${Number(v).toFixed(2)}${mon}` : "—";
      };
      const row = (label: string, r: any) =>
        `<tr><td style="padding:7px 10px;border-bottom:1px solid #27272A;color:#d4d4d8">${label}</td>` +
        `<td style="padding:7px 10px;border-bottom:1px solid #27272A;color:#fff;text-align:right;font-weight:700">${price(r)}</td></tr>`;

      let html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#d4d4d8">
        <h2 style="color:#F97316;margin:0 0 4px">Resumen de pendientes</h2>
        <p style="color:#a1a1aa;margin:0 0 18px">Hola, ${esc(empresa)}. Esto es lo que tienes pendiente en Brami3D:</p>`;

      if (d.quotes.length) {
        html += `<h3 style="color:#fff;font-size:15px;margin:18px 0 6px">📄 Presupuestos sin aceptar (${d.quotes.length})</h3>
          <table style="width:100%;border-collapse:collapse;font-size:14px"><tbody>` +
          d.quotes.map((r) => row(esc(r.proyecto || r.pres_num || "Presupuesto"), r)).join("") +
          `</tbody></table>`;
      }
      if (d.collect.length) {
        html += `<h3 style="color:#fff;font-size:15px;margin:18px 0 6px">💰 Pedidos pendientes de cobro (${d.collect.length})</h3>
          <table style="width:100%;border-collapse:collapse;font-size:14px"><tbody>` +
          d.collect.map((r) => row(esc(r.proyecto || r.pres_num || "Pedido"), r)).join("") +
          `</tbody></table>`;
      }

      html += `<p style="margin:22px 0 0"><a href="https://brami3d.app/brami3d_supabase.html"
        style="background:#F97316;color:#000;text-decoration:none;font-weight:700;padding:11px 22px;border-radius:8px;display:inline-block">Abrir Brami3D</a></p>
        <p style="color:#52525b;font-size:12px;margin-top:24px">Recibes este resumen porque tienes pendientes en Brami3D.</p></div>`;

      const rs = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to, subject: "Brami3D — Resumen de pendientes", html }),
      });
      if (rs.ok) sent++;

      // Push (además del email) con un resumen corto, si hay dispositivos suscritos.
      try {
        const partes = [];
        if (d.quotes.length) partes.push(`${d.quotes.length} presupuesto${d.quotes.length > 1 ? "s" : ""} sin aceptar`);
        if (d.collect.length) partes.push(`${d.collect.length} pedido${d.collect.length > 1 ? "s" : ""} por cobrar`);
        await fetch(PUSH_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-cron-secret": CRON_SECRET },
          body: JSON.stringify({ user_id: uid, title: "🔔 Tienes pendientes en Brami3D", body: partes.join(" · ") }),
        });
      } catch (_) { /* el push es best-effort; el email es lo principal */ }
    }

    return json({ ok: true, candidatos: users.length, enviados: sent });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

// Brami3D — Edge Function programada "backup-mensual"
// Copia de seguridad automática por usuario: el día 1 de cada mes genera un
// JSON con todas sus tablas de negocio (mismo formato que el backup manual de
// la app, restaurable desde Config → Restaurar copia) y lo guarda en Storage:
//   archivos/{uid}/backups/backup-YYYY-MM.json   (conserva las 3 últimas)
// No envía emails a los usuarios. Deja latido en cron_heartbeat (lo vigila
// verificar-crons.yml) y avisa al owner por email si revienta.
//
// Auth: NO lleva token de usuario (es un cron). "Verify JWT" debe estar OFF.
// Protección OBLIGATORIA: secreto CRON_SECRET (cabecera x-cron-secret).
// (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase solos.)

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const RESEND = Deno.env.get("RESEND_API_KEY") || "";

const TABLAS = ["clientes", "pedidos", "impresoras", "filamentos", "piezas", "archivos", "gastos"];
const CONSERVAR = 3; // backups por usuario
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };

async function fetchAll(tabla: string, uid: string) {
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/${tabla}?user_id=eq.${uid}&select=*&limit=1000&offset=${offset}`,
      { headers: H },
    );
    if (!r.ok) break;
    const data = await r.json();
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

async function latido(resultado: unknown) {
  await fetch(`${SUPABASE_URL}/rest/v1/cron_heartbeat?on_conflict=nombre`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ nombre: "backup-mensual", ultimo: new Date().toISOString(), resultado }),
  }).catch(() => {});
}

async function avisarOwner(texto: string) {
  if (!RESEND) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Brami3D <hola@brami3d.app>", to: "brami3d@gmail.com",
      subject: "⚠️ Brami3D — fallo en el cron backup-mensual", text: texto,
    }),
  }).catch(() => {});
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

  try {
    // 1) Listar usuarios (Admin API, paginado).
    type U = { id: string; email?: string };
    const usuarios: U[] = [];
    for (let page = 1; page <= 50; page++) {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: H });
      if (!r.ok) break;
      const data = await r.json();
      const us: U[] = data.users || [];
      if (!us.length) break;
      usuarios.push(...us);
      if (us.length < 200) break;
    }

    const ym = new Date().toISOString().slice(0, 7); // YYYY-MM
    let conBackup = 0, vacios = 0, fallos = 0;

    for (const u of usuarios) {
      try {
        // 2) Reunir los datos de negocio del usuario (formato del backup manual:
        //    la restauración de la app acepta claves en forma de BD).
        const data: Record<string, unknown> = {};
        let filas = 0;
        for (const t of TABLAS) {
          const rows = await fetchAll(t, u.id);
          data[t] = rows;
          filas += rows.length;
        }
        const cfgRows = await fetchAll("config", u.id);
        data.config = cfgRows[0] || {};
        if (filas === 0) { vacios++; continue; }   // cuenta vacía → sin backup

        const payload = {
          app: "Brami3D",
          schema_version: 1,
          exported_at: new Date().toISOString(),
          origen: "backup-automatico-mensual",
          user_email: u.email || null,
          user_id: u.id,
          data,
        };

        // 3) Subir a Storage (upsert: re-ejecutar el mismo mes lo sobrescribe).
        const path = `${u.id}/backups/backup-${ym}.json`;
        const up = await fetch(`${SUPABASE_URL}/storage/v1/object/archivos/${path}`, {
          method: "POST",
          headers: { ...H, "Content-Type": "application/json", "x-upsert": "true" },
          body: JSON.stringify(payload),
        });
        if (!up.ok) { fallos++; continue; }
        conBackup++;

        // 4) Retención: conservar solo los CONSERVAR más recientes.
        const ls = await fetch(`${SUPABASE_URL}/storage/v1/object/list/archivos`, {
          method: "POST",
          headers: { ...H, "Content-Type": "application/json" },
          body: JSON.stringify({ prefix: `${u.id}/backups`, limit: 100 }),
        });
        if (ls.ok) {
          const items: { name: string }[] = await ls.json();
          const nombres = items.map((i) => i.name).filter((n) => n.startsWith("backup-")).sort();
          const sobran = nombres.slice(0, Math.max(0, nombres.length - CONSERVAR));
          if (sobran.length) {
            await fetch(`${SUPABASE_URL}/storage/v1/object/archivos`, {
              method: "DELETE",
              headers: { ...H, "Content-Type": "application/json" },
              body: JSON.stringify({ prefixes: sobran.map((n) => `${u.id}/backups/${n}`) }),
            }).catch(() => {});
          }
        }
      } catch (_) { fallos++; }
    }

    const resumen = { mes: ym, usuarios: usuarios.length, con_backup: conBackup, vacios, fallos };
    await latido(resumen);
    if (fallos) await avisarOwner(`Backup mensual con fallos parciales: ${JSON.stringify(resumen)}`);
    return json({ ok: true, ...resumen });
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    await avisarOwner(`El cron backup-mensual ha fallado del todo:\n\n${msg}`);
    return json({ error: msg }, 500);
  }
});

// Brami3D — Edge Function "borrar-cuenta" (RGPD / derecho al olvido)
// Borra TODOS los datos del usuario logueado y su cuenta de autenticación.
// Auth: x-user-token (el propio usuario). "Verify JWT" debe estar OFF.
// (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase solos.)

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-user-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const PUBLISHABLE = "sb_publishable_4gEjOV3kyfh8_I0f861iow__6b1ueIi";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Tablas con columna user_id que hay que vaciar para este usuario.
const TABLES = [
  "facturas_eventos", "facturas_registro", "error_logs", "push_subscriptions",
  "gastos", "archivos", "piezas", "pedidos", "filamentos", "impresoras",
  "clientes", "contadores", "config", "user_plans",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const userToken = req.headers.get("x-user-token") || "";
    if (!userToken) return json({ error: "No autorizado" }, 401);
    const uResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${userToken}`, apikey: PUBLISHABLE },
    });
    if (!uResp.ok) return json({ error: "Sesión no válida" }, 401);
    const uid = (await uResp.json()).id;
    if (!uid) return json({ error: "Usuario no encontrado" }, 400);

    const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, Prefer: "return=minimal" };

    // 1) Borrar las filas del usuario en cada tabla (service role → ignora RLS).
    for (const tabla of TABLES) {
      await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?user_id=eq.${uid}`, { method: "DELETE", headers: H })
        .catch(() => {});   // si una tabla no existe, se ignora
    }

    // 2) Borrar la cuenta de autenticación (admin API).
    const del = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
      method: "DELETE",
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    });
    if (!del.ok && del.status !== 404) {
      return json({ error: "No se pudo eliminar la cuenta (" + del.status + ")" }, 500);
    }

    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

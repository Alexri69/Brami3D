// Brami3D — Edge Function "telegram-gastos"
// El usuario manda al bot de Telegram la foto (o el PDF) de un tique; Claude lee
// concepto, importe, fecha, proveedor y categoría; el bot responde con un resumen
// y los botones Guardar / Categoría / Descartar. Al guardar, se crea el gasto.
//
// Dos entradas:
//  · POST ?accion=configurar  (desde la app, x-user-token de un ADMIN): registra
//    el webhook en Telegram con su secreto y devuelve el usuario del bot.
//  · POST del webhook de Telegram: exige la cabecera
//    X-Telegram-Bot-Api-Secret-Token, que se deriva del token del bot (no hace
//    falta otro secreto).
// Secretos: TELEGRAM_BOT_TOKEN, ANTHROPIC_API_KEY (+ los de Supabase).
// Tablas: sql/029_telegram_gastos.sql. Verify JWT = OFF (se valida aquí).

import Anthropic from "npm:@anthropic-ai/sdk@1.10.0";

const SB = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const PUBLISHABLE = "sb_publishable_4gEjOV3kyfh8_I0f861iow__6b1ueIi";
const HS = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };

const CATS = ["Filamento", "Repuestos", "Herramientas", "Electricidad", "Envíos", "Publicidad", "Software", "Otros"];
const ICO: Record<string, string> = { Filamento: "🧵", Repuestos: "🔩", Herramientas: "🛠️", Electricidad: "⚡", "Envíos": "📦", Publicidad: "📣", Software: "💻", Otros: "📎" };
const LIMITE_DIA = 30;               // fotos leídas por usuario y día (control de coste)
const MAX_BYTES = 10 * 1024 * 1024;  // tamaño máximo del archivo
const IMG_TIPOS = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MODELO = "claude-opus-5-5";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-user-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// ── utilidades ──────────────────────────────────────────────────────────────
async function sha256Hex(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const secretoWebhook = async () => (await sha256Hex(BOT + ":brami3d-telegram-gastos")).slice(0, 48);

async function tg(metodo: string, cuerpo: Record<string, unknown>) {
  const r = await fetch(`https://api.telegram.org/bot${BOT}/${metodo}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) console.warn("telegram", metodo, j.description || r.status);
  return j;
}
const h = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const decir = (chat: number, texto: string, extra: Record<string, unknown> = {}) =>
  tg("sendMessage", { chat_id: chat, text: texto, parse_mode: "HTML", ...extra });

async function rest(ruta: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${ruta}`, { ...init, headers: { ...HS, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`REST ${ruta.split("?")[0]} ${r.status}: ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const hoyISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Atlantic/Canary" });
const fmtFecha = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : iso);
const fmtEur = (n: number) => n.toFixed(2).replace(".", ",") + " €";

// ── Claude: leer el tique ───────────────────────────────────────────────────
const ESQUEMA = {
  type: "object",
  properties: {
    es_gasto: { type: "boolean", description: "true si la imagen es un tique, factura o justificante de pago" },
    descripcion: { type: "string", description: "Concepto breve en español (máx. 60 caracteres)" },
    importe: { type: "number", description: "Importe TOTAL pagado, impuestos incluidos, en euros" },
    fecha: { type: "string", description: "Fecha del documento en formato AAAA-MM-DD, o cadena vacía si no se ve" },
    proveedor: { type: "string", description: "Nombre comercial de la tienda o empresa, o cadena vacía" },
    categoria: { type: "string", enum: CATS },
  },
  required: ["es_gasto", "descripcion", "importe", "fecha", "proveedor", "categoria"],
  additionalProperties: false,
};

const SISTEMA = `Lees fotos de tiques, facturas y justificantes de pago de un pequeño taller de impresión 3D en España (Canarias).
Extrae los datos del gasto:
- importe: el TOTAL pagado con impuestos (IGIC o IVA) incluidos, no la base imponible. Usa punto decimal.
- fecha: la del documento, en AAAA-MM-DD. Si no se lee, deja la cadena vacía.
- descripcion: lo comprado, corto y en español (por ejemplo «Rollo PLA 1 kg ×2» o «Boquillas 0,4 mm»).
- proveedor: el nombre comercial (por ejemplo «Amazon», «Leroy Merlin»).
- categoria, una de estas:
  Filamento (rollos de filamento o resina), Repuestos (boquillas, camas, correas y piezas de impresora),
  Herramientas, Electricidad (facturas de luz), Envíos (correos, mensajería, embalaje),
  Publicidad, Software (suscripciones y programas), Otros (cualquier otra cosa).
Si la imagen no es un tique ni una factura, pon es_gasto=false, importe 0 y el resto vacío con categoria «Otros».`;

type Datos = { descripcion: string; importe: number; fecha: string; proveedor: string; categoria: string };

async function leerTique(bytes: Uint8Array, tipo: string, nota: string): Promise<{ ok: boolean; datos?: Datos; motivo?: string }> {
  const client = new Anthropic(); // ANTHROPIC_API_KEY
  let b64 = "";
  for (let i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  b64 = btoa(b64);
  const bloque = tipo === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
    : { type: "image", source: { type: "base64", media_type: tipo, data: b64 } };
  const texto = `Hoy es ${hoyISO()}.${nota ? ` Nota del usuario: «${nota.slice(0, 300)}».` : ""} Extrae los datos del gasto.`;

  // deno-lint-ignore no-explicit-any
  const resp: any = await client.beta.messages.create({
    model: MODELO,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SISTEMA,
    output_config: { effort: "low", format: { type: "json_schema", schema: ESQUEMA } },
    messages: [{ role: "user", content: [bloque, { type: "text", text: texto }] }],
  // deno-lint-ignore no-explicit-any
  } as any);

  if (resp.stop_reason === "refusal") return { ok: false, motivo: "rechazo" };
  if (resp.stop_reason === "max_tokens") return { ok: false, motivo: "corte" };
  const txt = (resp.content || []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
  let d;
  try { d = JSON.parse(txt); } catch { return { ok: false, motivo: "json" }; }
  const importe = Math.round((Number(d.importe) || 0) * 100) / 100;
  if (!d.es_gasto || !(importe > 0)) return { ok: false, motivo: "no_gasto" };
  return {
    ok: true,
    datos: {
      descripcion: String(d.descripcion || "Gasto").trim().slice(0, 120) || "Gasto",
      importe,
      fecha: /^\d{4}-\d{2}-\d{2}$/.test(d.fecha) && d.fecha <= hoyISO() ? d.fecha : hoyISO(),
      proveedor: String(d.proveedor || "").trim().slice(0, 80),
      categoria: CATS.includes(d.categoria) ? d.categoria : "Otros",
    },
  };
}

// ── mensajes del bot ────────────────────────────────────────────────────────
const resumen = (d: Datos) =>
  `🧾 <b>Gasto leído</b>\n\n<b>Concepto:</b> ${h(d.descripcion)}\n<b>Importe:</b> ${fmtEur(d.importe)}\n<b>Fecha:</b> ${fmtFecha(d.fecha)}` +
  (d.proveedor ? `\n<b>Proveedor:</b> ${h(d.proveedor)}` : "") +
  `\n<b>Categoría:</b> ${ICO[d.categoria] || "📎"} ${h(d.categoria)}\n\n¿Lo guardo en Gastos?`;
const tecladoPrincipal = (id: string) => ({
  inline_keyboard: [
    [{ text: "✅ Guardar", callback_data: `ok:${id}` }],
    [{ text: "✏️ Categoría", callback_data: `c:${id}` }, { text: "❌ Descartar", callback_data: `x:${id}` }],
  ],
});
const tecladoCategorias = (id: string) => {
  const filas = [];
  for (let i = 0; i < CATS.length; i += 2) {
    filas.push(CATS.slice(i, i + 2).map((c, j) => ({ text: `${ICO[c]} ${c}`, callback_data: `s:${id}:${i + j}` })));
  }
  filas.push([{ text: "↩️ Volver", callback_data: `v:${id}` }]);
  return { inline_keyboard: filas };
};
const AYUDA_SIN_VINCULO = "Hola 👋 Este bot apunta sus gastos en <b>Brami3D</b>.\n\nPara empezar, conecte su cuenta: en la app, vaya a <b>Configuración → Gastos por Telegram → Conectar</b> y pulse el enlace que le aparece.";
const AYUDA = "📸 Mándeme la <b>foto de un tique o factura</b> (o el PDF) y le preparo el gasto.\nSi quiere, escriba una nota en el pie de la foto, por ejemplo «2 rollos para el pedido de medallas».";

// ── vincular el chat con la cuenta ──────────────────────────────────────────
async function vincular(chat: number, codigo: string) {
  const cod = codigo.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
  const filas = cod
    ? await rest(`telegram_codigos?codigo=eq.${cod}&expira=gt.${encodeURIComponent(new Date().toISOString())}&select=user_id`)
    : [];
  if (!filas?.length) {
    await decir(chat, "❌ Ese código no vale o ha caducado (duran 15 minutos). Pida uno nuevo en la app: <b>Configuración → Gastos por Telegram</b>.");
    return;
  }
  const uid = filas[0].user_id;
  await rest(`telegram_vinculos?chat_id=eq.${chat}`, { method: "DELETE" });
  await rest("telegram_vinculos?on_conflict=user_id", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ user_id: uid, chat_id: chat }),
  });
  await rest(`telegram_codigos?codigo=eq.${cod}`, { method: "DELETE" });
  await decir(chat, "✅ <b>Cuenta conectada.</b>\n\n" + AYUDA);
}

// ── foto o PDF recibido ─────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function tique(chat: number, uid: string, msg: any) {
  let fileId = "", tipo = "", tam = 0;
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const p = msg.photo[msg.photo.length - 1];
    fileId = p.file_id; tipo = "image/jpeg"; tam = p.file_size || 0;
  } else if (msg.document) {
    const m = String(msg.document.mime_type || "");
    if (m === "application/pdf" || IMG_TIPOS.includes(m)) { fileId = msg.document.file_id; tipo = m; tam = msg.document.file_size || 0; }
  }
  if (!fileId) { await decir(chat, AYUDA); return; }
  if (tam > MAX_BYTES) { await decir(chat, "El archivo es demasiado grande (máximo 10 MB)."); return; }

  // Límite diario
  const desde = new Date(Date.now() - 24 * 3600e3).toISOString();
  const usadas = await rest(`telegram_pendientes?user_id=eq.${uid}&creado=gte.${encodeURIComponent(desde)}&select=id&limit=${LIMITE_DIA + 1}`);
  if ((usadas?.length || 0) >= LIMITE_DIA) {
    await decir(chat, `Ha llegado al límite de ${LIMITE_DIA} tiques en 24 horas. Puede apuntar el gasto a mano en la app.`);
    return;
  }

  const aviso = await decir(chat, "📸 Leyendo el tique…");
  const msgId = aviso?.result?.message_id;
  const editar = (texto: string, extra: Record<string, unknown> = {}) =>
    msgId ? tg("editMessageText", { chat_id: chat, message_id: msgId, text: texto, parse_mode: "HTML", ...extra }) : decir(chat, texto, extra);

  const id = crypto.randomUUID();
  try {
    const f = await tg("getFile", { file_id: fileId });
    const ruta = f?.result?.file_path;
    if (!ruta) throw new Error("getFile sin ruta");
    const dr = await fetch(`https://api.telegram.org/file/bot${BOT}/${ruta}`);
    if (!dr.ok) throw new Error("descarga " + dr.status);
    const bytes = new Uint8Array(await dr.arrayBuffer());
    if (bytes.length > MAX_BYTES) { await editar("El archivo es demasiado grande (máximo 10 MB)."); return; }

    const r = await leerTique(bytes, tipo, String(msg.caption || ""));
    if (!r.ok || !r.datos) {
      await rest("telegram_pendientes", { method: "POST", body: JSON.stringify({ id, user_id: uid, chat_id: chat, estado: "descartado", datos: { motivo: r.motivo } }) });
      await editar(r.motivo === "no_gasto"
        ? "🤔 No he encontrado un tique o un importe en esa imagen. Pruebe con una foto más nítida, de frente y con buena luz."
        : "⚠️ No he podido leer el tique. Pruebe otra vez o apúntelo a mano en la app.");
      return;
    }

    // Guardar el justificante en Storage: archivos/{uid}/tiques/{id}.ext
    const ext = tipo === "application/pdf" ? "pdf" : (tipo.split("/")[1] || "jpg").replace("jpeg", "jpg");
    const fotoPath = `${uid}/tiques/${id}.${ext}`;
    const up = await fetch(`${SB}/storage/v1/object/archivos/${fotoPath}`, {
      method: "POST", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": tipo }, body: bytes,
    });
    await rest("telegram_pendientes", {
      method: "POST",
      body: JSON.stringify({ id, user_id: uid, chat_id: chat, datos: r.datos, foto_path: up.ok ? fotoPath : null }),
    });
    await editar(resumen(r.datos), { reply_markup: tecladoPrincipal(id) });
  } catch (e) {
    console.error("tique", e);
    await editar("⚠️ No he podido leer el tique ahora mismo. Pruebe otra vez en un momento o apúntelo a mano en la app.");
  }
}

// ── botones ─────────────────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function boton(cq: any) {
  await tg("answerCallbackQuery", { callback_query_id: cq.id });
  const chat = cq.message?.chat?.id, msgId = cq.message?.message_id;
  const [accion, id, extra] = String(cq.data || "").split(":");
  if (!chat || !/^[0-9a-f-]{36}$/.test(id || "")) return;
  const editar = (texto: string, markup?: unknown) =>
    tg("editMessageText", { chat_id: chat, message_id: msgId, text: texto, parse_mode: "HTML", ...(markup ? { reply_markup: markup } : {}) });

  const filas = await rest(`telegram_pendientes?id=eq.${id}&chat_id=eq.${chat}&select=*`);
  const p = filas?.[0];
  if (!p || p.estado !== "pendiente") { await editar("Este tique ya no está pendiente."); return; }
  const d: Datos = p.datos;

  if (accion === "ok") {
    await rest("gastos", {
      method: "POST",
      body: JSON.stringify({
        id: crypto.randomUUID(), user_id: p.user_id, descripcion: d.descripcion, categoria: d.categoria,
        importe: d.importe, fecha: d.fecha, proveedor: d.proveedor || "", notas: "Desde Telegram", foto_path: p.foto_path,
      }),
    });
    await rest(`telegram_pendientes?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ estado: "guardado" }) });
    await editar(`✅ <b>Guardado en Gastos</b>\n${ICO[d.categoria] || "📎"} ${h(d.descripcion)} · <b>${fmtEur(d.importe)}</b> · ${fmtFecha(d.fecha)}`);
  } else if (accion === "x") {
    await rest(`telegram_pendientes?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ estado: "descartado" }) });
    if (p.foto_path) {
      await fetch(`${SB}/storage/v1/object/archivos`, {
        method: "DELETE", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: [p.foto_path] }),
      }).catch(() => {});
    }
    await editar("❌ Descartado. No se ha guardado nada.");
  } else if (accion === "c") {
    await editar(resumen(d) + "\n\n<i>Elija la categoría:</i>", tecladoCategorias(id));
  } else if (accion === "s") {
    const cat = CATS[Number(extra)];
    if (cat) {
      d.categoria = cat;
      await rest(`telegram_pendientes?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ datos: d }) });
    }
    await editar(resumen(d), tecladoPrincipal(id));
  } else if (accion === "v") {
    await editar(resumen(d), tecladoPrincipal(id));
  }
}

// deno-lint-ignore no-explicit-any
async function manejar(upd: any) {
  if (upd.callback_query) { await boton(upd.callback_query); return; }
  const msg = upd.message;
  if (!msg || msg.chat?.type !== "private") return;
  const chat: number = msg.chat.id;
  const texto = String(msg.text || "").trim();

  const m = texto.match(/^\/(start|vincular)(?:@\w+)?\s*(\S*)/i);
  if (m && m[2]) { await vincular(chat, m[2]); return; }

  const v = await rest(`telegram_vinculos?chat_id=eq.${chat}&select=user_id`);
  const uid = v?.[0]?.user_id;
  if (!uid) { await decir(chat, AYUDA_SIN_VINCULO); return; }
  if (msg.photo || msg.document) { await tique(chat, uid, msg); return; }
  await decir(chat, AYUDA);
}

// ── entrada ─────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  if (!BOT) return json({ error: "Falta el secreto TELEGRAM_BOT_TOKEN" }, 500);
  const url = new URL(req.url);

  // 1) Configurar el webhook (desde la app, solo administradores)
  if (url.searchParams.get("accion") === "configurar") {
    const token = req.headers.get("x-user-token") || "";
    if (!token) return json({ error: "No autorizado" }, 401);
    const adm = await fetch(`${SB}/rest/v1/rpc/is_admin`, {
      method: "POST", headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}",
    });
    if (!adm.ok || (await adm.json()) !== true) return json({ error: "Solo administradores" }, 403);
    if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ error: "Falta el secreto ANTHROPIC_API_KEY" }, 500);
    const r = await tg("setWebhook", {
      url: `${SB}/functions/v1/telegram-gastos`,
      secret_token: await secretoWebhook(),
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
    });
    const me = await tg("getMe", {});
    if (!r.ok) return json({ error: "Telegram: " + (r.description || "error") }, 502);
    return json({ ok: true, bot: me?.result?.username || "" });
  }

  // 2) Webhook de Telegram
  if (req.headers.get("x-telegram-bot-api-secret-token") !== await secretoWebhook()) {
    return new Response("forbidden", { status: 401 });
  }
  const upd = await req.json().catch(() => null);
  if (!upd) return new Response("ok");
  // Se contesta enseguida a Telegram y el tique se procesa en segundo plano
  // (leerlo puede tardar unos segundos y Telegram reintenta si no hay respuesta).
  const tarea = manejar(upd).catch((e) => console.error("telegram-gastos", e));
  // deno-lint-ignore no-explicit-any
  const er = (globalThis as any).EdgeRuntime;
  if (er?.waitUntil) er.waitUntil(tarea); else await tarea;
  return new Response("ok");
});

# CLAUDE.md

Brami3D — app de gestión para negocio de impresión 3D. Static site **sin build**, desplegado en `brami3d.app` vía GitHub Pages (**push a `main` = producción**). Pensada para venderse como **SaaS multi-taller** (varios clientes).

## Archivos
- `landing.html` — página de marketing (precios, modal de pago)
- `brami3d_supabase.html` — SPA completa (~2700 líneas), la app de verdad
- `index.html` — redirección a landing
- `p.html` — página pública de aceptación de presupuestos (sin login)
- `gracias.html` — destino tras pago PayPal manual
- `cookies.html` · `privacidad.html` · `promo_instagram.html`
- `supabase/functions/*` — Edge Functions (Deno)
- `sql/*.sql` — migraciones (ejecutar a mano en SQL Editor)

## Backend (Supabase)
- Proyecto ref: **`uzgzfxizpoigzcnlunpr`**
- Claves **nuevo formato** `sb_publishable_…` (la antigua anon/JWT ya no se usa en el gateway)
- Tablas: `clientes`, `pedidos`, `impresoras`, `filamentos`, `piezas`, `archivos`, `gastos`, `config`, `user_plans`
- RLS por `user_id`; RPCs `SECURITY DEFINER` para la parte pública

### Edge Functions
Se crean/despliegan desde el **panel web** (Edge Functions → *Via Editor*). Secretos en *Settings → Edge Functions*. **"Verify JWT" = OFF** en todas (el gateway de la clave nueva rechaza el JWT de usuario; se valida a mano).
- `enviar-doc` — email vía **Resend**, auth por header `x-user-token` (validado contra `/auth/v1/user`), `from: hola@brami3d.app` (dominio `brami3d.app` verificado: DKIM/SPF `v=spf1 include:amazonses.com ~all`/MX/DMARC en Namecheap).
- `crear-checkout` — crea sesión de **Stripe Checkout** (suscripción). Auth `x-user-token`. Secreto `STRIPE_SECRET_KEY`. PRICES **live**: mensual `price_1TdvFePrM5C0gGgh2I0Gr6LC`, anual `price_1TdvFePrM5C0gGgh4liis6Os`. `success_url=?pago=ok`.
- `stripe-webhook` — verifica firma (`constructEventAsync` + `createSubtleCryptoProvider`), y en `checkout.session.completed` / `customer.subscription.*` hace upsert en `user_plans` con la **service role**. Secretos `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- `portal-cliente` — abre el **Customer Portal** de Stripe (cancelar/cambiar tarjeta/descargar facturas). Auth `x-user-token`; busca `stripe_customer_id` en `user_plans` con la service role; `billingPortal.sessions.create`. App: `irAPortal()` + botón "⚙️ Gestionar suscripción" en `showPlanInfo()` cuando `_plan.hasStripe`. Requiere activar el portal una vez en Stripe → Facturación → Portal de clientes (con Cancelaciones ON, cancelar al fin del periodo).
- `borrar-cuenta` — **RGPD / derecho al olvido**. Auth `x-user-token`; con service role borra las filas del usuario en todas las tablas (lista `TABLES`) y elimina la cuenta de auth (`DELETE /auth/v1/admin/users/{id}`). App: `confirmarEliminarCuenta()`/`eliminarCuenta()` (botón "Zona de peligro" en Config; pide escribir ELIMINAR/DELETE). Claves `del.*`/`cfg.dangerZone`.
- `enviar-push` — **Web Push** (notificaciones aunque la app esté cerrada). `npm:web-push` + VAPID (secretos `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`). Auth: `x-user-token` (manda al propio usuario, p. ej. botón "probar") o `x-cron-secret` (manda a `body.user_id`, para servidor/cron). Lee de `push_subscriptions` (service role), borra las caducadas (404/410). App: `suscribirPush()` (al activar notificaciones, `pushManager.subscribe` con la VAPID pública → upsert en `push_subscriptions`), `probarPush()` (botón en Config), listener `push` en `sw.js`. Tabla: `sql/015_push_subscriptions.sql`. ⚠️ iOS: solo si la PWA está instalada en inicio (iOS 16.4+).
- `recordatorios` — **programada (cron)**, sin token de usuario. Con la service role agrupa por taller los presupuestos compartidos sin aceptar (>3 días) y los pedidos terminados/entregados sin cobrar (>7 días, misma regla que `checkAndNotify`) y envía un **email-resumen** vía Resend al email de login. Protegida con header `x-cron-secret` (secreto `CRON_SECRET`). Se programa con `sql/013_cron_recordatorios.sql` (pg_cron, lunes 08:00 UTC) o el Cron UI del dashboard.

> ⚠️ Nunca pegar en chat secretos `sk_live_` / `whsec_` → van directos a Supabase secrets. La publishable sí puede ir embebida.

## App (`brami3d_supabase.html`)
- `sb = createClient(SUPA_URL, SUPA_KEY)` (publishable)
- Estado global: `CU` (usuario), `PAGE`, `_cache`, `_lineas`
- Boot: `bootApp()` → `loadAll()` → `goTo('dashboard')`. En bootApp se llaman además `handleShortcut(); _checkPagoReturn(); _checkSuscribirIntent();`
- Navegación: `goTo(page)` → `render()` reconstruye `#content`
- CRUD: `dbSave(table,data)` upsert, `dbDel(table,id)` — actualizan `_cache` y re-renderizan
- **Caché local** en `localStorage` por `user_id` (funciona offline) + **cola de escritura offline** (outbox en localStorage que se vacía al recuperar conexión)
- Detección de columnas opcionales en runtime: `_hasAnticipo`, `_hasShare`
- Tema: dark por defecto, `body.light` para claro, guardado en `b3d_theme`. Botón `#theme-btn` (🌙)
- **Dashboard con métricas** de negocio (ingresos, costes, beneficio, consumo)
- **Onboarding**: `maybeShowOnboarding()` (en bootApp) muestra un asistente de 3 pasos solo en cuentas vacías y no descartadas (flag `b3d_onboarded_<uid>`). Forzar para probar: `showOnboarding()` en consola.
- **Accesibilidad**: `a11yIcons()` da `aria-label` a los `.btn-icon` tras cada render/modal (por `title` o emoji). Claves `a11y.*`.
- **Errores globales**: `window.onerror`/`unhandledrejection` → `_logError()` muestra un toast (`err.generic`, sin spam, ignora ruido de red) y registra en la tabla `error_logs` (best-effort). Migración `sql/014_error_logs.sql` (RLS: insert propio, select solo admin). Ver: `select ... from error_logs order by created_at desc`.
- **Mantenimiento impresoras**: columnas opcionales `mantenimiento_cada`/`ultimo_mant_h` (detección `_hasMant`, `sql/018`). En la tarjeta: barra + "Toca mantenimiento" cuando `horasUso - ultimoMantH ≥ cada`; botón `marcarMantenimiento()` reinicia el contador. Aviso en `checkAndNotify`. Default `MANT_DEFAULT=250`.
- **Referidos**: enlace `?ref=CODE` → `localStorage b3d_ref` → `_aplicarReferido()` (en bootApp) llama RPC `aplicar_referido` (+30 días Pro a ambos, vía `_sumar_trial`). UI `mostrarReferidos()` (card en Config) usa RPC `mi_ref_code()` y cuenta `referidos`. SQL: `sql/017_referidos.sql` (tabla `referidos`, columna `user_plans.ref_code`, RPCs SECURITY DEFINER). Sin Edge Functions ni Stripe.
- **Nudge de trial**: `trialBannerHTML()` (en render) muestra un banner en los últimos ≤7 días de prueba (`_plan.source==='trial'`) con CTA a `showPlanInfo()`. Descartable en sesión (`_dismissTrial`). Claves `trial.*`.

### i18n (ES / EN)
- `LANG` global (localStorage `b3d_lang`, **default `es`**; inglés es opt-in)
- `I18N = { es:{…}, en:{…} }`, helper `t(key, vars)`
- `applyStaticI18n()` traduce el DOM estático; `setLang(l)` / `toggleLang()`
- **Botón de idioma = bandera** (`#lang-btn`): muestra 🇬🇧 en español (clic→inglés) y 🇪🇸 en inglés (clic→español); su `title` también se adapta
- En **inglés se oculta el módulo fiscal** (solo aplica a España)
- PDFs también traducidos
- ⚠️ Cuidado con apóstrofes en strings (rompen comillas simples JS) y con `€` (€) al editar

### Planes y límites (el "candado" del SaaS)
- Tabla `user_plans` (free/pro/admin) + columnas Stripe (`stripe_customer_id`, `stripe_subscription_id`, `expires_at`, `trial_until`), índice único por `user_id`
- `resolvePlan()` resuelve el plan efectivo; `FREE_LIMITS` = **10 pedidos/mes, 5 clientes**; `checkPlanLimit()` los aplica
- `ADMIN_EMAILS` = `alexri69@gmail.com`, `brami3d@gmail.com` (acceso admin total)
- Trial 30 días (`trial_until`); panel **Admin** (`pgAdmin`) para marcar plan/expiry/blocked a mano
- `showUpgradeModal()` enlaza a `landing.html#precios`

### Pago / suscripción (Stripe + PayPal)
- Precios: Básico **Gratis** · **Pro Mensual 9 €/mes** · **Pro Anual 79 €/año**
- `irACheckout(plan)` → fetch a `crear-checkout` (headers `apikey`+`Authorization` = publishable, `x-user-token`) → redirige a Stripe
- `_checkPagoReturn()` — al volver con `?pago=ok` avisa y refresca el plan (el webhook ya lo activó)
- `_checkSuscribirIntent()` — si se entra con `?suscribir=mensual|anual` (desde el landing), abre el checkout automáticamente tras login
- **Landing**: `openPayModal(plan)` muestra botón **"Pagar con tarjeta"** (`#pay-card-btn` → `brami3d_supabase.html?suscribir=<plan>`, activación instantánea) **+** caja PayPal como alternativa **manual** (24 h, el owner marca Pro a mano)

### Presupuestos públicos
- `p.html` consume RPCs `get_presupuesto_publico` y `aceptar_presupuesto` (deben existir como FUNCTION, no solo el ALTER TABLE)
- La app genera el enlace público para que el cliente acepte sin cuenta

## Migraciones SQL (a mano en SQL Editor)
- `009_pedidos_anticipo.sql` — anticipos en pedidos
- `010_presupuesto_publico.sql` — RPCs de aceptación pública
- `011_stripe.sql` — columnas Stripe + índice único en `user_plans`

## Validar JS antes de commitear
```bash
cd /c/Users/alexr/Brami3D
node scripts/validate.js   # valida los <script> inline de todos los .html + JSON
```
Hay **CI** (`.github/workflows/validate.yml`) que ejecuta esto en cada push/PR — como push a main = producción, sirve de red de seguridad. Tras cada cambio: **commit + push** (despliega solo).

## Seguridad (auditado 2026-06-03)
- **RLS** activo y correcto en las 12 tablas: cada política filtra por `(auth.uid() = user_id)`, ninguna permisiva. `user_plans` solo SELECT (writes vía webhook/admin RPC). Tablas VeriFactu append-only (solo INSERT+SELECT). Script de comprobación: `sql/012_audit_rls.sql`.
- **XSS**: `esc()` aplicado en todo el HTML con datos de usuario (incluido `p.html`, que ve el cliente). `esc()` escapa también `'`.

## Integración Meta (Facebook / Instagram / Ads)
Conexión **vía directa** a la Graph API (sin servidor MCP de terceros; se descartó `meta-ads-mcp`/Pipeboard por privacidad y fricción). Credenciales en **`.env` local** (gitignoreado, NUNCA al repo): `META_ACCESS_TOKEN` (token de usuario **sin caducidad** — verificado con `debug_token`: `expires_at=0`, por ser admin de la app en modo desarrollo), `META_APP_ID`, `META_APP_SECRET`, `META_AD_ACCOUNT_ID=act_365965302`, `META_PAGE_ID=1153412231189064` (Página "Brami3D"), `META_IG_USER_ID=17841442053876570`. Plantilla en `.env.example`.
- App de Meta: **"Brami3D"** (App ID `1218738721315597`), creada en developers.facebook.com.
- Helper: **`scripts/meta.ps1 <endpoint> [query] [-Method] [-Body]`** — lee el token del `.env` (no lo imprime) y llama a `graph.facebook.com/v25.0`. Ej: `powershell -File scripts/meta.ps1 act_365965302/campaigns "fields=name,status"`.
- **Permisos del token actual**: `ads_management`, `ads_read`, `business_management`, `pages_show_list`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_messages` → gestionar/leer **anuncios**, leer la **Página**, y **publicar/comentar/DMs en Instagram**.
- **Instagram conectado**: cuenta **@brami3d.app** (`META_IG_USER_ID=17841442053876570`), vinculada a la Página vía caso de uso "Administrar mensajes y contenido en Instagram" → **API setup with Facebook login** (NO Instagram login; esa no da insights). Publicar = flujo 2 pasos: `POST /{ig_user_id}/media` (crea contenedor con `image_url`/`video_url`+`caption`) → `POST /{ig_user_id}/media_publish` (`creation_id`).
- **Pendiente para más alcance**: `instagram_manage_insights` (métricas de IG, añadir en *Permisos y funciones* + regenerar token); en producción los DMs/insights pueden requerir **App Review** (modo desarrollo funciona para el propio dueño).

### Publicación en redes (manual y automática)
- **`scripts/publicar.py`** `--target fb|ig|both --caption "…" --images URL1 URL2…` (o `--job JSON`): publica post simple o carrusel en FB (multi-foto) e IG (carrusel). Imágenes deben ser **URLs públicas** (IG lo exige) → se alojan en **`m/`** (servida por GitHub Pages, `brami3d.app/m/*`). Lee credenciales del `.env` o de variables de entorno (CI).
- **Flujo del mes**: Antigravity genera imágenes en `marketing/` (gitignored) + `marketing/plan-mes.json` (16 posts julio: `id,fecha,redes,tipo,archivos,caption,estado`). `scripts/preparar.py` copia las imágenes a `m/` y genera **`social/plan.json`** (versionado, con URLs públicas). `scripts/publicar_hoy.py` publica los posts de hoy pendientes y marca estado.
- **Automático**: workflow `.github/workflows/publicar-redes.yml` (cron diario 17:00 UTC ≈ 19:00 ES + `workflow_dispatch` manual con input `id`). Requiere el **secret `META_ACCESS_TOKEN`** en GitHub (Settings → Secrets → Actions). `PAGE_ID`/`IG_USER_ID` van en el yaml (no son secretos). El Action commitea `social/plan.json` con el estado.
- **Salud del token**: el token **no caduca**, pero puede invalidarse por causas externas (cambio de contraseña FB, permisos revocados). `scripts/verificar_token.py` + workflow `verificar-token.yml` (cron lunes 07:00 UTC) lo comprueban; si se rompe, el workflow falla y GitHub avisa por email. Se descartó la auto-renovación con PAT (innecesaria + riesgo de PAT con `secrets:write` en repo público).

## Pendiente / ideas futuras
- **Landing en inglés** (selector ES/EN + traducir todo el marketing) — no hecho; la app sí está bilingüe
- Cancelar/reembolsar la suscripción de **prueba** de Stripe (pago test de 9 € real) — ya se puede desde el propio portal (`irAPortal`) ahora que Cancelaciones está activo
- (Opcional) i18n del botón "Gestionar suscripción" y limpieza de políticas RLS duplicadas (cosmético, sin riesgo de seguridad)

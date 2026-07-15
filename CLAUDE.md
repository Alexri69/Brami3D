# CLAUDE.md

Brami3D — gestión para negocio de impresión 3D. Static site **sin build**, en `brami3d.app` vía GitHub Pages (**push a `main` = producción**). Pensada como **SaaS multi-taller**. Tras cada cambio: **commit + push** (despliega solo). Responder siempre en español.

## Archivos
- `brami3d_supabase.html` — SPA completa, la app de verdad. Módulos propios en `js/` (scripts clásicos, **sin build**, cargan antes del script principal y están en el APP_SHELL de `sw.js`): `js/i18n.js` (LANG/I18N/`t()`) y `js/verifactu.js` (registro fiscal). `scripts/test.js` concatena HTML+módulos para extraer funciones.
- `landing.html` — marketing (precios, modal de pago) · `index.html` — redirige a landing
- `p.html` — aceptación pública de presupuestos (sin login) · `gracias.html` — post-pago PayPal
- `cookies.html` · `privacidad.html` · `promo_instagram.html`
- `supabase/functions/*` — Edge Functions (Deno) · `sql/*.sql` — migraciones (a mano en SQL Editor)
- `scripts/*` — utilidades (marketing, email, informes) · `m/` — imágenes públicas para redes

## Backend (Supabase)
- Ref: **`uzgzfxizpoigzcnlunpr`**. Claves **nuevo formato** `sb_publishable_…` (la anon/JWT antigua ya no vale en el gateway).
- Tablas (RLS por `user_id`): `clientes`, `pedidos`, `impresoras`, `filamentos`, `piezas`, `archivos`, `gastos`, `config`, `user_plans`, `push_subscriptions`, `error_logs`, `reenganche_enviado`, `referidos`, tablas VeriFactu. RPCs `SECURITY DEFINER` para lo público.

### Edge Functions
Desplegar: panel web (Edge Functions → *Via Editor*) **o** `npm run deploy:functions` (todas) / `npx supabase functions deploy <n> --project-ref uzgzfxizpoigzcnlunpr --no-verify-jwt`. **"Verify JWT" = OFF en todas** (se valida a mano por eso el `--no-verify-jwt`). Secretos en *Settings → Edge Functions*. Operar Supabase desde aquí: ver memoria `project_supabase_ops`.
- `enviar-doc` — email (PDF adjunto) vía **Resend**. Auth `x-user-token`. `from: hola@brami3d.app` (dominio verificado DKIM/SPF/DMARC en Namecheap). Valida destinatario/Reply-To, limita tamaños y **50 emails/día por usuario** (RPC `email_envio_check`, `sql/021`).
- `crear-checkout` — **Stripe Checkout** (suscripción). Auth `x-user-token`. `STRIPE_SECRET_KEY`. Prices live: mensual `price_1TdvFePrM5C0gGgh2I0Gr6LC`, anual `price_1TdvFePrM5C0gGgh4liis6Os`. `success_url=?pago=ok`.
- `stripe-webhook` — verifica firma; en `checkout.session.completed`/`customer.subscription.*` hace upsert en `user_plans` (service role). `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- `portal-cliente` — Customer Portal de Stripe. Auth `x-user-token`. App: `irAPortal()` (botón en `showPlanInfo()` si `_plan.hasStripe`). Activar portal una vez en Stripe.
- `borrar-cuenta` — **RGPD**. Auth `x-user-token`; service role borra filas del usuario en todas las tablas (lista `TABLES`, incluye `reenganche_enviado`) + ficheros de Storage (`archivos/{uid}/…`) + cuenta auth. App: `confirmarEliminarCuenta()`/`eliminarCuenta()` (Config → Zona de peligro).
- `enviar-push` — **Web Push** (`npm:web-push` + VAPID, secretos `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`). Auth `x-user-token` (propio) o `x-cron-secret` (`body.user_id`). Lee `push_subscriptions`, borra caducadas (404/410). App: `suscribirPush()`, `probarPush()`, listener `push` en `sw.js`. ⚠️ iOS: solo PWA instalada (16.4+).
- `recordatorios` — **cron** (lunes 08:00 UTC, `sql/013`). Service role: presupuestos sin aceptar (>3d) + pedidos sin cobrar (>7d) → email-resumen Resend. `x-cron-secret` (`CRON_SECRET`, **obligatorio**). **Vigilancia de crons**: recordatorios/reenganche dejan latido en `cron_heartbeat` (`sql/022`) y avisan por email al owner si fallan; `verificar-crons.yml` (martes) comprueba latidos frescos. `stripe-webhook` también avisa al owner en error.
- `avisar-registro` — aviso al owner (email a brami3d@gmail.com + push a admins vía `enviar-push`) en cada registro nuevo. La dispara el trigger `notificar_nuevo_usuario` de `auth.users` (`sql/025`, con EXCEPTION para no romper signups). `x-cron-secret`.
- `backup-mensual` — **cron ACTIVO** (`brami3d-backup-mensual`, día 1 a las 06:00 UTC, `sql/024`). Service role: JSON de negocio por usuario (formato restaurable desde Config → Restaurar) en Storage `archivos/{uid}/backups/backup-YYYY-MM.json`, conserva 3. `x-cron-secret`. Latido en `cron_heartbeat`.
- `reenganche` — **cron ACTIVO** (`brami3d-reenganche-semanal`, lunes 09:00 UTC, `sql/019`). Service role: usuarios registrados ≥7d **sin pedidos**, no admins/demo, **no contactados** → email bienvenida con **guía PDF adjunta** (de `brami3d.app/guia-brami3d.pdf`); registra en `reenganche_enviado` para no repetir. `x-cron-secret` (`CRON_SECRET`). Manual: `scripts/reenganche.py --to … [--dry]`.

> ⚠️ Nunca pegar en chat `sk_live_`/`whsec_`/tokens → van directos a Supabase secrets. La publishable sí puede ir embebida.

## App (`brami3d_supabase.html`)
- `sb = createClient(SUPA_URL, SUPA_KEY)` (publishable). Estado: `CU`, `PAGE`, `_cache`, `_lineas`.
- Boot: `bootApp()` → `loadAll()` → `goTo('dashboard')` (+ `handleShortcut/_checkPagoReturn/_checkSuscribirIntent/_aplicarReferido/maybeShowOnboarding`). Nav: `goTo(page)` → `render()` reconstruye `#content`. CRUD: `dbSave(table,data)`/`dbDel(table,id)` (actualizan `_cache` + re-render).
- **Offline**: caché en `localStorage` por `user_id` + **outbox** (cola de escritura que se vacía al volver la red). Detección de columnas opcionales: `_hasAnticipo`, `_hasShare`, `_hasMant`, `_hasStockDesc` (`pedidos.stock_descontado`, `sql/021`: evita doble descuento de filamento entre dispositivos).
- Tema dark por defecto (`body.light`, `b3d_theme`, `#theme-btn`). Dashboard con métricas (ingresos/costes/beneficio/consumo).
- **Onboarding** `maybeShowOnboarding()` (cuentas vacías, flag `b3d_onboarded_<uid>`; forzar: `showOnboarding()`). **A11y** `a11yIcons()`. **Errores globales** → `_logError()` (toast + tabla `error_logs`, `sql/014`).
- **Mantenimiento impresoras** (`sql/018`, `MANT_DEFAULT=250`, `marcarMantenimiento()`). **Referidos** `?ref=CODE` → RPC `aplicar_referido` (+30d Pro a ambos), UI `mostrarReferidos()`, `sql/017`. **Nudge trial** `trialBannerHTML()` (≤7d de prueba).
- **Rectificativas** (R1 por diferencias): botón "Rectificar" en Registro fiscal → `abrirRectificativa()`/`emitirRectificativa()` — importes en negativo, serie propia `rectnum` (`sql/023`), mismo hash-chain, PDF propio (`buildRectificativaPdf`), opción de liberar el pedido para refacturar.
- **Recordatorio de presupuesto** (🔔 en Pedidos, presupuestos no aceptados): `recordarPresupuesto()` → modal de email con texto de seguimiento + PDF + enlace público si existe. **Export trimestral para el gestor** (botón en Registro fiscal): `abrirExportTrimestral()` → CSV de facturas del trimestre (rectificativas en negativo) + CSV de gastos, con fila TOTAL.

### i18n (ES / EN)
`LANG` (localStorage `b3d_lang`, **default `es`**; EN opt-in). `I18N={es,en}`, helper `t(key,vars)`, `applyStaticI18n()`, `setLang()/toggleLang()`. Botón bandera `#lang-btn` (🇬🇧 en ES / 🇪🇸 en EN). En **EN se oculta el módulo fiscal** (solo España). PDFs traducidos. ⚠️ Cuidado con apóstrofes y `€` al editar strings.

### Planes y candado SaaS
- `user_plans` (free/pro/admin) + columnas Stripe (`stripe_customer_id`, `stripe_subscription_id`, `expires_at`, `trial_until`), índice único `user_id`.
- `resolvePlan()` → `_plan`; `FREE_LIMITS` = **10 pedidos/mes, 5 clientes**; `checkPlanLimit()` en cliente **y triggers en servidor** (`sql/020`: `check_limites_free`; bloqueo real con `banned_until`). `ADMIN_EMAILS` = `alexri69@gmail.com`, `brami3d@gmail.com`. Trial 30d. Panel **Admin** (`pgAdmin`). `showUpgradeModal()` → `landing.html#precios`. Numeración pres/factura: RPC atómica `siguiente_contador` (`sql/020`).

### Pago (Stripe + PayPal)
Precios: Gratis · Pro Mensual **9 €** · Pro Anual **79 €**. `irACheckout(plan)` → `crear-checkout` → Stripe. `_checkPagoReturn()` (`?pago=ok`), `_checkSuscribirIntent()` (`?suscribir=mensual|anual` desde landing). Landing `openPayModal(plan)`: botón tarjeta (`?suscribir=`) + PayPal manual (`paypal.me/Brami3D/9EUR`, el owner marca Pro a mano).

### Presupuestos públicos
`p.html` usa RPCs `get_presupuesto_publico` y `aceptar_presupuesto` (deben existir como FUNCTION). La app genera el enlace para aceptar sin cuenta. Tras aceptar, el mismo enlace muestra el **tracker "sigue tu pedido"** (En cola → Imprimiendo → Terminado → Entregado + entrega prevista; `estado`/`fecha_entrega` en la RPC, `sql/024`).

## Validar y seguridad
- **Validar antes de commit**: `node scripts/validate.js` (compila los `<script>` inline + JSON; ignora carpetas no desplegadas) **y `node scripts/test.js`** (tests de lógica de negocio: costes, hash VeriFactu, planes — extrae las funciones reales del HTML). CI: `.github/workflows/validate.yml` (corre ambos).
- **RLS** (auditado): cada política filtra por `(auth.uid() = user_id)`; `user_plans` solo SELECT (writes vía webhook/admin); VeriFactu append-only. Script: `sql/012_audit_rls.sql`. **XSS**: `esc()` en todo HTML con datos de usuario (incl. `p.html`), escapa también `'`.

## Marketing — Meta (FB / IG / Ads)
**Vía directa** a Graph API (sin MCP de terceros). Credenciales en **`.env` local** (gitignored): `META_ACCESS_TOKEN` (sin caducidad), `META_APP_ID`, `META_APP_SECRET`, `META_AD_ACCOUNT_ID=act_365965302`, `META_PAGE_ID=1153412231189064`, `META_IG_USER_ID=17841442053876570`. App Meta "Brami3D" (App ID `1218738721315597`). IG = **@brami3d.app** (vía *API setup with Facebook login*; publicar = 2 pasos `/{ig}/media` → `/{ig}/media_publish`).
- Helper: `scripts/meta.ps1 <endpoint> [query] [-Method] [-Body]` (lee token del `.env`, Graph v25.0).
- `scripts/metricas.py [--n N]` — métricas IG (reach; reels ~10x carruseles).
- **Publicar**: `scripts/publicar.py --target fb|ig|both --caption … --images URL… | --video URL --formato reel|story|feed` (URLs públicas desde `m/`). Flujo del mes: `marketing/plan-mes.json` (gitignored) → `scripts/preparar.py` → `social/plan.json` (versionado) → `scripts/publicar_hoy.py`.
  - Cada post en `plan-mes.json`: `{id, fecha, redes, tipo, archivos[], caption, estado}`; **reels/vídeo** llevan además `"video": "ruta/al.mp4"` (con `archivos: []`). `preparar.py` copia imágenes **y** el mp4 a `m/` (URL pública que IG exige) y vuelca a `plan.json`. `publicar_hoy.py` publica los de HOY: si el post tiene `video` → reel en IG (`publish_ig_video`) + vídeo de feed en FB (`publish_fb_video`); si no, imagen/carrusel. Marca `estado=publicado` + `publicado_en/at` (idempotente por red).
  - ⚠️ **`preparar.py` REESCRIBE `social/plan.json` entero** (no fusiona). Ejecutarlo **solo al cambiar de mes**, cuando el mes en curso ya se publicó: si se lanza antes, borra los posts pendientes del mes actual. Copia del mes anterior en `marketing/plan-<mes>.json`. Recuperar con `git restore social/plan.json` si se ejecuta por error.
- **Workflows**: `publicar-redes.yml` (cron 17:00 UTC + dispatch; secret `META_ACCESS_TOKEN`), `verificar-token.yml` (`scripts/verificar_token.py`, lunes 07:00; avisa si el token se invalida).

## Analítica (GA4)
Measurement ID **`G-C5P6F52QE3`**, propiedad **`531047655`**. `gtag` en `brami3d_supabase.html`/`landing.html`/`cookies.html`/`privacidad.html`, **consent-gated** (`localStorage b3d_rgpd`). Eventos vía `window.b3dTrack(name,params)`: `page_view` por sección (SPA), `pwa_install_prompt`/`pwa_installed`, `view_upgrade_modal`/`begin_checkout`.
- **Informe**: `scripts/ga_informe.py [--dias 30] [--email destino]` (GA4 Data API, cuenta de servicio `brami3d-informes@mindful-accord-500814-t1.iam.gserviceaccount.com`, JSON en `secretos/ga-service-account.json` gitignored, `GA_PROPERTY_ID` en `.env`; debe ser Lector en GA4). Con `--email` → Resend.
- **Email semanal**: `informe-ga.yml` (lunes 08:00 UTC). Secrets GitHub: `GA_SERVICE_ACCOUNT_JSON`, `RESEND_API_KEY`.

## Pendiente / ideas
- **Landing en inglés** (la app ya es bilingüe). i18n del botón "Gestionar suscripción" y limpiar políticas RLS duplicadas (cosmético). Si se añaden claves i18n o funciones fiscales, van en `js/i18n.js` / `js/verifactu.js` (no en el HTML).
- ~~Rotar `CRON_SECRET`~~ **hecho el 2026-07-04** (estaba hardcodeado en `sql/016`, repo público). Si vuelve a rotarse: `secrets set` + actualizar los 3 crons (`recordatorios`, `reenganche`, `backup-mensual`) + el trigger `notificar_presupuesto_aceptado`. ⚠️ Nunca commitear el secreto en `sql/*`.

# Brami3D — Gestión para talleres de impresión 3D

[![Web](https://img.shields.io/badge/web-brami3d.app-2563eb)](https://brami3d.app)
[![Licencia](https://img.shields.io/badge/licencia-propietaria-red)](./LICENSE)
[![Verifactu](https://img.shields.io/badge/Verifactu-2026-22c55e)](https://sede.agenciatributaria.gob.es)

**Brami3D** es una aplicación web para autónomos y talleres pequeños de impresión 3D en España. Gestiona pedidos, clientes, impresoras, filamentos, piezas y gastos, calcula costes por pieza incluyendo electricidad y desgaste de máquina, y emite **presupuestos y facturas con registro fiscal Verifactu** conforme al RD 1007/2023 y la Orden HAC/1177/2024.

👉 **Pruébala en [brami3d.app](https://brami3d.app)** — registro gratis, plan Free con 10 pedidos/mes y 5 clientes.

---

## ¿Qué hace?

- 📋 **Pedidos y presupuestos** — múltiples líneas (piezas, servicios, postproceso), conversión presupuesto → factura con numeración automática.
- 👥 **Clientes** — CIF/NIF, dirección fiscal, contacto; datos auto-rellenados en factura.
- 🖨️ **Impresoras** — horas de uso, desgaste, consumo eléctrico. Se descuenta del coste real de cada pieza.
- 🧵 **Filamentos** — stock en gramos, alerta cuando bajas del mínimo, descuento automático al completar pedido.
- 🧩 **Piezas** — catálogo de piezas recurrentes con precio de venta prefijado.
- 💸 **Gastos** — contabilidad simple con IVA repercutido/soportado.
- 🧾 **Facturación Verifactu** — registro de facturas con hash encadenado SHA-256, QR según Orden HAC/1177/2024, exportación XML AEAT, vista del registro fiscal con badge "No-Verifactu".
- 📊 **Dashboard** — facturación del mes, margen real, top clientes, alertas de stock y desgaste.
- 📁 **Archivos** — subida de STL/ZIP/imágenes por pedido (Supabase Storage, signed URLs 1h).
- 💾 **Backup** — exportar todos tus datos como JSON con un clic.
- 🎨 **Marca blanca** — logo y nombre de empresa propios en PDFs de presupuesto, factura e informe.
- 🌐 **PWA** — instalable en móvil, funciona offline con cache local, sincroniza en vivo entre dispositivos vía Supabase Realtime.

## Planes

| | Free | Pro | Admin |
|---|---|---|---|
| Pedidos/mes | 10 | ilimitados | ilimitados |
| Clientes | 5 | ilimitados | ilimitados |
| Impresoras / filamentos / piezas | ✅ | ✅ | ✅ |
| Registro fiscal Verifactu | ✅ | ✅ | ✅ |
| Soporte prioritario | ❌ | ✅ | ✅ |
| Prueba Pro gratis 30 días al registrarte | ✅ | — | — |

Los precios y condiciones están en [brami3d.app/landing.html#precios](https://brami3d.app/landing.html#precios).

---

## Stack técnico

Brami3D es una SPA **sin build step** — se despliega tal cual en GitHub Pages.

| Capa | Tecnología |
|---|---|
| Frontend | HTML + CSS + JS vanilla (un solo archivo `brami3d_supabase.html`) |
| Charts | [Chart.js](https://www.chartjs.org/) 4.4 vía CDN |
| QR Verifactu | [QRious](https://github.com/neocotic/qrious) 4.0 vía CDN |
| BBDD y auth | [Supabase](https://supabase.com) (Postgres + Storage + Realtime + Auth) |
| PWA / offline | Service Worker + `localStorage` (cache local por usuario) |
| Hosting | GitHub Pages + dominio custom `brami3d.app` |
| Analytics | Google Analytics 4, consent-gated RGPD |

### Arquitectura

```
landing.html           Marketing, pricing, calculadora pública
index.html             Redirect a landing.html
brami3d_supabase.html  Toda la app (SPA)
sw.js                  Service Worker (cache CDN + fallback offline)
manifest.webmanifest   PWA manifest
sql/*.sql              Migraciones Supabase (ejecutar manualmente en orden)
privacidad.html        Política de privacidad RGPD
terminos.html          Términos de uso
```

### Tablas Supabase

- `clientes`, `pedidos`, `impresoras`, `filamentos`, `piezas`, `archivos`, `gastos`, `config` — una fila por usuario, filtradas por `user_id` con RLS.
- `user_plans` — plan activo (free / pro / admin) con trial de 30 días al registrarse.
- `facturas_registro`, `facturas_eventos` — registro fiscal Verifactu con hash encadenado.

Todas las tablas tienen **Row Level Security** habilitado y políticas `user_id = auth.uid()`. Storage aplica RLS por path de usuario.

---

## Desarrollo local

No hay nada que compilar. Para ejecutar una copia local del frontend:

```bash
# Con Python
python -m http.server 8080

# O con Node
npx serve .
```

Abre `http://localhost:8080/brami3d_supabase.html`.

Para que la app funcione necesitas tu propio proyecto de Supabase. Las claves están al inicio del archivo `brami3d_supabase.html` (son claves `anon`, públicas — la seguridad real la hace RLS en Postgres).

### Migraciones SQL

Ejecuta los archivos de `sql/` **en orden** en Supabase → SQL Editor:

1. `001_verifactu_registros.sql` — tablas del registro fiscal.
2. `002_user_plans.sql` — planes de usuario, trigger de alta.
3. `003_config_logo.sql` — logo y nombre para marca blanca.
4. `004_enable_realtime.sql` — publicar tablas en el canal Realtime.
5. `005_admin_functions.sql` — panel de admin (RPCs SECURITY DEFINER).

---

## Contribuir

Este es un proyecto comercial privado. Las **contribuciones no están abiertas** de momento — puedes reportar bugs o sugerencias vía Issues.

Si detectas un problema de seguridad, **no abras un issue público**. Escribe a [alexri69@gmail.com](mailto:alexri69@gmail.com) con el detalle.

## Licencia

Código propietario. Ver [LICENSE](./LICENSE). Copyright © 2025-2026 Alexander Rivero.

---

**Hecho desde Canarias 🏝️**

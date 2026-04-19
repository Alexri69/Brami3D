# CLAUDE.md

Brami3D — app de gestión para negocio de impresión 3D, en español. Static site sin build, desplegado en `brami3d.app` via GitHub Pages (push a `main` = producción).

## Archivos
- `landing.html` — página de marketing
- `brami3d_supabase.html` — SPA completa (~2500 líneas)
- `index.html` — redirección a landing

## App (`brami3d_supabase.html`)
- Supabase: `sb = createClient(SUPA_URL, SUPA_KEY)` (claves públicas/anon)
- Estado global: `CU` (usuario), `PAGE`, `_cache`, `_lineas`
- Boot: `bootApp()` → `loadAll()` → `goTo('dashboard')`
- Navegación: `goTo(page)` → `render()` reconstruye `#content`
- CRUD: `dbSave(table, data)` upsert, `dbDel(table, id)` — actualizan `_cache` y re-renderizan
- Caché local en `localStorage` por `user_id` (funciona offline)
- Tablas: `clientes`, `pedidos`, `impresoras`, `filamentos`, `piezas`, `archivos`, `gastos`, `config`
- Tema: dark por defecto, clase `body.light` para claro, guardado en `b3d_theme`

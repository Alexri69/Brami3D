const CACHE_NAME = 'b3d-cdn-v6';

// Recursos CDN externos (no cambian).
const CDN_SHELL = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/qrious@4.0.2/dist/qrious.min.js'
];

// Shell propio de la app: hay que precachearlo para que la PWA instalada ARRANQUE
// sin conexión (cold-start offline). Sin esto, abrir la app sin red da error del
// navegador aunque haya datos en localStorage.
const APP_SHELL = [
  '/brami3d_supabase.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', e => {
  // Ya NO hacemos skipWaiting automático: el SW nuevo queda "waiting" hasta que
  // el usuario acepta actualizar (la app muestra un aviso y envía SKIP_WAITING).
  e.waitUntil(
    caches.open(CACHE_NAME).then(c =>
      // addAll es atómico (si uno falla, falla todo). Cacheamos cada uno por
      // separado para que un CDN caído no rompa la instalación del SW.
      Promise.all([...CDN_SHELL, ...APP_SHELL].map(u =>
        c.add(u).catch(() => {})
      ))
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// La app pide activar la versión nueva al pulsar "Actualizar".
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Supabase API → siempre red
  if (url.hostname.includes('supabase.co')) {
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // HTML de la app → network-first (siempre versión actualizada).
  // Sin red: servimos la copia cacheada de esta página y, si no la hay (p. ej.
  // start_url con query ?source=pwa), caemos al shell precacheado para que la
  // PWA arranque igualmente offline.
  if (url.pathname.endsWith('.html') || url.pathname === '/') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          // Refrescamos la copia cacheada del shell para el próximo cold-start.
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() =>
          caches.match(e.request).then(hit =>
            hit || caches.match('/brami3d_supabase.html')
          )
        )
    );
    return;
  }

  // CDN y otros recursos → stale-while-revalidate.
  // Servimos de caché al instante (rápido y offline) pero revalidamos en segundo
  // plano, así las librerías ancladas a tags móviles (@supabase/supabase-js@2,
  // chart.js) se actualizan en la siguiente visita en vez de quedarse congeladas
  // para siempre como con cache-first puro.
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type !== 'opaque') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

// Push real: muestra la notificación aunque la app esté cerrada.
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch(_) { data = { body: e.data && e.data.text() }; }
  const title = data.title || 'Brami3D';
  const opts = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [120, 60, 120],
    data: { url: data.url || '/brami3d_supabase.html' }
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes('brami3d') && 'focus' in c) return c.focus();
      }
      return clients.openWindow('/brami3d_supabase.html');
    })
  );
});

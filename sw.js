const CACHE = 'pe-v4';
const CDN   = 'pe-cdn-v4';
const CORE  = ['/', '/manifest.json', '/icon.svg', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks =>
      Promise.all(ks.filter(k => k !== CACHE && k !== CDN).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Navegação: stale-while-revalidate → abre do cache instantaneamente,
  // atualiza em segundo plano para a próxima visita
  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match('/').then(cached => {
          const network = fetch(e.request).then(r => {
            cache.put('/', r.clone());
            return r;
          });
          return cached || network;
        })
      )
    );
    return;
  }

  // CDN assets (Supabase JS, Google Fonts): cache-first com revalidação silenciosa
  if (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(CDN).then(cache =>
        cache.match(e.request).then(cached => {
          const network = fetch(e.request).then(r => {
            if (r.ok) cache.put(e.request, r.clone());
            return r;
          });
          return cached || network;
        })
      )
    );
  }
});

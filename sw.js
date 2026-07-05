const CACHE = 'pe-v7';
const CDN   = 'pe-cdn-v6';
const CORE  = ['/', '/manifest.json', '/icon.svg', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks =>
      Promise.all(ks.filter(k => k !== CACHE && k !== CDN).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Navegação: sempre network-first sem fallback para cache (garante versão nova)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then(r => {
          if (r.ok) caches.open(CACHE).then(c => c.put('/', r.clone()));
          return r;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // CDN assets (Supabase JS, Google Fonts): cache-first
  if (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(CDN).then(cache =>
        cache.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(r => {
            if (r.ok) cache.put(e.request, r.clone());
            return r;
          });
        })
      )
    );
  }
});

const CACHE = 'pe-v13';
const CDN   = 'pe-cdn-v6';
const CORE  = ['/', '/manifest.json', '/icon.svg', '/icon-192.png', '/icon-512.png', '/icon-192-maskable.png', '/icon-512-maskable.png'];

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

// Atualiza o shell em cache e avisa as abas abertas se o HTML mudou (deploy novo).
async function updateShell(resp) {
  const cache  = await caches.open(CACHE);
  const cached = await cache.match('/');
  if (cached) {
    const [novo, velho] = await Promise.all([resp.clone().text(), cached.clone().text()]);
    if (novo === velho) return;               // nada mudou → não recacheia nem notifica
  }
  await cache.put('/', resp);
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' }));
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Navegação: STALE-WHILE-REVALIDATE — serve o shell do cache na hora (abertura
  // instantânea) e revalida na rede em 2º plano. Se veio versão nova, avisa a aba.
  if (e.request.mode === 'navigate') {
    const network = fetch(e.request, { cache: 'no-store' })
      .then(r => { if (r && r.ok) updateShell(r.clone()); return r; })
      .catch(() => null);
    e.waitUntil(network.catch(() => {}));     // mantém a revalidação viva em 2º plano
    e.respondWith(
      caches.open(CACHE)
        .then(c => c.match('/'))
        .then(cached => cached || network.then(r => r || fetch(e.request)))
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

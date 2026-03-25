const CACHE = 'cf-cache-v17';

// Install: skip waiting immediately so new SW takes over
self.addEventListener('install', e => {
  self.skipWaiting();
});

// Activate: delete ALL old caches, claim all clients
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: NEVER cache HTML — always fetch fresh from network
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // HTML: always network, never serve from cache
  if (e.request.mode === 'navigate' || e.request.destination === 'document' ||
      url.pathname === '/' || url.pathname.endsWith('.html')) {
    e.respondWith(fetch(e.request, {cache: 'no-store'}));
    return;
  }

  // Static assets (images, icons, manifest): cache-first
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        });
      })
    )
  );
});

// Message handler — always skip waiting so new SW takes over immediately
self.addEventListener('message', e => {
  self.skipWaiting();
});

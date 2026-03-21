const CACHE = 'cf-cache-v1';
const ASSETS = ['/', '/index.html', '/manifest.json', '/icon.png', '/apple-touch-icon.png'];

// Install: cache all core assets immediately
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {}))
  );
});

// Activate: take control of all clients right away, clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: stale-while-revalidate for HTML, cache-first for everything else
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        // Always fetch fresh in background and update cache
        const fetchPromise = fetch(e.request, {cache: 'no-store'}).then(res => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        }).catch(() => null);

        // Return cached immediately if available, otherwise wait for network
        return cached || fetchPromise;
      })
    )
  );
});

// Message: force update check — fetch fresh index.html and notify clients
self.addEventListener('message', e => {
  if (e.data === 'SYNC') {
    caches.open(CACHE).then(cache => {
      fetch('/index.html', {cache: 'no-store'}).then(res => {
        if (res.ok) {
          cache.put('/index.html', res.clone());
          cache.put('/', res.clone());
        }
        // Tell all clients the update is cached and ready
        self.clients.matchAll().then(clients =>
          clients.forEach(c => c.postMessage('UPDATED'))
        );
      }).catch(() => {
        self.clients.matchAll().then(clients =>
          clients.forEach(c => c.postMessage('SYNC_FAILED'))
        );
      });
    });
  }
});

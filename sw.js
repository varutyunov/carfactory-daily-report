const CACHE = 'cf-cache-v5';

// Install: skip waiting immediately so new SW takes over
self.addEventListener('install', e => {
  self.skipWaiting();
});

// Activate: delete ALL old caches, claim all clients
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: NETWORK-FIRST for HTML, cache-first for static assets
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // HTML pages: always try network first
  if (e.request.mode === 'navigate' || e.request.destination === 'document' ||
      url.pathname === '/' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request, {cache: 'no-store'}).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => { c.put(e.request, clone); });
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Static assets (images, css, js, manifest): cache-first
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

// Message handler for SYNC and SKIP_WAITING
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (e.data === 'SYNC') {
    fetch('/index.html', {cache: 'no-store'}).then(res => {
      if (res.ok) {
        caches.open(CACHE).then(cache => {
          cache.put('/index.html', res.clone());
          cache.put('/', res.clone());
        });
      }
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage('UPDATED'))
      );
    }).catch(() => {
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage('SYNC_FAILED'))
      );
    });
  }
});

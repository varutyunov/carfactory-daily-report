// Import OneSignal service worker for push notification handling
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');

const CACHE = 'cf-cache-v226';

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
  if(e.data && e.data.type === 'SET_BADGE' && typeof e.data.count === 'number'){
    if(navigator.setAppBadge){
      if(e.data.count > 0) navigator.setAppBadge(e.data.count).catch(()=>{});
      else navigator.clearAppBadge().catch(()=>{});
    }
    return;
  }
  self.skipWaiting();
});

// Push notification received — show native notification + set badge
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  const title = (data.headings && data.headings.en) || data.title || 'Car Factory';
  const body = (data.contents && data.contents.en) || data.body || '';
  e.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || 'cf-notif',
      renotify: true,
      data: data
    }).then(() => {
      // Increment badge on push
      if(navigator.setAppBadge) navigator.setAppBadge().catch(()=>{});
    })
  );
});

// Notification clicked — open or focus the app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients => {
      if(clients.length > 0){
        clients[0].focus();
        return;
      }
      return self.clients.openWindow('/');
    })
  );
});

// Import OneSignal service worker for push notification handling
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');

const CACHE = 'cf-cache-v625';

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
    .then(() => self.clients.matchAll({type:'window'}).then(clients =>
      clients.forEach(c => c.postMessage({type:'SW_UPDATED'}))
    ))
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

// Notification clicked — focus / open the app and deep-link to the tab the
// notification belongs to. The push payload's `data.tab` survives across
// OneSignal's various nestings (top-level on web, `additionalData` on iOS,
// `custom.a` on Android in some SDK versions) — try each so a one-line
// caller in index.html (`sendPushNotification(..., 'deals')`) just works.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const d = e.notification.data || {};
  // Hunt for the data field across OneSignal's different SDK shapes.
  const pickData = () => {
    if (d.tab) return d;
    if (d.data && d.data.tab) return d.data;
    if (d.additionalData && d.additionalData.tab) return d.additionalData;
    if (d.custom && d.custom.a && d.custom.a.tab) return d.custom.a;
    return {};
  };
  const data = pickData();
  const tab = data.tab || null;
  // Pass any other fields (e.g. location for payments) as opts through to
  // the page-side router so it can pre-select the right lot etc.
  const opts = {};
  for (const k in data) if (k !== 'tab') opts[k] = data[k];

  e.waitUntil(
    self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients => {
      if(clients.length > 0){
        const client = clients[0];
        if(tab){
          try { client.postMessage({type:'NAVIGATE_TAB', tab:tab, opts:opts}); } catch(_){}
        }
        return client.focus();
      }
      // No open window — encode tab + opts into URL params (notif_tab,
      // notif_location, etc.). The page parses them on startup.
      let qs = 'notif_tab=' + encodeURIComponent(tab || '');
      for (const k in opts){
        qs += '&notif_' + encodeURIComponent(k) + '=' + encodeURIComponent(opts[k]);
      }
      return self.clients.openWindow(tab ? '/?' + qs : '/');
    })
  );
});

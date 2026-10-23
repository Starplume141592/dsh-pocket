/* Pocket service worker — app shell + push notifications.
 * Never cache session/API traffic.
 */
const CACHE = 'pocket-shell-v12';
const SHELL = [
  './', './index.html', './styles.css', './app.js',
  './api.js', './timeline.js', './cache.js', './prefs.js', './update.js',
  './manifest.webmanifest', './icon-192.png', './icon-512.png',
];
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const url of SHELL) { try { await cache.add(url); } catch { /* ignore */ } }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('pocket-shell-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/') || url.pathname.includes('/__dsh')) return;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }
  if (url.pathname.match(/\.(css|js|png|webmanifest|woff2?)$/)) {
    // Stale-while-revalidate: instant shell, then keep the copy fresh.
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) {
        fetch(req).then((res) => {
          if (res.ok) cache.put(req, res.clone());
        }).catch(() => {});
        return hit;
      }
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        return new Response('', { status: 504, statusText: 'offline' });
      }
    })());
  }
});

function iconUrl() {
  return new URL('./icon-192.png', self.registration.scope).href;
}
function pageUrl(sessionId) {
  const base = new URL('./', self.registration.scope).href;
  return sessionId ? base + '#/chat/' + encodeURIComponent(sessionId) : base;
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* ignore */ }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Pocket';
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clients.some((client) => client.focused === true)) return;
    await self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : '',
      tag: typeof data.tag === 'string' ? data.tag : 'pocket-' + Date.now(),
      icon: iconUrl(),
      badge: iconUrl(),
      data: { sessionId: data.sessionId || '', url: pageUrl(data.sessionId || '') },
      requireInteraction: data.kind === 'approval',
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || pageUrl('');
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      await client.focus();
      if (typeof client.navigate === 'function') {
        try { await client.navigate(target); } catch { /* ignore */ }
      }
      return;
    }
    await self.clients.openWindow(target);
  })());
});

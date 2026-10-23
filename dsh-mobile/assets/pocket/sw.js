/* Pocket service worker — app shell only; never cache session/API traffic. */
const CACHE = 'pocket-shell-v1';
const SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const url of SHELL) { try { await cache.add(url); } catch {} }
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
    event.respondWith(caches.match(req).then(hit => hit || fetch(req)));
  }
});

/* DSH 手机端 Service Worker：只缓存 App 外壳，不缓存会话与 API。 */
// 如果装了 meow-smooth，把它的推送 SW 脚本并进来：推送/点击通知的处理器
// 继续生效，同时本 SW 负责离线外壳。boot.js 会拦截它对同一 scope 的重复注册。
try {
  importScripts('/plugins/meow-smooth/sw.js');
} catch {
  /* 没装 meow-smooth 时忽略 */
}

const CACHE = 'dshm-shell-v2';
const SHELL = [
  '/__dshm/offline.html',
  '/__dshm/boot.js',
  '/__dshm/manifest.webmanifest',
  '/__dshm/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const url of SHELL) {
        try {
          await cache.add(url);
        } catch {
          /* 单个资源失败不阻塞安装 */
        }
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith('dshm-') && key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/__dshm/api')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match('/__dshm/offline.html');
        return cached || new Response('离线', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      }),
    );
    return;
  }

  if (url.pathname.startsWith('/__dshm/') && url.pathname !== '/__dshm/sw.js') {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
  }
});

// ── 系统通知 ─────────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* 非 JSON 负载忽略 */
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'DSH';
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // 页面正开着就别弹系统通知了，避免重复打扰。
      if (clients.some((client) => client.focused === true)) return;
      await self.registration.showNotification(title, {
        body: typeof data.body === 'string' ? data.body : '',
        tag: typeof data.tag === 'string' ? data.tag : `dshm-${Date.now()}`,
        icon: '/__dshm/icon-192.png',
        badge: '/__dshm/icon-192.png',
        data: { sessionId: data.sessionId || null },
        requireInteraction: data.kind === 'approval',
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        return;
      }
      await self.clients.openWindow('/');
    })(),
  );
});

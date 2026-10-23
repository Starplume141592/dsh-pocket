// 本地集成测试：假内核 + 真网关，覆盖配对、代理、HTML 注入、WS 与吊销。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMobileGateway } from '../lib/gateway.js';
import { createUpstream } from '../lib/upstream.js';
import { createStore } from '../lib/store.js';

const COOKIE = 'dsh-auth-test=SESSIONVALUE; Path=/; HttpOnly';
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function startUpstream() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://upstream');
    if (url.pathname === '/' && url.searchParams.get('token') === 'secret') {
      res.writeHead(302, { location: '/', 'set-cookie': COOKIE });
      res.end();
      return;
    }
    if (!String(req.headers.cookie ?? '').includes('SESSIONVALUE')) {
      res.writeHead(401, { 'content-type': 'text/plain' });
      res.end('unauthorized');
      return;
    }
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><html><head><title>DSH</title><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="manifest" href="./manifest.webmanifest"></head><body><div id="app">DESKTOP APP</div></body></html>',
      );
      return;
    }
    if (url.pathname === '/api/echo') {
      const body = await readBody(req);
      const payload = JSON.stringify({
        ok: true,
        body,
        host: req.headers.host,
        origin: req.headers.origin ?? '',
        cookie: String(req.headers.cookie ?? '').includes('SESSIONVALUE'),
      });
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
      res.end(payload);
      return;
    }
    if (url.pathname === '/gzip') {
      const compressed = zlib.gzipSync('<!doctype html><html><head></head><body>GZIP APP</body></html>');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-encoding': 'gzip', 'content-length': compressed.length });
      res.end(compressed);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'] ?? '';
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\nX-Saw-Cookie: ${String(req.headers.cookie ?? '').includes('SESSIONVALUE')}\r\n\r\n`,
    );
    socket.end();
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function startHarness({ store, upstream, upstreamPort, push = null, tunnel = null, tsnet = null, setMobileEnabled = null }) {
  const gateway = createMobileGateway({ upstream, store, port: 0, bind: '127.0.0.1', push, tunnel, tsnet, setMobileEnabled });
  return gateway.start().then(() => {
    const main = http.createServer((req, res) => {
      if (String(req.url ?? '').startsWith('/plugins/dsh-mobile/api')) {
        gateway.handleDesktop(req, res);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    return new Promise((resolve) => {
      main.listen(0, '127.0.0.1', () => {
        resolve({ gateway, main, mainPort: main.address().port, upstreamPort });
      });
    });
  });
}

function desktopFetch({ gateway, mainPort, upstreamPort }, route, init = {}) {
  return fetch(`http://127.0.0.1:${mainPort}/plugins/dsh-mobile/api${route}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      origin: `http://127.0.0.1:${upstreamPort}`,
      ...(init.headers ?? {}),
    },
  }).then(async (res) => ({ status: res.status, body: await res.json() }));
}

function phoneFetch({ gateway }, route, init = {}) {
  return fetch(`http://127.0.0.1:${gateway.port}${route}`, init);
}

function upgradeProbe(port, cookie) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/api/remote.mux',
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-key': crypto.randomBytes(16).toString('base64'),
        'sec-websocket-version': '13',
        cookie,
      },
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve(res.headers);
    });
    req.on('error', reject);
    req.end();
  });
}

test('配对、代理、PWA 注入、WS 与吊销', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mobile-test-'));
  const store = createStore(dir);
  const { server: upstreamServer, port: upstreamPort } = await startUpstream();
  const origin = `http://127.0.0.1:${upstreamPort}`;
  const upstream = createUpstream({
    origin,
    authenticatedUrl: (url) => `${url}${url.includes('?') ? '&' : '?'}token=secret`,
  });
  const pushSent = [];
  const fakePush = {
    available: true,
    publicKey: 'BTestVapidPublicKey',
    count: () => store.listSubscriptions().length,
    subscribe: (deviceId, subscription) => store.addSubscription(deviceId, subscription),
    send: async (payload, options) => {
      pushSent.push({ payload, options });
      return { sent: store.listSubscriptions().length, failed: 0 };
    },
  };
  const tunnelState = {
    running: false,
    mode: 'quick',
    url: 'https://demo.trycloudflare.com',
    available: true,
    autoStart: false,
    error: '',
  };
  const fakeTunnel = {
    start: async () => {
      tunnelState.running = true;
      return { ...tunnelState };
    },
    stop: async () => {
      tunnelState.running = false;
      return { ...tunnelState };
    },
    status: () => ({ ...tunnelState }),
  };
  const tsnetState = {
    running: false,
    phase: 'stopped',
    authURL: '',
    funnelURL: '',
    error: '',
    available: true,
    hostname: 'pocket',
    autoStart: false,
  };
  const fakeTsnet = {
    start: async () => {
      tsnetState.running = true;
      tsnetState.phase = 'serving';
      return { ...tsnetState };
    },
    stop: async () => {
      tsnetState.running = false;
      tsnetState.phase = 'stopped';
      return { ...tsnetState };
    },
    status: () => ({ ...tsnetState, enabled: store.settings.tsnet.enabled }),
  };
  const harness = await startHarness({ store, upstream, upstreamPort, push: fakePush, tunnel: fakeTunnel, tsnet: fakeTsnet });
  const { gateway, mainPort, main } = harness;

  t.after(async () => {
    await gateway.stop();
    main.closeAllConnections?.();
    main.close();
    upstreamServer.closeAllConnections?.();
    upstreamServer.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await t.test('健康检查', async () => {
    const res = await phoneFetch(harness, '/__dshm/health');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
  });

  await t.test('未配对访问被挡住', async () => {
    const res = await phoneFetch(harness, '/', { headers: { accept: 'text/html' } });
    assert.equal(res.status, 401);
    assert.match(await res.text(), /需要配对/);
  });

  await t.test('桌面状态与非法公网地址', async () => {
    const state = await desktopFetch(harness, '/state');
    assert.equal(state.status, 200);
    assert.equal(state.body.running, true);
    assert.equal(state.body.reachable, false);
    assert.equal(state.body.lan, false);
    const bad = await desktopFetch(harness, '/settings', { method: 'POST', body: JSON.stringify({ publicUrl: 'ftp://x' }) });
    assert.equal(bad.status, 400);
  });

  await t.test('PWA 资源可访问', async () => {
    for (const [path, type] of [
      ['/__dshm/manifest.webmanifest', 'application/manifest+json'],
      ['/__dshm/sw.js', 'application/javascript'],
      ['/__dshm/boot.js', 'application/javascript'],
      ['/__dshm/icon-192.png', 'image/png'],
    ]) {
      const res = await phoneFetch(harness, path);
      assert.equal(res.status, 200, path);
      assert.ok(String(res.headers.get('content-type')).includes(type), `${path} content-type`);
    }
    const sw = await phoneFetch(harness, '/__dshm/sw.js');
    assert.equal(sw.headers.get('service-worker-allowed'), '/');
    assert.match(await sw.text(), /importScripts\('\/plugins\/meow-smooth\/sw\.js'\)/);
  });


  await t.test('Pocket App 资源可访问（未配对也可打开外壳）', async () => {
    const page = await phoneFetch(harness, '/__dshapp/');
    assert.equal(page.status, 200);
    assert.ok(String(page.headers.get('content-type')).includes('text/html'));
    const html = await page.text();
    assert.match(html, /Pocket/);
    assert.match(html, /manifest\.webmanifest/);
    assert.match(html, /app\.js/);
    const redirect = await phoneFetch(harness, '/__dshapp', { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), '/__dshapp/');
    const manifest = await phoneFetch(harness, '/__dshapp/manifest.webmanifest');
    assert.equal(manifest.status, 200);
    assert.ok(String(manifest.headers.get('content-type')).includes('application/manifest+json'));
    const app = await phoneFetch(harness, '/__dshapp/app.js');
    assert.equal(app.status, 200);
    assert.equal(app.headers.get('service-worker-allowed'), '/__dshapp/');
    assert.ok(String(app.headers.get('cache-control')).includes('no-cache'));
  });

  let cookie = '';
  let deviceId = '';

  await t.test('生成配对并等待', async () => {
    const started = await desktopFetch(harness, '/pair/start', { method: 'POST', body: '{}' });
    assert.equal(started.status, 200);
    assert.match(started.body.pairing.url, /__dshm\/pair\?t=/);
    const token = started.body.pairing.token;
    const qrSvg = await (await fetch(`http://127.0.0.1:${mainPort}/plugins/dsh-mobile/api/qr?token=${encodeURIComponent(token)}`)).text();
    assert.match(qrSvg, /^<svg/);
    assert.match(qrSvg, /<\/svg>$/);
    const page = await phoneFetch(harness, `/__dshm/pair?t=${encodeURIComponent(token)}`);
    assert.equal(page.status, 200);
    const pairPage = await page.text();
    assert.match(pairPage, /正在等待电脑确认/);
    assert.ok(pairPage.includes(started.body.pairing.code), '配对页要显示 6 位配对码');
    assert.ok(pairPage.includes(token), '配对页要带上 token 供轮询/领取');
    assert.doesNotMatch(pairPage, /<div class="code">undefined<\/div>/);
    assert.doesNotMatch(pairPage, /var token=undefined/);
    const state = await phoneFetch(harness, `/__dshm/api/pair/state?t=${encodeURIComponent(token)}`);
    assert.equal((await state.json()).state, 'waiting');
    const claimedTooEarly = await phoneFetch(harness, `/__dshm/api/pair/claim?t=${encodeURIComponent(token)}`, { method: 'POST' });
    assert.equal((await claimedTooEarly.json()).ok, false);
  });

  await t.test('批准后手机领取设备 cookie', async () => {
    const state = await desktopFetch(harness, '/state');
    const token = state.body.pairing.token;
    const decided = await desktopFetch(harness, '/pair/decide', { method: 'POST', body: JSON.stringify({ approve: true }) });
    assert.equal(decided.status, 200);
    assert.equal(decided.body.pairing.state, 'approved');
    const claim = await phoneFetch(harness, `/__dshm/api/pair/claim?t=${encodeURIComponent(token)}`, { method: 'POST' });
    assert.equal(claim.status, 200);
    assert.equal((await claim.json()).ok, true);
    const setCookies = claim.headers.getSetCookie();
    assert.equal(setCookies.length, 1);
    cookie = setCookies[0].split(';')[0];
    assert.match(cookie, /^dshm_device=/);
  });

  await t.test('代理首页并注入 PWA', async () => {
    const res = await phoneFetch(harness, '/', { headers: { cookie, accept: 'text/html' } });
    assert.equal(res.status, 200);
    const markup = await res.text();
    assert.match(markup, /manifest\.webmanifest/);
    assert.match(markup, /viewport-fit=cover/);
    assert.match(markup, /interactive-widget=resizes-content/);
    assert.match(markup, /apple-mobile-web-app-title/);
    assert.match(markup, /__dshm\/boot\.js/);
    assert.match(markup, /DESKTOP APP/);
    assert.equal((markup.match(/rel="manifest"/g) ?? []).length, 1);
    assert.doesNotMatch(markup, /\.\/manifest\.webmanifest/);
    assert.match(markup, /href="\/__dshm\/manifest\.webmanifest"/);
    const boot = await (await phoneFetch(harness, '/__dshm/boot.js')).text();
    assert.match(boot, /api\/push\/subscribe/);
    assert.match(boot, /pushManager\.subscribe/);
    const sw = await (await phoneFetch(harness, '/__dshm/sw.js')).text();
    assert.match(sw, /addEventListener\('push'/);
    assert.match(sw, /showNotification/);
    const css = await (await phoneFetch(harness, '/__dshm/mobile.css')).text();
    assert.match(css, /max-width: 700px/);
  });

  await t.test('gzip HTML 也能注入', async () => {
    const res = await phoneFetch(harness, '/gzip', { headers: { cookie, accept: 'text/html' } });
    assert.equal(res.status, 200);
    const markup = await res.text();
    assert.match(markup, /manifest\.webmanifest/);
    assert.match(markup, /GZIP APP/);
  });

  await t.test('POST 代理重写 Host/Origin 并带上上游 cookie', async () => {
    const res = await phoneFetch(harness, '/api/echo', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: 'http://phone.local' },
      body: JSON.stringify({ hello: 'dsh' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.body, '{"hello":"dsh"}');
    assert.equal(body.host, `127.0.0.1:${upstreamPort}`);
    assert.equal(body.origin, origin);
    assert.equal(body.cookie, true);
  });

  await t.test('WebSocket 升级透传', async () => {
    const headers = await upgradeProbe(gateway.port, cookie);
    assert.equal(headers['x-saw-cookie'], 'true');
    assert.ok(headers['sec-websocket-accept']);
  });

  await t.test('公网地址保存后二维码使用它', async () => {
    const saved = await desktopFetch(harness, '/settings', { method: 'POST', body: JSON.stringify({ publicUrl: 'https://dsh.example.com' }) });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.state.publicUrl, 'https://dsh.example.com');
    const started = await desktopFetch(harness, '/pair/start', { method: 'POST', body: '{}' });
    assert.match(started.body.pairing.url, /^https:\/\/dsh\.example\.com\/__dshm\/pair\?t=/);
  });

  await t.test('测试公网入口（指向网关自身）', async () => {
    const target = `http://127.0.0.1:${gateway.port}`;
    const saved = await desktopFetch(harness, '/settings', { method: 'POST', body: JSON.stringify({ publicUrl: target }) });
    assert.equal(saved.status, 200);
    const probe = await desktopFetch(harness, '/probe', { method: 'POST', body: '{}' });
    assert.equal(probe.body.ok, true);
    assert.equal(probe.body.status, 200);
    assert.match(probe.body.body, /"ok":true/);
    assert.ok(probe.body.latency >= 0);
  });

  await t.test('设备重命名与在线状态', async () => {
    const before = await desktopFetch(harness, '/state');
    const device = before.body.devices[0];
    assert.ok(device);
    assert.equal(device.online, true);
    const renamed = await desktopFetch(harness, '/devices/rename', {
      method: 'POST',
      body: JSON.stringify({ id: device.id, name: '我的手机' }),
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.state.devices[0].name, '我的手机');
    const bad = await desktopFetch(harness, '/devices/rename', { method: 'POST', body: JSON.stringify({ id: device.id, name: '  ' }) });
    assert.equal(bad.status, 400);
  });

  await t.test('推送订阅、测试通知与退订', async () => {
    const key = await phoneFetch(harness, '/__dshm/api/push/key', { headers: { cookie } });
    assert.equal(key.status, 200);
    assert.equal((await key.json()).publicKey, 'BTestVapidPublicKey');
    const subscribed = await phoneFetch(harness, '/__dshm/api/push/subscribe', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'https://push.example.com/sub/1', keys: { p256dh: 'p256dh-key', auth: 'auth-key' } }),
    });
    assert.equal(subscribed.status, 200);
    assert.equal((await subscribed.json()).count, 1);
    const tested = await desktopFetch(harness, '/notify/test', { method: 'POST', body: '{}' });
    assert.equal(tested.status, 200);
    assert.equal(tested.body.ok, true);
    assert.equal(tested.body.sent, 1);
    assert.equal(pushSent.at(-1).payload.kind, 'test');
    const disabled = await desktopFetch(harness, '/notify', { method: 'POST', body: JSON.stringify({ enabled: false }) });
    assert.equal(disabled.body.state.notify.enabled, false);
    assert.equal((await desktopFetch(harness, '/notify/test', { method: 'POST', body: '{}' })).status, 400);
    await desktopFetch(harness, '/notify', { method: 'POST', body: JSON.stringify({ enabled: true }) });
    const removed = await phoneFetch(harness, '/__dshm/api/push/unsubscribe', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'https://push.example.com/sub/1' }),
    });
    assert.equal((await removed.json()).ok, true);
  });

  await t.test('隧道托管 API', async () => {
    const started = await desktopFetch(harness, '/tunnel/start', { method: 'POST', body: '{}' });
    assert.equal(started.status, 200);
    assert.equal(started.body.tunnel.running, true);
    const state = await desktopFetch(harness, '/state');
    assert.equal(state.body.tunnel.running, true);
    const stopped = await desktopFetch(harness, '/tunnel/stop', { method: 'POST', body: '{}' });
    assert.equal(stopped.body.tunnel.running, false);
  });

  await t.test('内嵌 Funnel API', async () => {
    const before = await desktopFetch(harness, '/state');
    assert.equal(before.body.tsnet.enabled, false);
    const started = await desktopFetch(harness, '/tsnet/start', { method: 'POST', body: '{}' });
    assert.equal(started.status, 200);
    assert.equal(started.body.tsnet.running, true);
    assert.equal(store.settings.tsnet.enabled, true, 'start 应记住启用状态');
    const state = await desktopFetch(harness, '/state');
    assert.equal(state.body.tsnet.running, true);
    const stopped = await desktopFetch(harness, '/tsnet/stop', { method: 'POST', body: '{}' });
    assert.equal(stopped.status, 200);
    assert.equal(stopped.body.tsnet.running, false);
  });

  await t.test('沙箱 iframe 的 Origin 也能生成配对', async () => {
    const url = `http://127.0.0.1:${harness.mainPort}/plugins/dsh-mobile/api/pair/start`;
    for (const origin of ['null', 'http://127.0.0.1:9999']) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: '{}',
      });
      assert.equal(res.status, 200, origin);
    }
    const noOrigin = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(noOrigin.status, 200, 'no origin');
    const fileOrigin = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'file://' },
      body: '{}',
    });
    assert.equal(fileOrigin.status, 200, 'file origin');
  });

  await t.test('tailnet 入口自动建配对设备', async () => {
    const res = await phoneFetch(harness, '/__dshapp/', {
      headers: { 'x-pocket-tailnet': '1' },
    });
    assert.equal(res.status, 200);
    const cookie = res.headers.get('set-cookie') ?? '';
    assert.match(cookie, /dshm_device=/);
    const state = await desktopFetch(harness, '/state');
    assert.ok(state.body.devices.some((d) => d.name === 'Pocket (tailnet)'));
    const before = state.body.devices.length;
    const again = await phoneFetch(harness, '/__dshapp/', { headers: { 'x-pocket-tailnet': '1' } });
    assert.equal(again.status, 200);
    const after = await desktopFetch(harness, '/state');
    assert.equal(after.body.devices.length, before, 'tailnet 请求应复用同一台设备');
  });

  await t.test('吊销设备后立即失效', async () => {
    const devices = await desktopFetch(harness, '/state');
    const target = devices.body.devices[0];
    assert.ok(target);
    const revoked = await desktopFetch(harness, '/devices/revoke', { method: 'POST', body: JSON.stringify({ id: target.id }) });
    assert.equal(revoked.body.ok, true);
    const res = await phoneFetch(harness, '/', { headers: { cookie } });
    assert.equal(res.status, 401);
  });
});

test('手机端总开关会调用控制器并阻止新的配对', async () => {
  const upstreamServer = await startUpstream();
  const upstream = createUpstream({
    origin: `http://127.0.0.1:${upstreamServer.port}`,
    authenticatedUrl: (url) => url + '?token=secret',
    log: () => {},
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-gw-mobile-'));
  const store = createStore(dir);
  const calls = [];
  const harness = await startHarness({
    store,
    upstream,
    upstreamPort: upstreamServer.port,
    setMobileEnabled: async (enabled) => {
      calls.push(enabled);
      store.updateSettings({ mobile: { enabled } });
    },
  });
  try {
    const before = await desktopFetch(harness, '/state');
    assert.equal(before.status, 200);
    assert.equal(before.body.mobile.enabled, true);

    const off = await desktopFetch(harness, '/mobile/enable', { method: 'POST', body: JSON.stringify({ enabled: false }) });
    assert.equal(off.status, 200);
    assert.deepEqual(calls, [false]);
    assert.equal(off.body.state.mobile.enabled, false);

    const pair = await desktopFetch(harness, '/pair/start', { method: 'POST', body: '{}' });
    assert.equal(pair.status, 409);
  } finally {
    await harness.gateway.stop();
    harness.main.close();
    upstreamServer.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

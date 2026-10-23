// dsh-mobile 手机网关：设备配对 + 反向代理内核 Web UI + PWA 资源。
//
// 设计要点
// - 手机永远只和本网关说话；内核的 launch token / 签名 cookie 只留在电脑上。
// - 每个手机一对设备令牌（HttpOnly cookie），可单独吊销。
// - 代理时把 Host/Origin 改写成内核自己的 origin，内核看到的始终是同源流量。
// - 只对导航请求做 HTML 注入（manifest / SW / 安全区），其余流量原样透传（含 gzip）。
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomBytes, randomInt } from 'node:crypto';
import { lanAddress, deviceLabel, isLoopbackAddress } from './net.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(__dirname, '..', 'assets');
const POCKET_DIR = path.resolve(ASSETS, 'pocket');
const COOKIE_NAME = 'dshm_device';
const PAIRING_TTL_MS = 5 * 60 * 1000;
const PAIRING_KEEP_MS = 30 * 60 * 1000;
const MAX_BODY = 64 * 1024;
const MAX_REPLAY_BODY = 1024 * 1024;
const VERSION = '0.2.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
};

const require = createRequire(import.meta.url);
let qrcodeFactory = null;

function qrSvg(text) {
  if (!qrcodeFactory) qrcodeFactory = require('./vendor/qrcode.cjs');
  const qr = qrcodeFactory(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 12, scalable: true, alt: '配对二维码' });
}

/**
 * 本机 DNS 经常解析不了 *.trycloudflare.com（路由器/安全软件拦截），
 * 探测公网入口时用公共 DNS 兜底一次，避免把「本机 DNS 坏了」误报成「隧道不通」。
 */
async function publicDnsLookup(hostname) {
  try {
    const resolver = new dns.promises.Resolver();
    resolver.setServers(['8.8.8.8', '1.1.1.1']);
    const list = await resolver.resolve4(hostname);
    return list?.[0] ?? null;
  } catch {
    return null;
  }
}

function pinnedRequest(target, ip) {
  return new Promise((resolve, reject) => {
    const url = new URL(target);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: { host: url.host, accept: 'application/json' },
        servername: url.hostname,
        lookup: ip ? (_hostname, _options, callback) => callback(null, ip, 4) : undefined,
        timeout: 8000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

async function probeHealth(target) {
  try {
    const res = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
    return { status: res.status, body: await res.text() };
  } catch (firstError) {
    const ip = await publicDnsLookup(new URL(target).hostname);
    if (!ip) throw firstError;
    return pinnedRequest(target, ip);
  }
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function html(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    out[key] = part.slice(eq + 1).trim();
  }
  return out;
}

function safeEqualText(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function readJson(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function collect(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

export function createMobileGateway({
  upstream,
  store,
  port = 8470,
  bind = '127.0.0.1',
  log = () => {},
  version = VERSION,
  push = null,
  tunnel = null,
  tsnet = null,
  notifyExternal = '',
  setMobileEnabled = null,
}) {
  let server = null;
  let listeningPort = 0;
  let activePort = port;
  let activeBind = bind;
  let lanUrl = '';
  let lanReachable = false;
  let pairing = null;
  let tailnetDevice = null;
  let lastError = '';
  const sockets = new Set();
  const upgradedSockets = new Set();
  const rateBuckets = new Map();

  function rateLimit(key, max, windowMs) {
    const now = Date.now();
    if (rateBuckets.size > 800) {
      for (const [name, bucket] of rateBuckets) {
        if (now > bucket.reset) rateBuckets.delete(name);
      }
    }
    const bucket = rateBuckets.get(key);
    if (!bucket || now > bucket.reset) {
      rateBuckets.set(key, { count: 1, reset: now + windowMs });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= max;
  }

  function tooMany(res) {
    return json(res, 429, { ok: false, error: '请求太频繁，请稍后再试' });
  }

  const base = new URL(upstream.origin);
  const upstreamPort = Number(base.port || 80);

  function clientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
    return req.socket.remoteAddress ?? '';
  }

  function isSecure(req) {
    if (req.socket && req.socket.encrypted) return true;
    return String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https';
  }

  function publicUrl() {
    return store.settings.publicUrl || '';
  }

  function appUrl() {
    if (publicUrl()) return publicUrl();
    if (lanReachable) return lanUrl;
    return `http://127.0.0.1:${listeningPort || port}`;
  }

  function pairingUrl(state = pairing) {
    if (!state) return '';
    return `${appUrl()}/__dshm/pair?t=${encodeURIComponent(state.token)}`;
  }

  function expireIfNeeded() {
    if (!pairing) return null;
    if (Date.now() > pairing.expiresAt && (pairing.state === 'waiting' || pairing.state === 'approved')) {
      pairing.state = 'expired';
    }
    if (Date.now() > pairing.expiresAt + PAIRING_KEEP_MS) pairing = null;
    return pairing;
  }

  function pairingView() {
    const state = expireIfNeeded();
    if (!state) return null;
    return {
      state: state.state,
      code: state.code,
      url: pairingUrl(state),
      token: state.token,
      expiresAt: state.expiresAt,
      deviceName: state.deviceName ?? '',
    };
  }

  function deviceCookie(deviceId, token) {
    return `${deviceId}.${token}`;
  }

  function setDeviceCookie(req, res, deviceId, token) {
    const parts = [
      `${COOKIE_NAME}=${deviceCookie(deviceId, token)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      'Max-Age=' + String(60 * 60 * 24 * 30),
    ];
    if (isSecure(req)) parts.push('Secure');
    res.setHeader('set-cookie', parts.join('; '));
  }

  function authenticate(req) {
    const cookies = parseCookies(req.headers.cookie);
    const raw = cookies[COOKIE_NAME];
    if (!raw) return null;
    const device = store.authenticate(raw);
    if (!device) return null;
    try {
      store.touchDevice(device.id, clientIp(req));
    } catch {
      /* 写盘失败不阻断请求 */
    }
    return device;
  }

  // tailnet 入口由 sidecar 注入这个头；只有 loopback 能伪造，等同于本机信任。
  // 第一次访问自动建一台设备并下发 cookie，不再需要二维码/配对码。
  function isTailnetRequest(req) {
    return req.headers['x-pocket-tailnet'] === '1' && isLoopbackAddress(req.socket.remoteAddress ?? '');
  }

  function isDesktopRequest(req) {
    if (!isLoopbackAddress(req.socket.remoteAddress ?? '')) return false;
    const origin = req.headers.origin;
    // The Electron/plugin bridge may omit Origin entirely for same-origin POSTs.
    // Loopback + the DSH auth cookie is the trust boundary for this desktop API.
    if (!origin) return true;
    if (origin === 'null') return true;
    const allowed = new Set([upstream.origin, upstream.origin.replace('127.0.0.1', 'localhost')]);
    if (allowed.has(origin)) return true;
    try {
      const url = new URL(origin);
      // file://, app://, dsh:// and other desktop shells are not web origins.
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;
      const host = url.hostname;
      return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
    } catch {
      return false;
    }
  }

  function wantsHtml(req) {
    const accept = String(req.headers.accept ?? '');
    return accept.includes('text/html') || req.headers['sec-fetch-dest'] === 'document';
  }

  // ── 上游代理 ────────────────────────────────────────────────────────────

  function requestUpstream(method, pathname, headers, body) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: base.hostname,
          port: upstreamPort,
          method,
          path: pathname,
          headers,
        },
        resolve,
      );
      req.on('error', reject);
      // Do not impose an idle timeout on streaming responses (SSE / long-running turns).
      // The client close handler owns cancellation instead.
      req.setTimeout(0);
      if (Buffer.isBuffer(body)) {
        req.end(body);
      } else if (body) {
        body.on('error', () => req.destroy());
        body.pipe(req);
      } else {
        req.end();
      }
    });
  }

  function filterResponseHeaders(headers) {
    const out = {};
    for (const [key, value] of Object.entries(headers)) {
      const lower = key.toLowerCase();
      if (lower === 'set-cookie' || lower === 'connection' || lower === 'keep-alive' || lower === 'transfer-encoding') continue;
      out[key] = value;
    }
    return out;
  }

  function rewriteLocation(headers) {
    const location = headers.location;
    if (typeof location === 'string' && location) {
      for (const prefix of [upstream.origin, upstream.origin.replace('127.0.0.1', 'localhost')]) {
        if (location.startsWith(prefix)) {
          headers.location = location.slice(prefix.length) || '/';
          break;
        }
      }
    }
  }

  function injectHtml(markup) {
    let out = markup;
    out = out.replace(/<meta[^>]+name=["']viewport["'][^>]*>/i, (tag) =>
      tag.replace(/content=(["'])(.*?)\1/i, (_, _quote, content) => {
        let next = content;
        if (!/viewport-fit=/i.test(next)) next += ', viewport-fit=cover';
        if (!/interactive-widget=/i.test(next)) next += ', interactive-widget=resizes-content';
        return `content="${next}"`;
      }),
    );

    // 官方 index 自带一个 manifest（只有 SVG 图标，且 start_url 是 ./）。
    // 浏览器的规则是「第一个 rel=manifest 生效」，所以必须替换而不是追加。
    let hasManifest = false;
    out = out.replace(/<link\b[^>]*\brel=["']manifest["'][^>]*>/i, () => {
      hasManifest = true;
      return '<link rel="manifest" href="/__dshm/manifest.webmanifest">';
    });

    const head = [
      ...(hasManifest ? [] : ['<link rel="manifest" href="/__dshm/manifest.webmanifest">']),
      '<meta name="theme-color" content="#111418">',
      '<meta name="apple-mobile-web-app-capable" content="yes">',
      '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
      '<meta name="apple-mobile-web-app-title" content="DSH">',
      '<meta name="mobile-web-app-capable" content="yes">',
      '<meta name="format-detection" content="telephone=no">',
      '<link rel="apple-touch-icon" href="/__dshm/icon-180.png">',
      '<link rel="stylesheet" href="/__dshm/mobile.css">',
      '<script src="/__dshm/boot.js" defer></script>',
    ].join('');
    out = out.replace(/<\/head>/i, `${head}</head>`);
    return out;
  }

  async function forward(req, res) {
    const document = wantsHtml(req);
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      const lower = key.toLowerCase();
      if (lower === 'host' || lower === 'cookie' || lower === 'connection') continue;
      headers[lower] = value;
    }
    headers.host = upstream.host;
    if (headers.origin) headers.origin = upstream.origin;
    if (headers.referer) headers.referer = upstream.origin + '/';
    headers.cookie = await upstream.ensureCookie();
    if (document) headers['accept-encoding'] = 'identity';

    const hasBody =
      req.method !== 'GET' &&
      req.method !== 'HEAD' &&
      (req.headers['content-length'] !== undefined || req.headers['transfer-encoding'] !== undefined);
    // Buffer small JSON bodies so a 401 (expired upstream cookie) can be replayed
    // once after refreshing the launch-token cookie. Larger/streamed bodies keep
    // the old streaming path and are not retried.
    let replayBody = null;
    if (hasBody) {
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared >= 0 && declared <= MAX_REPLAY_BODY) {
        try {
          replayBody = await collect(req);
        } catch {
          res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('request body aborted');
          return;
        }
        headers['content-length'] = String(replayBody.length);
        delete headers['transfer-encoding'];
      }
    }
    let upstreamRes = await requestUpstream(
      req.method ?? 'GET',
      req.url ?? '/',
      headers,
      replayBody ?? (hasBody ? req : undefined),
    );
    if (upstreamRes.statusCode === 401 && (!hasBody || replayBody)) {
      upstreamRes.resume();
      await upstream.refresh();
      headers.cookie = upstream.cookie;
      upstreamRes = await requestUpstream(req.method ?? 'GET', req.url ?? '/', headers, replayBody ?? undefined);
    }

    const status = upstreamRes.statusCode ?? 502;
    const type = String(upstreamRes.headers['content-type'] ?? '');
    const canInject = document && type.includes('text/html');

    if (canInject) {
      let buffer = await collect(upstreamRes);
      const encoding = String(upstreamRes.headers['content-encoding'] ?? '').toLowerCase();
      let decoded = true;
      try {
        if (encoding === 'gzip' || encoding === 'x-gzip') buffer = zlib.gunzipSync(buffer);
        else if (encoding === 'br') buffer = zlib.brotliDecompressSync(buffer);
        else if (encoding && encoding !== 'identity') decoded = false;
      } catch {
        decoded = false;
      }
      const out = filterResponseHeaders(upstreamRes.headers);
      rewriteLocation(out);
      if (decoded) {
        const markup = injectHtml(buffer.toString('utf8'));
        const payload = Buffer.from(markup, 'utf8');
        out['content-length'] = String(payload.length);
        out['cache-control'] = 'no-store';
        delete out['content-encoding'];
        res.writeHead(status, out);
        res.end(payload);
      } else {
        out['content-length'] = String(buffer.length);
        res.writeHead(status, out);
        res.end(buffer);
      }
      return;
    }

    const out = filterResponseHeaders(upstreamRes.headers);
    rewriteLocation(out);
    if (type.includes('text/event-stream')) {
      out['cache-control'] = 'no-cache, no-transform';
      out['x-accel-buffering'] = 'no';
      out['connection'] = 'keep-alive';
    }
    res.writeHead(status, out);
    if (type.includes('text/event-stream')) res.flushHeaders();
    res.on('close', () => {
      if (!res.writableEnded) upstreamRes.destroy();
    });
    upstreamRes.pipe(res);
  }

  function proxyAuthFailure(res) {
    html(
      res,
      401,
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>DSH 手机端</title><body style="font:16px/1.6 system-ui;background:#111418;color:#e8eaed;padding:32px">' +
        '<h1 style="font-size:20px">需要配对</h1><p>这台手机还没有和电脑配对。请在电脑上打开 DSH → 设置 → 连接手机，扫码或打开配对链接。</p>' +
        '</body>',
    );
  }

  // ── PWA 资源 ───────────────────────────────────────────────────────────

  const ASSET_CACHE = new Map();

  function servePocket(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' });
      res.end('method not allowed');
      return;
    }
    let rel = pathname.replace(/^\/__dshapp\/?/, '') || 'index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    rel = path.normalize(rel).replace(/^([.][.][/\\])+/, '');
    const file = path.join(POCKET_DIR, rel);
    if (!file.startsWith(POCKET_DIR)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('forbidden');
      return;
    }
    let content;
    try {
      content = fs.readFileSync(file);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    const ext = path.extname(file);
    const isShell = ext === '.html' || ext === '.js' || ext === '.css' || ext === '.webmanifest';
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': isShell ? 'no-cache' : 'public, max-age=86400',
      'content-length': content.length,
      'x-content-type-options': 'nosniff',
      ...(ext === '.js' ? { 'service-worker-allowed': '/__dshapp/' } : {}),
    });
    if (req.method === 'HEAD') res.end();
    else res.end(content);
  }

  function serveAsset(res, name, { cache = 'public, max-age=86400', extraHeaders = {} } = {}) {
    if (!ASSET_CACHE.has(name)) {
      try {
        ASSET_CACHE.set(name, fs.readFileSync(path.join(ASSETS, name)));
      } catch {
        ASSET_CACHE.set(name, null);
      }
    }
    const content = ASSET_CACHE.get(name);
    if (!content) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(name)] ?? 'application/octet-stream',
      'cache-control': cache,
      'content-length': content.length,
      'x-content-type-options': 'nosniff',
      ...extraHeaders,
    });
    res.end(content);
  }

  function pairPage(token) {
    const state = expireIfNeeded();
    const valid = state && state.state !== 'expired' && safeEqualText(token, state.token);
    if (!valid) {
      return [
        '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
        '<title>配对已失效</title>',
        '<style>body{margin:0;background:#111418;color:#e8eaed;font:16px/1.7 system-ui,-apple-system,"PingFang SC",sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;box-sizing:border-box}.card{max-width:380px;background:#1c2128;border:1px solid #2b333d;border-radius:18px;padding:28px 22px}h1{font-size:19px;margin:0 0 10px}p{color:#aab2bd;margin:0}</style>',
        '</head><body><div class="card"><h1>配对已失效</h1><p>请在电脑上重新打开「设置 → 连接手机」，生成新的二维码后再扫一次。</p></div></body></html>',
      ].join('');
    }
    return [
      '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
      '<title>正在配对 · DSH 手机端</title>',
      '<style>body{margin:0;background:#111418;color:#e8eaed;font:16px/1.7 system-ui,-apple-system,"PingFang SC",sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;box-sizing:border-box}.card{max-width:380px;width:100%;background:#1c2128;border:1px solid #2b333d;border-radius:18px;padding:30px 24px;text-align:center}.dot{width:54px;height:54px;border-radius:50%;border:2px solid #4d6bfe;border-top-color:transparent;margin:0 auto 18px;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}h1{font-size:19px;margin:0 0 8px}p{color:#aab2bd;margin:0 0 6px}.code{font:600 26px/1.2 ui-monospace,monospace;letter-spacing:.2em;color:#e8eaed;margin:16px 0 4px}.hint{font-size:13px;color:#7d8794}</style>',
      `</head><body><div class="card"><div class="dot" id="dot"></div><h1>正在等待电脑确认</h1><p>请在电脑上核对配对码：</p><div class="code">${esc(state.code)}</div><p class="hint" id="st">确认后会自动进入 DSH，请保持此页面打开。</p></div>`,
      `<script>` +
        `var token=${JSON.stringify(state.token)};` +
        `var timer=setInterval(poll,1200);` +
        `function done(msg){clearInterval(timer);document.getElementById('dot').style.display='none';document.getElementById('st').textContent=msg}` +
        `function enter(msg){clearInterval(timer);document.getElementById('dot').style.display='none';var st=document.getElementById('st');st.innerHTML=msg+'<br><a style="color:#8ab4ff" href="/">没反应？点这里进入</a>';setTimeout(function(){location.replace('/')},400)}` +
        `function poll(){fetch('/__dshm/api/pair/state?t='+encodeURIComponent(token),{cache:'no-store'}).then(function(r){return r.json()}).then(function(s){` +
        `if(s.state==='approved'){clearInterval(timer);return fetch('/__dshm/api/pair/claim?t='+encodeURIComponent(token),{method:'POST'}).then(function(r){if(r.ok){enter('配对成功，正在进入…')}else{done('配对失败，请重新扫码')}})}` +
        `if(s.state==='claimed'){enter('这台设备已经配对过了，正在进入…（如果提示需要配对，请用主浏览器地址栏打开本页，不要用扫码预览窗口）');return}` +
        `if(s.state==='rejected'){done('电脑端拒绝了这次配对，请重新发起。')}` +
        `if(s.state==='expired'){done('配对已过期，请在电脑端重新生成二维码。')}` +
        `}).catch(function(){})}` +
        `poll();` +
        `</script>`,
      '</body></html>',
    ].join('');
  }

  // ── 路由 ───────────────────────────────────────────────────────────────

  async function handlePhone(req, res) {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${listeningPort || port}`);
    const pathname = url.pathname;

    // tailnet-only entry: trust the sidecar and mint a device on first contact.
    if (isTailnetRequest(req) && !authenticate(req)) {
      try {
        if (!tailnetDevice || !store.findDevice(tailnetDevice.id)) {
          const created = store.addDevice({ name: 'Pocket (tailnet)', platform: 'tailscale', ip: clientIp(req) });
          tailnetDevice = { id: created.device.id, token: created.token };
        }
        setDeviceCookie(req, res, tailnetDevice.id, tailnetDevice.token);
        req.pocketDevice = store.findDevice(tailnetDevice.id);
      } catch {
        /* fall through to the normal auth check */
      }
    }

    if (pathname === '/__dshm/health') {
      return json(res, 200, { ok: true, version, upstream: upstream.origin });
    }
    if (pathname === '/__dshm/manifest.webmanifest') return serveAsset(res, 'manifest.webmanifest', { cache: 'no-cache' });
    if (pathname === '/__dshm/sw.js') {
      return serveAsset(res, 'sw.js', { cache: 'no-cache', extraHeaders: { 'service-worker-allowed': '/' } });
    }
    if (pathname === '/__dshm/boot.js') return serveAsset(res, 'boot.js', { cache: 'no-cache' });
    if (pathname === '/__dshm/mobile.css') return serveAsset(res, 'mobile.css', { cache: 'no-cache' });
    if (pathname === '/__dshm/offline.html') return serveAsset(res, 'offline.html', { cache: 'no-cache' });
    if (pathname === '/__dshm/icon-180.png') return serveAsset(res, 'icon-180.png');
    if (pathname === '/__dshm/icon-192.png') return serveAsset(res, 'icon-192.png');
    if (pathname === '/__dshm/icon-512.png') return serveAsset(res, 'icon-512.png');
    if (pathname === '/__dshm/icon-maskable-512.png') return serveAsset(res, 'icon-maskable-512.png');

    if (pathname === '/__dshapp') {
      res.writeHead(302, { location: '/__dshapp/' });
      res.end();
      return;
    }
    if (pathname.startsWith('/__dshapp/')) {
      return servePocket(req, res, pathname);
    }

    if (
      pathname === '/__dshm/pair' ||
      pathname === '/__dshm/api/pair/state' ||
      pathname === '/__dshm/api/pair/claim'
    ) {
      if (!rateLimit(`pair:${clientIp(req)}`, 500, 5 * 60_000)) return tooMany(res);
    }

    if (pathname === '/__dshm/pair') {
      const token = url.searchParams.get('t') ?? '';
      const state = expireIfNeeded();
      if (state && state.state !== 'expired' && safeEqualText(token, state.token)) {
        if (!state.deviceName && req.headers['user-agent']) {
          state.deviceName = deviceLabel(req.headers['user-agent']);
          state.ua = req.headers['user-agent'];
          state.ip = clientIp(req);
        }
      } else if (token && !rateLimit(`pairfail:${clientIp(req)}`, 40, 10 * 60_000)) {
        return tooMany(res);
      }
      return html(res, 200, pairPage(token));
    }

    if (pathname === '/__dshm/api/pair/state') {
      const token = url.searchParams.get('t') ?? '';
      const state = expireIfNeeded();
      if (!state || !safeEqualText(token, state.token)) {
        if (token && !rateLimit(`pairfail:${clientIp(req)}`, 40, 10 * 60_000)) return tooMany(res);
        return json(res, 200, { state: 'expired' });
      }
      return json(res, 200, { state: state.state, code: state.code });
    }

    if (pathname === '/__dshm/api/pair/claim' && req.method === 'POST') {
      const token = url.searchParams.get('t') ?? '';
      const state = expireIfNeeded();
      if (!state || !safeEqualText(token, state.token)) {
        if (token && !rateLimit(`pairfail:${clientIp(req)}`, 40, 10 * 60_000)) return tooMany(res);
        return json(res, 200, { ok: false, error: 'expired' });
      }
      if (state.state !== 'approved' || !state.deviceToken) return json(res, 200, { ok: false, error: 'not-approved' });
      const { deviceId, deviceToken } = state;
      state.state = 'claimed';
      state.deviceToken = '';
      setDeviceCookie(req, res, deviceId, deviceToken);
      return json(res, 200, { ok: true });
    }

    let device = authenticate(req) || req.pocketDevice || null;
    if (!device) {
      if (wantsHtml(req) || (req.method === 'GET' && pathname === '/')) return proxyAuthFailure(res);
      return json(res, 401, { ok: false, error: 'unauthorized' });
    }

    // ── 推送订阅（手机端自己调用，设备 cookie 鉴权）──────────────────────
    if (pathname === '/__dshm/api/push/key' && req.method === 'GET') {
      if (!push?.available) return json(res, 503, { ok: false, error: 'push-unavailable' });
      return json(res, 200, {
        ok: true,
        enabled: store.settings.notify.enabled,
        publicKey: push.publicKey,
      });
    }
    if (pathname === '/__dshm/api/push/subscribe' && req.method === 'POST') {
      const body = await readJson(req, 8 * 1024).catch(() => null);
      if (!body || typeof body.endpoint !== 'string' || !body.keys) {
        return json(res, 400, { ok: false, error: 'bad-subscription' });
      }
      if (!push?.available) return json(res, 503, { ok: false, error: 'push-unavailable' });
      const added = push.subscribe(device.id, body, String(req.headers['user-agent'] ?? ''));
      return json(res, added ? 200 : 400, { ok: added, count: push.count() });
    }
    if (pathname === '/__dshm/api/push/unsubscribe' && req.method === 'POST') {
      const body = await readJson(req, 4 * 1024).catch(() => null);
      const endpoint = body?.endpoint;
      if (typeof endpoint !== 'string') return json(res, 400, { ok: false, error: 'bad-request' });
      const owned = store.listSubscriptions(device.id).some((item) => item.endpoint === endpoint);
      return json(res, 200, { ok: owned ? store.removeSubscription(endpoint) : false });
    }
    if (pathname === '/__dshm/api/push/test' && req.method === 'POST') {
      if (!push?.available) return json(res, 503, { ok: false, error: 'push-unavailable' });
      const result = await push.send(
        { kind: 'test', title: 'DSH 手机端', body: '通知已连通，任务完成或需要批准时会提醒你。', tag: 'test' },
        { deviceId: device.id },
      );
      return json(res, 200, { ok: result.sent > 0, ...result });
    }


    try {
      await forward(req, res);
    } catch (error) {
      lastError = String(error?.message ?? error);
      log(`proxy error: ${lastError}`);
      if (!res.headersSent) {
        html(
          res,
          502,
          '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<title>连接断开</title><body style="font:16px/1.6 system-ui;background:#111418;color:#e8eaed;padding:32px">' +
            '<h1 style="font-size:20px">连不上电脑</h1><p>请确认电脑上的 DSH 仍然在运行，然后刷新重试。</p></body>',
        );
      } else {
        res.destroy();
      }
    }
  }

  async function handleDesktop(req, res) {
    if (!isDesktopRequest(req)) return json(res, 403, { ok: false, error: 'forbidden' });
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = url.pathname.replace(/^\/plugins\/dsh-mobile\/api/, '') || '/';

    if (req.method === 'GET' && route === '/state') {
      return json(res, 200, desktopState());
    }
    if (req.method === 'POST' && route === '/mobile/enable') {
      const body = await readJson(req).catch(() => null);
      if (!body || typeof body.enabled !== 'boolean') return json(res, 400, { ok: false, error: 'bad-request' });
      if (typeof setMobileEnabled !== 'function') return json(res, 503, { ok: false, error: 'not-supported' });
      try {
        await setMobileEnabled(body.enabled);
        return json(res, 200, { ok: true, state: desktopState() });
      } catch (error) {
        return json(res, 500, { ok: false, error: String(error?.message ?? error) });
      }
    }
    if (req.method === 'POST' && route === '/pair/start') {
      if (!store.settings.mobile.enabled) return json(res, 409, { ok: false, error: '手机端已停用，请先启用' });
      return json(res, 200, { ok: true, pairing: startPairing() });
    }
    if (req.method === 'POST' && route === '/pair/decide') {
      const body = await readJson(req).catch(() => null);
      if (!body || typeof body.approve !== 'boolean') return json(res, 400, { ok: false, error: 'bad-request' });
      return json(res, 200, decidePairing(body.approve, body.name));
    }
    if (req.method === 'POST' && route === '/pair/cancel') {
      if (pairing) pairing.state = 'rejected';
      return json(res, 200, { ok: true, pairing: pairingView() });
    }
    if (req.method === 'POST' && route === '/settings') {
      const body = await readJson(req).catch(() => null);
      if (!body) return json(res, 400, { ok: false, error: 'bad-request' });
      const publicUrlValue = typeof body.publicUrl === 'string' ? body.publicUrl : store.settings.publicUrl;
      if (publicUrlValue && !/^https?:\/\/[^\s]+$/i.test(publicUrlValue)) {
        return json(res, 400, { ok: false, error: 'publicUrl 必须以 http(s):// 开头' });
      }
      const wantsLan = typeof body.lan === 'boolean' ? body.lan : store.settings.lan;
      if (wantsLan !== store.settings.lan) {
        try {
          await setBind(wantsLan ? '0.0.0.0' : '127.0.0.1');
        } catch (error) {
          return json(res, 500, { ok: false, error: `切换监听地址失败：${String(error?.message ?? error)}` });
        }
        store.updateSettings({ lan: wantsLan });
      }
      store.updateSettings({ publicUrl: publicUrlValue });
      if (body.notify && typeof body.notify === 'object') {
        store.updateSettings({ notify: body.notify });
      }
      if (body.tunnel && typeof body.tunnel === 'object') {
        store.updateSettings({ tunnel: body.tunnel });
      }
      if (body.tsnet && typeof body.tsnet === 'object') {
        store.updateSettings({ tsnet: body.tsnet });
      }
      if (pairing) pairing.url = pairingUrl(pairing);
      return json(res, 200, { ok: true, state: desktopState() });
    }
    if (req.method === 'POST' && route === '/devices/rename') {
      const body = await readJson(req).catch(() => null);
      if (!body || typeof body.id !== 'string' || typeof body.name !== 'string') {
        return json(res, 400, { ok: false, error: 'bad-request' });
      }
      const renamed = store.renameDevice(body.id, body.name);
      return json(res, renamed ? 200 : 400, { ok: renamed, state: desktopState() });
    }
    if (req.method === 'POST' && route === '/notify') {
      const body = await readJson(req).catch(() => null);
      if (!body || typeof body.enabled !== 'boolean') return json(res, 400, { ok: false, error: 'bad-request' });
      store.updateSettings({ notify: { enabled: body.enabled } });
      return json(res, 200, { ok: true, state: desktopState() });
    }
    if (req.method === 'POST' && route === '/notify/test') {
      if (!push?.available) return json(res, 503, { ok: false, error: '推送模块不可用' });
      if (!store.settings.notify.enabled) return json(res, 400, { ok: false, error: '通知已关闭' });
      if (push.count() === 0) return json(res, 400, { ok: false, error: '还没有手机订阅通知，请先在手机上点「开启通知」' });
      const startedAt = Date.now();
      const result = await push.send({
        kind: 'test',
        title: 'DSH 手机端',
        body: '这是一条测试通知。任务完成或需要批准时会这样提醒你。',
        tag: 'test',
      });
      return json(res, 200, { ok: result.sent > 0, latency: Date.now() - startedAt, ...result });
    }
    if (req.method === 'POST' && route === '/tunnel/start') {
      if (!tunnel) return json(res, 503, { ok: false, error: '隧道模块不可用' });
      try {
        await tunnel.start();
        return json(res, 200, { ok: true, tunnel: tunnel.status(), state: desktopState() });
      } catch (error) {
        return json(res, 400, { ok: false, error: String(error?.message ?? error), tunnel: tunnel.status() });
      }
    }
    if (req.method === 'POST' && route === '/tunnel/stop') {
      if (!tunnel) return json(res, 503, { ok: false, error: '隧道模块不可用' });
      await tunnel.stop();
      return json(res, 200, { ok: true, tunnel: tunnel.status(), state: desktopState() });
    }
    if (req.method === 'POST' && route === '/tsnet/start') {
      if (!tsnet) return json(res, 503, { ok: false, error: '内嵌 Funnel 模块不可用' });
      try {
        store.updateSettings({ tsnet: { enabled: true } });
        await tsnet.start();
        return json(res, 200, { ok: true, tsnet: tsnet.status(), state: desktopState() });
      } catch (error) {
        return json(res, 400, { ok: false, error: String(error?.message ?? error), tsnet: tsnet.status() });
      }
    }
    if (req.method === 'POST' && route === '/tsnet/stop') {
      if (!tsnet) return json(res, 503, { ok: false, error: '内嵌 Funnel 模块不可用' });
      await tsnet.stop();
      return json(res, 200, { ok: true, tsnet: tsnet.status(), state: desktopState() });
    }
    if (req.method === 'POST' && route === '/probe') {
      const target = publicUrl();
      if (!target) return json(res, 400, { ok: false, error: '先保存公网地址再测试' });
      const startedAt = Date.now();
      try {
        const result = await probeHealth(`${target}/__dshm/health`);
        return json(res, 200, {
          ok: result.status >= 200 && result.status < 300,
          status: result.status,
          latency: Date.now() - startedAt,
          body: result.body.slice(0, 200),
        });
      } catch (error) {
        return json(res, 200, {
          ok: false,
          latency: Date.now() - startedAt,
          error: String(error?.message ?? error),
        });
      }
    }
    if (req.method === 'POST' && route === '/devices/revoke') {
      const body = await readJson(req).catch(() => null);
      if (!body || typeof body.id !== 'string') return json(res, 400, { ok: false, error: 'bad-request' });
      const removed = revokeDevice(body.id);
      return json(res, 200, { ok: removed, state: desktopState() });
    }
    if (req.method === 'GET' && route === '/qr') {
      const token = url.searchParams.get('token') ?? '';
      const state = expireIfNeeded();
      if (!state || !safeEqualText(token, state.token)) return json(res, 404, { ok: false, error: 'no-pairing' });
      const svg = qrSvg(pairingUrl(state));
      res.writeHead(200, {
        'content-type': 'image/svg+xml; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(svg),
      });
      return res.end(svg);
    }
    return json(res, 404, { ok: false, error: 'not-found' });
  }

  // ── 桌面端状态与配对 ───────────────────────────────────────────────────

  function desktopState() {
    const now = Date.now();
    return {
      ok: true,
      version,
      running: server !== null,
      port: listeningPort || port,
      bind: activeBind,
      mobile: { enabled: store.settings.mobile.enabled },
      lan: store.settings.lan,
      lanUrl,
      publicUrl: publicUrl(),
      appUrl: appUrl(),
      reachable: Boolean(publicUrl()) || lanReachable,
      lastError,
      notify: {
        enabled: store.settings.notify.enabled,
        available: Boolean(push?.available),
        external: notifyExternal,
        subscriptions: push?.count() ?? 0,
      },
      tunnel: tunnel ? tunnel.status() : null,
      tsnet: tsnet ? tsnet.status() : null,
      devices: store.listDevices().map((device) => ({
        ...device,
        online: now - (device.lastSeen ?? 0) < 90_000,
      })),
      pairing: pairingView(),
    };
  }

  /** 吊销设备，并立刻掐断它已经建立的 WebSocket（否则要等它自己断）。 */
  function revokeDevice(id) {
    const removed = store.revokeDevice(id);
    if (removed) {
      for (const pair of [...upgradedSockets]) {
        if (pair.deviceId !== id) continue;
        try {
          pair.socket.destroy();
          pair.upstreamSocket.destroy();
        } catch {
          /* ignore */
        }
        upgradedSockets.delete(pair);
      }
    }
    return removed;
  }

  function startPairing() {
    const token = randomBytes(24).toString('base64url');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    pairing = {
      token,
      code,
      createdAt: Date.now(),
      expiresAt: Date.now() + PAIRING_TTL_MS,
      state: 'waiting',
      deviceName: '',
      ua: '',
      ip: '',
      deviceId: '',
      deviceToken: '',
    };
    return pairingView();
  }

  function decidePairing(approve, name) {
    const state = expireIfNeeded();
    if (!state || state.state !== 'waiting') {
      return { ok: false, error: '没有等待中的配对', pairing: pairingView() };
    }
    if (!approve) {
      state.state = 'rejected';
      return { ok: true, pairing: pairingView() };
    }
    const label = String(name || state.deviceName || '手机').slice(0, 40);
    const created = store.addDevice({ name: label, platform: state.ua ?? '', ip: state.ip ?? '' });
    state.deviceId = created.device.id;
    state.deviceToken = created.token;
    state.state = 'approved';
    log(`设备已配对：${label} (${created.device.id})`);
    return { ok: true, pairing: pairingView() };
  }

  function handleUpgrade(req, socket, head) {
    const device = authenticate(req);
    if (!device) {
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return;
    }
    const upstreamSocket = net.connect(upstreamPort, base.hostname, () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (const [key, value] of Object.entries(req.headers)) {
        const lower = key.toLowerCase();
        if (lower === 'host' || lower === 'cookie' || lower === 'origin') continue;
        if (Array.isArray(value)) for (const item of value) lines.push(`${key}: ${item}`);
        else if (value !== undefined) lines.push(`${key}: ${value}`);
      }
      lines.push(`host: ${upstream.host}`);
      lines.push(`origin: ${upstream.origin}`);
      lines.push(`cookie: ${upstream.cookie}`);
      upstreamSocket.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head && head.length) upstreamSocket.write(head);
      upstreamSocket.pipe(socket);
      socket.pipe(upstreamSocket);
    });
    const pair = { socket, upstreamSocket, deviceId: device.id };
    upgradedSockets.add(pair);
    const cleanup = () => upgradedSockets.delete(pair);
    upstreamSocket.on('close', cleanup);
    socket.on('close', () => {
      cleanup();
      upstreamSocket.destroy();
    });
    upstreamSocket.on('error', () => socket.destroy());
    socket.on('error', () => upstreamSocket.destroy());
    socket.setTimeout(0);
    socket.setKeepAlive(true, 30_000);
    socket.setNoDelay(true);
    upstreamSocket.setKeepAlive(true, 30_000);
    upstreamSocket.setNoDelay(true);
  }

  /** 在线切换监听地址（127.0.0.1 ↔ 0.0.0.0），不需要重启 DSH。 */
  async function setBind(next) {
    if (next !== '0.0.0.0' && next !== '127.0.0.1') throw new Error('监听地址只能是 127.0.0.1 或 0.0.0.0');
    if (next === activeBind && server) return { port: listeningPort, lanUrl };
    const wasRunning = server !== null;
    await stop();
    activeBind = next;
    if (wasRunning) await start();
    return { port: listeningPort, lanUrl };
  }

  function start() {
    if (server) return Promise.resolve({ port: listeningPort, lanUrl });
    return new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        handlePhone(req, res).catch((error) => {
          log(`gateway error: ${String(error?.message ?? error)}`);
          if (!res.headersSent) json(res, 500, { ok: false, error: 'internal' });
          else res.destroy();
        });
      });
      server.requestTimeout = 0;
      server.headersTimeout = 120_000;
      server.keepAliveTimeout = 65_000;
      server.timeout = 0;
      server.on('connection', (socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
      });
      server.on('upgrade', (req, socket, head) => {
        try {
          handleUpgrade(req, socket, head);
        } catch (error) {
          socket.destroy();
          log(`upgrade error: ${String(error?.message ?? error)}`);
        }
      });
      server.on('error', (error) => {
        lastError = String(error?.message ?? error);
        log(`gateway listen error: ${lastError}`);
        reject(error);
      });
      server.listen(activePort, activeBind, () => {
        listeningPort = server.address().port;
        lanUrl = `http://${lanAddress()}:${listeningPort}`;
        lanReachable = activeBind !== '127.0.0.1' && activeBind !== '::1';
        upstream
          .refresh()
          .then(() => log(`网关已启动：${appUrl()}（上游 ${upstream.origin}）`))
          .catch((error) => log(`网关已启动，但上游会话初始化失败：${String(error?.message ?? error)}`));
        resolve({ port: listeningPort, lanUrl });
      });
    });
  }

  function stop() {
    if (!server) return Promise.resolve();
    const current = server;
    server = null;
    return new Promise((resolve) => {
      for (const pair of upgradedSockets) {
        try {
          pair.socket.destroy();
          pair.upstreamSocket.destroy();
        } catch {
          /* ignore */
        }
      }
      upgradedSockets.clear();
      for (const socket of sockets) {
        try {
          socket.destroy();
        } catch {
          /* ignore */
        }
      }
      sockets.clear();
      try {
        current.closeAllConnections?.();
      } catch {
        /* ignore */
      }
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      current.close(done);
      setTimeout(done, 800).unref?.();
    });
  }

  return {
    VERSION,
    start,
    stop,
    setBind,
    handleDesktop,
    desktopState,
    startPairing,
    decidePairing,
    appUrl,
    get pairing() {
      return pairingView();
    },
    get port() {
      return listeningPort || port;
    },
    get lanUrl() {
      return lanUrl;
    },
    get lanReachable() {
      return lanReachable;
    },
  };
}

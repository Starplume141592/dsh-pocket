import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMobileGateway } from '../lib/gateway.js';
import { createUpstream } from '../lib/upstream.js';
import { createStore } from '../lib/store.js';

const COOKIE = 'dsh-auth-test=SESSIONVALUE; Path=/; HttpOnly';
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const upstreamServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://upstream');
  console.log('UPSTREAM', req.method, url.pathname, 'cookie?', String(req.headers.cookie ?? '').includes('SESSIONVALUE'));
  if (url.pathname === '/' && url.searchParams.get('token') === 'secret') {
    res.writeHead(302, { location: '/', 'set-cookie': COOKIE });
    return res.end();
  }
  if (!String(req.headers.cookie ?? '').includes('SESSIONVALUE')) {
    res.writeHead(401, { 'content-type': 'text/plain' });
    return res.end('unauthorized');
  }
  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(
      '<!doctype html><html><head><title>DSH</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app">DESKTOP APP</div></body></html>',
    );
  }
  if (url.pathname === '/api/echo') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.stringify({ ok: true, body: Buffer.concat(chunks).toString('utf8'), host: req.headers.host, origin: req.headers.origin ?? '', cookie: true });
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(payload);
  }
  res.writeHead(404);
  res.end('not found');
});
upstreamServer.on('upgrade', (req, socket) => {
  const accept = crypto.createHash('sha1').update((req.headers['sec-websocket-key'] ?? '') + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nX-Saw-Cookie: ${String(req.headers.cookie ?? '').includes('SESSIONVALUE')}\r\n\r\n`);
  socket.end();
});
await new Promise((resolve) => upstreamServer.listen(0, '127.0.0.1', resolve));
const upstreamPort = upstreamServer.address().port;
console.log('upstream port', upstreamPort);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mobile-debug-'));
const store = createStore(dir);
const origin = `http://127.0.0.1:${upstreamPort}`;
const upstream = createUpstream({
  origin,
  authenticatedUrl: (url) => `${url}${url.includes('?') ? '&' : '?'}token=secret`,
  log: (message) => console.log('UPSTREAM LOG', message),
});
const gateway = createMobileGateway({ upstream, store, port: 0, bind: '127.0.0.1', log: (m) => console.log('GW', m) });
await gateway.start();
console.log('gateway port', gateway.port);

const base = `http://127.0.0.1:${gateway.port}`;

let res = await fetch(`${base}/`);
console.log('unauth /', res.status, (await res.text()).slice(0, 80));

const main = http.createServer((req, res) => {
  console.log('MAIN', req.method, req.url, 'remote', req.socket.remoteAddress);
  if (String(req.url ?? '').startsWith('/plugins/dsh-mobile/api')) return gateway.handleDesktop(req, res);
  res.writeHead(404);
  res.end();
});
await new Promise((resolve) => main.listen(0, '127.0.0.1', resolve));
const mainPort = main.address().port;
console.log('main port', mainPort);

res = await fetch(`http://127.0.0.1:${mainPort}/plugins/dsh-mobile/api/state`);
console.log('state', res.status, await res.text());

res = await fetch(`http://127.0.0.1:${mainPort}/plugins/dsh-mobile/api/pair/start`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin },
  body: '{}',
});
const started = await res.json();
console.log('pair start', res.status, JSON.stringify(started).slice(0, 200));

const token = started.pairing.token;
res = await fetch(`${base}/__dshm/pair?t=${encodeURIComponent(token)}`, { headers: { accept: 'text/html' } });
console.log('pair page', res.status, (await res.text()).slice(0, 80));

res = await fetch(`http://127.0.0.1:${mainPort}/plugins/dsh-mobile/api/pair/decide`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin },
  body: JSON.stringify({ approve: true }),
});
console.log('decide', res.status, JSON.stringify(await res.json()).slice(0, 200));

res = await fetch(`${base}/__dshm/api/pair/claim?t=${encodeURIComponent(token)}`, { method: 'POST' });
console.log('claim', res.status, await res.text());
const setCookie = res.headers.getSetCookie()[0];
const cookie = setCookie.split(';')[0];
console.log('cookie', cookie.slice(0, 24) + '...');

res = await fetch(`${base}/`, { headers: { cookie, accept: 'text/html' } });
const page = await res.text();
console.log('authed /', res.status, page.slice(0, 120), 'manifest?', page.includes('manifest.webmanifest'));

res = await fetch(`${base}/api/echo`, {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json', origin: 'http://phone.local' },
  body: '{"hello":"dsh"}',
});
console.log('echo', res.status, await res.text());

await new Promise((resolve) => {
  const req = http.request({
    host: '127.0.0.1',
    port: gateway.port,
    path: '/api/remote.mux',
    headers: {
      connection: 'Upgrade',
      upgrade: 'websocket',
      'sec-websocket-key': crypto.randomBytes(16).toString('base64'),
      'sec-websocket-version': '13',
      cookie,
    },
  });
  req.on('upgrade', (upRes, socket) => {
    console.log('ws upgrade', upRes.statusCode, upRes.headers['x-saw-cookie']);
    socket.destroy();
    resolve();
  });
  req.on('response', (upRes) => {
    console.log('ws response instead', upRes.statusCode);
    upRes.resume();
    resolve();
  });
  req.on('error', (error) => {
    console.log('ws error', error.message);
    resolve();
  });
  req.end();
});

await gateway.stop();
main.close();
upstreamServer.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('DONE');
process.exit(0);

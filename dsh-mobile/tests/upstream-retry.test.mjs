// Upstream cookie expiry: a POST must be retried once with a fresh cookie,
// including its body. Regression for the 401 loop that required a DSH restart.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMobileGateway } from '../lib/gateway.js';
import { createUpstream } from '../lib/upstream.js';
import { createStore } from '../lib/store.js';

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function startUpstream() {
  let current = 'SESSIONVALUE';
  let hits = 0;
  const seen = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://upstream');
    if (url.pathname === '/' && url.searchParams.get('token') === 'secret') {
      res.writeHead(302, { location: '/', 'set-cookie': `dsh-auth-test=${current}; Path=/; HttpOnly` });
      res.end();
      return;
    }
    const cookie = String(req.headers.cookie || '');
    const authed = cookie.split(';').some((part) => part.trim() === 'dsh-auth-test=' + current);
    if (!authed) {
      res.writeHead(401, { 'content-type': 'text/plain' });
      res.end('unauthorized');
      return;
    }
    if (url.pathname === '/api/echo') {
      hits += 1;
      seen.push(cookie);
      const body = await readBody(req);
      const payload = JSON.stringify({ ok: true, body, hits });
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
      res.end(payload);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      server,
      port: server.address().port,
      rotate(next) { current = next; },
      get hits() { return hits; },
      get seen() { return seen; },
    }));
  });
}

test('a POST is retried with a fresh upstream cookie and the same body', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-gw-retry-'));
  const upstreamServer = await startUpstream();
  const store = createStore(dir);
  const { device, token } = store.addDevice({ name: 'retry-test' });
  const upstream = createUpstream({
    origin: `http://127.0.0.1:${upstreamServer.port}`,
    authenticatedUrl: (url) => url + '?token=secret',
    log: () => {},
  });
  const gateway = createMobileGateway({ upstream, store, port: 0, bind: '127.0.0.1' });
  await gateway.start();
  const headers = {
    'content-type': 'application/json',
    cookie: `dshm_device=${device.id}.${token}`,
  };

  try {
    const first = await fetch(`http://127.0.0.1:${gateway.port}/api/echo`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ n: 1 }),
    });
    assert.equal(first.status, 200);
    assert.equal((await first.json()).hits, 1);

    upstreamServer.rotate('SESSIONVALUE2');
    const second = await fetch(`http://127.0.0.1:${gateway.port}/api/echo`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ n: 2 }),
    });
    assert.equal(second.status, 200);
    const echoed = await second.json();
    assert.equal(echoed.hits, 2);
    assert.equal(echoed.body, JSON.stringify({ n: 2 }));
    assert.match(upstreamServer.seen[1], /dsh-auth-test=SESSIONVALUE2/);
  } finally {
    await gateway.stop();
    upstreamServer.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

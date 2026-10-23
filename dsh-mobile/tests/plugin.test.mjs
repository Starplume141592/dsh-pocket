// 插件装配测试：用假的 ctx 验证 host 半能注册桌面 API、启动网关、并在销毁时停掉。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply, inject, name } from '../lib/index.js';
import plugin from '../lib/index.js';

test('默认导出必须带 name/inject/apply（0.2.x Loader 优先取 default）', () => {
  assert.equal(plugin.name, name);
  assert.deepEqual(plugin.inject, inject);
  assert.equal(plugin.apply, apply);
});

function startUpstream() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://upstream');
    if (url.pathname === '/' && url.searchParams.get('token') === 'secret') {
      res.writeHead(302, { location: '/', 'set-cookie': 'dsh-auth-test=SESSION; Path=/' });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head></head><body>ok</body></html>');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('host 插件可装配、可回滚', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mobile-plugin-'));
  const { server: upstreamServer, port: upstreamPort } = await startUpstream();
  const origin = `http://127.0.0.1:${upstreamPort}`;
  const gatewayPort = 19000 + Math.floor(Math.random() * 500);
  const registered = [];
  const disposers = [];
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = dir;

  const ctx = {
    webServer: {
      getOrigin: () => origin,
      register: (route) => {
        registered.push(route);
        return () => {};
      },
    },
    connection: { authenticatedUrl: (url) => `${url}?token=secret` },
    effect: (fn) => {
      disposers.push(fn());
    },
  };

  t.after(() => {
    try {
      upstreamServer.closeAllConnections?.();
      upstreamServer.close();
    } catch {
      /* ignore */
    }
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  apply(ctx, { port: gatewayPort, bind: '127.0.0.1' });

  let health = null;
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${gatewayPort}/__dshm/health`);
      if (res.ok) {
        health = await res.json();
        break;
      }
    } catch {
      /* not listening yet */
    }
    await wait(50);
  }

  assert.ok(health, '网关应在启动后响应健康检查');
  assert.equal(health.ok, true);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].path, '/plugins/dsh-mobile/api');
  assert.equal(registered[0].kind, 'prefix');

  for (const dispose of disposers) {
    if (typeof dispose === 'function') await dispose();
  }
  await wait(120);
  await assert.rejects(fetch(`http://127.0.0.1:${gatewayPort}/__dshm/health`));
});

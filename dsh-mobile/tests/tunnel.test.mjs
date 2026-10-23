// 隧道托管：地址解析、公网地址写回、token 模式与停止。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createStore } from '../lib/store.js';
import { createTunnelManager } from '../lib/tunnel.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mobile-tunnel-'));
}

function makeSpawn(spawned) {
  return (binary, args, options) => {
    const child = new EventEmitter();
    child.pid = 4242;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      setImmediate(() => child.emit('exit', 0));
    };
    spawned.push({ binary, args, options, child });
    return child;
  };
}

async function waitFor(check, timeout = 2000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

test('临时隧道：从日志解析地址并写回 publicUrl', async () => {
  const dir = tempDir();
  const store = createStore(dir);
  store.updateSettings({ tunnel: { mode: 'quick' } });
  const spawned = [];
  const manager = createTunnelManager({
    port: 8470,
    dataDir: dir,
    store,
    cloudflaredPath: process.execPath,
    spawnImpl: makeSpawn(spawned),
  });

  const started = await manager.start();
  assert.equal(started.running, true);
  assert.equal(spawned.length, 1);
  assert.deepEqual(spawned[0].args, [
    'tunnel',
    '--url',
    'http://127.0.0.1:8470',
    '--no-autoupdate',
    '--protocol',
    'http2',
  ]);
  assert.equal(spawned[0].options.env.TUNNEL_TOKEN, undefined);

  // 模拟 cloudflared 把地址写进日志文件（与真实实现一致）。
  fs.appendFileSync(path.join(dir, 'tunnel.log'), 'INF |  https://unit-test-tunnel.trycloudflare.com  |\n');
  assert.equal(await waitFor(() => store.settings.publicUrl !== ''), true);  assert.equal(store.settings.publicUrl, 'https://unit-test-tunnel.trycloudflare.com');
  assert.equal(manager.status().url, 'https://unit-test-tunnel.trycloudflare.com');

  await manager.stop();
  assert.equal(manager.status().running, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('固定隧道：token 走环境变量，地址保持用户设置', async () => {
  const dir = tempDir();
  const store = createStore(dir);
  store.updateSettings({ publicUrl: 'https://dsh.example.com', tunnel: { mode: 'token', token: 'tok_123' } });
  const spawned = [];
  const manager = createTunnelManager({
    port: 8470,
    dataDir: dir,
    store,
    cloudflaredPath: process.execPath,
    spawnImpl: makeSpawn(spawned),
  });
  await manager.start();
  assert.deepEqual(spawned[0].args, ['tunnel', '--no-autoupdate', 'run']);
  assert.equal(spawned[0].options.env.TUNNEL_TOKEN, 'tok_123');
  assert.equal(manager.status().url, 'https://dsh.example.com');
  fs.appendFileSync(path.join(dir, 'tunnel.log'), 'INF Registered tunnel connection connIndex=0\n');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(store.settings.publicUrl, 'https://dsh.example.com');
  await manager.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('上一次运行的旧地址不会被误读', async () => {
  const dir = tempDir();
  const store = createStore(dir);
  store.updateSettings({ tunnel: { mode: 'quick' } });
  fs.writeFileSync(path.join(dir, 'tunnel.log'), 'INF | https://old-dead-tunnel.trycloudflare.com |\n');
  const spawned = [];
  const manager = createTunnelManager({
    port: 8470,
    dataDir: dir,
    store,
    cloudflaredPath: process.execPath,
    spawnImpl: makeSpawn(spawned),
  });
  await manager.start();
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(store.settings.publicUrl, '', '旧日志里的地址不能被当成新地址');
  assert.equal(manager.status().url, '');
  fs.appendFileSync(path.join(dir, 'tunnel.log'), 'INF | https://fresh-tunnel.trycloudflare.com |\n');
  assert.equal(await waitFor(() => store.settings.publicUrl === 'https://fresh-tunnel.trycloudflare.com'), true);
  await manager.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('没有选模式时不启动', async () => {
  const dir = tempDir();
  const store = createStore(dir);
  const manager = createTunnelManager({
    port: 8470,
    dataDir: dir,
    store,
    cloudflaredPath: process.execPath,
    spawnImpl: makeSpawn([]),
  });
  await assert.rejects(() => manager.start(), /隧道模式/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('意外退出会记录错误；autoStart 关闭时不自动重连', async () => {
  const dir = tempDir();
  const store = createStore(dir);
  store.updateSettings({ tunnel: { mode: 'quick', autoStart: false } });
  const spawned = [];
  const manager = createTunnelManager({
    port: 8470,
    dataDir: dir,
    store,
    cloudflaredPath: process.execPath,
    spawnImpl: makeSpawn(spawned),
  });
  await manager.start();
  spawned[0].child.emit('exit', 1);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const status = manager.status();
  assert.equal(status.running, false);
  assert.match(status.error, /隧道已退出/);
  assert.equal(spawned.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

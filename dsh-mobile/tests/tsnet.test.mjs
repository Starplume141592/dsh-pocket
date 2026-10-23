// 内嵌 Funnel 管理器：参数、状态轮询、publicUrl 回填、退出与 auth key。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createStore } from '../lib/store.js';
import { createTsnetManager } from '../lib/tsnet.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mobile-tsnet-'));
}

function makeSpawn(spawned) {
  return (binary, args, options) => {
    const child = new EventEmitter();
    child.pid = 5151;
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      setImmediate(() => child.emit('exit', 0));
    };
    spawned.push({ binary, args, options, child });
    return child;
  };
}

function statusFetch(steps, repeat = 1) {
  let index = 0;
  return async () => {
    const step = steps[Math.min(Math.floor(index / repeat), steps.length - 1)];
    index += 1;
    return { ok: true, json: async () => step };
  };
}

async function waitFor(check, timeout = 2500) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

test('轮询状态：登录链接、Funnel 地址写回 publicUrl、可停止', async () => {
  const dir = tempDir();
  const store = createStore(dir);
  store.updateSettings({ tsnet: { enabled: true, hostname: 'pocket' } });
  const spawned = [];
  const manager = createTsnetManager({
    port: 8470,
    dataDir: dir,
    store,
    sidecarPath: process.execPath,
    controlPort: 18479,
    pollMs: 20,
    spawnImpl: makeSpawn(spawned),
    fetchImpl: statusFetch(
      [
        { ok: true, phase: 'need-login', authURL: 'https://login.tailscale.com/a/abc' },
        { ok: true, phase: 'serving', funnelURL: 'https://pocket.taila66dc2.ts.net' },
      ],
      5,
    ),
  });

  await manager.start();
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].binary, process.execPath);
  const args = spawned[0].args;
  assert.equal(args[0], '-listen');
  assert.equal(args[1], '127.0.0.1:18479');
  assert.equal(args[2], '-target');
  assert.equal(args[3], 'http://127.0.0.1:8470');
  assert.equal(args[args.indexOf('-hostname') + 1], 'pocket');
  assert.equal(args[args.indexOf('-dir') + 1], path.join(dir, 'tsnet'));

  assert.equal(await waitFor(() => manager.status().authURL !== ''), true);
  assert.equal(manager.status().phase, 'need-login');
  assert.equal(await waitFor(() => store.settings.publicUrl === 'https://pocket.taila66dc2.ts.net'), true);
  assert.equal(manager.status().funnelURL, 'https://pocket.taila66dc2.ts.net');
  assert.equal(manager.status().phase, 'serving');

  await manager.stop();
  assert.equal(manager.status().running, false);
  assert.equal(manager.status().phase, 'stopped');
  assert.equal(spawned[0].child.killed, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('auth key 走环境变量，不出现在命令行', async () => {
  const dir = tempDir();
  const store = createStore(dir);
  store.updateSettings({ tsnet: { enabled: true, authKey: 'tskey-auth-secret' } });
  const spawned = [];
  const manager = createTsnetManager({
    port: 8470,
    dataDir: dir,
    store,
    sidecarPath: process.execPath,
    controlPort: 18480,
    pollMs: 50,
    spawnImpl: makeSpawn(spawned),
    fetchImpl: statusFetch([{ ok: true, phase: 'connecting' }]),
  });
  await manager.start();
  assert.equal(spawned[0].options.env.TS_AUTHKEY, 'tskey-auth-secret');
  assert.equal(
    spawned[0].args.some((item) => item.includes('tskey-auth-secret')),
    false,
  );
  await manager.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('没有 sidecar 时明确报错', async () => {
  const dir = tempDir();
  const store = createStore(dir);
  const manager = createTsnetManager({
    port: 8470,
    dataDir: dir,
    store,
    sidecarPath: path.join(dir, 'missing-sidecar.exe'),
    controlPort: 18481,
    spawnImpl: makeSpawn([]),
  });
  assert.equal(manager.status().available, false);
  await assert.rejects(() => manager.start(), /没有找到/);
  assert.match(manager.status().error, /tsnet-sidecar/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('enabled 且 autoStart 才自动启动', async () => {
  const dir = tempDir();
  const store = createStore(dir);
  store.updateSettings({ tsnet: { enabled: true, autoStart: false } });
  const spawned = [];
  const manager = createTsnetManager({
    port: 8470,
    dataDir: dir,
    store,
    sidecarPath: process.execPath,
    controlPort: 18482,
    pollMs: 50,
    spawnImpl: makeSpawn(spawned),
    fetchImpl: statusFetch([{ ok: true, phase: 'connecting' }]),
  });
  assert.equal(await manager.autoStart(), null);
  assert.equal(spawned.length, 0);
  store.updateSettings({ tsnet: { autoStart: true } });
  const started = await manager.autoStart();
  assert.equal(spawned.length, 1);
  assert.equal(started.running, true);
  await manager.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('意外退出记录错误；autoStart 关闭时不自动重连', async () => {
  const dir = tempDir();
  const store = createStore(dir);
  store.updateSettings({ tsnet: { enabled: true, autoStart: false } });
  const spawned = [];
  const manager = createTsnetManager({
    port: 8470,
    dataDir: dir,
    store,
    sidecarPath: process.execPath,
    controlPort: 18483,
    pollMs: 50,
    spawnImpl: makeSpawn(spawned),
    fetchImpl: statusFetch([{ ok: true, phase: 'connecting' }]),
  });
  await manager.start();
  spawned[0].child.emit('exit', 1);
  await new Promise((resolve) => setTimeout(resolve, 40));
  const status = manager.status();
  assert.equal(status.running, false);
  assert.equal(status.phase, 'error');
  assert.match(status.error, /已退出/);
  assert.equal(spawned.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

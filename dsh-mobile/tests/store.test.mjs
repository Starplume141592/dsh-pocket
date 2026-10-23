// 存储层：设置迁移、设备重命名、推送订阅生命周期。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../lib/store.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mobile-store-'));
}

test('旧版 state.json 能补齐新设置而不丢设备', () => {
  const dir = tempDir();
  fs.writeFileSync(
    path.join(dir, 'state.json'),
    JSON.stringify({
      version: 1,
      secret: 'x'.repeat(43),
      devices: [
        { id: 'dev-1', name: '手机', tokenHash: 'a'.repeat(64), createdAt: 1, lastSeen: 1, lastIp: '' },
      ],
      settings: { publicUrl: 'https://old.example.com', lan: false },
      createdAt: 1,
    }),
  );
  const store = createStore(dir);
  assert.equal(store.settings.publicUrl, 'https://old.example.com');
  assert.equal(store.settings.mobile.enabled, true);
  assert.equal(store.settings.notify.enabled, true);
  assert.equal(store.settings.tunnel.mode, 'off');
  assert.equal(store.settings.tunnel.autoStart, false);
  assert.equal(store.settings.tsnet.enabled, false);
  assert.equal(store.settings.tsnet.hostname, 'pocket');
  assert.equal(store.listDevices().length, 1);
  assert.equal(store.listDevices()[0].platform, '');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('设备重命名与推送订阅', () => {
  const dir = tempDir();
  const store = createStore(dir);
  const created = store.addDevice({ name: '手机', platform: 'Android · Chrome', ip: '1.2.3.4' });
  assert.equal(store.renameDevice(created.device.id, '  我的手机  '), true);
  assert.equal(store.renameDevice(created.device.id, '   '), false);
  assert.equal(store.listDevices()[0].name, '我的手机');
  assert.equal(store.listDevices()[0].platform, 'Android · Chrome');

  const sub = { endpoint: 'https://push.example.com/a', keys: { p256dh: 'p', auth: 'a' } };
  assert.equal(store.addSubscription(created.device.id, sub), true);
  assert.equal(store.addSubscription(created.device.id, sub), true, '重复端点应幂等');
  assert.equal(store.listSubscriptions().length, 1);
  assert.equal(store.listDevices()[0].subscriptions, 1);
  assert.equal(store.addSubscription('missing', sub), false);
  assert.equal(store.addSubscription(created.device.id, { endpoint: 'http://insecure', keys: { p256dh: 'p', auth: 'a' } }), false);
  assert.equal(store.removeSubscription(sub.endpoint), true);
  assert.equal(store.listSubscriptions().length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('吊销设备会一并删掉它的推送订阅', () => {
  const dir = tempDir();
  const store = createStore(dir);
  const created = store.addDevice({ name: '手机' });
  store.addSubscription(created.device.id, { endpoint: 'https://push.example.com/a', keys: { p256dh: 'p', auth: 'a' } });
  assert.equal(store.revokeDevice(created.device.id), true);
  assert.equal(store.listSubscriptions().length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('内嵌 Funnel 设置：默认值、主机名清洗、非法值忽略', () => {
  const dir = tempDir();
  const store = createStore(dir);
  assert.equal(store.settings.tsnet.enabled, false);
  assert.equal(store.settings.tsnet.hostname, 'pocket');
  store.updateSettings({ tsnet: { enabled: true, hostname: ' My Pocket! ', autoStart: true } });
  assert.equal(store.settings.tsnet.hostname, 'mypocket');
  const snapshot = store.settings;
  snapshot.tsnet.enabled = false;
  assert.equal(store.settings.tsnet.enabled, true, '返回的应是副本');
  store.updateSettings({ tsnet: { autoStart: 'yes', hostname: '!!!' } });
  assert.equal(store.settings.tsnet.autoStart, true);
  assert.equal(store.settings.tsnet.hostname, 'pocket');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('手机端总开关：默认开、可关闭、返回副本', () => {
  const dir = tempDir();
  const store = createStore(dir);
  assert.equal(store.settings.mobile.enabled, true);
  store.updateSettings({ mobile: { enabled: false } });
  assert.equal(store.settings.mobile.enabled, false);
  const snapshot = store.settings;
  snapshot.mobile.enabled = true;
  assert.equal(store.settings.mobile.enabled, false, '返回的应是副本');
  store.updateSettings({ mobile: { enabled: 'yes' } });
  assert.equal(store.settings.mobile.enabled, false, '非法值忽略');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('设置更新只接受合法值并深拷贝返回', () => {
  const dir = tempDir();
  const store = createStore(dir);
  store.updateSettings({
    tunnel: { mode: 'token', token: ' secret ', autoStart: true },
    notify: { enabled: false },
  });
  const settings = store.settings;
  assert.equal(settings.tunnel.mode, 'token');
  assert.equal(settings.tunnel.token, 'secret');
  assert.equal(settings.tunnel.autoStart, true);
  assert.equal(settings.notify.enabled, false);
  store.updateSettings({ tunnel: { mode: 'bogus', autoStart: 'yes' } });
  assert.equal(store.settings.tunnel.mode, 'token');
  assert.equal(store.settings.tunnel.autoStart, true);
  settings.tunnel.mode = 'hacked';
  assert.equal(store.settings.tunnel.mode, 'token', '返回的应是副本');
  fs.rmSync(dir, { recursive: true, force: true });
});

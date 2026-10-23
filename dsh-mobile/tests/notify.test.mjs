// 通知旁路：审批、长任务完成、失败与去重。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../lib/store.js';
import { installNotifications } from '../lib/notify.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mobile-notify-'));
}

function makeCtx() {
  const handlers = new Map();
  return {
    on(name, handler) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(handler);
      return () => handlers.get(name)?.delete(handler);
    },
    emit(name, ...args) {
      for (const handler of handlers.get(name) ?? []) handler(...args);
    },
  };
}

function setup() {
  const dir = tempDir();
  const store = createStore(dir);
  const sent = [];
  const push = {
    available: true,
    send: async (payload) => {
      sent.push(payload);
      return { sent: 1, failed: 0 };
    },
  };
  const ctx = makeCtx();
  let clock = 1_000_000;
  const dispose = installNotifications(ctx, { push, store, now: () => clock });
  return {
    dir,
    store,
    sent,
    ctx,
    dispose,
    advance(ms) {
      clock += ms;
    },
    async flush() {
      await new Promise((resolve) => setTimeout(resolve, 10));
    },
  };
}

const session = (id, title = '修手机端') => ({
  id,
  events: [{ type: 'session/title', data: { title } }],
});

test('长任务完成会推送，短任务不打扰', async (t) => {
  const env = setup();
  t.after(() => fs.rmSync(env.dir, { recursive: true, force: true }));

  env.ctx.emit('session/event', session('s1'), { type: 'turn/start', data: { turn: 1 } });
  env.ctx.emit('session/event', session('s1'), { type: 'tool/call', data: { turn: 1 } });
  env.ctx.emit('session/event', session('s1'), { type: 'tool/call', data: { turn: 1 } });
  env.ctx.emit('session/event', session('s1'), { type: 'tool/call', data: { turn: 1 } });
  env.advance(25_000);
  env.ctx.emit('session/event', session('s1'), { type: 'turn/end', data: { turn: 1, reason: { kind: 'complete' } } });
  await env.flush();
  assert.equal(env.sent.length, 1);
  assert.equal(env.sent[0].kind, 'done');
  assert.match(env.sent[0].body, /25 秒/);
  assert.match(env.sent[0].body, /3 个工具/);
  assert.match(env.sent[0].body, /修手机端/);

  env.ctx.emit('session/event', session('s2'), { type: 'turn/start', data: { turn: 1 } });
  env.advance(3_000);
  env.ctx.emit('session/event', session('s2'), { type: 'turn/end', data: { turn: 1, reason: { kind: 'complete' } } });
  await env.flush();
  assert.equal(env.sent.length, 1);
});

test('审批请求会推送，同一个审批只推一次', async (t) => {
  const env = setup();
  t.after(() => fs.rmSync(env.dir, { recursive: true, force: true }));
  const event = {
    type: 'approval/asked',
    data: { id: 'ap-1', toolName: 'bash', reason: '需要在工作区执行命令' },
  };
  env.ctx.emit('session/event', session('s1'), event);
  env.ctx.emit('session/event', session('s1'), event);
  await env.flush();
  assert.equal(env.sent.length, 1);
  assert.equal(env.sent[0].kind, 'approval');
  assert.match(env.sent[0].title, /待批准/);
  assert.match(env.sent[0].title, /bash/);
  assert.match(env.sent[0].body, /需要在工作区执行命令/);
});

test('运行失败会推送错误', async (t) => {
  const env = setup();
  t.after(() => fs.rmSync(env.dir, { recursive: true, force: true }));
  env.ctx.emit('session/event', session('s1'), { type: 'turn/start', data: { turn: 2 } });
  env.ctx.emit('session/event', session('s1'), {
    type: 'turn/end',
    data: { turn: 2, reason: { kind: 'error', error: { message: '接口限流' } } },
  });
  await env.flush();
  assert.equal(env.sent.length, 1);
  assert.equal(env.sent[0].kind, 'error');
  assert.match(env.sent[0].body, /接口限流/);
});

test('总开关关闭后不再推送', async (t) => {
  const env = setup();
  t.after(() => fs.rmSync(env.dir, { recursive: true, force: true }));
  env.store.updateSettings({ notify: { enabled: false } });
  env.ctx.emit('session/event', session('s1'), {
    type: 'approval/asked',
    data: { id: 'ap-2', toolName: 'bash' },
  });
  await env.flush();
  assert.equal(env.sent.length, 0);
});

test('卸载后不再收到事件', async (t) => {
  const env = setup();
  t.after(() => fs.rmSync(env.dir, { recursive: true, force: true }));
  env.dispose();
  env.ctx.emit('session/event', session('s1'), {
    type: 'approval/asked',
    data: { id: 'ap-3', toolName: 'bash' },
  });
  await env.flush();
  assert.equal(env.sent.length, 0);
});

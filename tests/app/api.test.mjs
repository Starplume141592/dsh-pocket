import test from 'node:test';
import assert from 'node:assert/strict';
import { PocketApi, ApiError, sessionSummary } from '../../app/api.js';

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

test('rpc sends the DSH envelope and returns the value', async () => {
  const calls = [];
  const api = new PocketApi({
    base: 'https://example.test',
    fetch: async (url, init) => {
      calls.push({ url, init });
      const request = JSON.parse(init.body);
      return jsonResponse({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: { items: [{ sessionId: 's1' }] } } });
    },
  });
  const value = await api.listSessions();
  assert.equal(value.items[0].sessionId, 's1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.test/api/session/list');
  const request = JSON.parse(calls[0].init.body);
  assert.equal(request.type, 'client-request');
  assert.equal(request.method, 'session/list');
  assert.deepEqual(request.payload.args, { _request: {} });
});

test('rpc surfaces a DSH error result as ApiError', async () => {
  const api = new PocketApi({
    base: 'https://example.test',
    fetch: async (url, init) => {
      const request = JSON.parse(init.body);
      return jsonResponse({ type: 'server-response', rpcId: request.rpcId, result: { ok: false, error: { code: 'session/not-found', message: 'missing', details: { id: 's1' } } } });
    },
  });
  await assert.rejects(() => api.cancelSession('s1'), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'session/not-found');
    assert.equal(error.message, 'missing');
    return true;
  });
});

test('prompt sends a stable requestId, text block and time zone', async () => {
  const calls = [];
  const api = new PocketApi({
    base: 'https://example.test',
    fetch: async (url, init) => {
      calls.push(JSON.parse(init.body));
      return jsonResponse({ type: 'server-response', rpcId: calls[0].rpcId, result: { ok: true, value: { accepted: true } } });
    },
  });
  const result = await api.prompt('s1', 'hello', { requestId: 'req-1', timeZone: 'Asia/Shanghai' });
  assert.equal(result.accepted, true);
  const request = calls[0].payload.args.request;
  assert.equal(request.sessionId, 's1');
  assert.equal(request.requestId, 'req-1');
  assert.equal(request.mode, 'queue');
  assert.deepEqual(request.content, [{ type: 'text', text: 'hello' }]);
  assert.equal(request.clientTimeZone, 'Asia/Shanghai');
});

test('answerEvent posts the waterfall result', async () => {
  const calls = [];
  const api = new PocketApi({
    base: 'https://example.test',
    fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return jsonResponse({ type: 'server-response', rpcId: calls[0].body.rpcId, result: { ok: true, value: { accepted: true } } });
    },
  });
  await api.answerEvent('client-1', 'event-1', { kind: 'result', value: 'allowed-once' });
  assert.equal(calls[0].url, 'https://example.test/api/$events/result');
  assert.deepEqual(calls[0].body.payload.args, {
    clientId: 'client-1',
    eventId: 'event-1',
    outcome: { kind: 'result', value: 'allowed-once' },
  });
});

class FakeSocket {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.sent = [];
    FakeSocket.last = this;
  }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  send(text) { this.sent.push(JSON.parse(text)); }
  close() { this.emit('close', { code: 1000, reason: 'test' }); }
  emit(type, event) { for (const handler of this.listeners.get(type) || []) handler(event); }
  open() { this.emit('open', {}); }
  message(value) { this.emit('message', { data: JSON.stringify(value) }); }
}

test('followSession opens the mux stream and routes frames', async () => {
  const api = new PocketApi({ base: 'https://example.test', WebSocket: FakeSocket });
  const seen = { snapshot: 0, event: 0, stream: 0, closed: 0 };
  api.followSession('s1', {
    onSnapshot: (value) => { seen.snapshot += 1; assert.equal(value.cursor, 4); },
    onEvent: (event) => { seen.event += 1; assert.equal(event.type, 'turn/start'); },
    onAssistantStream: (frame) => { seen.stream += 1; assert.equal(frame.type, 'chunk'); },
    onClose: () => { seen.closed += 1; },
  });
  const socket = FakeSocket.last;
  assert.equal(socket.url, 'wss://example.test/api/remote.mux');
  socket.open();
  assert.equal(socket.sent.length, 1);
  const open = socket.sent[0];
  assert.equal(open.type, 'open');
  assert.equal(open.endpoint, 'session/follow');
  assert.equal(open.payload.args.request.address.kind, 'session');
  assert.equal(open.payload.args.request.address.sessionId, 's1');
  assert.equal(open.payload.args.request.assistantStream, true);
  socket.message({ type: 'item', streamId: open.streamId, value: { type: 'snapshot', cursor: 4, records: [] } });
  socket.message({ type: 'item', streamId: open.streamId, value: { type: 'event', event: { type: 'turn/start', seq: 5, data: { turn: 1 } } } });
  socket.message({ type: 'item', streamId: open.streamId, value: { type: 'assistant-stream', frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'x' } } } });
  socket.close();
  assert.deepEqual(seen, { snapshot: 1, event: 1, stream: 1, closed: 1 });
});

test('sessionSummary falls back to the session id and extracts title', () => {
  const summary = sessionSummary({ sessionId: 's1', updatedAt: 1, running: true, projections: { values: { title: 'Hello', workingDirectory: '/w' } } });
  assert.equal(summary.id, 's1');
  assert.equal(summary.title, 'Hello');
  assert.equal(summary.cwd, '/w');
  assert.equal(summary.running, true);
  const blank = sessionSummary({ sessionId: 's2', projections: { values: { sessionListMetadata: { blank: true } } } });
  assert.equal(blank.title, '新会话');
});

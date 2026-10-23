import test from 'node:test';
import assert from 'node:assert/strict';
import { createCache, SESSIONS_KEY, CHAT_PREFIX, CHAT_LIMIT } from '../../app/cache.js';

class MemoryStorage {
  constructor(limit = Infinity) {
    this.map = new Map();
    this.limit = limit;
  }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) {
    const next = new Map(this.map);
    next.set(key, String(value));
    const bytes = [...next.entries()].reduce((sum, [k, v]) => sum + k.length + v.length, 0);
    if (bytes > this.limit) {
      const error = new Error('QuotaExceededError');
      error.name = 'QuotaExceededError';
      throw error;
    }
    this.map.set(key, String(value));
  }
  removeItem(key) { this.map.delete(key); }
}

function chat(text = 'hello', extra = {}) {
  return {
    title: 'Test chat',
    messages: [{ role: 'user', text, time: '20:00' }, { role: 'assistant', text: text + ' reply', time: '20:01' }],
    ...extra,
  };
}

test('sessions round-trip keeps the slim render model', () => {
  const cache = createCache(new MemoryStorage());
  assert.equal(cache.saveSessions([
    { id: 'session-1', title: 'A', snippet: 'working', time: '刚刚', status: 'running', cwd: '/w', icon: 'spark', real: true, updatedAt: 123456, raw: { big: true } },
    { id: '', title: 'bad' },
    { title: 'no id' },
  ], 111), true);

  const result = cache.loadSessions();
  assert.equal(result.at, 111);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0], {
    id: 'session-1', title: 'A', snippet: 'working', time: '刚刚', status: 'running', cwd: '/w', icon: 'spark', real: true, updatedAt: 123456,
  });
  assert.equal(result.items[0].raw, undefined);
});

test('sessions with no valid items are not written', () => {
  const cache = createCache(new MemoryStorage());
  assert.equal(cache.saveSessions([{ title: 'nope' }]), false);
  assert.equal(cache.loadSessions(), null);
});

test('chat round-trip drops live flags and caps tool output', () => {
  const cache = createCache(new MemoryStorage());
  const long = 'x'.repeat(9000);
  assert.equal(cache.saveChat('session-1', {
    title: 'Build',
    messages: [
      { role: 'user', text: 'hi', live: true, pending: true, failed: true },
      { role: 'tool', name: 'pwsh', status: 'done', output: long, live: true },
    ],
  }, 222), true);

  const result = cache.loadChat('session-1');
  assert.equal(result.at, 222);
  assert.equal(result.title, 'Build');
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].live, false);
  assert.equal(result.messages[0].pending, false);
  assert.equal(result.messages[1].output.length, 1000);
});

test('chat keeps only the last messages and the newest text survives trimming', () => {
  const cache = createCache(new MemoryStorage());
  const messages = Array.from({ length: CHAT_LIMIT + 10 }, (_, i) => ({ role: 'assistant', text: 'm' + i }));
  messages.push({ role: 'assistant', text: 'LAST' });
  cache.saveChat('session-1', { title: 'T', messages });

  const result = cache.loadChat('session-1');
  assert.equal(result.messages.length, CHAT_LIMIT);
  assert.equal(result.messages.at(-1).text, 'LAST');
  assert.equal(result.messages[0].text, 'm11');
});

test('a large chat drops oldest messages to stay under the byte budget', () => {
  const cache = createCache(new MemoryStorage());
  const messages = Array.from({ length: CHAT_LIMIT }, (_, i) => ({ role: 'assistant', text: String(i).padStart(3, '0') + 'x'.repeat(8000) }));
  messages.push({ role: 'user', text: 'LAST' });
  cache.saveChat('session-1', { title: 'Big', messages });

  const result = cache.loadChat('session-1');
  assert.ok(result.messages.length < CHAT_LIMIT);
  assert.equal(result.messages.at(-1).text, 'LAST');
});

test('prune removes expired and overflow chat snapshots only', () => {
  const storage = new MemoryStorage();
  const cache = createCache(storage);
  const now = 1_000_000_000;
  cache.saveSessions([{ id: 'session-1', title: 'A' }], now);
  cache.saveChat('old', chat(), now - 20 * 24 * 3600 * 1000);
  cache.saveChat('recent', chat(), now - 1000);
  cache.saveChat('older', chat(), now - 2000);

  assert.equal(cache.prune({ now, maxCount: 1, maxAge: 14 * 24 * 3600 * 1000 }), 2);
  assert.equal(cache.loadChat('old'), null);
  assert.equal(cache.loadChat('older'), null);
  assert.ok(cache.loadChat('recent'));
  assert.ok(storage.getItem(SESSIONS_KEY));
});

test('quota pressure evicts the oldest chat snapshot and keeps the new one', () => {
  const storage = new MemoryStorage(1500);
  const cache = createCache(storage);
  const big = (tag) => ({ title: tag, messages: [{ role: 'assistant', text: tag + 'y'.repeat(450) }] });

  assert.equal(cache.saveChat('a', big('a'), 1), true);
  assert.equal(cache.saveChat('b', big('b'), 2), true);
  assert.equal(cache.saveChat('c', big('c'), 3), true);

  assert.equal(cache.loadChat('a'), null);
  assert.ok(cache.loadChat('c'));
});

test('pending approvals are not restored from a cached chat', () => {
  const cache = createCache(new MemoryStorage());
  cache.saveChat('session-1', {
    title: 'T',
    messages: [
      { role: 'approval', status: 'pending', tool: 'pwsh', key: 'a', reason: 'waiting' },
      { role: 'approval', status: 'allowed', tool: 'pwsh', key: 'b', reason: 'done' },
      { role: 'user', text: 'hello' },
    ],
  });
  const result = cache.loadChat('session-1');
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].status, 'allowed');
  assert.equal(result.messages[1].text, 'hello');
});

test('saving an empty chat removes the old snapshot', () => {
  const cache = createCache(new MemoryStorage());
  cache.saveChat('session-1', chat());
  assert.ok(cache.loadChat('session-1'));
  cache.saveChat('session-1', { title: 'empty', messages: [] });
  assert.equal(cache.loadChat('session-1'), null);
});

test('missing or corrupt storage degrades to no-ops', () => {
  const cache = createCache(null);
  assert.equal(cache.loadSessions(), null);
  assert.equal(cache.saveSessions([{ id: 'session-1', title: 'A' }]), false);
  assert.equal(cache.loadChat('session-1'), null);
  assert.equal(cache.saveChat('session-1', chat()), false);

  const broken = new MemoryStorage();
  const corrupt = createCache(broken);
  broken.setItem(SESSIONS_KEY, '{not json');
  broken.setItem(CHAT_PREFIX + 'session-1', '{not json');
  assert.equal(corrupt.loadSessions(), null);
  assert.equal(corrupt.loadChat('session-1'), null);
});

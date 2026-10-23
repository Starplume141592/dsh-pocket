import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrefs, normalizePrefs, DEFAULT_PREFS, PREFS_KEY } from '../../app/prefs.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

test('prefs default and round-trip', () => {
  const storage = new MemoryStorage();
  const prefs = createPrefs(storage);
  assert.deepEqual(prefs.value, DEFAULT_PREFS);

  const next = prefs.update({ accent: 'green', density: 'compact', showActivity: false, pageSize: 40, offlineCache: false });
  assert.equal(next.accent, 'green');
  assert.equal(next.density, 'compact');
  assert.equal(next.pageSize, 40);
  assert.equal(storage.getItem(PREFS_KEY).includes('"green"'), true);

  const reloaded = createPrefs(storage);
  assert.deepEqual(reloaded.value, next);
});

test('invalid values are ignored and copies are returned', () => {
  assert.deepEqual(normalizePrefs({ accent: 'pink', density: 'huge', pageSize: '99', showActivity: 'yes' }), DEFAULT_PREFS);
  const prefs = createPrefs(new MemoryStorage());
  const snapshot = prefs.value;
  snapshot.accent = 'orange';
  assert.equal(prefs.value.accent, 'violet');
});

test('reset restores defaults', () => {
  const storage = new MemoryStorage();
  const prefs = createPrefs(storage);
  prefs.update({ accent: 'blue', pageSize: 10 });
  assert.deepEqual(prefs.reset(), DEFAULT_PREFS);
  assert.deepEqual(createPrefs(storage).value, DEFAULT_PREFS);
});

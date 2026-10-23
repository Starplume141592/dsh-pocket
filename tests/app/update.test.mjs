import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_VERSION,
  compareVersions,
  isNewerVersion,
  entryCandidates,
  normalizeBase,
  fetchReleaseConfig,
} from '../../app/update.js';

test('version compare handles prefixes and suffixes', () => {
  assert.equal(compareVersions('0.4.1', '0.4.0'), 1);
  assert.equal(compareVersions('v0.4.0-dev', '0.4.0'), 0);
  assert.equal(compareVersions('0.5', '0.4.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(isNewerVersion('0.4.1', APP_VERSION), false);
  assert.equal(isNewerVersion('0.5.0', APP_VERSION), true);
});

test('base normalization and entry candidates prefer config, then saved', () => {
  assert.equal(normalizeBase(' pocket.example.com/ '), 'https://pocket.example.com');
  assert.deepEqual(entryCandidates('https://old.test', { publicUrl: 'https://new.test/' }), ['https://new.test', 'https://old.test']);
  assert.deepEqual(entryCandidates('https://same.test', { publicUrl: 'https://same.test' }), ['https://same.test']);
  assert.deepEqual(entryCandidates('', null), []);
});

test('fetchReleaseConfig returns null on failure and parses success', async () => {
  const failed = await fetchReleaseConfig({
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.equal(failed, null);

  const value = await fetchReleaseConfig({
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: '0.4.2', publicUrl: 'https://x.test' }) }),
  });
  assert.equal(value.version, '0.4.2');
  assert.equal(value.publicUrl, 'https://x.test');
});

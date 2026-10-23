import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_VERSION,
  compareVersions,
  isNewerVersion,
  entryCandidates,
  normalizeBase,
  fetchReleaseConfig,
  shellVersion,
  updateTargets,
} from '../../app/update.js';

test('version compare handles prefixes and suffixes', () => {
  assert.equal(compareVersions('0.4.1', '0.4.0'), 1);
  assert.equal(compareVersions('v0.4.0-dev', '0.4.0'), 0);
  assert.equal(compareVersions('0.5', '0.4.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(isNewerVersion('0.4.1', APP_VERSION), false);
  assert.equal(isNewerVersion('0.5.1', APP_VERSION), true);
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
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: '0.5.0', apkVersion: '0.5.0' }) }),
    url: 'https://example.test/release/config.json',
  });
  assert.equal(value.version, '0.5.0');
  assert.equal(value.apkVersion, '0.5.0');
});

test('update targets distinguish web UI from native shell', () => {
  assert.deepEqual(updateTargets({ version: '0.5.0', apkVersion: '0.5.0' }, '0.5.0', '0.5.0'), { web: false, apk: false });
  assert.deepEqual(updateTargets({ version: '0.5.1', apkVersion: '0.5.0' }, '0.5.0', '0.5.0'), { web: true, apk: false });
  assert.deepEqual(updateTargets({ version: '0.5.1', apkVersion: '0.5.1' }, '0.5.0', '0.5.0'), { web: true, apk: true });
  assert.equal(shellVersion(), '');
});

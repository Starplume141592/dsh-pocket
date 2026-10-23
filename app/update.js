/* Pocket update helpers: version compare, release config, native entry choice.
 * No DOM; safe to unit-test in Node.
 */

export const APP_VERSION = '0.4.2';
export const RELEASE_CONFIG_URL = 'https://Starplume141592.github.io/dsh-pocket/releases/config.json';

export function normalizeBase(value) {
  let text = String(value || '').trim();
  if (!text) return '';
  if (!/^https?:\/\//i.test(text)) text = 'https://' + text;
  return text.replace(/\/+$/, '');
}

function versionParts(value) {
  return String(value || '')
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
}

/** Compare dotted versions. Returns -1/0/1. */
export function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function isNewerVersion(remote, current) {
  return compareVersions(remote, current) > 0;
}

/** Config first, then the saved address; de-duplicated. */
export function entryCandidates(savedBase, config) {
  const list = [];
  const fromConfig = config && typeof config.publicUrl === 'string' ? normalizeBase(config.publicUrl) : '';
  const fromSaved = normalizeBase(savedBase);
  for (const value of [fromConfig, fromSaved]) {
    if (value && !list.includes(value)) list.push(value);
  }
  return list;
}

export async function fetchReleaseConfig(options = {}) {
  const {
    url = RELEASE_CONFIG_URL,
    fetchImpl = globalThis.fetch,
    timeoutMs = 3500,
  } = options;
  if (typeof fetchImpl !== 'function') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('release config timeout')), timeoutMs);
  try {
    const response = await fetchImpl(url, { cache: 'no-store', signal: controller.signal });
    if (!response?.ok) return null;
    const value = await response.json();
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

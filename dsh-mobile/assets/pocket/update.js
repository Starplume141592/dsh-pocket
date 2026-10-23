/* Pocket update helpers: version compare, release config, shell version.
 * No DOM; safe to unit-test in Node.
 */

export const APP_VERSION = '0.5.0';
export const RELEASE_CONFIG_URL = './release/config.json';

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

/** The native shell appends PocketShell/<version> to its WebView UA. */
export function shellVersion() {
  const match = /PocketShell\/([0-9.]+)/i.exec(navigator.userAgent || '');
  return match ? match[1] : '';
}

export function isPocketShell() {
  return Boolean(shellVersion());
}

/**
 * A release can need one or both:
 * - the web UI (hot-updatable; update.js / app.js / CSS)
 * - the native shell (APK install required; login / Tailscale / VPN)
 */
export function updateTargets(config, currentWeb, currentShell) {
  const web = Boolean(config && isNewerVersion(config.version, currentWeb || APP_VERSION));
  const apk = Boolean(config && currentShell && config.apkVersion && isNewerVersion(config.apkVersion, currentShell));
  return { web, apk };
}

export async function fetchReleaseConfig(options = {}) {
  const { timeoutMs = 3500, fetchImpl = globalThis.fetch, url: explicitUrl } = options;
  if (typeof fetchImpl !== 'function') return null;
  const base = typeof location !== 'undefined' ? location.href.replace(/#.*$/, '') : '';
  const url = explicitUrl || new URL(RELEASE_CONFIG_URL, base || 'https://localhost/').href;
  const separator = url.includes('?') ? '&' : '?';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('release config timeout')), timeoutMs);
  try {
    const response = await fetchImpl(url + separator + 't=' + Date.now(), {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response?.ok) return null;
    const value = await response.json();
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

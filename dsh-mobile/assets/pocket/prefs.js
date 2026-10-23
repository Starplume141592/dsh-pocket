/* Pocket local preferences. Plain localStorage, no DOM. */

export const PREFS_KEY = 'pocket-prefs-v1';
export const ACCENTS = ['violet', 'blue', 'green', 'orange'];
export const PAGE_SIZES = [10, 20, 40];

export const DEFAULT_PREFS = {
  accent: 'violet',
  density: 'comfortable',
  showActivity: true,
  pageSize: 20,
  offlineCache: true,
};

export function normalizePrefs(raw) {
  const value = { ...DEFAULT_PREFS };
  if (!raw || typeof raw !== 'object') return value;
  if (ACCENTS.includes(raw.accent)) value.accent = raw.accent;
  if (raw.density === 'compact' || raw.density === 'comfortable') value.density = raw.density;
  if (typeof raw.showActivity === 'boolean') value.showActivity = raw.showActivity;
  if (PAGE_SIZES.includes(Number(raw.pageSize))) value.pageSize = Number(raw.pageSize);
  if (typeof raw.offlineCache === 'boolean') value.offlineCache = raw.offlineCache;
  return value;
}

export function createPrefs(storage = (() => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
})()) {
  let value = normalizePrefs(read());

  function read() {
    try {
      const raw = storage?.getItem(PREFS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function write() {
    try { storage?.setItem(PREFS_KEY, JSON.stringify(value)); } catch { /* quota / private mode */ }
  }

  return {
    get value() { return { ...value }; },
    update(patch = {}) {
      value = normalizePrefs({ ...value, ...patch });
      write();
      return { ...value };
    },
    reset() {
      value = { ...DEFAULT_PREFS };
      write();
      return { ...value };
    },
  };
}

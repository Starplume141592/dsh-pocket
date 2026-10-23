/* Pocket offline cache: last session list + recent chat snapshots.
 * No DOM: takes a Storage-like object so it can be unit-tested in Node.
 *
 * Design notes:
 * - Sessions are cheap: store the slim render model, overwrite on every refresh.
 * - Chats are bounded: last 120 readable messages, 300 KB per session, 12 sessions.
 * - Tool output is trimmed harder than live output: offline reading is for context,
 *   not for full logs. Pending approvals are never restored.
 */

export const SESSIONS_KEY = 'pocket-cache-sessions-v1';
export const CHAT_PREFIX = 'pocket-cache-chat-v1:';
export const CHAT_LIMIT = 120;
export const CHAT_MAX_BYTES = 300_000;
export const CHAT_MAX_COUNT = 12;
export const CHAT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const TEXT_MAX = 4_000;
const OUTPUT_MAX = 1_000;
const TITLE_MAX = 200;

const MESSAGE_FIELDS = ['id', 'kind', 'text', 'reasoning', 'name', 'desc', 'status', 'tool', 'reason', 'outcome', 'tone', 'time'];

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function slimSession(session) {
  if (!session || typeof session.id !== 'string' || !session.id) return null;
  return {
    id: session.id,
    title: String(session.title || '').slice(0, TITLE_MAX),
    snippet: String(session.snippet || '').slice(0, 200),
    time: String(session.time || '').slice(0, 40),
    status: session.status === 'running' ? 'running' : 'done',
    cwd: String(session.cwd || '').slice(0, 300),
    icon: String(session.icon || '').slice(0, 20),
    real: session.real === true,
    updatedAt: Number(session.updatedAt) || 0,
  };
}

function slimMessage(message) {
  if (!message || typeof message !== 'object' || typeof message.role !== 'string') return null;
  const slim = { role: message.role, live: false, pending: false, failed: false };
  for (const field of MESSAGE_FIELDS) {
    const value = message[field];
    if (typeof value === 'string' && value) slim[field] = value.slice(0, TEXT_MAX);
  }
  if (typeof message.output === 'string') slim.output = message.output.slice(0, OUTPUT_MAX);
  return slim;
}

export function createCache(storage = defaultStorage()) {
  const available = Boolean(storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function');

  function read(key) {
    if (!available) return null;
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function remove(key) {
    if (!available) return;
    try { storage.removeItem(key); } catch { /* ignore */ }
  }

  function keys() {
    if (!available) return [];
    try {
      if (typeof storage.length === 'number' && typeof storage.key === 'function') {
        const out = [];
        for (let i = 0; i < storage.length; i += 1) {
          const key = storage.key(i);
          if (key) out.push(key);
        }
        return out;
      }
    } catch { /* fall through */ }
    try { return Object.keys(storage); } catch { return []; }
  }

  function chatEntries() {
    return keys()
      .filter((key) => key.startsWith(CHAT_PREFIX))
      .map((key) => ({ key, at: Number(read(key)?.at) || 0 }));
  }

  function oldestChatKey(exceptKey = '') {
    const entries = chatEntries().filter((entry) => entry.key !== exceptKey).sort((a, b) => a.at - b.at);
    return entries[0]?.key || '';
  }

  function write(key, value) {
    if (!available) return false;
    const text = JSON.stringify(value);
    try {
      storage.setItem(key, text);
      return true;
    } catch {
      // Quota: drop the oldest chat snapshot and retry a few times.
      for (let i = 0; i < 3; i += 1) {
        const victim = oldestChatKey(key);
        if (!victim) break;
        remove(victim);
        try {
          storage.setItem(key, text);
          return true;
        } catch { /* keep evicting */ }
      }
      return false;
    }
  }

  function saveSessions(sessions, now = Date.now()) {
    const items = (Array.isArray(sessions) ? sessions : []).map(slimSession).filter(Boolean);
    if (!items.length) return false;
    return write(SESSIONS_KEY, { at: now, items });
  }

  function loadSessions() {
    const value = read(SESSIONS_KEY);
    if (!value || !Array.isArray(value.items)) return null;
    const items = value.items.map(slimSession).filter(Boolean);
    if (!items.length) return null;
    return { at: Number(value.at) || 0, items };
  }

  function saveChat(sessionId, chat, now = Date.now()) {
    if (!sessionId || !chat) return false;
    const key = CHAT_PREFIX + sessionId;
    const messages = (Array.isArray(chat.messages) ? chat.messages : [])
      .slice(-CHAT_LIMIT)
      .map(slimMessage)
      .filter((message) => message && !(message.role === 'approval' && message.status === 'pending'));
    if (!messages.length) {
      remove(key);
      return true;
    }
    const payload = { at: now, title: String(chat.title || '').slice(0, TITLE_MAX), messages };
    let text = JSON.stringify(payload);
    while (text.length > CHAT_MAX_BYTES && messages.length > 4) {
      messages.splice(0, 2);
      text = JSON.stringify(payload);
    }
    return write(key, payload);
  }

  function loadChat(sessionId) {
    if (!sessionId) return null;
    const value = read(CHAT_PREFIX + sessionId);
    if (!value || !Array.isArray(value.messages)) return null;
    const messages = value.messages.map(slimMessage).filter(Boolean);
    if (!messages.length) return null;
    return { at: Number(value.at) || 0, title: String(value.title || ''), messages };
  }

  function removeChat(sessionId) {
    if (sessionId) remove(CHAT_PREFIX + sessionId);
  }

  function prune({ now = Date.now(), maxCount = CHAT_MAX_COUNT, maxAge = CHAT_MAX_AGE_MS } = {}) {
    const entries = chatEntries();
    let removed = 0;
    const fresh = [];
    for (const entry of entries) {
      if (!entry.at || now - entry.at > maxAge) {
        remove(entry.key);
        removed += 1;
      } else {
        fresh.push(entry);
      }
    }
    fresh.sort((a, b) => b.at - a.at);
    for (const entry of fresh.slice(maxCount)) {
      remove(entry.key);
      removed += 1;
    }
    return removed;
  }

  function clear() {
    remove(SESSIONS_KEY);
    for (const entry of chatEntries()) remove(entry.key);
  }

  return {
    available,
    saveSessions,
    loadSessions,
    saveChat,
    loadChat,
    removeChat,
    prune,
    clear,
  };
}

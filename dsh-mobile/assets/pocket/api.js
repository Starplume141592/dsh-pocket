/* Pocket transport: DSH HTTP RPC + Gateway WebSocket mux.
 * No DOM here; safe to unit-test in Node with injected WebSocket/fetch.
 */

export class ApiError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = 'ApiError';
    this.code = code || 'unknown';
    this.details = details || {};
  }
}

export function apiBase() {
  try {
    const saved = localStorage.getItem('pocket-base');
    if (saved) return String(saved).replace(/\/+$/, '');
  } catch { /* ignore */ }
  if (typeof location !== 'undefined' && (location.protocol === 'http:' || location.protocol === 'https:')) {
    return location.origin;
  }
  return '';
}

export function wsUrl(path) {
  const base = apiBase();
  if (base) {
    const u = new URL(base);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = path;
    u.search = '';
    u.hash = '';
    return u.href;
  }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return proto + '//' + location.host + path;
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}

export class PocketApi {
  constructor(options = {}) {
    this.base = options.base ?? apiBase();
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.WebSocketImpl = options.WebSocket ?? globalThis.WebSocket;
    this.timeoutMs = options.timeoutMs ?? 20000;
  }

  url(path) {
    return (this.base || '') + path;
  }

  async rpc(method, args, options = {}) {
    const rpcId = uuid();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('RPC timeout')), options.timeoutMs ?? this.timeoutMs);
    if (options.signal) {
      if (options.signal.aborted) controller.abort(options.signal.reason);
      else options.signal.addEventListener('abort', () => controller.abort(options.signal.reason), { once: true });
    }
    try {
      const res = await this.fetchImpl(this.url('/api/' + method), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }),
        signal: controller.signal,
      });
      if (!res.ok) throw new ApiError('HTTP ' + res.status + ' for ' + method, 'http_' + res.status);
      const body = await res.json();
      if (!body || body.type !== 'server-response' || body.rpcId !== rpcId) {
        throw new ApiError('Malformed RPC response for ' + method, 'protocol');
      }
      if (!body.result || body.result.ok !== true) {
        const err = body.result?.error ?? {};
        throw new ApiError(err.message || ('RPC failed: ' + method), err.code, err.details);
      }
      return body.result.value;
    } finally {
      clearTimeout(timer);
    }
  }

  listSessions() {
    return this.rpc('session/list', { _request: {} });
  }

  async createSession(options = {}) {
    const request = {};
    if (options.cwd) request.cwd = options.cwd;
    if (options.workspaceId) request.workspaceId = options.workspaceId;
    if (options.agentPreset) request.agentPreset = options.agentPreset;
    if (options.sessionId) request.sessionId = options.sessionId;
    return this.rpc('session/create', { request });
  }

  renameSession(sessionId, title) {
    return this.rpc('session/rename', { request: { sessionId, title } });
  }

  cancelSession(sessionId) {
    return this.rpc('session/cancel', { request: { sessionId } });
  }

  prompt(sessionId, text, options = {}) {
    const content = [];
    if (text && text.trim()) content.push({ type: 'text', text });
    if (Array.isArray(options.content)) content.push(...options.content);
    return this.rpc('session/prompt', {
      request: {
        requestId: options.requestId || uuid(),
        sessionId,
        mode: options.mode || 'queue',
        content,
        clientTimeZone: options.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    });
  }

  page(sessionId, throughSeq, options = {}) {
    return this.rpc('session/page', {
      request: {
        address: { kind: 'session', sessionId },
        throughSeq,
        maxMessages: options.maxMessages || 80,
        ...(options.beforeSeq === undefined ? {} : { beforeSeq: options.beforeSeq }),
      },
    });
  }

  answerEvent(clientId, eventId, outcome) {
    return this.rpc('$events/result', { clientId, eventId, outcome });
  }

  async health() {
    const res = await this.fetchImpl(this.url('/__dshm/health'), { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) throw new ApiError('health HTTP ' + res.status, 'http_' + res.status);
    return res.json();
  }

  openStream(endpoint, args, handlers = {}) {
    const streamId = uuid();
    const socket = new this.WebSocketImpl(wsUrl('/api/remote.mux'));
    let opened = false;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      try { socket.close(1000, 'client close'); } catch { /* ignore */ }
    };
    socket.addEventListener('open', () => {
      opened = true;
      socket.send(JSON.stringify({ type: 'open', streamId, endpoint, payload: { args } }));
    });
    socket.addEventListener('message', (event) => {
      let frame;
      try { frame = JSON.parse(String(event.data)); } catch { return; }
      if (!frame || frame.streamId !== streamId) return;
      if (frame.type === 'error') {
        handlers.onError?.(new ApiError(frame.error?.message || 'stream error', frame.error?.code, frame.error?.details));
        return;
      }
      if (frame.type === 'end') {
        handlers.onEnd?.();
        return;
      }
      if (frame.type !== 'item') return;
      const value = frame.value;
      if (!value || typeof value !== 'object') return;
      if (value.type === 'snapshot') handlers.onSnapshot?.(value);
      else if (value.type === 'event') handlers.onEvent?.(value.event);
      else if (value.type === 'assistant-stream') handlers.onAssistantStream?.(value.frame);
      else if (value.type === 'ready') handlers.onReady?.(value);
      else if (value.type === 'waterfall') handlers.onWaterfall?.(value);
      else if (value.type === 'emit') handlers.onEmit?.(value);
      else if (value.type === 'cancel') handlers.onCancel?.(value);
    });
    socket.addEventListener('error', () => {
      handlers.onError?.(new ApiError('stream socket error', 'socket'));
    });
    socket.addEventListener('close', (event) => {
      closed = true;
      handlers.onClose?.({ code: event.code, reason: event.reason, opened });
    });
    return { streamId, close };
  }

  followSession(sessionId, handlers = {}) {
    return this.openStream('session/follow', {
      request: {
        address: { kind: 'session', sessionId },
        assistantStream: true,
        maxMessages: 80,
      },
    }, handlers);
  }

  openEvents(handlers = {}) {
    return this.openStream('$events', {}, handlers);
  }
}

export function sessionSummary(item) {
  const values = item?.projections?.values ?? {};
  const title = values.title || (values.sessionListMetadata?.blank ? '新会话' : item?.sessionId) || '未命名会话';
  return {
    id: item?.sessionId,
    title,
    cwd: values.workingDirectory || item?.cwd || '',
    updatedAt: item?.updatedAt || 0,
    running: item?.running === true,
    blank: item?.blank === true || values.sessionListMetadata?.blank === true,
    agentAvailable: item?.agentAvailable === true,
    raw: item,
  };
}

// 把 DSH 的会话事件翻译成手机通知：待审批、长任务完成、运行失败。
//
// 只做旁路观察，不参与任何决策，也不注册审批 waterfall 监听器。
const DONE_MIN_MS = 20_000;
const DONE_MIN_TOOLS = 3;

function trim(text, max) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function sessionTitle(session) {
  try {
    const events = session?.events;
    if (Array.isArray(events)) {
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const event = events[i];
        if (event?.type === 'session/title' && typeof event.data?.title === 'string' && event.data.title) {
          return event.data.title;
        }
      }
      for (const event of events) {
        if (event?.type !== 'user/message') continue;
        const blocks = event.data?.content;
        if (!Array.isArray(blocks)) continue;
        const text = blocks.filter((block) => block?.type === 'text').map((block) => block.text).join(' ');
        if (text) return trim(text, 24);
      }
    }
    const headerTitle = session?.header?.title ?? session?.meta?.title;
    if (typeof headerTitle === 'string' && headerTitle) return headerTitle;
  } catch {
    /* 标题只是锦上添花 */
  }
  return '';
}

function durationText(ms) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} 分 ${seconds % 60} 秒`;
}

/**
 * 在插件 ctx 上安装通知旁路。返回卸载函数（通过 ctx.effect 注册）。
 */
export function installNotifications(ctx, { push, store, log = () => {}, now = () => Date.now() }) {
  if (!push?.available) return null;

  const turns = new Map();
  const seen = new Set();
  const seenOrder = [];

  const mark = (tag) => {
    if (!tag) return true;
    if (seen.has(tag)) return false;
    seen.add(tag);
    seenOrder.push(tag);
    if (seenOrder.length > 400) {
      const oldest = seenOrder.shift();
      seen.delete(oldest);
    }
    return true;
  };

  const send = (payload, options) => {
    if (!store.settings.notify.enabled) return;
    push.send(payload, options).catch((error) => {
      log(`通知发送失败：${String(error?.message ?? error).slice(0, 160)}`);
    });
  };

  const onSessionEvent = (session, event) => {
    const sessionId = typeof session?.id === 'string' ? session.id : '';
    if (!sessionId || !event?.type) return;
    const data = event.data ?? {};

    if (event.type === 'turn/start') {
      turns.set(sessionId, { at: now(), calls: 0, turn: data.turn ?? 0 });
      return;
    }

    if (event.type === 'tool/call') {
      const current = turns.get(sessionId);
      if (current) current.calls += 1;
      return;
    }

    if (event.type === 'approval/asked') {
      const id = typeof data.id === 'string' ? data.id : '';
      if (!mark(`a:${id || `${sessionId}:${data.callId ?? ''}`}`)) return;
      const title = sessionTitle(session);
      const tool = trim(data.toolName || '操作', 30);
      const reason = trim(data.reason || '有操作需要你确认', 80);
      send({
        kind: 'approval',
        title: `待批准 · ${tool}`,
        body: title ? `「${title}」${reason}` : reason,
        tag: `approval:${id || sessionId}`,
        sessionId,
      });
      return;
    }

    if (event.type === 'turn/end') {
      const started = turns.get(sessionId);
      turns.delete(sessionId);
      if (!started) return;
      const title = sessionTitle(session);
      const elapsed = now() - started.at;
      const reason = data.reason ?? {};
      const isError = reason?.kind === 'error';
      if (isError) {
        const message = trim(reason?.error?.message || '运行中断', 90);
        if (!mark(`e:${sessionId}:${data.turn ?? started.turn}`)) return;
        send({
          kind: 'error',
          title: '运行出错',
          body: title ? `「${title}」${message}` : message,
          tag: `error:${sessionId}:${data.turn ?? started.turn}`,
          sessionId,
        });
        return;
      }
      if (elapsed < DONE_MIN_MS && started.calls < DONE_MIN_TOOLS) return;
      if (!mark(`d:${sessionId}:${data.turn ?? started.turn}`)) return;
      send({
        kind: 'done',
        title: '任务完成',
        body: title
          ? `「${title}」用时 ${durationText(elapsed)}，调用 ${started.calls} 个工具`
          : `用时 ${durationText(elapsed)}，调用 ${started.calls} 个工具`,
        tag: `done:${sessionId}:${data.turn ?? started.turn}`,
        sessionId,
      });
    }
  };

  const disposers = [];
  if (typeof ctx.on === 'function') {
    disposers.push(ctx.on('session/event', onSessionEvent));
  }
  return () => {
    for (const dispose of disposers) {
      try {
        dispose?.();
      } catch {
        /* ignore */
      }
    }
  };
}

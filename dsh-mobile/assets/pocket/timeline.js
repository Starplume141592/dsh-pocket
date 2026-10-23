/* Pure session event -> UI timeline projection.
 * The same projection runs for a snapshot and for live frames.
 */

const MAX_TOOL_OUTPUT = 6000;
const MAX_REASONING = 4000;

function textOf(blocks) {
  if (!Array.isArray(blocks)) return '';
  const parts = [];
  let media = false;
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'image') { media = true; continue; }
    if (block.type === 'file') { media = true; continue; }
    if (block.type !== 'text') continue;
    const text = block.text || '';
    if (/<type>image<\/type>/.test(text) || /<type>file<\/type>/.test(text)) { media = true; continue; }
    if (text.trim()) parts.push(text);
  }
  return ((media ? '[图片 / 文件]\n\n' : '') + parts.join('\n\n')).trim();
}

function parseArgs(args) {
  if (typeof args !== 'string') return args && typeof args === 'object' ? args : {};
  try { return JSON.parse(args); } catch { return {}; }
}

export function describeTool(name, args) {
  const parsed = parseArgs(args);
  if (typeof parsed.description === 'string' && parsed.description.trim()) return parsed.description.trim().slice(0, 120);
  if (typeof parsed.command === 'string' && parsed.command.trim()) return parsed.command.trim().split(/\r?\n/)[0].slice(0, 120);
  if (typeof parsed.code === 'string' && parsed.code.trim()) {
    const line = parsed.code.trim().split(/\r?\n/)[0];
    return line.replace(/^\/\/\s*/, '').slice(0, 120);
  }
  if (typeof parsed.path === 'string') return parsed.path.slice(0, 120);
  if (typeof parsed.query === 'string') return parsed.query.slice(0, 120);
  return name || '工具调用';
}

export function toolOutputText(data) {
  const msg = data?.message;
  const blocks = msg?.content;
  let text = textOf(blocks);
  if (!text && data?.error) text = data.error.reason || data.error.message || data.error.code || '工具执行失败';
  if (text.length > MAX_TOOL_OUTPUT) text = text.slice(0, MAX_TOOL_OUTPUT) + '\n…（输出已截断）';
  return text;
}

export class Timeline {
  constructor(options = {}) {
    this.items = [];
    this.tools = new Map();
    this.approvals = new Map();
    this.seen = new Set();
    this.lastSeq = -1;
    this.firstSeq = -1;
    this.cursor = -1;
    this.running = false;
    this.title = options.title || '';
    this.gap = false;
    this.turn = 0;
    this.step = 0;
    this.onChange = options.onChange || null;
  }

  notify() {
    if (this.onChange) this.onChange(this);
  }

  reset(records, cursor, options = {}) {
    this.items = [];
    this.tools.clear();
    this.approvals.clear();
    this.seen.clear();
    this.lastSeq = -1;
    this.firstSeq = -1;
    this.cursor = Number.isFinite(cursor) ? cursor : -1;
    this.gap = false;
    this.running = options.running === true;
    this.title = options.title || this.title;
    for (const record of records || []) this.apply(record?.event ?? record, { snapshot: true });
    this.lastSeq = Math.max(this.lastSeq, this.cursor);
    this.notify();
  }

  /** Merge an older page of records in front of the current timeline.
   * Keeps lastSeq/running/title untouched; ignores overlaps and already-seen seq.
   * Returns the number of newly accepted events.
   */
  prepend(records) {
    const cutoff = this.firstSeq;
    const batch = (records || [])
      .map((record) => record?.event ?? record)
      .filter((event) => event && typeof event.seq === 'number' && !this.seen.has(event.seq))
      .filter((event) => cutoff < 0 || event.seq < cutoff)
      .sort((a, b) => a.seq - b.seq);
    if (!batch.length) return 0;

    const temp = new Timeline({ title: this.title });
    temp.reset(batch, batch[batch.length - 1].seq, { title: this.title });

    const existingTools = new Set(this.tools.keys());
    const existingApprovals = new Set(this.approvals.keys());
    const olderItems = temp.items.filter((item) => {
      if (item.kind === 'tool' && existingTools.has(item.id)) return false;
      if (item.kind === 'approval' && existingApprovals.has(item.key)) return false;
      return true;
    });

    this.items = olderItems.concat(this.items);
    for (const [callId, tool] of temp.tools) {
      if (!this.tools.has(callId)) this.tools.set(callId, tool);
    }
    for (const [id, approval] of temp.approvals) {
      if (!this.approvals.has(id)) this.approvals.set(id, approval);
    }
    for (const seq of temp.seen) this.seen.add(seq);
    this.firstSeq = batch[0].seq;
    this.notify();
    return batch.length;
  }

  apply(event, options = {}) {
    if (!event || typeof event.seq !== 'number') return false;
    if (this.seen.has(event.seq)) return false;
    if (!options.snapshot) {
      if (event.seq <= this.lastSeq) return false;
      if (this.lastSeq >= 0 && event.seq > this.lastSeq + 1) {
        this.gap = true;
        this.notify();
        return false;
      }
    }
    this.seen.add(event.seq);
    if (event.seq > this.lastSeq) this.lastSeq = event.seq;
    if (this.firstSeq < 0 || event.seq < this.firstSeq) this.firstSeq = event.seq;
    const data = event.data || {};
    const time = event.time || Date.now();
    switch (event.type) {
      case 'user/message': {
        const sourceKind = data.source?.kind;
        if (sourceKind && !['user', 'user-rpc', 'ptc-mode'].includes(sourceKind)) break;
        const text = textOf(data.content);
        if (text) this.items.push({ kind: 'user', id: data.id || 'u' + event.seq, text, time, seq: event.seq });
        break;
      }
      case 'assistant/message': {
        const content = data.message?.content || [];
        const reasoning = content.filter((b) => b?.type === 'reasoning').map((b) => b.text || '').join('\n').trim();
        const text = textOf(content.filter((b) => b?.type === 'text'));
        if (text) {
          this.items.push({
            kind: 'assistant',
            id: data.message?.id || 'a' + event.seq,
            text,
            reasoning: reasoning ? reasoning.slice(0, MAX_REASONING) : '',
            time,
            seq: event.seq,
            step: data.step,
            turn: data.turn,
          });
        }
        for (const block of content) {
          if (block?.type !== 'tool-call') continue;
          const callId = block.id || 'call-' + event.seq + '-' + this.items.length;
          this.ensureTool(callId, block.name, block.arguments, time, event.seq);
        }
        break;
      }
      case 'tool/call': {
        this.ensureTool(data.callId || 'call-' + event.seq, data.name, data.arguments, time, event.seq);
        break;
      }
      case 'tool/result': {
        const callId = data.message?.toolCallId || data.callId;
        const tool = callId ? this.tools.get(callId) : null;
        const output = toolOutputText(data);
        const failed = data.message?.isError === true || Boolean(data.error);
        if (tool) {
          tool.output = output;
          tool.status = failed ? 'error' : 'done';
          tool.endedAt = time;
          if (data.error) tool.error = data.error.code || data.error.reason || 'error';
        } else if (callId) {
          const created = this.ensureTool(callId, '工具', '', time, event.seq);
          created.output = output;
          created.status = failed ? 'error' : 'done';
          created.endedAt = time;
        }
        break;
      }
      case 'approval/asked': {
        const id = data.id || 'approval-' + event.seq;
        const item = {
          kind: 'approval',
          id,
          key: id,
          tool: data.toolName || '工具',
          callId: data.callId || '',
          reason: data.reason || '',
          displayReason: data.displayReason || '',
          time,
          seq: event.seq,
          status: 'pending',
        };
        this.items.push(item);
        this.approvals.set(id, item);
        break;
      }
      case 'approval/decided': {
        const item = this.approvals.get(data.id);
        if (item) {
          item.status = data.outcome === 'allowed-once' ? 'allowed' : data.outcome === 'cancelled' ? 'cancelled' : 'rejected';
          item.outcome = data.outcome;
        }
        break;
      }
      case 'turn/start': {
        this.running = true;
        this.turn = data.turn || this.turn;
        break;
      }
      case 'step/start': {
        this.running = true;
        this.step = data.step || this.step;
        break;
      }
      case 'turn/end': {
        this.running = false;
        const reason = data.reason || {};
        if (reason.kind === 'error') {
          this.items.push({
            kind: 'notice',
            id: 'err' + event.seq,
            tone: 'error',
            text: reason.message || reason.code || '运行出错',
            time,
            seq: event.seq,
          });
        }
        break;
      }
      case 'session/title': {
        const title = data.title || data.text || data.value;
        if (typeof title === 'string' && title.trim()) this.title = title.trim();
        break;
      }
      case 'workspace/changes': {
        if (Array.isArray(data.changes) && data.changes.length) {
          this.items.push({
            kind: 'notice',
            id: 'ws' + event.seq,
            tone: 'info',
            text: '工作区有 ' + data.changes.length + ' 处变更',
            time,
            seq: event.seq,
          });
        }
        break;
      }
      default:
        break;
    }
    if (!options.snapshot) this.notify();
    return true;
  }

  ensureTool(callId, name, args, time, seq) {
    let tool = this.tools.get(callId);
    if (tool) {
      if (name && tool.name === '工具') tool.name = name;
      if (args && !tool.desc) tool.desc = describeTool(name, args);
      return tool;
    }
    tool = {
      kind: 'tool',
      id: callId,
      name: name || '工具',
      desc: describeTool(name, args),
      output: '',
      status: 'running',
      time,
      seq,
    };
    this.tools.set(callId, tool);
    this.items.push(tool);
    return tool;
  }

  pendingApprovals() {
    return this.items.filter((item) => item.kind === 'approval' && item.status === 'pending');
  }
}

export function formatRelative(ts, now = Date.now()) {
  if (!ts) return '';
  const diff = Math.max(0, now - ts);
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + ' 分钟前';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + ' 小时前';
  if (diff < 7 * 86_400_000) return Math.floor(diff / 86_400_000) + ' 天前';
  const d = new Date(ts);
  return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
}

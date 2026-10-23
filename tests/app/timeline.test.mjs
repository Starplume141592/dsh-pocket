import test from 'node:test';
import assert from 'node:assert/strict';
import { Timeline, describeTool, formatRelative } from '../../app/timeline.js';

function event(seq, type, data) {
  return { seq, type, time: 1000 + seq, data };
}

test('filters runtime context but keeps human messages', () => {
  const timeline = new Timeline();
  timeline.apply(event(0, 'user/message', { source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'injected' }] }));
  timeline.apply(event(1, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] }));
  assert.equal(timeline.items.length, 1);
  assert.equal(timeline.items[0].kind, 'user');
  assert.equal(timeline.items[0].text, 'hello');
});

test('assistant text and tool calls become a readable timeline', () => {
  const timeline = new Timeline();
  timeline.apply(event(0, 'assistant/message', {
    turn: 1,
    step: 1,
    message: {
      content: [
        { type: 'reasoning', text: 'thinking' },
        { type: 'text', text: 'working on it' },
        { type: 'tool-call', id: 'call-1', name: 'run_code', arguments: '{"description":"Build UI"}' },
      ],
    },
  }));
  assert.equal(timeline.items.length, 2);
  assert.equal(timeline.items[0].kind, 'assistant');
  assert.equal(timeline.items[0].text, 'working on it');
  assert.equal(timeline.items[0].reasoning, 'thinking');
  assert.equal(timeline.items[1].kind, 'tool');
  assert.equal(timeline.items[1].name, 'run_code');
  assert.equal(timeline.items[1].desc, 'Build UI');
  assert.equal(timeline.items[1].status, 'running');

  timeline.apply(event(1, 'tool/result', {
    message: { toolCallId: 'call-1', isError: false, content: [{ type: 'text', text: 'done' }] },
  }));
  assert.equal(timeline.tools.get('call-1').status, 'done');
  assert.equal(timeline.tools.get('call-1').output, 'done');
});

test('tool errors are surfaced', () => {
  const timeline = new Timeline();
  timeline.apply(event(0, 'tool/call', { callId: 'c1', name: 'pwsh', arguments: '{"command":"exit 1"}' }));
  timeline.apply(event(1, 'tool/result', {
    message: { toolCallId: 'c1', isError: true, content: [{ type: 'text', text: 'boom' }] },
    error: { code: 'exit-1', reason: 'failed' },
  }));
  assert.equal(timeline.tools.get('c1').status, 'error');
  assert.equal(timeline.tools.get('c1').output, 'boom');
  assert.equal(timeline.tools.get('c1').error, 'exit-1');
});

test('approval request and decision update the same card', () => {
  const timeline = new Timeline();
  timeline.apply(event(0, 'approval/asked', { id: 'a1', toolName: 'run_code', callId: 'c1', reason: 'need write' }));
  assert.equal(timeline.items.length, 1);
  assert.equal(timeline.items[0].kind, 'approval');
  assert.equal(timeline.items[0].status, 'pending');
  assert.equal(timeline.pendingApprovals().length, 1);
  timeline.apply(event(1, 'approval/decided', { id: 'a1', outcome: 'allowed-once' }));
  assert.equal(timeline.approvals.get('a1').status, 'allowed');
  assert.equal(timeline.pendingApprovals().length, 0);
});

test('duplicate seq is ignored and a gap is reported', () => {
  const timeline = new Timeline();
  timeline.reset([], 5);
  assert.equal(timeline.apply(event(6, 'turn/start', { turn: 1 })), true);
  assert.equal(timeline.apply(event(6, 'turn/start', { turn: 1 })), false);
  assert.equal(timeline.gap, false);
  assert.equal(timeline.apply(event(9, 'turn/start', { turn: 2 })), false);
  assert.equal(timeline.gap, true);
});

test('snapshot reset replaces state and advances lastSeq', () => {
  const timeline = new Timeline();
  timeline.reset([
    { type: 'event', event: event(2, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'old' }] }) },
    { type: 'event', event: event(3, 'session/title', { title: 'Session A' }) },
  ], 10, { title: 'Session A', running: true });
  assert.equal(timeline.items.length, 1);
  assert.equal(timeline.title, 'Session A');
  assert.equal(timeline.running, true);
  assert.equal(timeline.lastSeq, 10);
  assert.equal(timeline.apply(event(4, 'turn/start', { turn: 1 })), false);
});

test('describeTool prefers description and handles invalid json', () => {
  assert.equal(describeTool('run_code', '{"description":"Build the UI"}'), 'Build the UI');
  assert.equal(describeTool('pwsh', '{"command":"npm test"}'), 'npm test');
  assert.equal(describeTool('unknown', 'not-json'), 'unknown');
});

test('prepend merges older messages in front without moving lastSeq', () => {
  const timeline = new Timeline();
  timeline.reset([
    { type: 'event', event: event(10, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'newer' }] }) },
    { type: 'event', event: event(11, 'turn/start', { turn: 1 }) },
  ], 11, { running: true, title: 'Session A' });

  const added = timeline.prepend([
    { type: 'event', event: event(8, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'older' }] }) },
    { type: 'event', event: event(9, 'turn/end', { reason: { kind: 'done' } }) },
  ]);

  assert.equal(added, 2);
  assert.deepEqual(timeline.items.map((item) => item.text), ['older', 'newer']);
  assert.equal(timeline.firstSeq, 8);
  assert.equal(timeline.lastSeq, 11);
  assert.equal(timeline.running, true);
  assert.equal(timeline.title, 'Session A');
  assert.equal(timeline.gap, false);
});

test('prepend ignores overlaps and does not duplicate an existing tool card', () => {
  const timeline = new Timeline();
  timeline.reset([
    { type: 'event', event: event(10, 'tool/result', { message: { toolCallId: 'c1', isError: false, content: [{ type: 'text', text: 'done' }] } }) },
  ], 10);

  const added = timeline.prepend([
    { type: 'event', event: event(8, 'tool/call', { callId: 'c1', name: 'pwsh', arguments: '{"command":"ls"}' }) },
    { type: 'event', event: event(9, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'older' }] }) },
    { type: 'event', event: event(10, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'duplicate' }] }) },
  ]);

  assert.equal(added, 2);
  assert.equal(timeline.items.filter((item) => item.kind === 'tool').length, 1);
  assert.equal(timeline.items[0].text, 'older');
  assert.equal(timeline.items[1].kind, 'tool');
  assert.equal(timeline.firstSeq, 8);
  assert.equal(timeline.lastSeq, 10);
});

test('prepend keeps approval decisions from the older page', () => {
  const timeline = new Timeline();
  timeline.reset([
    { type: 'event', event: event(20, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'newer' }] }) },
  ], 20);

  timeline.prepend([
    { type: 'event', event: event(8, 'approval/asked', { id: 'a1', toolName: 'pwsh', callId: 'c1', reason: 'need write' }) },
    { type: 'event', event: event(9, 'approval/decided', { id: 'a1', outcome: 'allowed-once' }) },
  ]);

  assert.equal(timeline.items[0].kind, 'approval');
  assert.equal(timeline.items[0].status, 'allowed');
  assert.equal(timeline.approvals.get('a1').status, 'allowed');
});

test('formatRelative produces stable buckets', () => {
  const now = 10_000_000;
  assert.equal(formatRelative(now - 30_000, now), '刚刚');
  assert.equal(formatRelative(now - 120_000, now), '2 分钟前');
  assert.equal(formatRelative(now - 7_200_000, now), '2 小时前');
  assert.equal(formatRelative(now - 172_800_000, now), '2 天前');
});

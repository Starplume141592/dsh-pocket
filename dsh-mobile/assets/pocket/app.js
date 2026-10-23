/* Pocket — DSH 随行
 * 旗舰版 App UI + 真实 DSH Session API 接入。
 */
import { PocketApi, sessionSummary } from './api.js';
import { Timeline, formatRelative } from './timeline.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, cls = '') => '<svg class="icon ' + cls + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';

const api = new PocketApi();
let deferredInstallPrompt = null;
const live = {
  ready: false,
  demo: false,
  eventStream: null,
  eventsClientId: '',
  follow: null,
  currentSessionId: '',
  timeline: null,
  pending: new Map(),
  sessionList: [],
  reconnectTimer: null,
  reconnectAttempt: 0,
  renderQueued: false,
  lastPaint: 0,
  optimistic: [],
  stream: null,
};

const now = new Date();
const hm = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
const dateLabel = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });

const state = {
  route: { name: 'home' },
  theme: localStorage.getItem('pocket-theme') || 'dark',
  connected: true,
  sessions: [
    { id: 's1', title: '把 DSH 手机端做成旗舰 App', snippet: '正在重写同步层与 App UI', time: '2 分钟前', status: 'running', cwd: '~/projects/app', icon: 'spark' },
    { id: 's2', title: '继续完善手机端程序', snippet: 'PWA、通知、公网隧道已就绪', time: '昨天', status: 'done', cwd: '~/projects/app', icon: 'check' },
    { id: 's3', title: '移动端远程协作软件', snippet: '梳理 DSH 的会话 API 与事件流', time: '3 天前', status: 'done', cwd: '~/projects/app', icon: 'code' },
    { id: 's4', title: '给手机端加一个活动中心', snippet: '待审批与后台任务统一收口', time: '10 月 20 日', status: 'done', cwd: '~/projects/app', icon: 'bolt' },
  ],
  chat: {
    title: '把 DSH 手机端做成旗舰 App',
    status: 'running',
    messages: [
      { id: 'm1', role: 'user', time: '20:32', text: '先做一版 UI 看看。要像真正的 App，不要浏览器套壳的感觉，也不要加任何无关功能。' },
      { id: 'm2', role: 'assistant', time: '20:32', text: '明白。先把「连接 → 会话 → 审批」这条主路径做成原生手感，再谈别的。\n\n这一版会把手机端从「桌面 UI 缩小版」改成 **chat-first** 的独立界面：\n\n- 首页直接继续上次任务，不用先找会话\n- 工具调用折叠成可展开的卡片\n- 审批在消息流里就地完成\n- 断线后自动重连，回到同一位置' },
      { id: 'm3', role: 'tool', time: '20:33', name: 'run_code', desc: '生成 App UI 组件与设计令牌', status: 'done', output: 'wrote app/index.html\nwrote app/styles.css\nwrote app/app.js\n\n✓ 3 files, 42.1 KB' },
      { id: 'm4', role: 'assistant', time: '20:34', text: '首页和会话页已经出来了。接下来需要你确认一个关键取舍：**会话过程默认展开还是折叠？**\n\n我的建议是默认折叠，只显示当前步骤和最终回答；点开卡片再看完整工具输出。这样长任务不会把手机屏幕刷满。' },
      { id: 'm5', role: 'user', time: '20:35', text: '折叠。手机上信息密度低一点更好。' },
      { id: 'm6', role: 'assistant', time: '20:35', text: '好，折叠作为默认。现在我在把审批卡片接到真实的 approval/request 事件上。\n\n> 这一步会直接调用 DSH 的 $events 流，不再靠轮询。' },
      { id: 'm7', role: 'approval', time: '20:36', tool: 'run_code', reason: '需要写入 ~/projects/app\\app 以生成 App UI', key: 'ap1', answered: false },
    ],
  },
  activity: {
    pending: [
      { id: 'ap1', tool: 'run_code', title: '工具 run_code 请求越权执行', sub: '把 App UI 写入工作区', time: '刚刚', session: '把 DSH 手机端做成旗舰 App' },
      { id: 'ap2', tool: 'pwsh', title: '工具 pwsh 请求越权执行', sub: '启动本地预览服务', time: '6 分钟前', session: '把 DSH 手机端做成旗舰 App' },
    ],
    running: [
      { id: 'r1', title: '把 DSH 手机端做成旗舰 App', sub: '正在生成会话页 · 2 / 4 步', time: '2 分钟前' },
    ],
    done: [
      { id: 'd1', title: '继续完善手机端程序', sub: '已完成 · 用时 12 分钟', time: '昨天' },
      { id: 'd2', title: '移动端远程协作软件', sub: '已完成 · 用时 48 分钟', time: '3 天前' },
    ],
  },
  settings: {
    notify: true,
    haptics: true,
    theme: 'dark',
  },
};

/* ── 基础组件 ─────────────────────────────────────────────────── */
function mark(size = '') {
  return '<span class="mark ' + size + '">' + icon('spark') + '</span>';
}
function topbar(opts = {}) {
  return '<header class="topbar">' +
    '<div class="brand">' + mark() +
      '<div><div class="brand-name">Pocket</div><div class="brand-sub">DSH 随行</div></div>' +
    '</div>' +
    (opts.connection === false ? '' : '<button class="conn-pill ' + (state.connected ? '' : 'offline') + '" data-action="connection">' +
      '<span class="dot ' + (state.connected ? 'pulse' : 'amber') + '"></span>' + (state.connected ? '已连接' : '重连中') + '</button>') +
    '<button class="icon-btn" data-go="#/settings" aria-label="设置">' + icon('settings', 'sm') + '</button>' +
  '</header>';
}
function tabbar(active) {
  const tabs = [
    { id: 'home', label: '首页', icon: 'home', href: '#/home' },
    { id: 'chats', label: '会话', icon: 'chats', href: '#/sessions' },
    { id: 'activity', label: '活动', icon: 'activity', href: '#/activity' },
    { id: 'settings', label: '设置', icon: 'settings', href: '#/settings' },
  ];
  return '<nav class="tabbar">' + tabs.map((t, i) => {
    if (i === 2) {
      return '<div class="tab-fab"><button data-action="new-chat" aria-label="新建会话">' + icon('plus') + '</button></div>' +
        '<a class="tab ' + (active === t.id ? 'active' : '') + '" href="' + t.href + '">' + icon(t.icon) + '<span>' + t.label + '</span></a>';
    }
    return '<a class="tab ' + (active === t.id ? 'active' : '') + '" href="' + t.href + '">' + icon(t.icon) + '<span>' + t.label + '</span></a>';
  }).join('') + '</nav>';
}
function statusBadge(status) {
  if (status === 'running') return '<span class="badge run"><span class="dot pulse" style="width:5px;height:5px;box-shadow:none"></span>进行中</span>';
  if (status === 'waiting') return '<span class="badge wait">待审批</span>';
  if (status === 'error') return '<span class="badge err">失败</span>';
  return '<span class="badge done">已完成</span>';
}
function sessionItem(s) {
  return '<a class="session-item" href="#/chat/' + s.id + '">' +
    '<span class="session-avatar ' + s.status + '">' + icon(s.icon || 'chats', 'sm') + '</span>' +
    '<span class="session-main"><span class="session-title">' +
      '<span class="truncate">' + esc(s.title) + '</span>' +
    '</span><span class="session-snippet">' + esc(s.snippet) + '</span></span>' +
    '<span class="session-side">' +
      (s.status === 'running' ? statusBadge('running') : '<span class="session-time">' + esc(s.time) + '</span>') +
      (s.status === 'running' ? '<span class="session-time">' + esc(s.time) + '</span>' : '<span class="faint" style="font-size:15px">' + icon('chevron', 'sm') + '</span>') +
    '</span></a>';
}

/* ── 首页 ─────────────────────────────────────────────────────── */
function renderHome() {
  const running = state.sessions.find(s => s.status === 'running');
  return topbar() +
    '<section class="hero view-enter">' +
      '<p class="eyebrow">' + esc(dateLabel) + '</p>' +
      '<h1>晚上好。<br><span>今天想让 <span class="grad">DSH</span> 做什么？</span></h1>' +
      '<div class="composer-card">' +
        '<textarea id="home-input" rows="2" placeholder="描述你想构建的内容，或继续上次的任务…" aria-label="输入任务"></textarea>' +
        '<div class="composer-tools">' +
          '<button class="chip" data-action="attach">' + icon('paperclip') + '附件</button>' +
          '<button class="chip model" data-action="model">' + icon('spark') + 'DeepSeek V4.1</button>' +
          '<button class="send-btn" data-action="send-home" aria-label="发送">' + icon('send', 'fill') + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="quick-row">' +
        '<button class="chip" data-action="quick" data-text="继续上次的任务">' + icon('refresh') + '继续上次</button>' +
        '<button class="chip" data-action="quick" data-text="看看现在有什么待审批">' + icon('shield') + '待审批</button>' +
        '<button class="chip" data-action="new-chat">' + icon('plus') + '新会话</button>' +
      '</div>' +
    '</section>' +
    (running ? (() => {
      const stats = running.raw?.projections?.values?.sessionStats || {};
      const step = stats.steps ? '第 ' + stats.steps + ' 步' : '实时同步';
      return '<section class="running-card view-enter">' +
        '<div class="running-top"><span class="dot pulse"></span>正在运行</div>' +
        '<div class="running-title">' + esc(running.title) + '</div>' +
        '<div class="running-meta"><span>' + esc(running.snippet) + '</span><span class="faint">·</span><span>' + esc(step) + '</span></div>' +
        '<div class="running-foot"><div class="progress"><i></i></div><button class="btn-ghost" data-action="open-chat" data-id="' + running.id + '">查看</button></div>' +
      '</section>';
    })() : '') +
    '<section class="section">' +
      '<div class="section-head"><h2>最近会话<span class="count">' + state.sessions.length + '</span></h2><a class="text-btn" href="#/sessions">全部</a></div>' +
      '<div class="session-list">' + state.sessions.slice(0, 3).map(sessionItem).join('') + '</div>' +
    '</section>' +
    '<div style="height:24px"></div>' +
    tabbar('home');
}

/* ── 会话列表页 ───────────────────────────────────────────────── */
function renderSessions() {
  const groups = [
    { label: '今天', items: state.sessions.slice(0, 1) },
    { label: '更早', items: state.sessions.slice(1) },
  ];
  return topbar() +
    '<div class="page view-enter">' +
      '<div class="page-head"><h1>会话</h1><p>所有任务都在这里，按最近活动排序。</p></div>' +
      '<div style="margin-top:18px">' + groups.map(g =>
        '<div class="section-head" style="margin-top:18px"><h2 style="font-size:13px;color:var(--muted)">' + g.label + '<span class="count">' + g.items.length + '</span></h2></div>' +
        '<div class="session-list">' + g.items.map(sessionItem).join('') + '</div>'
      ).join('') + '</div>' +
      '<div style="height:18px"></div>' +
    '</div>' + tabbar('chats');
}

/* ── 会话页 ───────────────────────────────────────────────────── */
function renderMessage(m) {
  const role = m.role || m.kind;
  if (role === 'user') {
    const pending = m.pending ? '<span class="msg-state">发送中</span>' : m.failed ? '<span class="msg-state err">发送失败</span>' : '';
    return '<div class="msg user' + (m.failed ? ' failed' : '') + '"><div class="bubble">' + esc(m.text).replace(/\n/g, '<br>') + pending + '</div></div>';
  }
  if (role === 'assistant') {
    const reasoning = m.reasoning ? '<details class="reasoning"><summary>' + icon('spark', 'sm') + '思考过程</summary><div>' + esc(m.reasoning).replace(/\n/g, '<br>') + '</div></details>' : '';
    return '<div class="msg assistant"><div class="who">' + mark() + 'DSH<span style="margin-left:auto;font-weight:500">' + esc(m.time) + '</span></div>' +
      reasoning + '<div class="prose">' + prose(m.text) + (m.live ? '<span class="live-cursor"></span>' : '') + '</div></div>';
  }
  if (role === 'tool') {
    const state = m.status === 'running' ? 'run' : m.status === 'error' ? 'err' : '';
    const stateText = m.status === 'running' ? '运行中' : m.status === 'error' ? '失败' : '已完成';
    const stateIcon = m.status === 'running' ? '' : m.status === 'error' ? icon('x', 'sm') : icon('check', 'sm');
    const output = m.output ? '<details class="tool-fold"' + (m.status === 'error' ? ' open' : '') + '><summary>' + icon('code', 'sm') + '查看输出</summary><div class="tool-body">' + esc(m.output) + '</div></details>' : '';
    return '<div class="tool-card"><div class="tool-head"><span class="tool-ico">' + icon('tool') + '</span>' +
      '<div class="grow"><div class="tool-name">' + esc(m.name) + '</div><div class="tool-desc">' + esc(m.desc) + '</div></div>' +
      '<span class="tool-status ' + state + '">' + stateIcon + stateText + '</span></div>' +
      output + '<div class="tool-foot">' + esc(m.time) + '</div></div>';
  }
  if (role === 'approval') {
    const pending = m.status === 'pending';
    const title = pending ? '等待审批' : m.status === 'allowed' ? '已允许一次' : m.status === 'cancelled' ? '审批已取消' : '已拒绝';
    const cls = pending ? '' : m.status === 'allowed' ? ' done' : ' muted-card';
    return '<div class="approval-card' + cls + '" data-approval="' + esc(m.key) + '">' +
      '<div class="approval-strip"><span class="dot ' + (pending ? 'amber' : m.status === 'allowed' ? '' : 'red') + '"></span>' + title + '</div>' +
      '<div class="approval-body"><div class="approval-title">工具 <b>' + esc(m.tool) + '</b> 请求越权执行</div>' +
      '<div class="approval-reason">' + esc(m.reason) + '</div></div>' +
      (pending ? '<div class="approval-actions">' +
        '<button class="btn ghost grow-btn" data-action="reject" data-key="' + esc(m.key) + '">拒绝</button>' +
        '<button class="btn primary grow-btn" data-action="allow" data-key="' + esc(m.key) + '">允许一次</button>' +
      '</div>' : '') + '</div>';
  }
  if (role === 'notice') {
    return '<div class="notice ' + (m.tone === 'error' ? 'err' : '') + '">' + icon(m.tone === 'error' ? 'x' : 'spark', 'sm') + '<span>' + esc(m.text) + '</span></div>';
  }
  return '';
}
function prose(text) {
  let s = esc(text);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>');
  s = s.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  s = s.replace(/^- (.+)$/gm, '<li>$1</li>');
  s = s.replace(/(<li>.*<\/li>\n?)+/g, (m) => '<ul>' + m.replace(/\n/g, '') + '</ul>');
  s = s.split(/\n{2,}/).map(p => p.trim()).filter(Boolean).map(p => {
    if (/^<(h[23]|ul|ol|blockquote|pre)/.test(p)) return p;
    return '<p>' + p.replace(/\n/g, '<br>') + '</p>';
  }).join('');
  return s;
}
function renderChat(id) {
  const c = state.chat;
  const running = c.running !== false;
  const statusText = c.statusText || (running ? '正在运行' : '已同步');
  return '<div class="chat-view view-enter" data-session-id="' + esc(id) + '">' +
    '<header class="chat-header">' +
      '<a class="icon-btn" href="#/sessions" aria-label="返回">' + icon('back') + '</a>' +
      '<div class="chat-head-main"><h1 class="truncate">' + esc(c.title) + '</h1>' +
        '<p><span class="dot ' + (running ? 'pulse' : '') + '"></span>' + esc(statusText) + '</p></div>' +
      '<button class="icon-btn" data-action="chat-menu" aria-label="更多">' + icon('more') + '</button>' +
    '</header>' +
    '<div class="chat-scroll" id="chat-scroll"><div class="chat-inner">' +
      '<div class="day-divider">今天 ' + hm + '</div>' +
      c.messages.map(renderMessage).join('') +
      '<div class="msg assistant" id="typing-row" style="display:none"><div class="who">' + mark() + 'DSH<span style="margin-left:auto;font-weight:500">' + hm + '</span></div>' +
        '<div class="prose"><span class="typing"><i></i><i></i><i></i></span></div></div>' +
    '</div></div>' +
    '<button class="jump-btn" id="jump" data-action="jump">' + icon('arrow-down') + '回到最新</button>' +
    '<footer class="chat-composer">' +
      '<div class="composer-inner">' +
        '<textarea id="chat-input" rows="1" placeholder="继续对话，或输入 / 命令…" aria-label="消息"></textarea>' +
        '<button class="send-btn" data-action="send-chat" aria-label="发送">' + icon('send', 'fill') + '</button>' +
      '</div>' +
      '<div class="composer-sub">' +
        '<button class="chip" data-action="attach">' + icon('paperclip') + '</button>' +
        '<button class="chip" data-action="model">' + icon('spark') + 'DeepSeek V4.1</button>' +
        '<button class="chip" data-action="mode">' + icon('bolt') + '排队发送</button>' +
        '<span class="grow"></span>' +
        '<button class="chip" data-action="stop-chat">' + icon('stop') + '停止</button>' +
      '</div>' +
    '</footer>' +
  '</div>';
}

/* ── 活动页 ───────────────────────────────────────────────────── */
function renderActivity() {
  const a = state.activity;
  return topbar() +
    '<div class="page view-enter">' +
      '<div class="page-head"><h1>活动</h1><p>需要你决定的事，和正在后台跑的任务。</p></div>' +
      '<div class="segmented"><button class="active" data-action="seg" data-seg="pending">待处理 <span class="count">' + a.pending.length + '</span></button><button data-action="seg" data-seg="running">进行中</button><button data-action="seg" data-seg="done">已完成</button></div>' +
      '<div id="activity-body"><div class="activity-list">' + a.pending.map(x =>
        '<div class="activity-card"><div class="activity-top"><span class="setting-ico" style="width:28px;height:28px;border-radius:9px">' + icon('shield', 'sm') + '</span>' +
        '<span class="badge wait">待审批</span><span class="faint" style="font-size:11px;margin-left:auto">' + esc(x.time) + '</span></div>' +
        '<div class="activity-title">' + esc(x.title) + '</div><div class="activity-sub">' + esc(x.sub) + ' · ' + esc(x.session) + '</div>' +
        '<div class="activity-actions"><button class="btn ghost grow-btn" data-action="reject" data-key="' + x.id + '">拒绝</button><button class="btn primary grow-btn" data-action="allow" data-key="' + x.id + '">允许一次</button></div></div>'
      ).join('') + '</div>' +
      '<div class="empty" id="activity-empty" style="display:none"><div class="empty-ico">' + icon('check') + '</div><h3>都处理完了</h3><p>新的审批和任务会出现在这里。</p></div></div>' +
    '</div>' + tabbar('activity');
}

/* ── 设置页 ───────────────────────────────────────────────────── */
function renderSettings() {
  const s = state.settings;
  return topbar({ connection: false }) +
    '<div class="page view-enter">' +
      '<div class="page-head"><h1>设置</h1><p>连接、通知与外观。</p></div>' +
      '<div class="settings-group">' +
        '<div class="conn-card"><div class="row">' + mark() +
          '<div class="grow"><h3>我的电脑</h3><p>pocket.local · 已连接</p></div>' +
          '<span class="badge done">在线</span></div>' +
          '<div class="conn-stats">' +
            '<div class="conn-stat"><b>18 ms</b><span>延迟</span></div>' +
            '<div class="conn-stat"><b>1</b><span>设备</span></div>' +
            '<div class="conn-stat"><b>v0.3</b><span>版本</span></div>' +
          '</div></div>' +
      '</div>' +
      '<div class="settings-group"><p class="settings-label">偏好</p><div class="settings-card">' +
        '<div class="setting-row"><span class="setting-ico">' + icon('bell', 'sm') + '</span><div class="setting-main"><div class="setting-title">任务通知</div><div class="setting-sub">完成、失败与待审批</div></div><button class="switch ' + (s.notify ? 'on' : '') + '" data-action="toggle" data-key="notify" aria-label="任务通知"></button></div>' +
        '<div class="setting-row"><span class="setting-ico">' + icon('bell', 'sm') + '</span><div class="setting-main"><div class="setting-title">测试通知</div><div class="setting-sub">确认手机能收到系统通知</div></div><button class="text-btn" data-action="test-notify">发送</button></div>' +
        '<div class="setting-row"><span class="setting-ico">' + icon('bolt', 'sm') + '</span><div class="setting-main"><div class="setting-title">触感反馈</div><div class="setting-sub">发送、切换与审批时轻振</div></div><button class="switch ' + (s.haptics ? 'on' : '') + '" data-action="toggle" data-key="haptics" aria-label="触感反馈"></button></div>' +
        '<div class="setting-row"><span class="setting-ico">' + icon('spark', 'sm') + '</span><div class="setting-main"><div class="setting-title">外观</div><div class="setting-sub">深色 / 浅色 / 跟随系统</div></div><button class="text-btn" data-action="appearance">深色 ' + icon('chevron', 'sm') + '</button></div>' +
      '</div></div>' +
      '<div class="settings-group"><p class="settings-label">连接</p><div class="settings-card">' +
        '<div class="setting-row"><span class="setting-ico">' + icon('bolt', 'sm') + '</span><div class="setting-main"><div class="setting-title">服务器地址</div><div class="setting-sub">' + esc((() => { try { return localStorage.getItem('pocket-base') || location.host; } catch { return location.host; } })()) + '</div></div><button class="text-btn" data-action="server">更换</button></div>' +
        '<div class="setting-row"><span class="setting-ico">' + icon('refresh', 'sm') + '</span><div class="setting-main"><div class="setting-title">同步状态</div><div class="setting-sub">实时事件流 · 已同步</div></div><button class="text-btn" data-action="resync">重新同步</button></div>' +
        '<div class="setting-row"><span class="setting-ico">' + icon('shield', 'sm') + '</span><div class="setting-main"><div class="setting-title">设备与安全</div><div class="setting-sub">在电脑端管理已配对设备</div></div>' + icon('chevron', 'sm') + '</div>' +
      '</div></div>' +
      '<div class="settings-group"><p class="settings-label">关于</p><div class="settings-card">' +
        '<div class="setting-row"><span class="setting-ico">' + icon('chats', 'sm') + '</span><div class="setting-main"><div class="setting-title">Pocket</div><div class="setting-sub">DSH 随行 · 0.3.0 (build 1)</div></div></div>' +
        '<div class="setting-row"><span class="setting-ico">' + icon('plus', 'sm') + '</span><div class="setting-main"><div class="setting-title">安装到桌面</div><div class="setting-sub">' + (isStandalone() ? '已安装' : '全屏打开，像 App 一样') + '</div></div><button class="text-btn" data-action="install-app">' + (isStandalone() ? '已安装' : '安装') + '</button></div>' +
        '<div class="setting-row"><span class="setting-ico">' + icon('code', 'sm') + '</span><div class="setting-main"><div class="setting-title">开源与反馈</div><div class="setting-sub">GitHub · MIT License</div></div>' + icon('chevron', 'sm') + '</div>' +
      '</div></div>' +
      '<div class="about">把电脑上的 DSH 带到手机<br>会话、流式输出与审批保持同步</div>' +
    '</div>' + tabbar('settings');
}

/* ── 路由 ─────────────────────────────────────────────────────── */
function parseRoute() {
  const hash = location.hash || '#/home';
  if (hash.startsWith('#/chat/')) return { name: 'chat', id: hash.slice(7) };
  if (hash.startsWith('#/connect')) return { name: 'connect' };
  if (hash.startsWith('#/sessions')) return { name: 'sessions' };
  if (hash.startsWith('#/activity')) return { name: 'activity' };
  if (hash.startsWith('#/settings')) return { name: 'settings' };
  return { name: 'home' };
}
function render() {
  state.route = parseRoute();
  const app = $('#app');
  if (state.route.name === 'connect') {
    document.body.classList.remove('chat-mode');
    app.innerHTML = renderConnect();
    bindCommon();
    return;
  }
  if (state.route.name === 'chat') {
    const id = state.route.id;
    if (id.startsWith('session-')) {
      if (live.currentSessionId !== id) {
        openRealChat(id);
        return;
      }
      if (live.timeline) syncFromTimeline();
    } else if (live.currentSessionId) {
      closeFollow();
      live.currentSessionId = '';
      live.timeline = null;
      state.chat = JSON.parse(JSON.stringify(demoChatSnapshot));
    }
    app.innerHTML = renderChat(id);
    document.body.classList.add('chat-mode');
    requestAnimationFrame(() => {
      const sc = $('#chat-scroll');
      if (sc) sc.scrollTop = sc.scrollHeight;
      bindChat();
    });
  } else {
    document.body.classList.remove('chat-mode');
    let html = '';
    if (state.route.name === 'sessions') html = renderSessions();
    else if (state.route.name === 'activity') html = renderActivity();
    else if (state.route.name === 'settings') html = renderSettings();
    else html = renderHome();
    app.innerHTML = html;
    bindCommon();
  }
}

/* ── 首次连接 / 配对提示 ─────────────────────────────────────── */
function isNativeShell() {
  return (location.protocol === 'https:' && location.hostname === 'localhost') || location.protocol === 'capacitor:';
}
function normalizeBase(value) {
  let text = String(value || '').trim();
  if (!text) return '';
  if (!/^https?:\/\//i.test(text)) text = 'https://' + text;
  return text.replace(/\/+$/, '');
}
function renderConnect(error) {
  let saved = '';
  try { saved = localStorage.getItem('pocket-base') || ''; } catch { /* ignore */ }
  return '<div class="connect-view view-enter">' +
    '<div class="connect-hero">' + mark('lg') +
      '<p class="connect-eyebrow">POCKET · DSH 随行</p>' +
      '<h1>连接你的 <span class="grad">DSH</span></h1>' +
      '<p class="connect-sub">输入电脑上的公网地址。第一次使用需要在电脑端 DSH → 设置 → 连接手机里批准这台设备。</p>' +
    '</div>' +
    '<div class="connect-form">' +
      '<label class="field"><span>DSH 地址</span>' +
        '<input id="connect-url" type="url" inputmode="url" autocomplete="url" spellcheck="false" placeholder="https://laptop.xxx.ts.net" value="' + esc(saved) + '">' +
      '</label>' +
      (error ? '<div class="connect-error">' + icon('x', 'sm') + '<span>' + esc(error) + '</span></div>' : '') +
      '<button class="btn primary connect-submit" data-action="connect">' + icon('bolt', 'sm') + '连接</button>' +
      '<div class="connect-help"><span class="dot"></span>连接后，这台手机上的会话、审批与电脑端保持同步。</div>' +
    '</div>' +
    '<div class="connect-foot">' +
      '<button class="text-btn" data-action="demo">先看看界面</button>' +
      '<span class="faint">·</span>' +
      '<button class="text-btn" data-action="help">怎么找到地址？</button>' +
    '</div>' +
  '</div>';
}
function renderPairingNeeded() {
  return '<div class="connect-view view-enter">' +
    '<div class="connect-hero">' + mark('lg') +
      '<p class="connect-eyebrow">POCKET · DSH 随行</p>' +
      '<h1>还差一步</h1>' +
      '<p class="connect-sub">这台设备还没有和电脑配对。请在电脑上打开 DSH → 设置 → 连接手机，生成二维码或配对链接。</p>' +
    '</div>' +
    '<div class="connect-form">' +
      '<button class="btn primary connect-submit" data-action="retry">已配对，重新连接</button>' +
      '<button class="btn ghost connect-submit" data-action="desktop">打开完整桌面 UI</button>' +
      '<div class="connect-help"><span class="dot amber"></span>配对必须在电脑端批准，二维码 5 分钟内有效。</div>' +
    '</div>' +
    '<div class="connect-foot"><span class="faint">Pocket 不会接触 DSH 的启动令牌</span></div>' +
  '</div>';
}
async function submitConnect() {
  const input = $('#connect-url');
  const base = normalizeBase(input?.value || '');
  if (!base) { toast('请输入 DSH 地址'); return; }
  try { localStorage.setItem('pocket-base', base); } catch { /* ignore */ }
  toast('正在打开 ' + base + '…');
  location.replace(base + '/__dshapp/');
}

/* ── 真实 DSH 数据 ───────────────────────────────────────────── */
const demoChatSnapshot = JSON.parse(JSON.stringify(state.chat));

function relTime(ts) {
  return formatRelative(ts);
}
function snippetOf(item, running) {
  const values = item?.projections?.values || {};
  const outline = Array.isArray(values.turnOutline) ? values.turnOutline : [];
  const last = outline[outline.length - 1];
  let text = String(last?.prompt || last?.response || '').replace(/\s+/g, ' ').trim();
  if (!text) text = values.sessionListMetadata?.blank ? '空白会话' : running ? '运行中 · 点击查看最新进度' : '已结束';
  return text.slice(0, 90);
}
function mapSession(item) {
  const summary = sessionSummary(item);
  return {
    id: summary.id,
    title: summary.title,
    snippet: snippetOf(item, summary.running),
    time: relTime(summary.updatedAt),
    status: summary.running ? 'running' : 'done',
    cwd: summary.cwd,
    icon: summary.running ? 'spark' : summary.blank ? 'plus' : 'check',
    real: true,
    raw: item,
  };
}
function applySessionList(items) {
  live.sessionList = (items || []).map(sessionSummary);
  state.sessions = (items || []).map(mapSession);
  const running = state.sessions.filter((s) => s.status === 'running');
  state.activity.running = running.map((s) => ({
    id: s.id,
    title: s.title,
    sub: s.snippet,
    time: s.time,
  }));
  state.activity.done = state.sessions.filter((s) => s.status !== 'running').slice(0, 5).map((s) => ({
    id: s.id,
    title: s.title,
    sub: s.time + ' · 已完成',
    time: s.time,
  }));
}
async function refreshSessions() {
  const data = await api.listSessions();
  applySessionList(data?.items || []);
  live.ready = true;
  state.connected = true;
  if (state.route.name === 'chat') {
    const current = state.sessions.find((s) => s.id === live.currentSessionId);
    if (current && (!state.chat.title || state.chat.title === '会话')) {
      state.chat.title = current.title;
      state.chat.running = current.status === 'running';
      if (live.timeline) live.timeline.title = current.title;
      schedulePaint();
    }
    return;
  }
  render();
}
function loadSessionTitle(id) {
  api.rpc('session/projections', { request: { sessionId: id } }).then((value) => {
    const title = value?.values?.title;
    if (title && live.currentSessionId === id) {
      if (live.timeline) live.timeline.title = title;
      state.chat.title = title;
      schedulePaint();
    }
  }).catch(() => {});
}
let sessionRefreshTimer = null;
function scheduleSessionRefresh() {
  if (sessionRefreshTimer) return;
  sessionRefreshTimer = setTimeout(() => {
    sessionRefreshTimer = null;
    refreshSessions().catch(() => {});
  }, 400);
}

function schedulePaint() {
  if (live.renderQueued) return;
  live.renderQueued = true;
  requestAnimationFrame(() => {
    live.renderQueued = false;
    paintChat();
  });
}
function messageTime(ms) {
  try { return new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}
function itemToLegacy(item, index) {
  const time = messageTime(item.time);
  if (item.kind === 'user') return { role: 'user', id: item.id, text: item.text, time };
  if (item.kind === 'assistant') return { role: 'assistant', id: item.id, text: item.text, reasoning: item.reasoning, time };
  if (item.kind === 'tool') return { role: 'tool', id: item.id, name: item.name, desc: item.desc, status: item.status, output: item.output, time };
  if (item.kind === 'approval') return { role: 'approval', key: item.key, tool: item.tool, reason: item.reason, status: item.status, time };
  if (item.kind === 'notice') return { role: 'notice', tone: item.tone, text: item.text, time };
  return null;
}
function syncFromTimeline() {
  if (!live.timeline) return;
  const tl = live.timeline;
  state.chat.title = tl.title || state.chat.title;
  state.chat.running = tl.running;
  const toolCount = tl.items.filter((i) => i.kind === 'tool').length;
  const streaming = live.stream && live.stream.text.trim();
  state.chat.statusText = tl.running ? (streaming ? '正在生成…' : '正在运行' + (toolCount ? ' · ' + toolCount + ' 个工具' : '')) : '已同步';
  for (const opt of [...live.optimistic]) {
    if (tl.items.some((i) => i.kind === 'user' && i.text === opt.text)) {
      live.optimistic = live.optimistic.filter((x) => x !== opt);
    }
  }
  const items = tl.items.map(itemToLegacy).filter(Boolean);
  if (live.stream && live.stream.text.trim()) {
    items.push({ role: 'assistant', id: 'stream', text: live.stream.text, reasoning: '', time: hm, live: true });
  }
  state.chat.messages = items.concat(live.optimistic);
  schedulePaint();
}
function handleStreamFrame(frame) {
  if (!frame) return;
  try {
    if (localStorage.getItem('pocket-debug') === '1') console.debug('[pocket-stream]', frame.type, frame.chunk?.type || '', frame.chunk?.text || '');
  } catch { /* ignore */ }
  if (frame.type === 'start') {
    live.stream = { attemptId: frame.attemptId, turn: frame.turn, step: frame.step, text: '', reasoning: '', active: true };
    schedulePaint();
    return;
  }
  if (!live.stream) {
    if (frame.type !== 'chunk') return;
    live.stream = { attemptId: frame.attemptId || 'stream', turn: 0, step: 0, text: '', reasoning: '', active: true };
  }
  if (frame.attemptId && live.stream.attemptId && frame.attemptId !== live.stream.attemptId) {
    live.stream = { attemptId: frame.attemptId, turn: frame.turn || 0, step: frame.step || 0, text: '', reasoning: '', active: true };
  }
  if (frame.type === 'chunk') {
    const chunk = frame.chunk || {};
    if (chunk.type === 'text-delta' || chunk.type === 'text') {
      live.stream.text += chunk.text || '';
      syncFromTimeline();
    } else if (chunk.type === 'reasoning-delta') {
      live.stream.reasoning += chunk.text || '';
    } else if (chunk.type === 'block-start' && chunk.blockType === 'text') {
      live.stream.active = true;
      syncFromTimeline();
    }
    return;
  }
  if (frame.type === 'end') {
    live.stream.active = false;
  }
}
function paintChat() {
  if (state.route.name !== 'chat') return;
  const inner = $('.chat-inner');
  const sc = $('#chat-scroll');
  if (!inner) return;
  const head = $('.chat-head-main h1');
  if (head && state.chat.title) head.textContent = state.chat.title;
  const status = $('.chat-head-main p');
  if (status) {
    status.innerHTML = '<span class="dot ' + (state.chat.running ? 'pulse' : '') + '"></span>' + esc(state.chat.statusText || (state.chat.running ? '正在运行' : '已同步'));
  }
  const near = !sc || (sc.scrollHeight - sc.scrollTop - sc.clientHeight < 140);
  const streaming = live.stream && live.stream.text.trim();
  const typing = state.chat.running && !streaming
    ? '<div class="msg assistant"><div class="who">' + mark() + 'DSH<span style="margin-left:auto;font-weight:500">' + hm + '</span></div><div class="prose"><span class="typing"><i></i><i></i><i></i></span></div></div>'
    : '';
  const visible = state.chat.messages.slice(-14);
  inner.innerHTML = '<div class="day-divider">今天 ' + hm + '</div>' + visible.map(renderMessage).join('') + typing;
  if (near && sc) sc.scrollTop = sc.scrollHeight;
}
function closeFollow() {
  if (live.follow) {
    try { live.follow.close(); } catch { /* ignore */ }
  }
  live.follow = null;
}
function scheduleFollowReconnect() {
  if (live.currentSessionId !== state.route.id) return;
  if (live.reconnectTimer) return;
  state.chat.statusText = '连接中断，正在重连…';
  schedulePaint();
  const delay = Math.min(2000, 500 * Math.pow(2, live.reconnectAttempt++));
  live.reconnectTimer = setTimeout(() => {
    live.reconnectTimer = null;
    if (live.currentSessionId !== state.route.id) return;
    closeFollow();
    openRealChat(state.route.id);
  }, delay);
}
function openRealChat(id) {
  if (live.currentSessionId === id && live.follow) return;
  closeFollow();
  live.currentSessionId = id;
  live.reconnectAttempt = 0;
  if (live.reconnectTimer) { clearTimeout(live.reconnectTimer); live.reconnectTimer = null; }
  const summary = live.sessionList.find((s) => s.id === id);
  const listed = state.sessions.find((s) => s.id === id);
  state.chat = {
    title: summary?.title || listed?.title || '会话',
    running: listed?.status === 'running',
    statusText: '正在同步…',
    messages: [],
  };
  live.timeline = new Timeline({ onChange: syncFromTimeline });
  if (!summary) loadSessionTitle(id);
  live.follow = api.followSession(id, {
    onSnapshot: (value) => {
      live.reconnectAttempt = 0;
      live.stream = null;
      const title = value.projections?.values?.title || summary?.title || state.chat.title;
      live.timeline.title = title;
      live.timeline.reset(value.records || [], value.cursor, {
        running: state.chat.running,
        title,
      });
      state.chat.title = title;
      if (!value.projections?.values?.title) loadSessionTitle(id);
      syncFromTimeline();
    },
    onEvent: (event) => {
      if (event.type === 'assistant/message' || event.type === 'turn/end') live.stream = null;
      live.timeline.apply(event);
      if (event.type === 'session/title' && live.timeline.title) state.chat.title = live.timeline.title;
      if (event.type === 'turn/end') scheduleSessionRefresh();
    },
    onAssistantStream: (frame) => handleStreamFrame(frame),
    onError: () => scheduleFollowReconnect(),
    onClose: () => scheduleFollowReconnect(),
  });
  render();
}
function linkApprovals() {
  if (!live.timeline) return;
  const pending = [...live.pending.values()];
  for (const item of live.timeline.items) {
    if (item.kind !== 'approval' || item.status !== 'pending') continue;
    const match = pending.find((p) => (p.callId && p.callId === item.callId) || (!p.callId && p.tool === item.tool));
    if (match) item.eventId = match.eventId;
  }
}
async function answerApproval(key, outcome) {
  if (!live.ready) return false;
  const item = live.timeline?.items.find((i) => i.kind === 'approval' && i.key === key) || null;
  let pending = item?.eventId ? live.pending.get(item.eventId) : null;
  if (!pending && item?.callId) pending = [...live.pending.values()].find((p) => p.callId === item.callId) || null;
  if (!pending) pending = [...live.pending.values()].find((p) => p.tool === item?.tool) || null;
  if (!pending) {
    toast('审批已由电脑端处理，正在刷新');
    return true;
  }
  try {
    await api.answerEvent(live.eventsClientId || pending.clientId, pending.eventId, { kind: 'result', value: outcome });
    live.pending.delete(pending.eventId);
    state.activity.pending = state.activity.pending.filter((x) => x.eventId !== pending.eventId && x.id !== pending.eventId);
    if (item) {
      item.status = outcome === 'allowed-once' ? 'allowed' : 'rejected';
      item.outcome = outcome;
    }
    live.pending.forEach((p) => { /* keep */ });
    syncFromTimeline();
    if (state.route.name === 'activity' || state.route.name === 'home') render();
    haptic(14);
    toast(outcome === 'allowed-once' ? '已允许一次，任务继续' : '已拒绝，已通知 DSH');
    return true;
  } catch (error) {
    toast('审批失败：' + (error?.message || '未知错误'));
    return true;
  }
}
function openEventsStream() {
  if (live.eventStream) return;
  live.eventStream = api.openEvents({
    onReady: (value) => { live.eventsClientId = value.clientId; },
    onWaterfall: (value) => {
      if (value.event !== 'approval/request') return;
      const request = value.request || {};
      const eventId = value.eventId;
      const callId = request.callId || '';
      const tool = request.toolName || '工具';
      const reason = request.reason || request.displayReason || '等待你的决定';
      if (live.pending.has(eventId)) return;
      const pending = { eventId, clientId: live.eventsClientId, tool, reason, callId, at: Date.now() };
      live.pending.set(eventId, pending);
      const key = callId || eventId;
      if (!state.activity.pending.some((x) => x.id === key || x.eventId === eventId)) {
        state.activity.pending.unshift({
          id: key,
          key,
          eventId,
          tool,
          title: '工具 ' + tool + ' 请求越权执行',
          sub: reason,
          time: '刚刚',
          session: 'DSH 会话',
        });
      }
      linkApprovals();
      if (state.route.name === 'activity' || state.route.name === 'home') render();
      else if (state.route.name === 'chat') schedulePaint();
      haptic(16);
    },
    onEmit: (value) => {
      if (value.event && value.event.startsWith('api-session/')) scheduleSessionRefresh();
    },
    onCancel: (value) => {
      live.pending.delete(value.eventId);
      state.activity.pending = state.activity.pending.filter((x) => x.eventId !== value.eventId);
      if (state.route.name === 'activity') render();
    },
    onClose: () => {
      live.eventStream = null;
      if (live.ready) setTimeout(openEventsStream, 3000);
    },
    onError: () => { /* close handler reconnects */ },
  });
}
async function createNewChat() {
  if (!live.ready) { location.hash = '#/chat/s1'; return; }
  try {
    const created = await api.createSession({});
    await refreshSessions();
    location.hash = '#/chat/' + created.sessionId;
  } catch (error) {
    toast('新建会话失败：' + (error?.message || '未知错误'));
  }
}
async function reconnectNow() {
  state.connected = false;
  if (state.route.name === 'home') render();
  try {
    const health = await api.health();
    state.version = health.version || state.version;
    state.connected = true;
    await refreshSessions();
    openEventsStream();
    live.ready = true;
    if (live.currentSessionId) {
      closeFollow();
      openRealChat(live.currentSessionId);
    }
    toast('已重新连接');
  } catch (error) {
    state.connected = false;
    if (state.route.name === 'home') render();
    toast('连接失败：' + (error?.message || '未知错误'));
  }
}

async function bootstrap() {
  try {
    const health = await api.health();
    state.version = health.version || '';
    await refreshSessions();
    openEventsStream();
    live.ready = true;
    syncNotifyState().then(() => { if (state.route.name === 'settings') render(); }).catch(() => {});
    const view = state.route.name;
    if (view === 'home' || view === 'sessions' || view === 'activity') render();
  } catch (error) {
    live.demo = true;
    state.connected = false;
    console.warn('[Pocket] 未连接 DSH：', error?.message || error);
    if (isNativeShell()) {
      renderConnect(error?.message || '无法连接 DSH');
    } else if (location.port === '8788' || location.hostname === 'localhost') {
      if (state.route.name === 'home') render();
    } else {
      document.body.classList.remove('chat-mode');
      $('#app').innerHTML = renderPairingNeeded();
      bindCommon();
    }
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    state.connected = true;
    refreshSessions().catch(() => {});
    if (live.currentSessionId === state.route.id) scheduleFollowReconnect();
  });
  window.addEventListener('offline', () => {
    state.connected = false;
    if (state.route.name === 'home') render();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (live.ready) refreshSessions().catch(() => {});
    if (live.currentSessionId === state.route.id) scheduleFollowReconnect();
  });
  window.addEventListener('pageshow', () => {
    if (live.ready) refreshSessions().catch(() => {});
  });
}

/* ── 系统通知（Pocket 子路径 SW） ─────────────────────────────── */
let notifyBusy = false;
function pushSupported() {
  return Boolean(window.isSecureContext && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window);
}
function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}
async function loadPushConfig() {
  try {
    const res = await fetch('/__dshm/api/push/key', { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) return null;
    const config = await res.json();
    if (!config || config.ok !== true || config.enabled !== true || typeof config.publicKey !== 'string') return null;
    return config;
  } catch {
    return null;
  }
}
async function currentPushSubscription() {
  if (!pushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}
async function syncNotifyState() {
  if (!pushSupported()) { state.settings.notify = false; return; }
  if (Notification.permission !== 'granted') { state.settings.notify = false; return; }
  const subscription = await currentPushSubscription();
  state.settings.notify = Boolean(subscription);
}
async function subscribePush(config) {
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey),
    });
  }
  const res = await fetch('/__dshm/api/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(subscription.toJSON()),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok !== true) throw new Error(body.error || ('HTTP ' + res.status));
  return subscription;
}
async function unsubscribePush() {
  const subscription = await currentPushSubscription();
  if (!subscription) return;
  try {
    await fetch('/__dshm/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
  } catch { /* ignore */ }
  await subscription.unsubscribe().catch(() => {});
}
async function toggleNotify() {
  if (notifyBusy) return;
  notifyBusy = true;
  try {
    if (!pushSupported()) {
      toast('此浏览器不支持系统通知，请用 Chrome / Safari');
      state.settings.notify = false;
      render();
      return;
    }
    if (state.settings.notify) {
      await unsubscribePush();
      state.settings.notify = false;
      haptic();
      render();
      toast('已关闭任务通知');
      return;
    }
    const config = await loadPushConfig();
    if (!config) {
      toast('先在电脑端开启「手机通知」');
      return;
    }
    if (Notification.permission === 'denied') {
      toast('通知权限被浏览器拒绝，请在站点设置里允许');
      return;
    }
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission !== 'granted') {
      toast('没有通知权限');
      return;
    }
    await subscribePush(config);
    state.settings.notify = true;
    haptic();
    render();
    toast('通知已开启，完成任务会提醒你');
  } catch (error) {
    toast('通知开启失败：' + (error?.message || '未知错误'));
    state.settings.notify = false;
    render();
  } finally {
    notifyBusy = false;
  }
}
function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
}
async function installApp() {
  if (isStandalone()) { toast('Pocket 已经安装到桌面'); return; }
  if (!deferredInstallPrompt) {
    toast('打开浏览器菜单，选择「添加到主屏幕」');
    return;
  }
  const prompt = deferredInstallPrompt;
  deferredInstallPrompt = null;
  prompt.prompt();
  try {
    const choice = await prompt.userChoice;
    toast(choice?.outcome === 'accepted' ? '正在安装 Pocket…' : '已取消安装');
  } catch {
    toast('安装提示已失效，请用浏览器菜单安装');
  }
}
async function sendTestNotify() {
  if (!state.settings.notify) { toast('先开启任务通知'); return; }
  try {
    const res = await fetch('/__dshm/api/push/test', { method: 'POST', credentials: 'same-origin' });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok) toast('测试通知已发送');
    else toast('发送失败：' + (body.error || ('HTTP ' + res.status)));
  } catch (error) {
    toast('发送失败：' + (error?.message || '网络错误'));
  }
}

/* ── 交互 ─────────────────────────────────────────────────────── */
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 1900);
}
function haptic(ms = 8) {
  if (state.settings.haptics && navigator.vibrate) navigator.vibrate(ms);
}
function openSheet(title, sub, options) {
  const layer = $('#sheet');
  layer.hidden = false;
  layer.innerHTML = '<div class="sheet"><div class="sheet-handle"></div><h2>' + esc(title) + '</h2><div class="sheet-sub">' + esc(sub) + '</div>' +
    options.map(o => '<button class="sheet-option" data-sheet-action="' + o.action + '"><span class="setting-ico">' + icon(o.icon || 'chevron', 'sm') + '</span><span class="grow"><b>' + esc(o.title) + '</b><span>' + esc(o.sub || '') + '</span></span>' + icon('chevron', 'sm') + '</button>').join('') +
    '</div>';
  layer.onclick = (e) => {
    if (e.target === layer) closeSheet();
    const b = e.target.closest('[data-sheet-action]');
    if (b) { closeSheet(); handleSheet(b.dataset.sheetAction); }
  };
}
function closeSheet() { const layer = $('#sheet'); layer.hidden = true; layer.innerHTML = ''; }

function bindCommon() {
  document.documentElement.dataset.theme = state.theme;
}
function bindChat() {
  const input = $('#chat-input');
  const sc = $('#chat-scroll');
  if (input) {
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 132) + 'px';
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(); }
    });
  }
  if (sc) {
    sc.addEventListener('scroll', () => {
      const jump = $('#jump');
      if (!jump) return;
      const near = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 120;
      jump.classList.toggle('show', !near);
    }, { passive: true });
  }
  bindCommon();
}
function addChatMessage(m) {
  state.chat.messages.push(m);
  const inner = $('.chat-inner');
  if (!inner) return;
  const typing = $('#typing-row');
  const html = renderMessage(m);
  if (typing) typing.insertAdjacentHTML('beforebegin', html);
  else inner.insertAdjacentHTML('beforeend', html);
  const sc = $('#chat-scroll');
  if (sc) sc.scrollTop = sc.scrollHeight;
}
function sendChat() {
  const input = $('#chat-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  haptic();
  if (live.ready && live.currentSessionId && live.currentSessionId.startsWith('session-')) {
    const optimistic = { id: 'local-' + Date.now(), role: 'user', time: hm, text, pending: true };
    live.optimistic.push(optimistic);
    syncFromTimeline();
    api.prompt(live.currentSessionId, text, { mode: live.mode || 'queue' }).then(() => {
      optimistic.pending = false;
      syncFromTimeline();
    }).catch((error) => {
      optimistic.pending = false;
      optimistic.failed = true;
      syncFromTimeline();
      toast('发送失败：' + (error?.message || '未知错误'));
    });
    return;
  }
  addChatMessage({ id: 'u' + Date.now(), role: 'user', time: hm, text });
  const typing = $('#typing-row');
  if (typing) typing.style.display = '';
  const sc = $('#chat-scroll');
  if (sc) sc.scrollTop = sc.scrollHeight;
  setTimeout(() => {
    if (typing) typing.style.display = 'none';
    addChatMessage({ id: 'a' + Date.now(), role: 'assistant', time: hm, text: '这是演示数据。连接电脑上的 DSH 后，这里会显示真实回复。' });
    haptic(12);
  }, 900);
}
async function sendHome() {
  const input = $('#home-input');
  const text = input ? input.value.trim() : '';
  if (!text) { toast('说说你想做什么'); return; }
  haptic();
  if (!live.ready) {
    toast('演示模式：连接 DSH 后即可创建真实会话');
    setTimeout(() => { location.hash = '#/chat/s1'; }, 450);
    return;
  }
  try {
    toast('正在创建会话…');
    const created = await api.createSession({});
    await api.prompt(created.sessionId, text);
    await refreshSessions();
    location.hash = '#/chat/' + created.sessionId;
  } catch (error) {
    toast('创建失败：' + (error?.message || '未知错误'));
  }
}
function toggle(key) {
  if (key === 'notify') { toggleNotify(); return; }
  state.settings[key] = !state.settings[key];
  haptic();
  render();
  toast(state.settings[key] ? '已开启' : '已关闭');
}
function handleSheet(action) {
  if (action === 'theme-dark' || action === 'theme-light' || action === 'theme-system') {
    state.theme = action === 'theme-light' ? 'light' : 'dark';
    localStorage.setItem('pocket-theme', state.theme);
    document.documentElement.dataset.theme = state.theme;
    toast(action === 'theme-light' ? '已切换浅色' : '已切换深色');
  }
  if (action === 'about') toast('Pocket 0.3.0 · MIT');
}
function onAction(action, el) {
  if (action === 'connect') return submitConnect();
  if (action === 'demo') { live.demo = true; state.connected = false; location.hash = '#/home'; render(); return; }
  if (action === 'retry') return reconnectNow();
  if (action === 'desktop') { location.href = '/'; return; }
  if (action === 'help') {
    openSheet('怎么找到地址', '在电脑上打开 DSH → 设置 → 连接手机，复制「公网地址」或 Tailscale Funnel 地址。', [
      { action: 'about', icon: 'shield', title: '需要先配对', sub: '地址填对后，手机仍要经过电脑批准' },
      { action: 'about', icon: 'bolt', title: '必须 HTTPS', sub: '局域网 HTTP 只建议在可信网络使用' },
    ]);
    return;
  }
  if (action === 'server') { location.hash = '#/connect'; return; }
  if (action === 'send-home') return sendHome();
  if (action === 'send-chat') return sendChat();
  if (action === 'quick') {
    const input = $('#home-input');
    if (input) { input.value = el.dataset.text || ''; input.focus(); }
    return;
  }
  if (action === 'new-chat') {
    haptic();
    createNewChat();
    return;
  }
  if (action === 'open-chat') {
    haptic();
    location.hash = '#/chat/' + el.dataset.id;
    return;
  }
  if (action === 'allow' || action === 'reject') {
    const key = el.dataset.key;
    const outcome = action === 'allow' ? 'allowed-once' : 'rejected';
    const real = live.ready && (live.pending.size > 0 || (live.timeline && live.timeline.items.some((i) => i.kind === 'approval' && i.key === key)));
    if (real) { answerApproval(key, outcome); return; }
    state.chat.messages.forEach(m => { if (m.role === 'approval' && m.key === key) m.answered = true; });
    state.activity.pending = state.activity.pending.filter(x => x.id !== key);
    haptic(14);
    toast(action === 'allow' ? '已允许一次，任务继续' : '已拒绝，已通知 DSH');
    render();
    return;
  }
  if (action === 'toggle') return toggle(el.dataset.key);
  if (action === 'test-notify') return sendTestNotify();
  if (action === 'install-app') return installApp();
  if (action === 'appearance') {
    openSheet('外观', '选择 Pocket 的显示方式', [
      { action: 'theme-dark', icon: 'spark', title: '深色', sub: '当前' },
      { action: 'theme-light', icon: 'spark', title: '浅色', sub: '明亮环境' },
      { action: 'theme-system', icon: 'spark', title: '跟随系统', sub: '自动切换' },
    ]);
    return;
  }
  if (action === 'connection') {
    reconnectNow();
    return;
  }
  if (action === 'resync') {
    reconnectNow();
    return;
  }
  if (action === 'stop-chat') {
    if (live.ready && live.currentSessionId) {
      haptic(14);
      api.cancelSession(live.currentSessionId).then(() => toast('已请求停止')).catch((error) => toast('停止失败：' + (error?.message || '未知错误')));
    } else {
      toast('演示模式：连接 DSH 后可停止任务');
    }
    return;
  }
  if (action === 'mode') {
    live.mode = live.mode === 'steer' ? 'queue' : 'steer';
    toast(live.mode === 'steer' ? '下一条将作为引导发送' : '下一条将排队发送');
    return;
  }
  if (action === 'model' || action === 'attach') {
    toast(action === 'model' ? '模型选择将在 v0.4 接入' : '附件上传将在 v0.4 接入');
    return;
  }
  if (action === 'jump') {
    const sc = $('#chat-scroll'); if (sc) sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
    return;
  }
  if (action === 'chat-menu') {
    openSheet('会话', state.chat.title, [
      { action: 'about', icon: 'refresh', title: '重命名', sub: '给这个会话一个更好找的名字' },
      { action: 'about', icon: 'copy', title: '复制链接', sub: '在电脑上打开' },
      { action: 'about', icon: 'stop', title: '停止任务', sub: '保留已生成的输出' },
    ]);
    return;
  }
  if (action === 'seg') {
    $$('.segmented button').forEach(b => b.classList.toggle('active', b === el));
    const seg = el.dataset.seg;
    const body = $('#activity-body');
    if (!body) return;
    if (seg === 'pending') {
      body.innerHTML = '<div class="activity-list">' + state.activity.pending.map(x =>
        '<div class="activity-card"><div class="activity-top"><span class="setting-ico" style="width:28px;height:28px;border-radius:9px">' + icon('shield', 'sm') + '</span><span class="badge wait">待审批</span><span class="faint" style="font-size:11px;margin-left:auto">' + esc(x.time) + '</span></div><div class="activity-title">' + esc(x.title) + '</div><div class="activity-sub">' + esc(x.sub) + ' · ' + esc(x.session) + '</div><div class="activity-actions"><button class="btn ghost grow-btn" data-action="reject" data-key="' + x.id + '">拒绝</button><button class="btn primary grow-btn" data-action="allow" data-key="' + x.id + '">允许一次</button></div></div>'
      ).join('') + '</div>';
    } else if (seg === 'running') {
      body.innerHTML = '<div class="activity-list">' + state.activity.running.map(x =>
        '<div class="activity-card"><div class="activity-top"><span class="setting-ico" style="width:28px;height:28px;border-radius:9px;color:#aebcff;background:rgba(91,124,255,.1)">' + icon('spark', 'sm') + '</span><span class="badge run">进行中</span><span class="faint" style="font-size:11px;margin-left:auto">' + esc(x.time) + '</span></div><div class="activity-title">' + esc(x.title) + '</div><div class="activity-sub">' + esc(x.sub) + '</div><div class="progress" style="margin-top:13px"><i style="width:42%"></i></div></div>'
      ).join('') + '</div>';
    } else {
      body.innerHTML = '<div class="activity-list">' + state.activity.done.map(x =>
        '<div class="activity-card"><div class="activity-top"><span class="setting-ico" style="width:28px;height:28px;border-radius:9px;color:var(--green)">' + icon('check', 'sm') + '</span><span class="badge done">已完成</span><span class="faint" style="font-size:11px;margin-left:auto">' + esc(x.time) + '</span></div><div class="activity-title">' + esc(x.title) + '</div><div class="activity-sub">' + esc(x.sub) + '</div></div>'
      ).join('') + '</div>';
    }
  }
}

document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (go) { location.hash = go.dataset.go; return; }
  const el = e.target.closest('[data-action]');
  if (el) onAction(el.dataset.action, el);
});
window.addEventListener('hashchange', render);

/* 启动 */
document.documentElement.dataset.theme = state.theme;
render();
bootstrap();

if (localStorage.getItem('pocket-debug') === '1') {
  window.__pocket = { live, state, api };
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (state.route.name === 'settings') render();
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  toast('Pocket 已安装到桌面');
  if (state.route.name === 'settings') render();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => { /* http LAN 下可能失败 */ });
  });
}
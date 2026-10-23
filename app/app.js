/* Pocket — DSH 随行
 * 第一版：可直接预览的高保真 App UI，数据层随后接入 DSH Session API。
 */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, cls = '') => '<svg class="icon ' + cls + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';

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
  return '<span class="mark ' + size + '">' + icon('spark', 'fill') + '</span>';
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
    (running ? '<section class="running-card view-enter">' +
      '<div class="running-top"><span class="dot pulse"></span>正在运行</div>' +
      '<div class="running-title">' + esc(running.title) + '</div>' +
      '<div class="running-meta"><span>正在生成会话页</span><span class="faint">·</span><span>第 2 步 / 共 4 步</span></div>' +
      '<div class="running-foot"><div class="progress"><i></i></div><button class="btn-ghost" data-action="open-chat" data-id="' + running.id + '">查看</button></div>' +
    '</section>' : '') +
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
  if (m.role === 'user') {
    return '<div class="msg user"><div class="bubble">' + esc(m.text).replace(/\n/g, '<br>') + '</div></div>';
  }
  if (m.role === 'assistant') {
    return '<div class="msg assistant"><div class="who">' + mark() + 'DSH<span style="margin-left:auto;font-weight:500">' + esc(m.time) + '</span></div>' +
      '<div class="prose">' + prose(m.text) + '</div></div>';
  }
  if (m.role === 'tool') {
    return '<div class="tool-card"><div class="tool-head"><span class="tool-ico">' + icon('tool') + '</span>' +
      '<div class="grow"><div class="tool-name">' + esc(m.name) + '</div><div class="tool-desc">' + esc(m.desc) + '</div></div>' +
      '<span class="tool-status ' + (m.status === 'running' ? 'run' : '') + '">' + (m.status === 'running' ? '运行中' : icon('check', 'sm')) + (m.status === 'running' ? '' : '已完成') + '</span></div>' +
      (m.output ? '<div class="tool-body">' + esc(m.output) + '</div>' : '') +
      '<div class="tool-foot">' + icon('code', 'sm') + '点击展开完整输出<span style="margin-left:auto">' + esc(m.time) + '</span></div></div>';
  }
  if (m.role === 'approval') {
    return '<div class="approval-card" data-approval="' + m.key + '">' +
      '<div class="approval-strip"><span class="dot amber"></span>等待审批</div>' +
      '<div class="approval-body"><div class="approval-title">工具 <b>' + esc(m.tool) + '</b> 请求越权执行</div>' +
      '<div class="approval-reason">' + esc(m.reason) + '</div></div>' +
      '<div class="approval-actions">' +
        '<button class="btn ghost grow-btn" data-action="reject" data-key="' + m.key + '">拒绝</button>' +
        '<button class="btn primary grow-btn" data-action="allow" data-key="' + m.key + '">允许一次</button>' +
      '</div></div>';
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
  return '<div class="chat-view view-enter">' +
    '<header class="chat-header">' +
      '<a class="icon-btn" href="#/sessions" aria-label="返回">' + icon('back') + '</a>' +
      '<div class="chat-head-main"><h1 class="truncate">' + esc(c.title) + '</h1>' +
        '<p><span class="dot pulse"></span>正在运行 · 2 个工具调用</p></div>' +
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
        '<div class="setting-row"><span class="setting-ico">' + icon('bolt', 'sm') + '</span><div class="setting-main"><div class="setting-title">触感反馈</div><div class="setting-sub">发送、切换与审批时轻振</div></div><button class="switch ' + (s.haptics ? 'on' : '') + '" data-action="toggle" data-key="haptics" aria-label="触感反馈"></button></div>' +
        '<div class="setting-row"><span class="setting-ico">' + icon('spark', 'sm') + '</span><div class="setting-main"><div class="setting-title">外观</div><div class="setting-sub">深色 / 浅色 / 跟随系统</div></div><button class="text-btn" data-action="appearance">深色 ' + icon('chevron', 'sm') + '</button></div>' +
      '</div></div>' +
      '<div class="settings-group"><p class="settings-label">连接</p><div class="settings-card">' +
        '<div class="setting-row"><span class="setting-ico">' + icon('refresh', 'sm') + '</span><div class="setting-main"><div class="setting-title">同步状态</div><div class="setting-sub">实时事件流 · 已同步</div></div><button class="text-btn" data-action="resync">重新同步</button></div>' +
        '<div class="setting-row"><span class="setting-ico">' + icon('shield', 'sm') + '</span><div class="setting-main"><div class="setting-title">设备与安全</div><div class="setting-sub">在电脑端管理已配对设备</div></div>' + icon('chevron', 'sm') + '</div>' +
      '</div></div>' +
      '<div class="settings-group"><p class="settings-label">关于</p><div class="settings-card">' +
        '<div class="setting-row"><span class="setting-ico">' + icon('chats', 'sm') + '</span><div class="setting-main"><div class="setting-title">Pocket</div><div class="setting-sub">DSH 随行 · 0.3.0 (build 1)</div></div></div>' +
        '<div class="setting-row"><span class="setting-ico">' + icon('code', 'sm') + '</span><div class="setting-main"><div class="setting-title">开源与反馈</div><div class="setting-sub">GitHub · MIT License</div></div>' + icon('chevron', 'sm') + '</div>' +
      '</div></div>' +
      '<div class="about">把电脑上的 DSH 带到手机<br>会话、流式输出与审批保持同步</div>' +
    '</div>' + tabbar('settings');
}

/* ── 路由 ─────────────────────────────────────────────────────── */
function parseRoute() {
  const hash = location.hash || '#/home';
  if (hash.startsWith('#/chat/')) return { name: 'chat', id: hash.slice(7) };
  if (hash.startsWith('#/sessions')) return { name: 'sessions' };
  if (hash.startsWith('#/activity')) return { name: 'activity' };
  if (hash.startsWith('#/settings')) return { name: 'settings' };
  return { name: 'home' };
}
function render() {
  state.route = parseRoute();
  const app = $('#app');
  if (state.route.name === 'chat') {
    app.innerHTML = renderChat(state.route.id);
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
  addChatMessage({ id: 'u' + Date.now(), role: 'user', time: hm, text });
  const typing = $('#typing-row');
  if (typing) typing.style.display = '';
  const sc = $('#chat-scroll');
  if (sc) sc.scrollTop = sc.scrollHeight;
  setTimeout(() => {
    if (typing) typing.style.display = 'none';
    addChatMessage({ id: 'a' + Date.now(), role: 'assistant', time: hm, text: '收到。这条消息已经进入同步队列；等真实 API 接上后，这里会直接显示 DSH 的流式输出。\n\n现在可以先继续打磨界面：你更在意 **首页的信息密度**，还是 **会话页的滚动手感**？' });
    haptic(12);
  }, 1100);
}
function sendHome() {
  const input = $('#home-input');
  const text = input ? input.value.trim() : '';
  toast(text ? '已创建新会话，正在进入…' : '说说你想做什么');
  haptic();
  setTimeout(() => { location.hash = '#/chat/s1'; }, 450);
}
function toggle(key) {
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
  if (action === 'send-home') return sendHome();
  if (action === 'send-chat') return sendChat();
  if (action === 'quick') {
    const input = $('#home-input');
    if (input) { input.value = el.dataset.text || ''; input.focus(); }
    return;
  }
  if (action === 'new-chat' || action === 'open-chat') {
    haptic();
    location.hash = action === 'open-chat' ? '#/chat/' + el.dataset.id : '#/chat/s1';
    return;
  }
  if (action === 'allow' || action === 'reject') {
    const key = el.dataset.key;
    state.chat.messages.forEach(m => { if (m.role === 'approval' && m.key === key) m.answered = true; });
    state.activity.pending = state.activity.pending.filter(x => x.id !== key);
    haptic(14);
    toast(action === 'allow' ? '已允许一次，任务继续' : '已拒绝，已通知 DSH');
    render();
    return;
  }
  if (action === 'toggle') return toggle(el.dataset.key);
  if (action === 'appearance') {
    openSheet('外观', '选择 Pocket 的显示方式', [
      { action: 'theme-dark', icon: 'spark', title: '深色', sub: '当前' },
      { action: 'theme-light', icon: 'spark', title: '浅色', sub: '明亮环境' },
      { action: 'theme-system', icon: 'spark', title: '跟随系统', sub: '自动切换' },
    ]);
    return;
  }
  if (action === 'connection') {
    state.connected = !state.connected;
    render();
    toast(state.connected ? '已重新连接' : '连接已断开，正在重试…');
    return;
  }
  if (action === 'resync') { toast('已重新同步 · 0 条遗漏'); return; }
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
# v0.4-dev 验证记录

> 时间：2026-10-23 23:10（Asia/Shanghai）
> 环境：DSH Electron（GUI 65534）、dsh-mobile 网关 8470、Pocket 预览 8788

## 1. 网关与协议

- 网关健康检查：200，version=0.2.0，upstream=http://127.0.0.1:65534
- session/list：返回 70+ 条真实会话，包含 title / running / projections
- session/follow：首帧 snapshot（cursor + records + projections），之后 event 帧
- session/page：`throughSeq` 为包含上界，`maxMessages` 控制消息数；旧页通过
  `throughSeq = firstSeq - 1` 取得，返回 `{ records, hasMore }`
- session/prompt：accepted=true
- session/create：返回新 sessionId
- session/cancel / session/rename：均返回 ok
- $events：ready 帧可建立；approval/request 与 $events/result 的协议已按 DSH 源码实现

## 2. UI 与同步

- 首页加载真实会话列表，进行中会话显示运行卡片
- 直接打开真实会话 URL 时，标题从 session/projections 补齐
- 会话消息流按 seq 合并；重复 seq 跳过；缺口触发重开 follow
- token 流式：第 3 秒采样到 live-cursor 与“正在生成…”，第 6 秒持久 assistant/message 落定
- 注入消息（runtime-context / skill-catalog / time-context）已过滤，只显示人类 user 消息
- 工具卡片按 callId 合并调用与结果，错误状态显示红色
- 默认只渲染最近 14 个条目，可点「加载更早」逐页展开（上限 200），避免 60+ 工具卡把手机拖慢
- 断线恢复：WebSocket close → 指数退避 → 新 snapshot 合并；页面可见/online 触发重新同步

## 3. 端到端

~~~text
新建会话 -> 输入“只回复 OK，不要调用任何工具。” -> 发送
=> HTTP 200 session/create
=> HTTP 200 session/prompt
=> session/follow 收到 user/message 与 assistant/message
=> 界面显示 user 气泡 + DSH “OK”，状态回到“已同步”
~~~

审批 E2E（同一会话）：

~~~text
=> 发送“用 pwsh 写到桌面 pocket-approval-test.txt，必须 danger-full-access”
=> $events 收到 approval/request（pending=1）
=> 会话流出现“等待审批”卡片（工具 pwsh）
=> 点击“允许一次” -> $events/result allowed-once
=> 工具完成，approval/decided 落定，状态回到“已同步”
=> 助手总结：写入 ok / 回读 ok / 删除后 exists_after=False
~~~

第二次发送较长任务：

~~~text
=> 3.0s: live-cursor 存在，status=正在生成…
=> 6.0s: assistant/message 落定，status=已同步
~~~

## 4. 系统通知

- 浏览器授权 notifications 后，设置页开关调用 /__dshm/api/push/subscribe，HTTP 200
- 生成 WNS endpoint（Windows 通知服务），网关订阅数 subscriptions=1
- 调用 /__dshm/api/push/test：ok=true, sent=1, failed=0
- Pocket SW 已实现 push / notificationclick：点击通知回到对应会话
- 注意：Android WebView 不保证支持 Web Push；原生通知需要 FCM 或通知桥

## 5. 测试

~~~text
node --test --test-isolation=none --test-force-exit \
  tests/gateway.test.mjs tests/plugin.test.mjs tests/net.test.mjs \
  tests/store.test.mjs tests/tunnel.test.mjs tests/notify.test.mjs \
  tests/tsnet.test.mjs tests/upstream-retry.test.mjs

tests 49 gateway + 31 app
pass 80
fail 0
~~~

App 传输/时间线/缓存/偏好测试覆盖：

- RPC envelope、错误结果、prompt 幂等 requestId、$events/result
- session/follow 的 mux open 帧与 snapshot/event/assistant-stream 路由
- session/page 的 address / throughSeq / beforeSeq 参数
- 注入消息过滤、assistant 文本 + 工具调用合并、tool/result 状态
- 审批 asked/decided、seq 去重、snapshot reset、gap 检测
- 旧页 prepend：顺序、firstSeq、lastSeq/running 不变、重叠去重、工具卡/审批不重复
- 离线缓存：会话/聊天往返、120 条截断、300 KB 字节上限、12 个会话 / 30 天清理、
  localStorage 配额淘汰、坏 JSON、待审批卡不落盘
- 偏好：默认值、非法值忽略、深拷贝、持久化与 reset

## 5.1 离线快照（22:25）

用 headless Edge + 真实网关跑完整链路：

~~~text
在线首页 -> 76 个真实会话，缓存 76 条
进入会话 -> snapshot 到达，缓存 24 条消息
阻断 /api/* + /__dshm/* + WebSocket -> 冷启动
  => 会话页：离线条幅、状态「离线快照 · 等待重连」、24 条缓存消息
  => 首页：离线条幅、重连中 pill、运行中的会话标「离线 / 上次同步时仍在运行」
点「重试」-> health + session/list + follow 恢复
  => 条幅消失、pill 已连接、状态回到「已同步」
~~~

安装副本验证：`GET /__dshapp/app.js|cache.js|sw.js` 均 200，内容与工作区一致；
`sw.js` 为 `pocket-shell-v5`。

## 5.2 加载更早 + 上游 401 重试（22:45）

~~~text
真实会话 firstSeq 2754，默认可见 14 条
点击「加载更早」-> session/page(throughSeq=2753, maxMessages=20)
  => firstSeq 2576，可见 34 条，toast「已加载更早的 18 条消息」
再点一次 -> firstSeq 2380，可见 54 条
  => 滚动位置保持在原阅读位置，无 pageerror
~~~

上游 cookie 过期：假内核先返回 401、token 端点下发新 cookie；
带 body 的 POST 会刷新 cookie 后重试一次并原样重放，`tests/upstream-retry.test.mjs` 通过。
安装副本 `/__dshapp/` 同样通过分页验证。

## 5.3 移动端总开关（23:10）

- `store.settings.mobile.enabled` 默认 true，旧 state.json 自动补齐。
- `/state` 返回 `mobile.enabled`；`/mobile/enable` 调控制器并回传新状态。
- 关闭：通知 dispose → tsnet.stop → tunnel.stop → gateway.stop；桌面 API 仍在，可再打开。
- 禁用时 `/pair/start` 返回 409，避免生成连不上的二维码。
- 测试：gateway 20（新增总开关 1）、store 6（新增开关迁移 1）。

## 5.4 自定义与离线翻页（23:10）

~~~text
设置 -> 自定义：主题色「海蓝」-> html[data-accent=blue]
紧凑模式 -> html[data-density=compact]
显示活动页 关 -> tabbar = 首页 / 会话 / 设置
每页消息数 -> 40
离线快照 开

在线会话缓存 75 条消息
断网冷启动：可见 14 条，按钮「加载更早（离线缓存）」
点两次：可见 14 -> 34 -> 54，toast「已显示更早的离线缓存」
~~~

`sw.js` 为 `pocket-shell-v6`；安装副本 `prefs.js` 返回 200。

网关新增覆盖：

- /__dshapp/ 外壳可访问（未配对也可打开）
- /__dshapp 重定向到 /__dshapp/
- manifest / app.js 的 content-type、cache-control、service-worker-allowed
- 原有配对、代理、HTML 注入、WS 升级、推送、隧道、吊销

## 6. 已知问题

- 审批 waterfall 已真机跑通（allowed-once）；尚未验证 rejected / cancelled 的界面回滚。
- 预览服务器需要浏览器已有设备 cookie；否则会回退演示数据。
- Capacitor Android 工程已生成，但本机没有 JDK / Android SDK，APK 还没打出来。
- Pocket 子路径 SW 已接推送；Android WebView 的 Web Push 不保证可用，需要 FCM 或原生通知桥。
- 默认只显示最近 14 条，可加载更早（一次 10/20/40 条，上限 200）；更细的分页锚点还没做。
- 离线快照用 localStorage，保留最近 120 条 / 300 KB / 12 个会话；离线翻页只在这个窗口内。
- 第三方扩展只有设计稿（`docs/product/PLUGINS.md`），扩展宿主还没实现。
- 拆分 core/pocket 两个插件包还没落地，当前仍是单个 `dsh-mobile`。

## 7. 复现

~~~powershell
# 1. 预览（代理到本机 8470）
node .\scripts\serve-app.mjs .\app 8788

# 2. 网关单测
cd dsh-mobile
node --test --test-isolation=none --test-force-exit tests/gateway.test.mjs tests/plugin.test.mjs tests/net.test.mjs tests/store.test.mjs tests/tunnel.test.mjs tests/notify.test.mjs tests/tsnet.test.mjs tests/upstream-retry.test.mjs

# 3. App 单测（传输 / 时间线 / 离线缓存 / 偏好）
cd ..\tests\app
node api.test.mjs
node timeline.test.mjs
node cache.test.mjs
node prefs.test.mjs

# 4. 构建插件内 App 资源
cd ..\..
node .\scripts\build-app.mjs .
~~~
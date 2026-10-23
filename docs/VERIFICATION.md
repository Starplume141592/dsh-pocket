# v0.4-dev 验证记录

> 时间：2026-10-23 21:17（Asia/Shanghai）
> 环境：DSH Electron（GUI 17063）、dsh-mobile 网关 8470、Pocket 预览 8788

## 1. 网关与协议

- 网关健康检查：200，version=0.2.0，upstream=http://127.0.0.1:17063
- session/list：返回 70+ 条真实会话，包含 title / running / projections
- session/follow：首帧 snapshot（cursor + records + projections），之后 event 帧
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
- 长会话只渲染最近 14 个条目，避免 60+ 工具卡把手机拖慢
- 断线恢复：WebSocket close → 指数退避 → 新 snapshot 合并；页面可见/online 触发重新同步

## 3. 端到端

~~~text
新建会话 -> 输入“只回复 OK，不要调用任何工具。” -> 发送
=> HTTP 200 session/create
=> HTTP 200 session/prompt
=> session/follow 收到 user/message 与 assistant/message
=> 界面显示 user 气泡 + DSH “OK”，状态回到“已同步”
~~~

第二次发送较长任务：

~~~text
=> 3.0s: live-cursor 存在，status=正在生成…
=> 6.0s: assistant/message 落定，status=已同步
~~~

## 4. 测试

~~~text
node --test --test-isolation=none --test-force-exit \
  tests/gateway.test.mjs tests/plugin.test.mjs tests/net.test.mjs \
  tests/store.test.mjs tests/tunnel.test.mjs tests/notify.test.mjs

tests 39 + 14 (app)
pass 53
fail 0
~~~

App 传输/时间线测试覆盖：

- RPC envelope、错误结果、prompt 幂等 requestId、$events/result
- session/follow 的 mux open 帧与 snapshot/event/assistant-stream 路由
- 注入消息过滤、assistant 文本 + 工具调用合并、tool/result 状态
- 审批 asked/decided、seq 去重、snapshot reset、gap 检测

网关新增覆盖：

- /__dshapp/ 外壳可访问（未配对也可打开）
- /__dshapp 重定向到 /__dshapp/
- manifest / app.js 的 content-type、cache-control、service-worker-allowed
- 原有配对、代理、HTML 注入、WS 升级、推送、隧道、吊销

## 5. 已知问题

- 审批 waterfall 还没有在真机上制造一次真实审批；协议与 UI 已实现，待联调。
- 预览服务器需要浏览器已有设备 cookie；否则会回退演示数据。
- 安卓原生壳尚未生成；当前是可安装 PWA。
- 通知仍由原有根路径 SW 负责，Pocket 子路径 SW 还没有接推送。
- 超长会话只显示最近 14 条，向上分页还没做。

## 6. 复现

~~~powershell
# 1. 预览（代理到本机 8470）
node .\scripts\serve-app.mjs .\app 8788

# 2. 网关单测
cd dsh-mobile
node --test --test-isolation=none --test-force-exit tests/gateway.test.mjs tests/plugin.test.mjs tests/net.test.mjs tests/store.test.mjs tests/tunnel.test.mjs tests/notify.test.mjs

# 3. 构建插件内 App 资源
node .\scripts\build-app.mjs .
~~~
# Pocket 同步模型

> 目标：手机端在切后台、隧道抖动、WebSocket 断开后，仍能回到正确状态，不丢消息、不重复、不假装成功。

## 1. 三条通道

| 通道 | 用途 | 是否可丢 |
|---|---|---|
| HTTP RPC /api/<method> | 列表、创建、发消息、停止、重命名 | 可重试，按 requestId 幂等 |
| WebSocket /api/remote.mux → session/follow | 会话快照 + 增量事件 | 不可丢；断线重开 |
| WebSocket /api/remote.mux → $events | 审批 waterfall + 状态通知 | 不可丢；断线重开 |

所有通道都使用设备 cookie 鉴权；App 不直接接触 DSH 的 launch token。

## 2. RPC 信封

请求：

~~~json
{
  "type": "client-request",
  "rpcId": "uuid-v4",
  "method": "session/list",
  "payload": { "args": { "_request": {} } }
}
~~~

响应：

~~~json
{
  "type": "server-response",
  "rpcId": "same-uuid",
  "result": { "ok": true, "value": { "items": [] } }
}
~~~

失败时 result.ok=false，error 含 code / message / details。
参数名必须与 descriptor 一致，例如 session/prompt 的参数名是 request。

## 3. 会话快照 + 增量

打开 follow：

~~~json
{
  "type": "open",
  "streamId": "uuid-v4",
  "endpoint": "session/follow",
  "payload": {
    "args": {
      "request": {
        "address": { "kind": "session", "sessionId": "session-..." },
        "assistantStream": true,
        "maxMessages": 80
      }
    }
  }
}
~~~

服务端先返回一帧 snapshot：

~~~json
{
  "type": "item",
  "streamId": "uuid-v4",
  "value": {
    "type": "snapshot",
    "header": { "id": "session-...", "cwd": "..." },
    "cursor": 885,
    "records": [ { "type": "event", "event": { "type": "assistant/message", "seq": 794, "data": {} } } ],
    "hasMore": true,
    "projections": { "asOfSeq": 885, "values": {} }
  }
}
~~~

之后是连续事件帧：

~~~json
{ "type": "item", "streamId": "...", "value": { "type": "event", "event": { "type": "user/message", "seq": 886, "data": {} } } }
~~~

规则：

- 只接受 seq 连续的事件；出现缺口立即重开 follow 拿新 snapshot。
- 重开时清空本地“实时尾部”，用新 snapshot 替换，再合并 seq 更大的事件。
- 事件按 seq 去重；同一 seq 以最新 snapshot 为准。
- 用户主动上滑后停止自动跟随；新消息只增加“未读”计数。

## 4. 审批 waterfall

打开 $events：

~~~json
{ "type": "open", "streamId": "events-1", "endpoint": "$events", "payload": { "args": {} } }
~~~

首帧：

~~~json
{ "type": "item", "streamId": "events-1", "value": { "type": "ready", "clientId": "...", "host": { "home": "..." } } }
~~~

审批请求：

~~~json
{
  "type": "item",
  "streamId": "events-1",
  "value": {
    "type": "waterfall",
    "event": "approval/request",
    "eventId": "...",
    "agentId": "...",
    "request": {
      "toolName": "run_code",
      "callId": "...",
      "reason": "...",
      "displayReason": "..."
    }
  }
}
~~~

回答：

~~~json
POST /api/$events/result
{
  "type": "client-request",
  "rpcId": "...",
  "method": "$events/result",
  "payload": {
    "args": {
      "clientId": "...",
      "eventId": "...",
      "outcome": { "kind": "result", "value": "allowed-once" }
    }
  }
}
~~~

outcome 取值：allowed-once / rejected / cancelled / unavailable。
选择“交给下一个应答者”时发送 { "kind": "next" }。

超时与撤销：

- 服务端取消时发送 { "type": "cancel", "eventId": "..." }，App 移除对应卡片。
- 审批卡片只允许回答一次；回答后立即置灰，失败则回滚并提示。
- 断线期间到达的审批无法补发；重连后以会话快照中的 approval/asked 与后续 decided 为准。

## 5. 生命周期恢复

触发恢复的事件：

- visibilitychange → visible
- pageshow（含 bfcache）
- online
- WebSocket close / error
- 用户下拉刷新或点“重新同步”

恢复流程：

1. 若隐藏超过 30 秒，先请求 /__dshm/health（2 秒超时）。
2. 健康检查失败 → 顶部“重连中”，指数退避 0.5 / 1 / 2 秒。
3. 健康检查成功 → 重开 session/follow + $events。
4. 新 snapshot 按 seq 合并；清理旧的临时流。
5. 3 次失败后显示“手动重连”，不无限转圈。

不做整页 reload 的情况：

- 只是 WebSocket 断开，HTTP 仍可用。
- 页面在后台被冻结但 JS 仍存活。

需要整页 reload 的情况：

- 前端 chunk 加载失败且无法恢复。
- 服务端会话格式升级，旧客户端无法解析。
- 连续 3 次恢复后仍出现 seq 缺口。

## 6. 本地缓存

- IndexedDB 存最近会话列表 + 每个会话最近 100 条事件 + 最后 seq。
- 只作为首屏骨架；进入会话后以网络 snapshot 为准。
- 缓存不存审批结果、不存工具完整输出（超过 8KB 的内容只存摘要）。
- 退出登录/吊销设备时清空缓存。

## 7. 发消息的乐观更新

1. 用户点击发送 → 立即插入本地气泡，状态 pending。
2. 生成 requestId（UUID），调用 session/prompt。
3. 成功 → 标记 accepted；等待 follow 中的 user/message 到达后按 requestId 合并。
4. 失败 → 气泡标红，提供重试；不自动重试有副作用的请求。
5. 网络超时但服务端可能已接受 → 重试用同一 requestId，服务端幂等。

## 8. 性能与背压

- 每条事件只做一次 DOM 更新；批量事件用 requestAnimationFrame 合并。
- 长会话只渲染最近 100 条；向上滚动分页加载。
- 工具输出折叠时只渲染头部；展开后超过 8KB 截断，提供“下载完整输出”。
- 流式 token 更新使用 textContent 追加，不重建整个 Markdown 树；每 80ms 节流一次。
- 页面不可见时暂停渲染，只保留事件队列。

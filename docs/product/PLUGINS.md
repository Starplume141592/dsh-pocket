# Pocket 插件化与扩展设计

> 状态：设计稿（2026-10-23）
> 目标：把「一个 dsh-mobile 插件」拆成可独立启停的核心、可自定义的 App、可扩展的第三方卡片。

## 1. 现在是什么样

```text
dsh-mobile（一个插件包）
├─ host 半：网关 8470、配对、设备、推送、隧道、tsnet、桌面 API
├─ client 半：DSH 设置页里的「连接手机」卡片
└─ assets/pocket：Pocket App（HTML/CSS/JS + SW），由网关静态托管
```

- Pocket 是独立 UI，只消费 `session/list`、`session/follow`、`session/page`、`$events`，不加载 DSH 桌面插件。
- 设置卡和网关在同一个插件里；关掉插件 = 网关和设置卡一起消失，无法从手机侧再打开。
- 没有第三方扩展点；所有卡片、Tab、设置项都是写死的。

## 2. 目标结构

```text
dsh-mobile-core        headless：网关、配对、设备、推送、隧道、策略
dsh-pocket             App：静态资源、PWA、离线缓存、偏好、版本
dsh-pocket-ext（可选）  扩展宿主：manifest、沙箱、RPC
```

### 2.1 为什么拆

- **可启停**：`dsh-mobile-core` 可以有运行时总开关；`dsh-pocket` 只负责 UI，不跟着网关一起死。
- **可替换**：想换一套 App 皮肤/交互，只换 `dsh-pocket`，不动安全网关。
- **可审计**：网关只暴露最小 RPC；App 与扩展不接触上游 launch token。
- **可发布**：`dsh-pocket` 可以单独发版，不必每次改网关。

### 2.2 兼容策略

- 保留 `dsh-mobile` 作为 meta 包：依赖 core + pocket，老用户升级路径不变。
- 新装用户可以直接装 `dsh-mobile-core` + `dsh-pocket`；设置卡由 core 提供，App 由 pocket 提供。
- `cordis.patch.yml` 从一条变成两条（core、pocket），都支持 `mobile.enabled` 总开关。

## 3. 第三方扩展协议（MVP）

### 3.1 扩展清单

`GET /__dshapp/extensions.json`：

```json
{
  "version": 1,
  "extensions": [
    {
      "id": "example.timer",
      "name": "任务计时",
      "version": "0.1.0",
      "entry": "/__dshapp/ext/example.timer/index.js",
      "slots": ["home.card", "chat.action"],
      "permissions": ["session:read", "toast"]
    }
  ]
}
```

- 扩展只从本机插件目录加载，不接远程 URL。
- `slots` 先支持四个：`home.card`、`chat.action`、`activity.item`、`settings.section`。
- `permissions` 是能力白名单；未声明的 API 调用直接拒绝。

### 3.2 沙箱与 RPC

- 每个扩展跑在 `<iframe sandbox="allow-scripts">` 里，**不给 same-origin**，拿不到 Pocket 的 DOM、cookie、localStorage。
- 宿主通过 `postMessage` 提供 RPC：

```text
ext -> host: { id, method: "session.summary", params: { sessionId } }
host -> ext: { id, ok: true, result: { title, running, updatedAt } }
```

- 首批 API：
  - `session.summary` / `session.messages`（只读、分页）
  - `ui.toast` / `ui.openSession`
  - `storage.get` / `storage.set`（按扩展 id 隔离）
- 明确不给：`session/prompt`、审批回答、网关设置、设备吊销——这些只允许 Pocket 本体调用。
- 审批类扩展以后单独设计，必须二次确认。

### 3.3 渲染边界

- 扩展只能渲染自己的 iframe 内容；宿主给固定高度和卡片外框，避免扩展撑破移动端布局。
- 主题通过 `postMessage` 下发 `{ theme, accent, density }`，扩展自己适配。
- 离线时扩展宿主不加载远程资源；`entry` 必须随插件一起安装。

## 4. 分阶段

| 阶段 | 内容 | 依赖 |
|---|---|---|
| v0.5（当前） | 运行时总开关、App 偏好（主题色/密度/活动页/分页/离线开关） | 无 |
| v0.6 | 拆 `dsh-mobile-core` + `dsh-pocket`，meta 包兼容 | 安装脚本、profile patch |
| v0.7 | 扩展宿主 MVP：manifest、iframe 沙箱、4 个 slot、只读 API | v0.6 |
| v1.0 | 扩展审核/权限确认、版本兼容、示例扩展 | v0.7 |

## 5. 风险

- **拆包迁移**：两个 profile（desktop / web-desktop）都要改 patch，安装脚本要能回滚。
- **扩展安全**：iframe 沙箱能挡住 DOM/cookie，但挡不住扩展把读到的会话内容发到网络；需要 CSP + 明确告知用户。
- **移动端性能**：多个 iframe 会吃内存；首版限制 3 个扩展、每个只挂一个 slot。
- **版本兼容**：`extensions.json` 带 `apiVersion`，宿主不兼容时直接不加载，不报错刷屏。

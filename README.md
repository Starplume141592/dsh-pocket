# Pocket · DSH 随行

把电脑上的 **DeepSeek Harness (DSH)** 带到手机：
看长任务进度、在消息流里直接批准工具、继续对话、收到系统通知。

> **Pocket 是 DSH 的伴生 App，不是另一个聊天机器人。**
> 它不重新实现 Agent，只消费 DSH 的 Session / 事件流 / 审批 API。

> 状态：**v0.3 — 高保真 UI 原型**。
> 真实 API 接入、离线恢复和 Android 打包正在进行。当前版本适合看设计与交互，不建议当作日常主力使用。

![首页](docs/assets/pocket-home.png)
![会话](docs/assets/pocket-chat.png)

<table>
<tr>
<td><img src="docs/assets/pocket-activity.png" alt="活动" width="280"></td>
<td><img src="docs/assets/pocket-settings.png" alt="设置" width="280"></td>
</tr>
</table>

## 为什么做 Pocket

原来的手机端是「桌面 Web UI + 窄屏 CSS」：能用，但不像 App，而且长任务时容易出现两个问题：

- **卡顿**：桌面布局、工具输出和滚动容器一起挤在手机上。
- **不同步**：切后台、隧道抖动或 WebSocket 断开后，页面还停在旧状态。

Pocket 的解法不是继续给桌面 UI 打补丁，而是：

1. **独立 App UI**：chat-first，首页直接继续任务，工具输出默认折叠。
2. **状态模型优先**：以 DSH 的 seq / 事件流为准，先渲染快照，再合并增量。
3. **恢复优先**：切后台、断网、隧道重连后自动重新 follow，不整页刷新。
4. **审批就地完成**：approval/request 直接出现在消息流和活动中心，一次点击结案。

## 当前能力（v0.3）

- 首页 / 会话 / 活动 / 设置四栏，底部 Tab + 新会话 FAB
- 会话页消息流：用户气泡、助手 Markdown、工具卡片、审批卡片
- 交互原型：发送、审批、主题切换、触感、Toast、底部弹层
- 深色 / 浅色主题、安全区、减少动效、键盘适配
- PWA manifest / Service Worker / 离线壳
- 响应式：390×844 参考尺寸，兼容更小与更宽屏幕

**还没接真实数据**：当前 app.js 使用 mock 数据。下一步直接对接 gateway 后面的 DSH API。

## 架构

~~~text
┌─────────────┐      HTTPS / WSS       ┌──────────────────┐
│  Pocket App │ ─────────────────────▶ │  dsh-mobile 网关  │
│  PWA/APK    │  device cookie         │  127.0.0.1:8470   │
└─────────────┘                        └────────┬─────────┘
                                                 │ 注入上游 cookie
                                                 ▼
                                        ┌──────────────────┐
                                        │  DSH Web Host    │
                                        │  Session / Event │
                                        └──────────────────┘
~~~

- **App**：静态 HTML/CSS/JS，无构建步骤；可直接作为 PWA，也可被 Capacitor 装进 Android。
- **Gateway**：现有 dsh-mobile 插件，负责配对、设备令牌、反向代理、推送和公网入口。
- **DSH Host**：会话与 Agent 的唯一事实源；Pocket 只读/写它的 HTTP RPC 与 WebSocket 事件流。

## 本地预览 UI

~~~powershell
# 终端 1：启动静态预览（默认 127.0.0.1:8788）
node .\scripts\serve-app.mjs .\app 8788
~~~

打开 <http://127.0.0.1:8788/>。这是纯前端 mock，不会连接 DSH。

## 安装到 DSH（现有网关）

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
# 然后完全退出并重新打开 DSH
powershell -ExecutionPolicy Bypass -File .\scripts\check.ps1
~~~

配对与公网入口见 [docs/remote-domain.md](docs/remote-domain.md)。
当前 App 仍是独立静态目录，gateway 接入会在 v0.4 完成。

## 开发

~~~powershell
# 网关单测
cd dsh-mobile
npm ci
npm test

# 真实实例联调（不影响正在用的 DSH）
$env:DSH_MOBILE_PORT = '8471'
powershell -ExecutionPolicy Bypass -File ..\scripts\dev-host.ps1
$env:DSH_GW = 'http://127.0.0.1:8471'
node .\tests\live-check.mjs
~~~

## 路线图

| 版本 | 内容 |
|---|---|
| v0.3 | 高保真 UI + 交互原型 + 设计系统（当前） |
| v0.4 | 接真实 session/list、session/follow、session/prompt、$events |
| v0.5 | 断线恢复、离线缓存、通知、审批闭环、活动中心 |
| v0.6 | Capacitor Android、启动图、原生通知、分享入口 |
| v1.0 | 引导页、多语言、可访问性、性能与安全审计、Release |

详见 [docs/product/APP_SPEC.md](docs/product/APP_SPEC.md) 与 [docs/product/SYNC.md](docs/product/SYNC.md)。

## 安全模型

- 手机只持有设备 cookie；不接触 DSH launch token / 上游签名 cookie。
- 公网必须 HTTPS；HTTP 仅限可信局域网。
- 审批结果只允许一次；不实现「永久允许」。
- 通知默认只显示工具名与会话标题，不推送完整命令或文件内容。
- 设备可在电脑端单独吊销，吊销后 WebSocket 立即断开。

## 许可与声明

MIT License。见 [LICENSE](LICENSE)。

Pocket 是社区项目，**不是 DeepSeek 官方产品**。
DSH（DeepSeek Harness）及其相关商标、代码归其所有者所有；本仓库不包含 DSH 的闭源实现。
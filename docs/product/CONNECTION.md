# 手机与 PC 的连接方式

> 状态：讨论稿。只讨论“手机怎么找到并连上 PC”，不改变 Session 事实源与审批归属。

## 1. 当前实现

~~~text
手机 App ──HTTPS/WSS──▶ dsh-mobile 网关（PC:8470）──HTTP/WS──▶ DSH Host
~~~

- 公网入口：Tailscale Funnel（固定 HTTPS）或 Cloudflare Tunnel
- 局域网：网关切到 0.0.0.0，手机访问 http://局域网IP:8470
- 配对：电脑生成一次性 token + 6 位码，手机扫码/打开链接，电脑批准
- 鉴权：设备 cookie（30 天），服务端只存 sha256
- App：PWA 在 /__dshapp/，Android 壳导航到同一个地址

问题：普通用户不愿意装 Tailscale、买域名、配 token。

## 2. 连接方式拆成四层

| 层 | 当前 | 可替换为 |
|---|---|---|
| 发现 | 用户手填 URL / 扫码 | mDNS、UDP 广播、二维码带 IP、账号设备列表 |
| 传输 | HTTPS + WSS 反向代理 | 局域网直连、WebRTC DataChannel、云 relay、USB |
| 鉴权 | 设备 cookie | 设备密钥、账号 token、一次性配对码 |
| 兜底 | 换隧道 / 重连 | LAN → 外网 → relay 自动切换 |

## 3. 候选方案

| 方案 | 外网可用 | 零配置 | 延迟 | 成本 | 隐私 | 工作量 |
|---|---|---|---|---|---|---|
| 局域网直连 + mDNS | 否 | 高 | 最低 | 0 | 最高 | 小 |
| Tailscale Funnel（当前） | 是 | 低 | 中 | 0 | 高 | 已完成 |
| Cloudflare Tunnel | 是 | 中 | 中 | 0 + 域名 | 中 | 已完成 |
| WebRTC P2P + TURN | 是 | 高 | 低-中 | TURN 流量 | 高（可 E2E） | 大 |
| 云 relay + 账号 | 是 | 最高 | 中 | 服务器 | 依赖服务端 | 大 |
| USB / ADB | 否 | 低 | 最低 | 0 | 最高 | 中 |

### 局域网直连 + mDNS
- PC 广播 mDNS 服务名 _dsh._tcp，App 自动列出同一 Wi-Fi 下的电脑。
- 扫码只用于第一次确认设备，之后自动连。
- 适合“在家/办公室”的主场景，不适合 4G。

### WebRTC P2P + TURN
- PC 和手机都主动连出，不需要公网 IP、域名、端口映射。
- 需要一个轻量 signaling 服务；NAT 失败时走 TURN。
- 可以把 Session API 封装成 DataChannel 上的请求/流，或只把 WebRTC 当隧道跑现有 HTTP/WS。
- 最接近“旗舰消费级”的远程方案，但 NAT/后台/移动网络切换要处理。

### 云 relay + 账号
- 两端都连 relay，按账号/房间号配对；PC 不需要开端口。
- 最容易做到“登录就能用”，但需要服务器、带宽与隐私承诺。
- 可以只中转加密后的字节，服务端看不到 Session 内容。

### USB / ADB
- 适合开发者和极端离线场景，不适合普通用户。

## 4. 建议的连接层抽象

无论选哪种，App 只依赖一个稳定接口：

~~~ts
interface PocketConnection {
  connect(): Promise<void>;
  close(): void;
  request(path, init): Promise<Response>;
  openStream(path): WebSocketLike;
  state: 'idle' | 'connecting' | 'online' | 'degraded' | 'offline';
}
~~~

实现可以是：

- DirectTransport：LAN/WAN 直连现有 HTTPS/WSS
- RelayTransport：WebRTC/云 relay 隧道
- UsbTransport：可选

Session 层（session/list、session/follow、prompt、$events）完全不动。
这样换连接方式不会重写 UI 和同步逻辑。

## 5. 需要先定的问题

1. 主场景是同一 Wi-Fi，还是必须 4G/5G 外网？
2. 是否接受一个小型云中转（成本、备案、隐私）？
3. 是否要求零配置：打开 App 自动发现电脑，不填 URL、不装 Tailscale？
4. PC 端是否允许常驻后台/开机自启？
5. 连接失败时的顺序：LAN → P2P → relay，还是只保留一种？
6. 配对是否还要“电脑批准”，还是账号登录即可？

## 6. 我的倾向（待讨论）

如果目标是“面向其他用户的旗舰 App”：

- **同网优先**：mDNS 自动发现 + 局域网直连，速度最好、零成本。
- **外网兜底**：WebRTC DataChannel，TURN 只在必要时使用；不要求域名和入站端口。
- **账号可选**：局域网不需要账号；外网 relay 才需要登录。
- **配对保留一次**：第一次扫码/6 位码确认设备，之后自动重连。
- **连接层可插拔**：Direct / WebRTC / Relay 共用同一套 Session API。

这样用户不需要理解 Tailscale、域名、端口，也不需要把电脑暴露成公网服务器。

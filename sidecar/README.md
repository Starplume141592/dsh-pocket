# tsnet-sidecar

把 Tailscale 节点和 Funnel 嵌进 dsh-mobile 插件的小程序。目标是让用户**只装 DSH 和 Pocket**：
不用装 Tailscale、不用管理员权限、不用改防火墙，也能有一个固定的 HTTPS 公网地址。

## 它做什么

```text
Pocket ──HTTPS/WSS──▶ https://pocket.<tailnet>.ts.net
                          │  Tailscale Funnel（Tailscale 边缘）
                   tsnet-sidecar.exe（用户态，无虚拟网卡）
                          │  X-Forwarded-Proto / X-Forwarded-For
                   dsh-mobile 网关 127.0.0.1:8470
```

- 用 [`tsnet`](https://pkg.go.dev/tailscale.com/tsnet) 在进程内跑一个 Tailscale 节点，不碰系统网络。
- `ListenFunnel("tcp", ":443")` 拿到公网 TLS 监听，反代到本机网关；WebSocket / SSE 由
  `httputil.ReverseProxy` 原生支持。
- 只监听 `127.0.0.1:8479` 的控制接口给插件轮询，不对外暴露。

## 编译

CI（推荐，不需要本机装 Go）：推送后跑 `sidecar` workflow，下载 `tsnet-sidecar-windows-amd64` 产物。

本机编译（PowerShell）：

```powershell
cd sidecar
go mod tidy
go build -trimpath -ldflags "-s -w" -o tsnet-sidecar.exe .
```

（要交叉编译 Linux 时再设 `$env:GOOS='linux'; $env:GOARCH='amd64'; $env:CGO_ENABLED='0'`。）

产物约 40–60 MB（Tailscale + gVisor 网络栈），和 cloudflared.exe 一个量级。

## 运行

```powershell
.\tsnet-sidecar.exe `
  -listen 127.0.0.1:8479 `
  -target http://127.0.0.1:8470 `
  -hostname pocket `
  -dir "$env:USERPROFILE\.dsh-mobile\tsnet" `
  -log "$env:USERPROFILE\.dsh-mobile\tsnet.log"
```

首次运行没有状态时，日志里会出现：

```text
[tsnet] To authenticate, visit: https://login.tailscale.com/a/xxxxxxxx
```

把这个链接给用户（或做成二维码），浏览器登录后节点入网。然后还需要在
<https://login.tailscale.com/f/funnel> 开启一次 HTTPS + Funnel（每个 tailnet 一次）。

之后启动复用 `-dir` 里的状态，不再需要登录。

## 状态接口

```http
GET http://127.0.0.1:8479/status
```

```json
{
  "ok": true,
  "phase": "serving",
  "hostname": "pocket",
  "authURL": "",
  "funnelURL": "https://pocket.taila66dc2.ts.net",
  "error": "",
  "startedAt": "2026-10-23T13:50:00Z",
  "pid": 12345
}
```

`phase`：`starting` → `connecting` → `need-login`（等用户登录）→ `serving`；失败为 `error`。

`GET /healthz` 返回 `ok`。

## 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `-listen` | `127.0.0.1:8479` | 控制接口地址 |
| `-target` | `http://127.0.0.1:8470` | 本机网关 |
| `-hostname` | `pocket` | tailnet 主机名，决定 `https://<hostname>.<tailnet>.ts.net` |
| `-dir` | 用户配置目录 `dsh-mobile/tsnet` | tsnet 状态目录 |
| `-authkey` | 空 | 可选；不填走交互登录 |
| `-funnel` | `:443` | tsnet 虚拟端口，不占本机 443 |
| `-log` | 空 | 日志文件 |

## 为什么不用系统版 Tailscale

- 系统版要管理员安装服务 + WinTun 虚拟网卡，会和游戏加速器（UU/迅游的 TAP 网卡）抢路由。
- tsnet 是用户态网络栈：不建网卡、不改路由、不改 DNS、不加防火墙规则，只做出站连接。
- Windows 官方目前仍不支持免管理员的 `tailscaled`（[issue #2791](https://github.com/tailscale/tailscale/issues/2791) 还开着），
  tsnet 是唯一干净的嵌入方式。

## 接入插件（下一步）

插件侧计划新增 `lib/tsnet.js`：拉起 sidecar、轮询 `/status`、把 `funnelURL` 写回
`publicUrl`、把 `authURL` 显示成二维码/按钮；设置卡加一个「内嵌 Funnel（免安装）」模式。

## 注意

- Funnel 是公网入口，安全仍靠设备配对 + cookie；不要把这个地址当私密链接。
- 每个跑 DSH 的用户需要一个自己的 Tailscale 账号（一次性，扫码登录）。
- Funnel 入口在境外，延迟不会比现在好；它解决的是「装什么」，不是「快不快」。

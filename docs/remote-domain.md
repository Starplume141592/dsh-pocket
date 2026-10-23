# 远程访问 DSH 手机端：公网入口方案

目标：手机在外面（4G/5G、公司 Wi-Fi）也能打开一个固定的 HTTPS 地址，连回家里这台电脑。
电脑不需要公网 IP，也不需要路由器端口映射。

## 先选路线

| 方案 | 成本 | 难度 | 适合 |
| --- | --- | --- | --- |
| **Tailscale Funnel（不买域名，当前方案）** | 0 | 低 | 家用宽带、不想买域名；固定 `*.ts.net` 地址 |
| **Cloudflare Tunnel + 自己的域名** | 域名年费（几十元）+ 免费 Cloudflare | 低 | 想要自己的品牌域名、长期稳定 |
| VPS + frp / Caddy | VPS 月费 + 域名 | 中 | 有服务器、想完全自控 |
| 纯局域网 | 0 | 最低 | 只在家里用；没有 HTTPS/PWA 安装 |
| **内嵌 Funnel（tsnet，免安装）** | 0 | 低 | 不想装 Tailscale / 没有管理员；每人一个 Tailscale 账号 |

下面先写当前在用的 Tailscale Funnel，再写 Cloudflare Tunnel；文末给 VPS 方案的要点。

---

## 方案 D：Tailscale Funnel（不买域名，固定地址）

原理：Tailscale 在电脑上跑一个系统服务，Funnel 把本机 `127.0.0.1:8470` 以
`https://<机器名>.<tailnet>.ts.net` 暴露到公网。TLS 由 Tailscale 自动处理，
地址固定，重启电脑/DSH 都不变。

### 1. 安装并登录

1. 下载安装 <https://tailscale.com/download/windows>。
2. 登录一个免费账号（Google/Microsoft/GitHub 均可）。
3. 安装完成后 Tailscale 作为 Windows 服务开机自启。

### 2. 启用 Funnel

1. 打开 <https://login.tailscale.com/f/funnel>，按提示 **Enable Funnel**。
2. 如果提示 **Enable HTTPS / HTTPS Certificates**，一起开启。
3. 管理员 PowerShell 执行：

   ```powershell
   & 'C:\Program Files\Tailscale\tailscale.exe' funnel --bg 8470
   & 'C:\Program Files\Tailscale\tailscale.exe' funnel status
   ```

   输出里的 `https://xxx.ts.net` 就是固定地址。
   也可以用封装脚本（需要管理员 PowerShell）：

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\tailscale-funnel.ps1
   powershell -ExecutionPolicy Bypass -File .\scripts\tailscale-funnel.ps1 -Status
   powershell -ExecutionPolicy Bypass -File .\scripts\tailscale-funnel.ps1 -Stop
   ```

### 3. 填进 DSH

DSH → 设置 → 连接手机：

- 「公网地址」填 `https://xxx.ts.net`
- 「公网隧道」保持「不用托管」（Funnel 独立运行，和 cloudflared 无关）
- 生成二维码 → 手机**主浏览器**（Safari/Chrome）打开 → 电脑批准

### 4. 注意

- Funnel 是**公网入口**，安全靠设备配对和 cookie；不用的设备在设置卡里吊销。
- 电脑需要保持开机、Tailscale 服务保持运行；Funnel 配置会保留。
- 国内连通性取决于 Tailscale 的 ingress；如果慢或不稳，Cloudflare + 自己的域名更稳。
- 手机用 **Via/WebView 类浏览器**可以正常浏览，但通常**收不到系统通知**；
  要通知请用 Chrome/Safari 重新配对一次。
- 配对链接必须用**主浏览器**打开，不要用扫码 App 的预览窗口（cookie 不共享，会一直转圈）。

---

## 方案 A：Cloudflare Tunnel + 自己的域名

原理：`cloudflared` 在电脑上**主动向外**建立隧道到 Cloudflare，Cloudflare 把
`https://dsh.example.com` 的请求送进 `127.0.0.1:8470`。没有入站端口，TLS 由 Cloudflare 终止。

### 0. 准备

- 一个域名（阿里云/腾讯云/Namecheap 等都可以，能改 NS 即可）。
- 一个 Cloudflare 账号（免费计划够用）。
- Windows 电脑上能运行 `cloudflared`。

#### 没有域名：先买一个（最省事的长期方案）

域名不是“建立”出来的，是向注册商**租**的，按年付费。买完把 NS 改到 Cloudflare，
就能给 DSH 用一个固定地址（例如 `dsh.你的域名.com`），以后重启电脑、重启 DSH 都不变。

| 在哪买 | 大概价格 | 实名/支付 | 备注 |
| --- | --- | --- | --- |
| 阿里云 / 腾讯云 | `.top` / `.xyz` 首年约 ¥10–30，续费 ¥30–80/年 | 国内实名认证；支付宝/微信 | 最方便，NS 可以改到 Cloudflare |
| Namecheap / Namesilo | 约 $5–12/年 | 不需要国内实名；Visa/Mastercard/PayPal | 不想实名时用这个 |
| Cloudflare Registrar | 成本价（约 $10/年） | 需要外币卡 | 域名直接托管在 Cloudflare，少一步改 NS |

不建议用“免费二级域名”（Freenom / afraid 之类）：大多数不能改 NS，Cloudflare 接不进去；
少数能改的也不稳定，折腾成本比买域名高。

买的时候注意：
- 不要买 `.cn`（NS 修改和实名限制多）。
- 域名随便起，长度不重要；后面用 `dsh.域名` 这样的子域名给 DSH。
- 买完在注册商后台把 **NS（名称服务器）** 改成 Cloudflare 给的两个地址，
  等 Cloudflare 显示 **Active** 再继续。

#### 实在不想买域名

- **Tailscale Funnel**：免费、固定 `https://机器名.你的tailnet.ts.net`，但要装 Tailscale、
  注册账号，国内连通性取决于网络；适合愿意折腾的人。
- **继续用临时隧道**：不用域名，但地址每次重启都变，手机要重新扫码配对。

### 1. 域名接入 Cloudflare

1. 打开 <https://dash.cloudflare.com> → Add a site → 输入域名 → 选 Free。
2. Cloudflare 给出一对 nameserver，去域名注册商后台把 NS 改成这两个。
3. 等生效（几分钟到几小时），Cloudflare 面板显示 Active。

### 2. 安装 cloudflared

任选一种：

```powershell
winget install --id Cloudflare.cloudflared -e
```

或从 <https://github.com/cloudflare/cloudflared/releases/latest> 下载
`cloudflared-windows-amd64.exe`，改名 `cloudflared.exe` 放进 `C:\Windows\System32`
或任意 PATH 目录。

验证：

```powershell
cloudflared --version
```

### 3. 登录并创建隧道

```powershell
cloudflared tunnel login
```

浏览器会打开 Cloudflare，选择你的域名并授权。然后：

```powershell
cloudflared tunnel create dsh-mobile
```

输出里有一行 `Created tunnel dsh-mobile with id <UUID>`，记下 UUID；
证书在 `%USERPROFILE%\.cloudflared\<UUID>.json`。

### 3B. 更省事：用 token 让插件托管（推荐）

不想自己写 `config.yml`、也不想让 cloudflared 常驻的话，用 token 模式：

1. 打开 <https://one.dash.cloudflare.com> → **Networks → Tunnels → Create a tunnel**，
   选 **Cloudflared**，起个名字。
2. 在隧道的 **Public Hostname** 里加一条：
   - Hostname：`dsh.example.com`
   - Service：`http://127.0.0.1:8470`（网关端口）
3. 回到隧道详情页，复制安装命令里的 **token**（`--token eyJ...` 后面那一串）。
4. DSH → 设置 → 连接手机 → 公网隧道 → 选「固定隧道（Cloudflare token）」，
   粘贴 token 保存，再把上方的「公网地址」填成 `https://dsh.example.com`。
5. 点「启动隧道」；勾选「DSH 启动时自动拉起隧道」可以随 DSH 一起启动。

插件会用 `TUNNEL_TOKEN` 环境变量把 token 传给 cloudflared（不会出现在进程命令行），
日志在 `$DSH_HOME/.dsh-mobile/tunnel.log`。

### 4. 写配置文件

新建 `%USERPROFILE%\.cloudflared\config.yml`：

```yaml
tunnel: <UUID>
credentials-file: C:\Users\<你的用户名>\.cloudflared\<UUID>.json

ingress:
  - hostname: dsh.example.com
    service: http://127.0.0.1:8470
  - service: http_status:404
```

> 8470 是 dsh-mobile 网关端口。如果你在插件 config 里改过 `port`，这里同步改。

### 5. 绑定域名

```powershell
cloudflared tunnel route dns dsh-mobile dsh.example.com
```

这会在 Cloudflare 里自动建一条指向隧道的 CNAME。

### 6. 先手动跑起来验证

```powershell
cloudflared tunnel run dsh-mobile
```

保持窗口不要关，另开一个窗口：

```powershell
curl https://dsh.example.com/__dshm/health
```

返回 `{"ok":true,...}` 就通了。然后在 DSH 设置 → 连接手机里把公网地址填成
`https://dsh.example.com` 并保存，生成二维码，手机扫码配对。

### 7. 装成开机自启服务

`cloudflared service install` 会读取 `%USERPROFILE%\.cloudflared\config.yml`，
以 Windows 服务方式常驻（需要管理员 PowerShell）：

```powershell
cloudflared service install
sc.exe start cloudflared
```

或者用「任务计划程序」在登录时运行 `cloudflared tunnel run dsh-mobile`（不需要管理员）。

### 8. 安全建议

- 只暴露 8470，**不要**把 63160 暴露到公网。
- 配对必须电脑端批准；不用的设备在设置卡里点「吊销」。
- 想再加一层：Cloudflare Zero Trust → Access → Application，给
  `dsh.example.com` 加邮箱/Google 登录策略。手机端会多一次登录，但安全性更高。
- 定期更新 DSH 与本插件；公网入口不要用 `http://`。

### 常见问题

| 现象 | 原因 |
| --- | --- |
| 502 / 1033 | 网关没启动（DSH 没开或 8470 被占）；先看 `http://127.0.0.1:8470/__dshm/health` |
| 手机一直「需要配对」 | cookie 没写入：确认访问的是 HTTPS 域名，且没有隐私模式拦截 |
| 安装不了 PWA | 必须是 HTTPS；iOS 需要 Safari「添加到主屏幕」 |
| 二维码地址是 127.0.0.1 | 还没填公网地址，或保存失败；重新保存后再生成 |

---

## 方案 B：VPS + frp（有服务器时）

1. VPS 上装 frps，开放 7000（frp 控制）和 443。
2. 电脑上 frpc 把 `127.0.0.1:8470` 映射到 VPS 的 `127.0.0.1:8470`。
3. VPS 用 Caddy/Nginx 反代 `https://dsh.example.com` → `127.0.0.1:8470`，
   Caddy 自动签 Let's Encrypt 证书。
4. DNS 的 A 记录指向 VPS。
5. 其余步骤（配对、填公网地址）同方案 A。

Caddy 片段：

```caddy
dsh.example.com {
    reverse_proxy 127.0.0.1:8470
}
```

反代需要保留 `X-Forwarded-Proto`（Caddy 默认会加），插件据此把设备 cookie 标成 Secure。

---

## 方案 C：只在家里用

1. 插件 config 改成 `bind: 0.0.0.0`，重启 DSH。
2. 设置卡里会显示 `http://192.168.x.x:8470`。
3. 手机连同一 Wi-Fi，扫码配对。

限制：HTTP 不是安全上下文，Chrome 不会给 PWA 安装提示、Service Worker 和推送也不可用；
只是「能用网页」，体验不如 HTTPS。要完整体验还是走 A 或 B。

---

## 方案 E：内嵌 Funnel（tsnet，免安装）

原理：插件拉起 `sidecar/tsnet-sidecar.exe`，在进程内跑一个用户态 Tailscale 节点，用
`ListenFunnel` 把 `127.0.0.1:8470` 暴露成 `https://<主机名>.<tailnet>.ts.net`。
不需要安装 Tailscale、不需要管理员、不需要开端口；Funnel 的 443 是 tsnet 虚拟端口，
不占本机 443，也不创建虚拟网卡、不改路由和 DNS。

### 准备

1. 到 Actions 跑 `sidecar` workflow，下载 `tsnet-sidecar-windows-amd64` 产物；
   或本机 `cd sidecar && go mod tidy && go build -o tsnet-sidecar.exe .`
2. 把 `tsnet-sidecar.exe` 放到 `%USERPROFILE%\.dsh-mobile\bin\`（或放进 `tools\` 后跑 `install.ps1`）。

### 首次启用

1. DSH → 设置 → 连接手机 → 勾「启用内嵌 Funnel」→ 点「启动」。
2. 点「打开登录页」，用 Google/GitHub 登录 Tailscale（链接也可以发到手机上登录）。
3. 到 <https://login.tailscale.com/f/funnel> 开一次 HTTPS 和 Funnel（每个 tailnet 一次）。
4. 地址会自动回填「公网地址」；生成二维码配对即可。

### 注意

- 每个跑 DSH 的人需要自己的 Tailscale 账号（一次性），这是 Tailscale 的模式。
- 地址固定，重启电脑/DSH 不变；换名改 `state.json` 的 `tsnet.hostname`（默认 `pocket`）。
- 不用时在卡片里「停止」，或在 Tailscale 控制台移除该设备。
- Funnel 是公网入口，安全仍靠设备配对 + 设备 cookie。
- Funnel 入口在境外，延迟和方案 D 同级；要更低延迟还是走方案 B 或 IPv6（如果学校放通）。

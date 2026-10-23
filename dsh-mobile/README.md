# dsh-mobile · DSH 手机端

把电脑上的 DSH 带到手机上：**扫码配对 → 安装到主屏幕 → 像 App 一样远程使用**。
手机拿到的就是电脑里的完整 Web UI（会话、流式输出、审批、文件变更、终端、设置），
所以 PC 端功能基本原样保留；插件本身只负责配对、设备管理和安全代理。

## 它做了什么

- **一键配对**：电脑端「设置 → 连接手机」生成二维码，手机扫码、电脑核对 6 位码并批准。
- **设备令牌**：批准后手机拿到 HttpOnly 的随机设备 cookie（30 天），可单独吊销；
  内核的 launch token 和签名 cookie 永远不下发到手机。
- **完整功能代理**：把手机请求反向代理到本机 DSH Web 服务，改写 `Host/Origin`，
  透传 SSE/WebSocket，会话与工具调用与电脑端一致。
- **可安装 PWA**：manifest、图标、Service Worker、离线页、安全区适配；
  满足 HTTPS 条件后 Android Chrome 会提示「安装应用」。
- **公网访问**：手机端不直接连 `63160`；插件另开一个只给手机用的网关端口（默认
  `127.0.0.1:8470`），用 Cloudflare Tunnel / frp / 反向代理把它安全地暴露出去。
- **与 meow-smooth 共存**：手机端推送继续由 meow-smooth 提供；本插件把它的推送
  Service Worker 脚本并入自己的 SW，避免两个 SW 抢同一 scope。

## 架构

```
手机浏览器 / PWA
      │  HTTPS（Cloudflare Tunnel 等）
      ▼
dsh-mobile 网关（127.0.0.1:8470）
  ├─ 配对页 / 设备 cookie 校验
  ├─ PWA 资源 + HTML 注入
  └─ 反向代理（改写 Host/Origin，带上内核 cookie）
      ▼
DSH Web 服务（127.0.0.1:63160，保持只监听回环）
```

## 安装

在仓库根目录运行（会先备份当前 profile）：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

然后**重启 DSH**，打开 设置 → 连接手机。

卸载 / 回滚：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1
```

## 首次使用

1. 设置 → 连接手机，网络模式选好后填「公网地址」（例如 `https://dsh.example.com`），保存。
2. 点「生成配对二维码」，手机浏览器扫码（微信扫码请选「在浏览器打开」）。
3. 电脑上核对 6 位配对码，点「批准」。
4. 手机自动进入 DSH；浏览器菜单 →「添加到主屏幕」。
5. 以后从主屏幕图标打开，即为全屏 App。

没有公网域名也可以先用局域网：把插件配置的 `bind` 改成 `0.0.0.0`，手机连同一 Wi-Fi，
用卡片里显示的局域网地址。注意局域网 HTTP 不是安全上下文，PWA 安装与推送会受限。

公网域名怎么搭：见 [docs/remote-domain.md](docs/remote-domain.md)，或直接运行
`bash scripts/setup-tunnel.sh`（Git Bash）跟着向导走。

## 配置

在 profile 的 `cordis.patch.yml` 里给 `dsh-mobile` 加 `config`：

```yaml
- insert:
    - id: dsh-mobile
      name: 'dsh-mobile'
      config:
        port: 8470          # 手机网关端口
        bind: 127.0.0.1     # 走隧道保持回环；局域网改成 0.0.0.0
```

公网地址保存在 `$DSH_HOME/.dsh-mobile/state.json`，在设置卡里改，不用重启。

## 安全模型

- 上游 `63160` 不对外；只有网关端口可以被隧道暴露，且必须通过设备 cookie。
- 配对 token 一次性、5 分钟过期、常量时间比较；批准必须发生在电脑端。
- 设备令牌是 32 字节随机数，服务端只存 sha256；吊销立即生效。
- 代理会剥掉上游的 `Set-Cookie`，手机永远拿不到内核会话 cookie。
- 公网务必用 HTTPS（Cloudflare Tunnel 自带）；HTTP 下设备 cookie 会在传输中暴露。

## 开发与测试

```powershell
cd dsh-mobile
& F:\nodejs\node.exe --test --test-force-exit tests/gateway.test.mjs
& F:\nodejs\node.exe --test --test-force-exit tests/plugin.test.mjs
```

测试用假上游覆盖：健康检查、未配对拦截、配对/批准/领取、HTML 注入、POST 代理、
WebSocket 升级、公网地址、设备吊销、插件装配与销毁。

## 已知限制

- 推送依赖 meow-smooth 的 VAPID/订阅；本插件只保证它不被 SW 顶掉。
- 还没有 Android APK / iOS 原生壳；当前是 PWA，满足「安装到主屏幕 + 全屏」。
- 局域网 HTTP 下没有 Service Worker / 推送 / 安装提示，这是浏览器安全上下文限制。
- 二维码里的地址需要在手机浏览器可达；纯回环且没填公网地址时会提示不可达。

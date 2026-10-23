# 发布与热更新

## 一次性准备

1. 登录 GitHub CLI（浏览器授权）：
   ```powershell
   gh auth login --hostname github.com --git-protocol https --web
   ```
2. 创建仓库并推送（默认 `dsh-pocket`，public）：
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\create-github-repo.ps1
   ```
   也可以手动建仓库后：
   ```powershell
   git remote add origin https://github.com/<你>/dsh-pocket.git
   git push -u origin main
   ```
3. 仓库 → Settings → Pages → Source 选 **GitHub Actions**。
   发布页地址：`https://<你>.github.io/dsh-pocket/releases/`。

## 发一个版本

```powershell
# 1. 本地构建并校验
node scripts/build-mobile-web.mjs
cd mobile; npx cap sync android
cd android; .\gradlew.bat assembleDebug --no-daemon

# 2. 改版本号（mobile/android/app/build.gradle）和发布页配置后提交
git add -A
git commit -m "release: v0.4.1"
git tag v0.4.1
git push origin main --tags
```

推送 tag 后 `.github/workflows/release.yml` 会：

- 构建 Android debug APK；
- 构建 Windows `tsnet-sidecar.exe`；
- 生成 sha256；
- 创建 GitHub Release 并附上这些文件。

发布页 `docs/releases/config.json` 里的 `apkUrl` 指向 Release 资产；换 tag 时一起改。

## 热更新（证书签下来 / 换入口）

**只改 `docs/releases/config.json` 的 `publicUrl`，提交即可**，不需要重新打 APK：

```json
{
  "publicUrl": "https://pocket.taila66dc2.ts.net",
  "updatedAt": "2026-10-24T00:00:00Z",
  "entryHint": "稳定 Funnel 入口"
}
```

Pages 会在 1–2 分钟内更新；发布页的「当前公网入口」「打开 Pocket」按钮跟着变。

0.4.1 起，Android 壳启动时会先读这个 `config.json` 的 `publicUrl`：

- 健康检查通过 → 直接加载远端 `/__dshapp/`，UI 永远跟着网关走；
- 失败 → 回退到上次保存的地址，再不行留在本地壳/连接页。

已经装在手机上的 App 不需要重装：

- **PWA / APK**：设置 → 连接 → 服务器地址 → 更换，填新地址；
- 新地址第一次使用要重新配对（设备 cookie 按域名隔离）；
- APK 里的地址不是写死的；0.4.1 起还能从发布页自动取当前入口。
- 设置 → 关于 → 检查更新 会读 `config.json` 的 `version/apkUrl`，有新版就打开下载页。
- 原生壳（图标、权限、Capacitor 版本）变更仍需要重新安装 APK；Web UI 不需要。

## 已知限制

- 当前 APK 是 debug 签名，只能侧载；正式发布要生成 release keystore 并在 CI 注入。
- 临时 trycloudflare 地址每次隧道重启都会变；稳定入口等 Funnel 证书。
- 发布页是纯静态，不做健康检查（浏览器跨域限制）；以手机实际打开为准。

PocketHost — 电脑端安装包
=========================

Pocket 需要电脑端 DSH 安装「连接手机」插件。这个包已经带好：
  dsh-mobile/     插件
  bin/            Funnel sidecar + cloudflared
  install.ps1     安装脚本
  uninstall.ps1   卸载脚本

安装
----
1. 先启动一次 DSH，确认它已经创建过 profile。
2. 双击 install.bat（或在 PowerShell 里运行 install.ps1）。
3. 完全退出 DSH，再重新打开。
4. DSH 的「插件 → 已安装插件」里会出现 dsh-mobile，
   左侧栏也会出现「手机」图标。

如果提示找不到 profile
-----------------------
确认 DSH 至少启动过一次；或手动指定 DSH_HOME：
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -DshHome "C:\Users\你\.dsh"

下一步
------
在 DSH 设置 -> 连接手机：
  - 打开手机端总开关；
  - 选择公网入口（Funnel 需要登录一次 Tailscale；临时隧道免登录但地址会变）；
  - 生成配对二维码，用手机扫码。

卸载
----
  powershell -ExecutionPolicy Bypass -File .\uninstall.ps1

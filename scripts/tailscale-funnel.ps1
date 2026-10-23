# Tailscale Funnel：不用买域名，把本机 dsh-mobile 网关挂到一个固定 HTTPS 地址。
#
# 需要：
#   1. 已安装 Tailscale 并登录（服务开机自启）
#   2. 在 https://login.tailscale.com/f/funnel 启用 Funnel（按提示同时开启 HTTPS）
#   3. 用「管理员 PowerShell」运行本脚本（Tailscale CLI 的本地管道只允许管理员访问）
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File .\scripts\tailscale-funnel.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\tailscale-funnel.ps1 -Status
#   powershell -ExecutionPolicy Bypass -File .\scripts\tailscale-funnel.ps1 -Stop
#   powershell -ExecutionPolicy Bypass -File .\scripts\tailscale-funnel.ps1 -Port 8471
param(
  [switch]$Stop,
  [switch]$Status,
  [int]$Port = 8470
)

$ErrorActionPreference = "Stop"
$exe = "C:\Program Files\Tailscale\tailscale.exe"

if (-not (Test-Path $exe)) {
  throw "没找到 $exe；请先安装 Tailscale：https://tailscale.com/download/windows"
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "提示：Tailscale CLI 需要管理员权限，请用「管理员 PowerShell」运行，否则会 Access denied。" -ForegroundColor Yellow
}

if ($Stop) {
  & $exe funnel --https=443 off
  exit $LASTEXITCODE
}

if ($Status) {
  & $exe funnel status
  exit $LASTEXITCODE
}

& $exe funnel --bg $Port
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

try {
  $json = (& $exe status --json | Out-String) | ConvertFrom-Json
  $dns = $json.Self.DNSName
  if ($dns) { Write-Host "公网地址：https://$($dns.TrimEnd('.'))" -ForegroundColor Green }
} catch {
  Write-Host "已启动，但没读到 DNSName；用 -Status 看当前 Funnel 地址。" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "下一步：把上面的地址填进 DSH → 设置 → 连接手机 → 公网地址，然后生成二维码配对。"
Write-Host "注意：本地 8470 必须只监听回环（默认就是）；Funnel 会把它暴露成公网 HTTPS。"

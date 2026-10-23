# 开一个 Cloudflare 临时隧道（quick tunnel），并把地址自动写进 DSH 手机端的「公网地址」。
# 不需要域名、不需要账号；地址形如 https://xxx.trycloudflare.com，重启隧道后会变。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File .\scripts\tunnel-quick.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\tunnel-quick.ps1 -Stop
param(
  [switch]$Stop,
  [int]$GatewayPort = 8470,
  [int]$GuiPort = 0
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $repoRoot 'tools'
$exe = Join-Path $tools 'cloudflared.exe'
$out = Join-Path $tools 'tunnel.out.log'
$err = Join-Path $tools 'tunnel.err.log'
$pidFile = Join-Path $tools 'tunnel.pid'

if ($Stop) {
  if (Test-Path $pidFile) {
    $old = [int](Get-Content $pidFile)
    try { Stop-Process -Id $old -Force -ErrorAction Stop; Write-Host "已停止隧道 PID $old" } catch { Write-Host "隧道已不在运行" }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  } else {
    Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
    Write-Host "已清理 cloudflared 进程"
  }
  return
}

New-Item -ItemType Directory -Force -Path $tools | Out-Null
if (-not (Test-Path $exe)) {
  Write-Host "没有 cloudflared，正在下载（约 55MB）……"
  curl.exe -L --fail --retry 2 --connect-timeout 15 -o $exe "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $exe)) { throw "cloudflared 下载失败" }
}

Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item $out, $err -ErrorAction SilentlyContinue

$proc = Start-Process -FilePath $exe -ArgumentList @(
  'tunnel', '--url', "http://127.0.0.1:$GatewayPort", '--no-autoupdate', '--protocol', 'http2'
) -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden -PassThru
Set-Content $pidFile $proc.Id

Write-Host "隧道启动中（PID $($proc.Id)）……"
$url = $null
for ($i = 0; $i -lt 80; $i++) {
  Start-Sleep -Milliseconds 500
  $text = ''
  if (Test-Path $out) { $text += (Get-Content $out -Raw -ErrorAction SilentlyContinue) }
  if (Test-Path $err) { $text += (Get-Content $err -Raw -ErrorAction SilentlyContinue) }
  if ($text -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
    $url = $Matches[0]
    break
  }
}
if (-not $url) {
  Write-Host "没拿到隧道地址，看日志：" -ForegroundColor Red
  Get-Content $err -Tail 30 -ErrorAction SilentlyContinue
  throw "隧道启动失败"
}
Write-Host "隧道地址：$url" -ForegroundColor Green

# 自动找当前 DSH 的 GUI 端口（不依赖写死的端口）
if (-not $GuiPort) {
  try {
    $hostProc = Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" |
      Where-Object { $_.CommandLine -match 'dsh-desktop-host' } |
      Select-Object -First 1
    if ($hostProc) {
      $ports = Get-NetTCPConnection -State Listen -OwningProcess $hostProc.ProcessId -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty LocalPort -Unique |
        Where-Object { $_ -ne $GatewayPort }
      foreach ($p in $ports) {
        try {
          $state = Invoke-RestMethod -Uri "http://127.0.0.1:$p/plugins/dsh-mobile/api/state" -TimeoutSec 2
          if ($state.ok) { $GuiPort = $p; break }
        } catch {}
      }
    }
  } catch {}
}

if ($GuiPort) {
  $payload = @{ publicUrl = $url } | ConvertTo-Json -Compress
  try {
    $result = Invoke-RestMethod -Method POST -Uri "http://127.0.0.1:$GuiPort/plugins/dsh-mobile/api/settings" `
      -Headers @{ Origin = "http://127.0.0.1:$GuiPort" } -ContentType 'application/json' -Body $payload
    if ($result.ok) { Write-Host "已写入 DSH 公网地址（GUI :$GuiPort）" -ForegroundColor Green }
    else { Write-Host "写入失败：$($result | ConvertTo-Json -Compress)" -ForegroundColor Yellow }
  } catch {
    Write-Host "自动写入公网地址失败：$($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "请手动把 $url 填进 设置 → 连接手机 → 公网地址。"
  }
} else {
  Write-Host "没找到 DSH GUI 端口；请手动把 $url 填进 设置 → 连接手机 → 公网地址。"
}

Write-Host ""
Write-Host "下一步：DSH → 设置 → 连接手机 → 生成配对二维码 → 手机扫码 → 电脑批准。"
Write-Host "手机如果连同一 Wi-Fi 打不开，先切到移动数据再试（本机 DNS 可能拦截 trycloudflare）。"
Write-Host "停止隧道： powershell -ExecutionPolicy Bypass -File .\scripts\tunnel-quick.ps1 -Stop"

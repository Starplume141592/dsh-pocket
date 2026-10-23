# 起一个隔离的 DSH 开发实例（不碰你正在用的那个），用来联调 dsh-mobile。
# 原理：复制 desktop profile 到临时 DSH_HOME，用 Electron 的 Node 模式跑 dsh CLI，
#       profile 名改成 devhost（desktop 是 Electron 独占的，不能直接用）。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File .\scripts\dev-host.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\dev-host.ps1 -Port 39002
#   powershell -ExecutionPolicy Bypass -File .\scripts\dev-host.ps1 -Stop
param(
  [int]$Port = 39001,
  [string]$DevHome = "F:\dshapp\.dev-dshhome",
  [switch]$Stop
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $DevHome 'devhost.pid'

if ($Stop) {
  if (Test-Path $pidFile) {
    $old = [int](Get-Content $pidFile)
    try { Stop-Process -Id $old -Force -ErrorAction Stop; Write-Host "已停止 dev host PID $old" }
    catch { Write-Host "dev host 已不在运行" }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  } else {
    Write-Host "没有记录在案的 dev host"
  }
  return
}

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE ".dsh" }
$sourceProfile = Join-Path $dshHome "profiles\desktop"
$devProfile = Join-Path $DevHome "profiles\devhost"

if (-not (Test-Path $sourceProfile)) { throw "找不到 $sourceProfile" }
if (-not (Test-Path $DevHome)) { New-Item -ItemType Directory -Force -Path $DevHome | Out-Null }

# 复制/刷新 profile（node_modules 只补 dsh-mobile，避免每次全量拷贝）
if (-not (Test-Path $devProfile)) {
  Copy-Item $sourceProfile $devProfile -Recurse
} else {
  Copy-Item (Join-Path $sourceProfile 'cordis.patch.yml') (Join-Path $devProfile 'cordis.patch.yml') -Force
  Copy-Item (Join-Path $sourceProfile 'package.json') (Join-Path $devProfile 'package.json') -Force
}
$target = Join-Path $devProfile 'node_modules\dsh-mobile'
if (Test-Path $target) { Remove-Item $target -Recurse -Force }
Copy-Item (Join-Path $repoRoot 'dsh-mobile') $target -Recurse
Copy-Item (Join-Path $dshHome '.credentials.yaml') $DevHome -ErrorAction SilentlyContinue

if (Test-Path $pidFile) {
  $old = [int](Get-Content $pidFile)
  try { Stop-Process -Id $old -Force -ErrorAction SilentlyContinue } catch {}
}

$exe = 'F:\dsh\DeepSeek Harness.exe'
$cli = 'F:\dsh\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js'
if (-not (Test-Path $exe)) { throw "找不到 Electron 版 DSH：$exe" }
if (-not (Test-Path 'F:\dsh\resources\app.asar')) { throw "找不到 app.asar" }

$out = Join-Path $DevHome 'devhost.out.log'
$err = Join-Path $DevHome 'devhost.err.log'
Remove-Item $out, $err -ErrorAction SilentlyContinue

$env:DSH_HOME = $DevHome
$env:ELECTRON_RUN_AS_NODE = '1'
$proc = Start-Process -FilePath $exe -ArgumentList @(
  '--expose-internals', $cli, '--profile', 'devhost', '--no-open', '--port', "$Port", '--host', '127.0.0.1'
) -RedirectStandardOutput $out -RedirectStandardError $err -NoNewWindow -PassThru
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Set-Content $pidFile $proc.Id

Write-Host "dev host 启动中（PID $($proc.Id), GUI :$Port）……"
$health = $null
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8470/__dshm/health" -TimeoutSec 2
    break
  } catch {}
}
if ($health) {
  Write-Host "dsh-mobile 网关 OK：version=$($health.version) upstream=$($health.upstream)" -ForegroundColor Green
} else {
  Write-Host "网关没起来，看日志：" -ForegroundColor Red
  Get-Content $err -Tail 30 -ErrorAction SilentlyContinue
}
Write-Host ""
Write-Host "GUI:      http://127.0.0.1:$Port （需要带 token 的 URL，见 $out）"
Write-Host "网关:     http://127.0.0.1:8470/__dshm/health"
Write-Host "联调:     node .\dsh-mobile\tests\live-check.mjs"
Write-Host "停止:     powershell -ExecutionPolicy Bypass -File .\scripts\dev-host.ps1 -Stop"

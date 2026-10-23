# 重启 DSH 后运行，检查 dsh-mobile 是否真的起来了、装在哪个 profile。
# 用法： powershell -ExecutionPolicy Bypass -File .\scripts\check.ps1
param(
  [int]$Port = 8470
)

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE ".dsh" }
$profileRoot = Join-Path $dshHome "profiles"
$dataDir = Join-Path $dshHome ".dsh-mobile"

Write-Host "== 正在运行的 DSH =="
try {
  $procs = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
    $_.Name -in @('DeepSeek Harness.exe', 'dsh-eac-shell.exe') -and $_.CommandLine -match 'profiles[\\/]'
  })
  if ($procs.Count -eq 0) {
    Write-Host "没找到带 profile 参数的 DSH 进程（可能进程名不同）。"
  } else {
    foreach ($p in $procs) {
      $m = [regex]::Match($p.CommandLine, 'profiles[\\/]([^"\\/\s]+)')
      Write-Host ("PID {0}  profile={1}" -f $p.ProcessId, $(if ($m.Success) { $m.Groups[1].Value } else { '?' }))
    }
  }
} catch {
  Write-Host "读取进程失败：$($_.Exception.Message)"
}

Write-Host ""
Write-Host "== 安装状态 =="
Get-ChildItem $profileRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  $patch = Join-Path $_.FullName 'cordis.patch.yml'
  if (-not (Test-Path $patch)) { return }
  $hasPackage = Test-Path (Join-Path $_.FullName 'node_modules\dsh-mobile\package.json')
  $entries = (Select-String -Path $patch -Pattern 'id:\s*dsh-mobile').Count
  Write-Host ("{0,-14} 插件={1}  patch条目={2}" -f $_.Name, $(if ($hasPackage) { '有' } else { '无' }), $entries)
}

Write-Host ""
Write-Host "== 插件加载标记 =="
$loadFile = Join-Path $dataDir 'last-load.json'
if (Test-Path $loadFile) {
  Write-Host "last-load.json 存在（host 半确实被加载过）："
  Get-Content $loadFile
} else {
  Write-Host "没有 last-load.json —— 插件没有被加载，或还没重启过 DSH。" -ForegroundColor Yellow
}
$startFile = Join-Path $dataDir 'last-start.json'
if (Test-Path $startFile) {
  Write-Host ""
  Write-Host "最近一次网关启动："
  Get-Content $startFile
}
$errFile = Join-Path $dataDir 'last-error.log'
if (Test-Path $errFile) {
  Write-Host ""
  Write-Host "最近一次启动错误：" -ForegroundColor Red
  Get-Content $errFile
}

Write-Host ""
Write-Host "== 网关健康检查 (127.0.0.1:$Port) =="
try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/__dshm/health" -TimeoutSec 4
  Write-Host "OK  version=$($health.version)  upstream=$($health.upstream)" -ForegroundColor Green
} catch {
  Write-Host "FAIL  $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "如果 DSH 刚重启完，等几秒再试；仍失败就看上面的 last-error。"
}

Write-Host ""
Write-Host "下一步：在 DSH 里打开 设置 → 连接手机，填公网地址（或勾选局域网直连），生成二维码。"

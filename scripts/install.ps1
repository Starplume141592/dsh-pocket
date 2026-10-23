# 把 dsh-mobile 安装进 DSH profile：默认装进所有 profile（桌面版/网页版共用一套 DSH_HOME 时最省心）。
# 用法：
#   powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Profile desktop
#   powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Profile all
param(
  [string]$Profile = "all",
  [string]$Source = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($Source)) { $Source = Join-Path $repoRoot "dsh-mobile" }

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE ".dsh" }
$profileRoot = Join-Path $dshHome "profiles"
$dataDir = Join-Path $dshHome ".dsh-mobile"

if (-not (Test-Path (Join-Path $Source "package.json"))) { throw "源目录不像插件包：$Source" }

# 把 cloudflared 放进数据目录，插件里的「隧道托管」才能一键启动。
$cloudflared = Join-Path $repoRoot "tools\cloudflared.exe"
if (Test-Path $cloudflared) {
  $binDir = Join-Path $dataDir "bin"
  New-Item -ItemType Directory -Force -Path $binDir | Out-Null
  Copy-Item $cloudflared (Join-Path $binDir "cloudflared.exe") -Force
  Write-Host "已准备 cloudflared → $binDir"
}

if ($Profile -eq "all") {
  $targets = @(Get-ChildItem $profileRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName "cordis.patch.yml") } |
    ForEach-Object { $_.Name })
} else {
  $targets = @($Profile)
}
if ($targets.Count -eq 0) { throw "在 $profileRoot 下没找到带 cordis.patch.yml 的 profile" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

foreach ($name in $targets) {
  $profileDir = Join-Path $profileRoot $name
  $patchFile = Join-Path $profileDir "cordis.patch.yml"
  $packageJson = Join-Path $profileDir "package.json"
  $target = Join-Path $profileDir "node_modules\dsh-mobile"

  if (-not (Test-Path $patchFile)) { Write-Host "跳过 $name：没有 cordis.patch.yml"; continue }

  $backupDir = Join-Path $dshHome "backups\dsh-mobile-$stamp-$name"
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  Copy-Item $patchFile (Join-Path $backupDir "cordis.patch.yml")
  if (Test-Path $packageJson) { Copy-Item $packageJson (Join-Path $backupDir "package.json") }
  if (Test-Path $target) { Copy-Item $target (Join-Path $backupDir "dsh-mobile") -Recurse }
  Set-Content -Path (Join-Path $backupDir "profile.txt") -Value $name -Encoding utf8

  if (Test-Path $target) { Remove-Item $target -Recurse -Force }
  Copy-Item $Source $target -Recurse

  $text = Get-Content $patchFile -Raw
  if ($text -notmatch "(?m)^\s*-\s*id:\s*dsh-mobile\s*$") {
    $block = "`r`n- insert:`r`n    - id: dsh-mobile`r`n      name: 'dsh-mobile'`r`n"
    [System.IO.File]::AppendAllText($patchFile, $block, [System.Text.UTF8Encoding]::new($false))
    $patched = "已插入 patch"
  } else {
    $patched = "patch 已存在，跳过"
  }

  Write-Host "[$name] 已安装 → $target；$patched；备份 $backupDir"
}

Write-Host ""
Write-Host "安装完成。请完全退出并重新打开你正在用的 DSH（不是只关窗口）。"
Write-Host "然后运行： powershell -ExecutionPolicy Bypass -File .\scripts\check.ps1"
Write-Host "回滚：     powershell -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1 -Profile all"

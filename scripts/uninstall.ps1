# 卸载 dsh-mobile：优先用安装前的备份恢复 patch/package.json，并删除插件目录。
# 用法：
#   powershell -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1 -Profile desktop
param(
  [string]$Profile = "all"
)

$ErrorActionPreference = "Stop"

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE ".dsh" }
$profileRoot = Join-Path $dshHome "profiles"

if ($Profile -eq "all") {
  $targets = @(Get-ChildItem $profileRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName "cordis.patch.yml") } |
    ForEach-Object { $_.Name })
} else {
  $targets = @($Profile)
}
if ($targets.Count -eq 0) { throw "在 $profileRoot 下没找到带 cordis.patch.yml 的 profile" }

function Find-Backup([string]$name) {
  $all = @(Get-ChildItem (Join-Path $dshHome "backups") -Directory -Filter "dsh-mobile-*" -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending)
  foreach ($b in $all) {
    $marker = Join-Path $b.FullName "profile.txt"
    if (Test-Path $marker) {
      if ((Get-Content $marker -Raw).Trim() -eq $name) { return $b }
    }
  }
  # 兼容早期没有 profile.txt 的备份：取最近一个「patch 里还没有 dsh-mobile」的。
  foreach ($b in $all) {
    $saved = Join-Path $b.FullName "cordis.patch.yml"
    if (-not (Test-Path $saved)) { continue }
    if ((Get-Content $saved -Raw) -notmatch "dsh-mobile") { return $b }
  }
  return $null
}

function Remove-PatchEntry([string]$patchFile) {
  if (-not (Test-Path $patchFile)) { return $false }
  $lines = @(Get-Content $patchFile)
  $out = New-Object System.Collections.Generic.List[string]
  $skipNext = 0
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    if ($skipNext -gt 0) { $skipNext--; continue }
    if ($line -match "^\s*-\s*id:\s*dsh-mobile\s*$") {
      if ($out.Count -gt 0 -and $out[$out.Count - 1] -match "^\s*-\s*insert:\s*$") {
        $out.RemoveAt($out.Count - 1)
      }
      if ($i + 1 -lt $lines.Count -and $lines[$i + 1] -match "^\s*name:\s*'dsh-mobile'\s*$") { $skipNext = 1 }
      continue
    }
    $out.Add($line)
  }
  Set-Content -Path $patchFile -Value $out -Encoding utf8
  return $true
}

foreach ($name in $targets) {
  $profileDir = Join-Path $profileRoot $name
  if (-not (Test-Path $profileDir)) { Write-Host "跳过 $name：目录不存在"; continue }
  $patchFile = Join-Path $profileDir "cordis.patch.yml"
  $target = Join-Path $profileDir "node_modules\dsh-mobile"

  $backup = Find-Backup $name
  if ($backup) {
    $savedPatch = Join-Path $backup.FullName "cordis.patch.yml"
    if (Test-Path $savedPatch) {
      Copy-Item $savedPatch $patchFile -Force
      Write-Host "[$name] 已从备份恢复 cordis.patch.yml：$($backup.FullName)"
    }
    $savedPkg = Join-Path $backup.FullName "package.json"
    if (Test-Path $savedPkg) {
      Copy-Item $savedPkg (Join-Path $profileDir "package.json") -Force
    }
  } else {
    [void](Remove-PatchEntry $patchFile)
    Write-Host "[$name] 没找到安装备份，已从 patch 移除 dsh-mobile"
  }

  if (Test-Path $target) {
    Remove-Item $target -Recurse -Force
    Write-Host "[$name] 已删除插件目录"
  }
}

Write-Host ""
Write-Host "卸载完成，请完全退出并重新打开 DSH。"
Write-Host "（手机端配对记录保存在 $dshHome\.dsh-mobile；如需彻底清除可手动删除该目录。）"

# PocketHost installer: copy the dsh-mobile plugin into DSH profiles.
# Run from the extracted PocketHost folder:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
param(
  [string]$DshHome = ''
)

$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$source = Join-Path $root 'dsh-mobile'
if (-not (Test-Path (Join-Path $source 'package.json'))) {
  throw "PocketHost is incomplete: dsh-mobile/package.json not found."
}

if ([string]::IsNullOrWhiteSpace($DshHome)) {
  $DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
}
$profileRoot = Join-Path $DshHome 'profiles'
if (-not (Test-Path $profileRoot)) {
  throw "DSH profiles not found at $profileRoot. Start DSH once, then run this again."
}

$targets = @(Get-ChildItem $profileRoot -Directory -ErrorAction SilentlyContinue |
  Where-Object { Test-Path (Join-Path $_.FullName 'cordis.patch.yml') })
if ($targets.Count -eq 0) {
  throw "No DSH profile with cordis.patch.yml under $profileRoot."
}

# Sidecars used by the plugin (Funnel + optional Cloudflare quick tunnel).
$bin = Join-Path $DshHome '.dsh-mobile\bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null
foreach ($exe in @('tsnet-sidecar.exe', 'cloudflared.exe')) {
  $from = Join-Path $root "bin\$exe"
  if (Test-Path $from) {
    Copy-Item $from (Join-Path $bin $exe) -Force
    Write-Host "prepared $exe"
  }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
foreach ($profile in $targets) {
  $target = Join-Path $profile.FullName 'node_modules\dsh-mobile'
  $patch = Join-Path $profile.FullName 'cordis.patch.yml'
  $backup = Join-Path $DshHome "backups\pockethost-$stamp\$($profile.Name)"
  New-Item -ItemType Directory -Force -Path $backup | Out-Null
  Copy-Item $patch (Join-Path $backup 'cordis.patch.yml')
  if (Test-Path $target) {
    Copy-Item $target (Join-Path $backup 'dsh-mobile') -Recurse
    Remove-Item $target -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
  Copy-Item $source $target -Recurse

  $text = Get-Content $patch -Raw
  if ($text -notmatch '(?m)^\s*-\s*id:\s*dsh-mobile\s*$') {
    $block = "`r`n- insert:`r`n    - id: dsh-mobile`r`n      name: 'dsh-mobile'`r`n"
    [System.IO.File]::AppendAllText($patch, $block, [System.Text.UTF8Encoding]::new($false))
    Write-Host "[$($profile.Name)] plugin installed and patch added"
  } else {
    Write-Host "[$($profile.Name)] plugin installed (patch already present)"
  }
  Write-Host "  backup: $backup"
}

Write-Host ''
Write-Host 'Done. Restart DSH (quit and reopen), then open Settings -> Connect phone.' -ForegroundColor Green
Write-Host 'If Settings has no "Connect phone" card, check that the profile patch contains dsh-mobile.'

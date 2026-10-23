# Build a self-contained Windows host package:
#   dist/PocketHost-<version>.zip
# Contains the dsh-mobile plugin, both sidecars, and installer scripts.
param(
  [string]$Version = '0.4.1'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $repo 'dist'
$stage = Join-Path $dist 'PocketHost'
$zip = Join-Path $dist "PocketHost-$Version.zip"

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

# Plugin files + runtime dependencies.
$plugin = Join-Path $stage 'dsh-mobile'
New-Item -ItemType Directory -Force -Path $plugin | Out-Null
foreach ($name in @('package.json', 'cordis.patch.yml', 'README.md')) {
  Copy-Item (Join-Path $repo "dsh-mobile\$name") (Join-Path $plugin $name)
}
Copy-Item (Join-Path $repo 'dsh-mobile\lib') (Join-Path $plugin 'lib') -Recurse
Copy-Item (Join-Path $repo 'dsh-mobile\assets') (Join-Path $plugin 'assets') -Recurse
Copy-Item (Join-Path $repo 'dsh-mobile\node_modules') (Join-Path $plugin 'node_modules') -Recurse

# Do not bundle the host zip or APK into the host zip.
foreach ($name in @('PocketHost.zip', 'Pocket-0.4.2-debug.apk')) {
  $nested = Join-Path $plugin "assets\pocket\release\$name"
  if (Test-Path $nested) { Remove-Item $nested -Force }
}

# Sidecars.
$bin = Join-Path $stage 'bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null
foreach ($exe in @('tsnet-sidecar.exe', 'cloudflared.exe')) {
  $from = Join-Path $repo "tools\$exe"
  if (-not (Test-Path $from)) { throw "missing $from" }
  Copy-Item $from (Join-Path $bin $exe)
}

# Installer scripts at the zip root.
Copy-Item (Join-Path $PSScriptRoot 'host\install.ps1') $stage
Copy-Item (Join-Path $PSScriptRoot 'host\uninstall.ps1') $stage
Copy-Item (Join-Path $PSScriptRoot 'host\README.txt') $stage

if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
Copy-Item $zip (Join-Path $dist 'PocketHost.zip') -Force

$size = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host "PocketHost -> $zip ($size MB)"

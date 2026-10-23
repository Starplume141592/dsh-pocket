# PocketHost one-line installer.
# Usage:
#   irm https://starplume141592.github.io/dsh-pocket/install.ps1 | iex
# Fallback mirror:
#   irm https://pocket.taila66dc2.ts.net/__dshapp/release/install.ps1 | iex
$ErrorActionPreference = 'Stop'

$urls = @(
  'https://github.com/Starplume141592/dsh-pocket/releases/download/native-test/PocketHost.zip',
  'https://pocket.taila66dc2.ts.net/__dshapp/release/PocketHost.zip'
)

$tmp = Join-Path $env:TEMP ("PocketHost-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$zip = Join-Path $tmp 'PocketHost.zip'
$last = $null
foreach ($url in $urls) {
  try {
    Write-Host "Downloading $url"
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -TimeoutSec 120
    $last = $null
    break
  } catch {
    $last = $_
    Write-Host "Failed: $($_.Exception.Message)"
  }
}
if ($last) { throw "Could not download PocketHost.zip: $($last.Exception.Message)" }

Expand-Archive -Path $zip -DestinationPath $tmp -Force
$installer = Join-Path $tmp 'install.ps1'
if (-not (Test-Path $installer)) { throw "PocketHost.zip is invalid: install.ps1 missing" }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer

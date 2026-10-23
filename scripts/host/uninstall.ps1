# Remove the dsh-mobile plugin from every DSH profile.
#   powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
param(
  [string]$DshHome = ''
)

$ErrorActionPreference = 'Continue'
if ([string]::IsNullOrWhiteSpace($DshHome)) {
  $DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
}
$profileRoot = Join-Path $DshHome 'profiles'
if (-not (Test-Path $profileRoot)) { throw "DSH profiles not found at $profileRoot." }

$targets = @(Get-ChildItem $profileRoot -Directory -ErrorAction SilentlyContinue |
  Where-Object { Test-Path (Join-Path $_.FullName 'cordis.patch.yml') })

foreach ($profile in $targets) {
  $target = Join-Path $profile.FullName 'node_modules\dsh-mobile'
  if (Test-Path $target) {
    Remove-Item $target -Recurse -Force
    Write-Host "[$($profile.Name)] removed node_modules\dsh-mobile"
  }
  $patch = Join-Path $profile.FullName 'cordis.patch.yml'
  if (Test-Path $patch) {
    $text = Get-Content $patch -Raw
    $next = [regex]::Replace($text, '(?ms)^\s*-\s*insert:\s*\r?\n\s*-\s*id:\s*dsh-mobile\s*\r?\n\s*name:\s*''dsh-mobile''\s*\r?\n?', '')
    if ($next -ne $text) {
      [System.IO.File]::WriteAllText($patch, $next, [System.Text.UTF8Encoding]::new($false))
      Write-Host "[$($profile.Name)] removed patch entry"
    }
  }
}

Write-Host ''
Write-Host 'Removed. DSH will no longer show the Connect phone card after restart.' -ForegroundColor Yellow
Write-Host "Data kept at $DshHome\.dsh-mobile (devices, tsnet state). Delete it manually if you want a clean reset."

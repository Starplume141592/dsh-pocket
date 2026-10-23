# Remove the dsh-mobile plugin bundle from every DSH profile.
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
  Where-Object { Test-Path (Join-Path $_.FullName 'package.json') })

foreach ($profile in $targets) {
  $link = Join-Path $profile.FullName 'node_modules\dsh-mobile'
  if (Test-Path $link) {
    & cmd /c rmdir "$link" 2>$null
    if (Test-Path $link) { Remove-Item $link -Recurse -Force }
    Write-Host "[$($profile.Name)] removed node_modules\dsh-mobile"
  }
  $pkgFile = Join-Path $profile.FullName 'package.json'
  if (Test-Path $pkgFile) {
    try {
      $pkg = Get-Content $pkgFile -Raw | ConvertFrom-Json
      $changed = $false
      if ($pkg.dependencies -and ($pkg.dependencies.PSObject.Properties.Name -contains 'dsh-mobile')) {
        $pkg.dependencies.PSObject.Properties.Remove('dsh-mobile')
        $changed = $true
      }
      if ($pkg.dsh -and $pkg.dsh.profile -and $pkg.dsh.profile.bundles -contains 'dsh-mobile') {
        $pkg.dsh.profile.bundles = @($pkg.dsh.profile.bundles | Where-Object { $_ -ne 'dsh-mobile' })
        $changed = $true
      }
      if ($changed) {
        [System.IO.File]::WriteAllText($pkgFile, ($pkg | ConvertTo-Json -Depth 32), [System.Text.UTF8Encoding]::new($false))
        Write-Host "[$($profile.Name)] removed dsh-mobile dependency/bundle"
      }
    } catch { Write-Host "[$($profile.Name)] package.json skipped: $($_.Exception.Message)" }
  }
  $patch = Join-Path $profile.FullName 'cordis.patch.yml'
  if (Test-Path $patch) {
    $text = Get-Content $patch -Raw
    $next = [regex]::Replace($text, '(?ms)^\s*-\s*insert:\s*\r?\n\s*-\s*id:\s*dsh-mobile\s*\r?\n\s*name:\s*''dsh-mobile''\s*\r?\n?', '')
    if ($next -ne $text) {
      [System.IO.File]::WriteAllText($patch, $next, [System.Text.UTF8Encoding]::new($false))
      Write-Host "[$($profile.Name)] removed legacy patch entry"
    }
  }
}

$bundle = Join-Path $DshHome 'bundles\dsh-mobile'
if (Test-Path $bundle) {
  Remove-Item $bundle -Recurse -Force
  Write-Host "removed bundle $bundle"
}

Write-Host ''
Write-Host 'Removed. Restart DSH.' -ForegroundColor Yellow
Write-Host "Device/settings data kept at $DshHome\.dsh-mobile. Delete it for a clean reset."

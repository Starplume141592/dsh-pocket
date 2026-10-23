# PocketHost installer: register dsh-mobile as a DSH profile bundle.
# Mirrors the DSHgo install pattern: one shared bundle + a profile dependency,
# so the plugin shows up in DSH's plugin manager and survives updates.
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
  Where-Object { Test-Path (Join-Path $_.FullName 'package.json') })
if ($targets.Count -eq 0) {
  throw "No DSH profile with package.json under $profileRoot."
}

# Shared bundle, one copy for every profile.
$bundle = Join-Path $DshHome 'bundles\dsh-mobile'
if (Test-Path $bundle) { Remove-Item $bundle -Recurse -Force }
New-Item -ItemType Directory -Force -Path $bundle | Out-Null
foreach ($name in @('package.json', 'cordis.patch.yml', 'README.md')) {
  $from = Join-Path $source $name
  if (Test-Path $from) { Copy-Item $from (Join-Path $bundle $name) -Force }
}
foreach ($name in @('lib', 'assets', 'node_modules')) {
  $from = Join-Path $source $name
  if (Test-Path $from) { Copy-Item $from (Join-Path $bundle $name) -Recurse -Force }
}
$bundleLink = $bundle -replace '\\', '/'

# Sidecars used by the plugin.
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
  $nm = Join-Path $profile.FullName 'node_modules'
  New-Item -ItemType Directory -Force -Path $nm | Out-Null
  $link = Join-Path $nm 'dsh-mobile'
  $backup = Join-Path $DshHome "backups\pockethost-$stamp\$($profile.Name)"
  New-Item -ItemType Directory -Force -Path $backup | Out-Null
  if (Test-Path $link) {
    Copy-Item $link (Join-Path $backup 'dsh-mobile') -Recurse -Force -ErrorAction SilentlyContinue
    # A junction is removed without deleting the shared bundle behind it.
    & cmd /c rmdir "$link" 2>$null
    if (Test-Path $link) { Remove-Item $link -Recurse -Force }
  }
  & cmd /c mklink /J "$link" "$bundle" | Out-Null
  if (-not (Test-Path $link)) { throw "Could not create junction $link" }

  $pkgFile = Join-Path $profile.FullName 'package.json'
  Copy-Item $pkgFile (Join-Path $backup 'package.json') -Force -ErrorAction SilentlyContinue
  $pkg = Get-Content $pkgFile -Raw | ConvertFrom-Json
  if (-not $pkg.dependencies) { $pkg | Add-Member -NotePropertyName dependencies -NotePropertyValue (New-Object PSObject) }
  $has = $pkg.dependencies.PSObject.Properties.Name -contains 'dsh-mobile'
  $value = 'link:' + $bundleLink
  if ($has) { $pkg.dependencies.'dsh-mobile' = $value }
  else { $pkg.dependencies | Add-Member -NotePropertyName 'dsh-mobile' -NotePropertyValue $value }
  if (-not $pkg.dsh) { $pkg | Add-Member -NotePropertyName dsh -NotePropertyValue (New-Object PSObject) }
  if (-not $pkg.dsh.profile) { $pkg.dsh | Add-Member -NotePropertyName profile -NotePropertyValue (New-Object PSObject) }
  if (-not $pkg.dsh.profile.bundles) { $pkg.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue @() }
  if (-not ($pkg.dsh.profile.bundles -contains 'dsh-mobile')) {
    $pkg.dsh.profile.bundles = @($pkg.dsh.profile.bundles) + 'dsh-mobile'
  }
  $json = $pkg | ConvertTo-Json -Depth 32
  [System.IO.File]::WriteAllText($pkgFile, $json, (New-Object System.Text.UTF8Encoding($false)))

  # Remove the legacy manual patch entry; the bundle dependency applies it.
  $patch = Join-Path $profile.FullName 'cordis.patch.yml'
  if (Test-Path $patch) {
    $text = Get-Content $patch -Raw
    $next = [regex]::Replace($text, '(?ms)^\s*-\s*insert:\s*\r?\n\s*-\s*id:\s*dsh-mobile\s*\r?\n\s*name:\s*''dsh-mobile''\s*\r?\n?', '')
    if ($next -ne $text) {
      [System.IO.File]::WriteAllText($patch, $next, [System.Text.UTF8Encoding]::new($false))
    }
  }
  Write-Host "[$($profile.Name)] dsh-mobile registered (bundle link)"
}

Write-Host ''
Write-Host 'Done. Restart DSH (quit and reopen).' -ForegroundColor Green
Write-Host 'The plugin appears in DSH Plugins -> Installed as dsh-mobile,'
Write-Host 'and a Phone icon appears in the left sidebar.'

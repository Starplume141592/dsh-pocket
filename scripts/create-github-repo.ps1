# Create the Pocket GitHub repository, set origin, push main + tags, enable Pages.
# Requires: gh auth login (or GH_TOKEN in the environment).
param(
  [string]$Name = 'dsh-pocket',
  [ValidateSet('public', 'private')]
  [string]$Visibility = 'public',
  [string]$Description = 'Pocket - a mobile companion app for DeepSeek Harness: sessions, streaming, approvals.'
)

$ErrorActionPreference = 'Continue'

gh auth status 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw 'GitHub CLI is not logged in. Run: gh auth login'
}

$owner = (gh api user --jq .login 2>$null | Select-Object -First 1)
if ([string]::IsNullOrWhiteSpace($owner)) { throw 'Could not read GitHub user from gh.' }
$full = "$owner/$Name"
Write-Host "Repository: $full" -ForegroundColor Cyan

gh repo view $full --json name 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
  Write-Host "Repository $full already exists." -ForegroundColor Yellow
} else {
  gh repo create $full --$Visibility --description $Description
  if ($LASTEXITCODE -ne 0) { throw "gh repo create failed with exit code $LASTEXITCODE" }
}

$remote = "https://github.com/$full.git"
$current = git remote get-url origin 2>$null
if ($current) {
  git remote set-url origin $remote
} else {
  git remote add origin $remote
}
Write-Host "origin -> $remote" -ForegroundColor Cyan

git push -u origin main
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "git push failed (often the Windows schannel/accelerator issue)." -ForegroundColor Red
  Write-Host "Run this in a normal terminal with the accelerator on:" -ForegroundColor Yellow
  Write-Host "  cd F:\dshapp" -ForegroundColor Yellow
  Write-Host "  git push -u origin main" -ForegroundColor Yellow
  Write-Host "  git push origin --tags" -ForegroundColor Yellow
} else {
  git push origin --tags
}

# Enable GitHub Actions as the Pages source (ignore if already configured).
gh api --method PUT "repos/$full/pages" -f build_type=workflow 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
  Write-Host "Pages source: GitHub Actions" -ForegroundColor Green
} else {
  Write-Host "Pages not enabled automatically; set Settings -> Pages -> Source: GitHub Actions." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Repo:  https://github.com/$full" -ForegroundColor Green
Write-Host "Pages: https://$owner.github.io/$Name/releases/ (after the pages workflow runs)" -ForegroundColor Green
Write-Host "Release assets are created when the v* tag is pushed." -ForegroundColor Green

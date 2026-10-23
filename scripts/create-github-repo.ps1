# Create the Pocket GitHub repository and push the local main branch.
# Requires: gh auth login (or GH_TOKEN in the environment).
param(
  [string]$Name = 'dsh-pocket',
  [ValidateSet('public', 'private')]
  [string]$Visibility = 'public',
  [string]$Description = 'Pocket — a mobile companion app for DeepSeek Harness: sessions, streaming, approvals.'
)

$ErrorActionPreference = 'Stop'

gh auth status 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw 'GitHub CLI is not logged in. Run: gh auth login'
}

$existing = gh repo view $Name --json name 2>$null
if ($LASTEXITCODE -eq 0) {
  Write-Host "Repository $Name already exists; adding remote and pushing." -ForegroundColor Yellow
} else {
  gh repo create $Name --$Visibility --source . --remote origin --push --description $Description
}

if (-not (git remote get-url origin 2>$null)) {
  gh repo set-default $Name
  git remote add origin "https://github.com/$(gh api user --jq .login)/$Name.git"
  git push -u origin main
} else {
  git push -u origin main
}

gh repo edit $Name --add-topic dsh,deepseek-harness,android,pwa,mobile --description $Description
Write-Host "Done: $(gh repo view $Name --json url --jq .url)" -ForegroundColor Green

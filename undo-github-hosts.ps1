# 修复 GitHub 访问：清理 hosts 里 Steam++（Watt Toolkit）和旧脚本写入的映射。
# 用法：
#   预览（不改任何文件，不需要管理员）：.\undo-github-hosts.ps1 -WhatIf
#   实际修复（需要管理员）：右键“以管理员身份运行”，或双击 fix-github-hosts.bat
# 实际修复前会自动备份 hosts -> hosts.bak-时间戳，可随时还原。
[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = 'Stop'
$log = Join-Path $PSScriptRoot 'fix-github-hosts.log'
function Log($m) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
    $line | Tee-Object -FilePath $log -Append | Out-Host
}

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($id)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin -and -not $WhatIfPreference) {
    Log 'ERROR: 需要管理员权限。预览可加 -WhatIf；修复请右键“以管理员身份运行”，或双击 fix-github-hosts.bat'
    exit 1
}

$hosts = Join-Path $env:WINDIR 'System32\drivers\etc\hosts'
if (-not (Test-Path $hosts)) { Log "ERROR: hosts 不存在: $hosts"; exit 1 }

$lines = [System.IO.File]::ReadAllLines($hosts)
$kept = New-Object System.Collections.Generic.List[string]
$inSteam = $false
$removed = 0

foreach ($l in $lines) {
    if ($l -match '^\s*#\s*Steam\+\+\s*Start') { $inSteam = $true;  $removed++; continue }
    if ($l -match '^\s*#\s*Steam\+\+\s*End')   { $inSteam = $false; $removed++; continue }
    if ($inSteam) { $removed++; continue }
    # 本仓库旧脚本写入的固定 IP / 标记
    if ($l -match 'DSH-GITHUB-FIX') { $removed++; continue }
    if ($l -match '^\s*\d{1,3}(\.\d{1,3}){3}\s+(www\.)?github\.com\s*$') { $removed++; continue }
    $kept.Add($l)
}

if (-not $PSCmdlet.ShouldProcess($hosts, "移除 $removed 行 GitHub / Steam++ 映射")) {
    Log "预览：将移除 $removed 行，保留 $($kept.Count) 行；未写入任何文件。"
    return
}

$stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$hosts.bak-$stamp"
Copy-Item $hosts $backup -Force
Log "已备份 hosts -> $backup"

$enc = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($hosts, $kept.ToArray(), $enc)
ipconfig /flushdns | Out-Null
Log "已移除 $removed 行映射（Steam++ 残留或旧固定 IP），DNS 缓存已刷新"

# 自检：github.com 不应再指向回环地址
$ips = @(Resolve-DnsName github.com -Type A -ErrorAction SilentlyContinue |
    Where-Object { $_.Type -eq 'A' } |
    ForEach-Object { $_.IPAddress })
if ($ips.Count -eq 0) {
    Log 'WARN: github.com 仍解析不到，检查网络 / DNS'
} elseif ($ips -contains '127.0.0.1') {
    Log "ERROR: github.com 仍指向 127.0.0.1（$($ips -join ', ')），可能还有别的工具在接管 hosts"
    exit 1
} else {
    Log "自检: github.com -> $($ips -join ', ')"
}

try {
    $r = Invoke-WebRequest -Uri 'https://github.com' -Method Head -TimeoutSec 20 -UseBasicParsing
    Log "自检: https://github.com -> HTTP $($r.StatusCode)"
} catch {
    Log "自检失败（可能只是本机 TLS/代理限制）: $($_.Exception.Message)"
}

Log '完成。浏览器请按 Ctrl+F5 强制刷新。'

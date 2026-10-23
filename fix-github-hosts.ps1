# 已弃用：不要直接运行本脚本（它只钉一个 IP，清不掉 Steam++ 的整段映射）。
# 修复 GitHub 请双击 fix-github-hosts.bat，它会调用 undo-github-hosts.ps1 清理 hosts。
#
# 修复 github.com 直连：把被阻断的边缘 IP 换成可用 IP（写入 hosts）
# 需要管理员权限运行。可随时用 undo-github-hosts.ps1 还原。
param(
    [string]$PinIp = '20.27.177.113'
)

$ErrorActionPreference = 'Stop'
$log = Join-Path $PSScriptRoot 'fix-github-hosts.log'
function Log($m) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
    $line | Tee-Object -FilePath $log -Append | Out-Host
}

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Log 'ERROR: 需要管理员权限，请在开始菜单右键“以管理员身份运行”'
    exit 1
}

$hosts = Join-Path $env:WINDIR 'System32\drivers\etc\hosts'
if (-not (Test-Path $hosts)) { Log "ERROR: hosts 文件不存在: $hosts"; exit 1 }

$stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$hosts.bak-$stamp"
Copy-Item $hosts $backup -Force
Log "已备份 hosts -> $backup"

# hosts 可能被设为只读
$attrs = (Get-Item $hosts).Attributes
if ($attrs -band [System.IO.FileAttributes]::ReadOnly) {
    Set-ItemProperty $hosts -Name Attributes -Value ($attrs -bxor [System.IO.FileAttributes]::ReadOnly)
    Log '已清除 hosts 只读属性'
}

$enc   = New-Object System.Text.UTF8Encoding($false)
$lines = [System.IO.File]::ReadAllLines($hosts)

# 只删除 github.com / www.github.com 这两条的既有映射，其它条目原样保留
$kept = foreach ($l in $lines) {
    if ($l -match 'DSH-GITHUB-FIX') { continue }
    $m = [regex]::Match($l, '^\s*(?<ip>\d{1,3}(?:\.\d{1,3}){3})\s+(?<host>\S+)')
    if ($m.Success -and $m.Groups['host'].Value -match '^(www\.)?github\.com$') { continue }
    $l
}

$block = @(
    "# DSH-GITHUB-FIX $stamp",
    "$PinIp github.com",
    "$PinIp www.github.com"
)
[System.IO.File]::WriteAllLines($hosts, (@($kept) + $block), $enc)
Log "已写入映射: $PinIp -> github.com, www.github.com"

ipconfig /flushdns | Out-Null
Log 'DNS 缓存已刷新'

# 简单自检（失败不视为致命，仅记录）
try {
    $r = Invoke-WebRequest -Uri 'https://github.com' -Method Head -TimeoutSec 15 -UseBasicParsing
    Log "自检: https://github.com -> HTTP $($r.StatusCode)"
} catch {
    Log "自检失败（不影响映射生效）: $($_.Exception.Message)"
}

Log '完成。浏览器请按 Ctrl+F5 强刷，或重开标签页。'

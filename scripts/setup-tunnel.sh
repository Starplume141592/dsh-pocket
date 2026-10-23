#!/usr/bin/env bash
#
# DSH 手机端 · 公网域名向导（Cloudflare Tunnel）
# 生成自 /wizard 技能。整个过程只做你手动做不了/容易漏的事：开网页、告诉你点哪里、
# 跑 cloudflared 命令、写 config.yml、验证健康检查。
#
# 运行：在 Git Bash 里执行
#   bash scripts/setup-tunnel.sh

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────
# Wizard library: delightful, consistent UX, identical across every wizard.
# ──────────────────────────────────────────────────────────────────────────

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
  BLUE=$(tput setaf 4); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3); RED=$(tput setaf 1)
else
  BOLD=""; DIM=""; RESET=""; BLUE=""; GREEN=""; YELLOW=""; RED=""
fi

TOTAL_STAGES=0

_STAGE_INDEX=0
ENV_FILE="${ENV_FILE:-.env}"
WRITTEN_ENV=()
WRITTEN_SECRET=()
SKIPPED=()

_clear() {
  [[ -t 1 ]] || return 0
  if command -v tput >/dev/null 2>&1; then tput clear; else printf '\033[2J\033[3J\033[H'; fi
}

banner() {
  _clear
  printf '\n%s%s  %s%s\n' "$BOLD" "$BLUE" "$1" "$RESET"
  printf '%s  %s stages%s\n\n' "$DIM" "$TOTAL_STAGES" "$RESET"
  printf '%s  You drive the browser; this wizard tells you exactly what to do and\n' "$DIM"
  printf '  captures the values you copy back. Stop any time with Ctrl-C and re-run\n'
  printf '  later, since it remembers values already saved.%s\n' "$RESET"
  pause "Ready to start?"
}

stage() {
  _clear
  _STAGE_INDEX=$((_STAGE_INDEX + 1))
  printf '\n%s%s▸ Stage %s/%s · %s%s\n' \
    "$BOLD" "$BLUE" "$_STAGE_INDEX" "$TOTAL_STAGES" "$1" "$RESET"
}

say()  { printf '  %s\n' "$1"; }
step() { printf '  %s•%s %s\n' "$BLUE" "$RESET" "$1"; }
note() { printf '  %s%s%s\n' "$DIM" "$1" "$RESET"; }
warn() { printf '  %s⚠ %s%s\n' "$YELLOW" "$1" "$RESET"; }

open_url() {
  local url="$1"
  printf '  %s↗ opening%s %s\n' "$GREEN" "$RESET" "$url"
  { if   command -v wslview     >/dev/null 2>&1; then wslview "$url"
    elif command -v explorer.exe >/dev/null 2>&1; then explorer.exe "$url"
    elif command -v xdg-open    >/dev/null 2>&1; then xdg-open "$url"
    elif command -v open        >/dev/null 2>&1; then open "$url"
    else warn "couldn't open a browser; visit it manually: $url"; fi
  } >/dev/null 2>&1 || warn "couldn't open a browser, so visit it manually: $url"
}

pause() {
  printf '  %s%s%s ' "$DIM" "${1:-Press Enter to continue}" "$RESET"
  read -r _ || true
}

confirm() {
  local reply=""
  printf '  %s? %s [y/N] ' "$YELLOW" "$1"
  read -r reply || true
  [[ "$reply" =~ ^[Yy] ]]
}

_existing() {
  [[ -f "$ENV_FILE" ]] || return 1
  local line; line=$(grep -E "^${1}=" "$ENV_FILE" | tail -n1) || return 1
  printf '%s' "${line#*=}"
}

ask() {
  local key="$1" prompt="$2" current input
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[Enter keeps current]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -r input || true
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

ask_secret() {
  local key="$1" prompt="$2" current input
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[Enter keeps current]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -rs input || true
  printf '\n'
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

write_env() {
  local key="$1" value="$2" tmp
  touch "$ENV_FILE"
  tmp=$(mktemp)
  grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  WRITTEN_ENV+=("$key")
  printf '  %s✓ wrote%s %s → %s\n' "$GREEN" "$RESET" "$key" "$ENV_FILE"
}

set_secret() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if printf '%s' "$value" | gh secret set "$name" >/dev/null 2>&1; then
      WRITTEN_SECRET+=("$name")
      printf '  %s✓ set%s GitHub secret %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("GitHub secret $name (set it manually: gh secret set $name)")
  warn "skipped GitHub secret $name: gh not ready; set it later"
}

set_var() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if gh variable set "$name" --body "$value" >/dev/null 2>&1; then
      printf '  %s✓ set%s GitHub variable %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("GitHub variable $name")
  warn "skipped GitHub variable $name, gh not ready; set it later"
}

finish() {
  _clear
  printf '\n%s%s  ✓ Setup complete%s\n' "$BOLD" "$GREEN" "$RESET"
  (( ${#WRITTEN_ENV[@]} ))    && note "wrote ${#WRITTEN_ENV[@]} value(s) to $ENV_FILE: ${WRITTEN_ENV[*]}"
  (( ${#WRITTEN_SECRET[@]} )) && note "set ${#WRITTEN_SECRET[@]} GitHub secret(s): ${WRITTEN_SECRET[*]}"
  if (( ${#SKIPPED[@]} )); then
    printf '\n'; warn "still to do by hand:"
    for s in "${SKIPPED[@]}"; do note "  - $s"; done
  fi
  printf '\n'
}

# ──────────────────────────────────────────────────────────────────────────
# STAGES
# ──────────────────────────────────────────────────────────────────────────

TOTAL_STAGES=6

banner "DSH 手机端 · 公网域名（Cloudflare Tunnel）"

# ── Stage 1 ────────────────────────────────────────────────────────────────
stage "域名接入 Cloudflare"
say "先把一个域名交给 Cloudflare 托管；之后隧道和 HTTPS 证书都由它免费提供。"
open_url "https://dash.cloudflare.com"
step "Add a site → 输入你的域名 → 选 Free 计划。"
step "Cloudflare 会给你两个 nameserver，去域名注册商后台改成它们。"
step "等 Cloudflare 面板显示 Active（几分钟到几小时）。"
note "还没有域名的话，先在阿里云/腾讯云/Namecheap 买一个，再回来。"
ask DOMAIN "已接入 Cloudflare 的完整域名（例如 dsh.example.com）："
if [[ -z "${DOMAIN:-}" ]]; then
  warn "域名不能为空，先准备好再来。"
  exit 1
fi
write_env DSH_MOBILE_DOMAIN "$DOMAIN"
pause "确认 $DOMAIN 在 Cloudflare 里已经是 Active 状态后按 Enter。"

# ── Stage 2 ────────────────────────────────────────────────────────────────
stage "安装 cloudflared"
if command -v cloudflared >/dev/null 2>&1; then
  say "已经找到：$(cloudflared --version 2>&1 | head -n1)"
else
  say "还没装。推荐用 winget（Windows 自带）："
  printf '    %swinget install --id Cloudflare.cloudflared -e%s\n' "$BOLD" "$RESET"
  say "装完重新打开一个 Git Bash 窗口，再回来按 Enter。"
  open_url "https://github.com/cloudflare/cloudflared/releases/latest"
  pause "装好后按 Enter；向导会再检查一次。"
  if ! command -v cloudflared >/dev/null 2>&1; then
    warn "还是找不到 cloudflared。把它加进 PATH，或用完整路径重跑向导。"
    exit 1
  fi
fi

# ── Stage 3 ────────────────────────────────────────────────────────────────
stage "登录 Cloudflare 并创建隧道"
say "接下来会打开浏览器让你授权，选择刚才的域名即可。"
pause "按 Enter 打开登录页。"
cloudflared tunnel login

say "创建一条名为 dsh-mobile 的隧道……"
CREATE_OUT="$(cloudflared tunnel create dsh-mobile 2>&1 || true)"
printf '%s\n' "$CREATE_OUT"
TUNNEL_ID="$(printf '%s' "$CREATE_OUT" | grep -oE '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' | head -n1 || true)"
if [[ -z "$TUNNEL_ID" ]]; then
  warn "没从输出里认出隧道 UUID（可能同名隧道已存在）。"
  TUNNEL_ID="$(cloudflared tunnel list 2>/dev/null | awk '$2=="dsh-mobile" {print $1; exit}')"
fi
if [[ -z "$TUNNEL_ID" ]]; then
  ask TUNNEL_ID "请粘贴隧道 UUID（cloudflared tunnel list 里 dsh-mobile 那一行）："
fi
[[ -n "$TUNNEL_ID" ]] || { warn "没有 UUID，无法继续。"; exit 1; }
write_env CLOUDFLARE_TUNNEL_ID "$TUNNEL_ID"
note "隧道 UUID：$TUNNEL_ID"

# ── Stage 4 ────────────────────────────────────────────────────────────────
stage "写 cloudflared 配置"
CF_DIR="$HOME/.cloudflared"
mkdir -p "$CF_DIR"
CRED_FILE="$CF_DIR/$TUNNEL_ID.json"
if [[ ! -f "$CRED_FILE" ]]; then
  warn "找不到凭据文件 $CRED_FILE。先确认隧道创建成功。"
  exit 1
fi
if [[ -f "$CF_DIR/config.yml" ]]; then
  cp "$CF_DIR/config.yml" "$CF_DIR/config.yml.bak.$(date +%Y%m%d-%H%M%S)"
  note "已备份原 config.yml"
fi
# cloudflared 是 Windows 程序，凭据路径要 Windows 形式；Git Bash 下用 cygpath。
if command -v cygpath >/dev/null 2>&1; then
  CRED_WIN="$(cygpath -w "$CRED_FILE")"
else
  CRED_WIN="$CRED_FILE"
fi
cat > "$CF_DIR/config.yml" <<EOF
tunnel: $TUNNEL_ID
credentials-file: $CRED_WIN

ingress:
  - hostname: $DOMAIN
    service: http://127.0.0.1:8470
  - service: http_status:404
EOF
say "已写入 $CF_DIR/config.yml："
note "  tunnel: $TUNNEL_ID"
note "  hostname: $DOMAIN → http://127.0.0.1:8470"
note "如果改过插件端口（默认 8470），记得同步这里的 service。"
pause "确认无误后按 Enter。"

# ── Stage 5 ────────────────────────────────────────────────────────────────
stage "绑定域名并验证"
say "给域名建一条指向隧道的 DNS 记录……"
cloudflared tunnel route dns dsh-mobile "$DOMAIN" || warn "DNS 路由可能已存在，继续。"
say "临时启动隧道做健康检查（约 10 秒）……"
cloudflared tunnel run dsh-mobile >/tmp/dsh-mobile-tunnel.log 2>&1 &
TUNNEL_PID=$!
sleep 8
if curl -fsS --max-time 15 "https://$DOMAIN/__dshm/health" >/tmp/dsh-mobile-health.json 2>/tmp/dsh-mobile-health.err; then
  printf '  %s✓ 公网健康检查通过%s：%s\n' "$GREEN" "$RESET" "$(cat /tmp/dsh-mobile-health.json)"
else
  warn "健康检查失败。先确认 DSH 正在运行、插件已加载（本机 http://127.0.0.1:8470/__dshm/health）。"
  note "隧道日志：/tmp/dsh-mobile-tunnel.log"
  tail -n 15 /tmp/dsh-mobile-tunnel.log || true
fi
kill "$TUNNEL_PID" 2>/dev/null || true
wait "$TUNNEL_PID" 2>/dev/null || true

# ── Stage 6 ────────────────────────────────────────────────────────────────
stage "常驻运行 + 在 DSH 里填地址"
say "让隧道开机自启（需要管理员 PowerShell）："
printf '    %scloudflared service install%s\n' "$BOLD" "$RESET"
printf '    %ssc.exe start cloudflared%s\n' "$BOLD" "$RESET"
note "不想用管理员权限：任务计划程序 → 登录时运行 cloudflared tunnel run dsh-mobile。"
say ""
say "最后在 DSH 里完成配对："
step "打开 DSH → 设置 → 连接手机。"
step "公网地址填 https://$DOMAIN ，点保存。"
step "点「生成配对二维码」，手机扫码，电脑上核对 6 位码并批准。"
step "手机浏览器菜单 →「添加到主屏幕」。"
note "以后手机从主屏幕打开，就是全屏 App；电脑端 DSH 关掉时手机打不开，属正常。"

finish

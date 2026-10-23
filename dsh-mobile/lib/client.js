/**
 * dsh-mobile — 设置页「连接手机」卡片（client 半）。
 *
 * 与内核同源调用 /plugins/dsh-mobile/api/*：生成配对二维码、批准/拒绝、
 * 查看与吊销设备、设置公网地址。真正的手机网关在 host 半。
 */
window.__ModuleLoader__.load({
  id: "dsh-mobile",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var react = require("react");
    var h = react.createElement;

    var CSS =
      ".__dm_root{max-width:680px;display:flex;flex-direction:column;gap:12px}" +
      ".__dm_row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}" +
      ".__dm_title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);margin:2px 0 0}" +
      ".__dm_hint{font-size:12px;line-height:1.65;color:var(--dsw-alias-label-tertiary);margin:0}" +
      ".__dm_err{font-size:12px;line-height:1.6;color:var(--dsw-alias-state-error-primary)}" +
      ".__dm_badge{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 10px;font-size:12px;color:var(--dsw-alias-label-secondary)}" +
      ".__dm_dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-business-primary)}" +
      ".__dm_btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:9px;padding:6px 14px;font:inherit;font-size:13px;cursor:pointer}" +
      ".__dm_btn:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary)}" +
      ".__dm_btn:disabled{opacity:.5;cursor:default}" +
      ".__dm_primary{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-on-accent)}" +
      ".__dm_danger{color:var(--dsw-alias-state-error-primary)}" +
      ".__dm_qr{background:#fff;border-radius:14px;padding:12px;display:inline-block;line-height:0}" +
      ".__dm_code{font:600 26px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.22em;color:var(--dsw-alias-label-primary)}" +
      ".__dm_url{font-size:12px;word-break:break-all;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:8px 10px;flex:1 1 260px;min-width:0}" +
      ".__dm_input{font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:7px 10px;flex:1 1 260px;min-width:0}" +
      ".__dm_list{display:flex;flex-direction:column;gap:8px}" +
      ".__dm_item{display:flex;align-items:center;gap:10px;flex-wrap:wrap;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px 10px;background:var(--dsw-alias-bg-layer-2)}" +
      ".__dm_itemMain{flex:1 1 200px;min-width:0}" +
      ".__dm_itemName{font-size:13px;color:var(--dsw-alias-label-primary)}" +
      ".__dm_itemMeta{font-size:11px;color:var(--dsw-alias-label-tertiary)}" +
      ".__dm_online{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#3fb950);display:inline-block;margin-right:6px}" +
      ".__dm_offline{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-border-l2);display:inline-block;margin-right:6px}" +
      ".__dm_field{display:flex;flex-direction:column;gap:4px;flex:1 1 220px;min-width:0}" +
      ".__dm_label{font-size:12px;color:var(--dsw-alias-label-secondary)}" +
      ".__dm_select{font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:7px 10px}" +
      ".__dm_ok{font-size:12px;color:var(--dsw-alias-state-success-primary,#3fb950)}";

    var tagId = "dsh-mobile/main.css";
    if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "dsh-mobile";
      tag.dataset.pluginCss = tagId;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    var NS = "dsh-mobile";
    var inject = ["slots", "locale"];

    var zh = {
      nav: "连接手机",
      intro:
        "用手机浏览器扫码配对，之后可把 DSH 安装到主屏幕，像 App 一样使用电脑上的完整 DSH：会话、输入、审批、文件与设置。电脑端无需开放公网端口，推荐用 Cloudflare Tunnel 绑定自己的域名。",
      running: "网关运行中（端口 {port}）",
      stopped: "网关未运行",
      mobileEnable: "启用手机端",
      mobileHint: "关闭后网关、通知、隧道、内嵌 Funnel 全部停止；桌面设置卡仍可用，随时可以再打开。",
      mobileDisabled: "手机端已停用。打开上面的开关后，再生成配对二维码。",
      reachable: "手机可达地址",
      unreachable:
        "当前网关只监听 127.0.0.1，手机无法直接访问。请先填写公网地址，或在插件配置里把 bind 改为 0.0.0.0（仅限可信局域网）。",
      publicUrl: "公网地址",
      publicUrlHint: "例如 https://dsh.example.com；留空则使用局域网地址。保存后二维码会立即使用新地址。",
      lanLabel: "允许局域网直连",
      lanHint: "打开后网关监听 0.0.0.0，同一 Wi-Fi 的手机可以直接访问；流量是明文 HTTP，只建议在可信网络临时开启。",
      probe: "测试公网入口",
      probeOk: "公网入口正常（{ms} ms）",
      probeFail: "公网入口失败：{err}",
      save: "保存",
      saved: "已保存",
      start: "生成配对二维码",
      restart: "重新生成",
      waiting: "等待手机扫码…",
      approve: "批准",
      reject: "拒绝",
      approved: "已批准，等待手机进入…",
      expired: "二维码已过期，请重新生成。",
      rejected: "已拒绝这次配对。",
      code: "配对码",
      qrHint: "手机扫码后，请在这里核对屏幕上的配对码并批准。",
      installHint: "配对成功后：手机浏览器菜单 →「添加到主屏幕」，即可获得全屏 App 图标。",
      devices: "已配对设备",
      noDevices: "还没有配对的设备。",
      revoke: "吊销",
      lastSeen: "最近使用",
      copy: "复制链接",
      copied: "已复制",
      err: "操作失败：{msg}",
      unknown: "未知",
      online: "在线",
      offline: "离线",
      rename: "重命名",
      renamePrompt: "给这台设备起个名字",
      expires: "剩余 {t}",
      tunnelTitle: "公网隧道",
      tunnelHint:
        "让插件自己启动 cloudflared。临时隧道不用账号、一键可用，但每次重启地址都会变（手机需要重新配对）；固定隧道要自己的域名和 Cloudflare token，并把上面的公网地址填成你绑定的域名。已有手动开的隧道时先停掉再托管。",
      tunnelModeOff: "不用托管（手动开隧道）",
      tunnelModeQuick: "临时隧道（trycloudflare）",
      tunnelModeToken: "固定隧道（Cloudflare token）",
      tunnelToken: "隧道 token",
      tunnelTokenHint: "Cloudflare Zero Trust → Networks → Tunnels 创建后复制 token。保存后不会回显，留空表示不修改。",
      tunnelAuto: "DSH 启动时自动拉起隧道",
      tunnelStart: "启动隧道",
      tunnelStop: "停止隧道",
      tunnelRunning: "隧道运行中",
      tunnelStopped: "隧道未运行",
      tunnelNoBin: "没找到 cloudflared：把 cloudflared.exe 放到数据目录的 bin 下，或运行 install.ps1。",
      tunnelChangeHint: "地址变化后，已安装的手机 App 需要重新扫码配对。",
      tsnetTitle: "内嵌 Funnel（免安装）",
      tsnetHint:
        "在插件里跑一个用户态 Tailscale 节点，给手机一个固定 HTTPS 地址；不用装 Tailscale、不用管理员、不用开端口。首次启用要扫码登录 Tailscale，并在控制台开一次 HTTPS + Funnel。",
      tsnetEnable: "启用内嵌 Funnel",
      tsnetStart: "启动",
      tsnetStop: "停止",
      tsnetLogin: "打开登录页",
      tsnetNoBin: "没找到 tsnet-sidecar：把它放到数据目录的 bin 下，或用 sidecar workflow 构建一个。",
      tsnetFirstRun: "第一次用：先点「启动」，出现登录链接后用浏览器登录；再到控制台开启 HTTPS 和 Funnel，地址会自动回填。",
      tsnetHostHint: "主机名 {host}，对应 https://{host}.<tailnet>.ts.net；想换名改 state.json 的 tsnet.hostname。",
      tsnetPhaseStarting: "正在启动…",
      tsnetPhaseConnecting: "正在连接 Tailscale…",
      tsnetPhaseNeedLogin: "等待登录 Tailscale",
      tsnetPhaseServing: "Funnel 运行中",
      tsnetPhaseError: "启动失败",
      tsnetPhaseStopped: "未运行",
      tsnetAuto: "DSH 启动时自动启动内嵌 Funnel",
      notifyTitle: "手机通知",
      notifyHint: "任务完成、等待批准、运行失败时推送到手机。需要 HTTPS 公网地址，并在手机上允许通知。",
      notifyExternal: "检测到 meow-smooth，通知由它发送（避免重复推送）。",
      notifyUnavailable: "推送依赖 web-push，当前没有安装成功。",
      notifyEnable: "启用通知",
      notifySubs: "已订阅 {n} 个设备",
      notifyTest: "发送测试通知",
      notifyTestOk: "已发送（{sent} 个订阅）",
      notifyTestFail: "发送失败：{err}",
    };

    var en = {
      nav: "Connect Phone",
      intro:
        "Scan with your phone to pair, then add DSH to your home screen and use the full desktop DSH — sessions, input, approvals, files and settings. No public port needed on the PC; a Cloudflare Tunnel with your own domain is recommended.",
      running: "Gateway running (port {port})",
      stopped: "Gateway is not running",
      mobileEnable: "Enable mobile",
      mobileHint: "Turning this off stops the gateway, notifications, tunnel and embedded Funnel. This settings card stays available.",
      mobileDisabled: "Mobile is off. Turn the switch on, then generate a new pairing QR code.",
      reachable: "Phone-reachable address",
      unreachable:
        "The gateway only listens on 127.0.0.1, so a phone cannot reach it. Set a public URL, or set bind to 0.0.0.0 for a trusted LAN.",
      publicUrl: "Public URL",
      publicUrlHint: "For example https://dsh.example.com; leave empty to use the LAN address. Saving updates the QR code immediately.",
      lanLabel: "Allow LAN access",
      lanHint: "Listens on 0.0.0.0 so phones on the same Wi-Fi can connect directly. Traffic is plain HTTP; enable only on a trusted network.",
      probe: "Test public URL",
      probeOk: "Public URL is reachable ({ms} ms)",
      probeFail: "Public URL failed: {err}",
      save: "Save",
      saved: "Saved",
      start: "Show pairing QR",
      restart: "Pair again",
      waiting: "Waiting for the phone…",
      approve: "Approve",
      reject: "Reject",
      approved: "Approved — waiting for the phone…",
      expired: "The QR code expired. Generate a new one.",
      rejected: "Pairing rejected.",
      code: "Pairing code",
      qrHint: "After scanning, check the code shown on the phone and approve here.",
      installHint: "After pairing: browser menu → Add to Home Screen for a full-screen app icon.",
      devices: "Paired devices",
      noDevices: "No devices paired yet.",
      revoke: "Revoke",
      lastSeen: "Last used",
      copy: "Copy link",
      copied: "Copied",
      err: "Request failed: {msg}",
      unknown: "Unknown",
      online: "Online",
      offline: "Offline",
      rename: "Rename",
      renamePrompt: "Name this device",
      expires: "{t} left",
      tunnelTitle: "Public tunnel",
      tunnelHint:
        "Let the plugin run cloudflared. A quick tunnel needs no account but its URL changes on every restart (phones must pair again); a named tunnel needs your domain and a Cloudflare token, and the public URL above must be that domain. Stop any manually started tunnel first.",
      tunnelModeOff: "No managed tunnel",
      tunnelModeQuick: "Quick tunnel (trycloudflare)",
      tunnelModeToken: "Named tunnel (Cloudflare token)",
      tunnelToken: "Tunnel token",
      tunnelTokenHint: "Create a tunnel in Cloudflare Zero Trust → Networks → Tunnels, then paste its token. It is never shown again; leave blank to keep the saved one.",
      tunnelAuto: "Start the tunnel when DSH starts",
      tunnelStart: "Start tunnel",
      tunnelStop: "Stop tunnel",
      tunnelRunning: "Tunnel running",
      tunnelStopped: "Tunnel stopped",
      tunnelNoBin: "cloudflared not found: put cloudflared.exe under the data dir's bin/, or run install.ps1.",
      tunnelChangeHint: "When the URL changes, the installed phone app has to pair again.",
      tsnetTitle: "Embedded Funnel (no install)",
      tsnetHint:
        "Run a userspace Tailscale node inside the plugin and give the phone a fixed HTTPS URL. No Tailscale install, no admin rights, no open ports. First run needs a Tailscale login and a one-time HTTPS + Funnel enable in the admin console.",
      tsnetEnable: "Enable embedded Funnel",
      tsnetStart: "Start",
      tsnetStop: "Stop",
      tsnetLogin: "Open login page",
      tsnetNoBin: "tsnet-sidecar not found: put it under the data dir's bin/, or build it with the sidecar workflow.",
      tsnetFirstRun: "First run: click Start, open the login link in a browser, then enable HTTPS and Funnel in the admin console; the URL is filled in automatically.",
      tsnetHostHint: "Hostname {host} gives https://{host}.<tailnet>.ts.net; change tsnet.hostname in state.json to rename.",
      tsnetPhaseStarting: "Starting…",
      tsnetPhaseConnecting: "Connecting to Tailscale…",
      tsnetPhaseNeedLogin: "Waiting for Tailscale login",
      tsnetPhaseServing: "Funnel running",
      tsnetPhaseError: "Start failed",
      tsnetPhaseStopped: "Stopped",
      tsnetAuto: "Start embedded Funnel when DSH starts",
      notifyTitle: "Phone notifications",
      notifyHint: "Push task completion, pending approvals and failures to the phone. Requires an HTTPS public URL and notification permission on the phone.",
      notifyExternal: "meow-smooth is installed and provides notifications (avoids duplicates).",
      notifyUnavailable: "Push needs web-push, which did not load.",
      notifyEnable: "Enable notifications",
      notifySubs: "{n} device subscription(s)",
      notifyTest: "Send test notification",
      notifyTestOk: "Sent ({sent} subscription(s))",
      notifyTestFail: "Failed: {err}",
    };

    function api(path, options) {
      var init = Object.assign({ headers: { "content-type": "application/json" } }, options || {});
      return fetch("/plugins/dsh-mobile/api" + path, init).then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok) throw new Error((body && body.error) || "HTTP " + res.status);
          return body;
        });
      });
    }

    function when(ts) {
      if (!ts) return "";
      try {
        return new Date(ts).toLocaleString();
      } catch (e) {
        return "";
      }
    }

    function ago(ts) {
      if (!ts) return "";
      var diff = Date.now() - ts;
      if (diff < 60 * 1000) return "刚刚";
      if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + " 分钟前";
      if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / 3600000) + " 小时前";
      return Math.floor(diff / 86400000) + " 天前";
    }

    function clockLeft(ts) {
      if (!ts) return "";
      var left = Math.max(0, ts - Date.now());
      var seconds = Math.floor(left / 1000);
      return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
    }

    function platformOf(ua) {
      if (!ua) return "";
      var platform = /iPhone/i.test(ua)
        ? "iPhone"
        : /iPad/i.test(ua)
          ? "iPad"
          : /Android/i.test(ua)
            ? "Android"
            : /Windows/i.test(ua)
              ? "Windows"
              : /Macintosh|Mac OS X/i.test(ua)
                ? "Mac"
                : "";
      var browser = /EdgA?\/|Edg\//i.test(ua)
        ? "Edge"
        : /MicroMessenger/i.test(ua)
          ? "微信"
          : /CriOS|Chrome\//i.test(ua)
            ? "Chrome"
            : /FxiOS|Firefox\//i.test(ua)
              ? "Firefox"
              : /Safari\//i.test(ua)
                ? "Safari"
                : "";
      return [platform, browser].filter(Boolean).join(" · ") || "手机";
    }

    function Section(props) {
      var t = props.t;
      var [state, setState] = react.useState(null);
      var [error, setError] = react.useState(null);
      var [busy, setBusy] = react.useState(false);
      var [draft, setDraft] = react.useState("");
      var [lanDraft, setLanDraft] = react.useState(null);
      var [probe, setProbe] = react.useState(null);
      var [copied, setCopied] = react.useState(false);
      var [saved, setSaved] = react.useState(false);
      var [tunnelToken, setTunnelToken] = react.useState("");
      var [notifyResult, setNotifyResult] = react.useState(null);
      var aliveRef = react.useRef(true);
      var draftDirty = react.useRef(false);

      function refresh() {
        return api("/state")
          .then(function (next) {
            if (!aliveRef.current) return;
            setState(next);
            setDraft(function (current) {
              if (draftDirty.current) return current;
              return next.publicUrl || "";
            });
            setLanDraft((current) => (current === null ? Boolean(next.lan) : current));
            setError(null);
          })
          .catch(function (e) {
            if (aliveRef.current) setError(String((e && e.message) || e));
          });
      }

      react.useEffect(function () {
        refresh();
        var timer = setInterval(refresh, 2000);
        return function () {
          aliveRef.current = false;
          clearInterval(timer);
        };
      }, []);

      function run(fn) {
        setBusy(true);
        setError(null);
        fn()
          .then(function () {
            if (aliveRef.current) setBusy(false);
            return refresh();
          })
          .catch(function (e) {
            if (!aliveRef.current) return;
            setBusy(false);
            setError(String((e && e.message) || e));
          });
      }

      function startPairing() {
        run(function () {
          return api("/pair/start", { method: "POST", body: "{}" }).then(function (res) {
            if (res && res.pairing) setState(function (prev) { return Object.assign({}, prev, { pairing: res.pairing }); });
          });
        });
      }

      function decide(approve) {
        run(function () {
          return api("/pair/decide", { method: "POST", body: JSON.stringify({ approve: approve }) });
        });
      }

      function saveUrl() {
        run(function () {
          return api("/settings", {
            method: "POST",
            body: JSON.stringify({ publicUrl: draft.trim(), lan: Boolean(lanDraft) }),
          }).then(function () {
            draftDirty.current = false;
            if (aliveRef.current) {
              setSaved(true);
              setTimeout(function () {
                if (aliveRef.current) setSaved(false);
              }, 1500);
            }
          });
        });
      }

      function runProbe() {
        setBusy(true);
        setProbe(null);
        api("/probe", { method: "POST", body: "{}" })
          .then(function (result) {
            if (aliveRef.current) setProbe(result);
          })
          .catch(function (e) {
            if (aliveRef.current) setProbe({ ok: false, error: String((e && e.message) || e) });
          })
          .then(function () {
            if (aliveRef.current) setBusy(false);
          });
      }

      function revoke(id) {
        if (typeof window !== "undefined" && !window.confirm(t("revoke") + "?")) return;
        run(function () {
          return api("/devices/revoke", { method: "POST", body: JSON.stringify({ id: id }) });
        });
      }

      function rename(device) {
        if (typeof window === "undefined") return;
        var next = window.prompt(t("renamePrompt"), device.name || "");
        if (next === null) return;
        var name = next.trim();
        if (!name || name === device.name) return;
        run(function () {
          return api("/devices/rename", { method: "POST", body: JSON.stringify({ id: device.id, name: name }) });
        });
      }

      function saveSettings(patch) {
        run(function () {
          return api("/settings", {
            method: "POST",
            body: JSON.stringify(Object.assign({ publicUrl: draft.trim(), lan: Boolean(lanDraft) }, patch)),
          });
        });
      }

      function toggleNotify(enabled) {
        run(function () {
          return api("/notify", { method: "POST", body: JSON.stringify({ enabled: enabled }) });
        });
      }

      function toggleMobile(enabled) {
        run(function () {
          return api("/mobile/enable", { method: "POST", body: JSON.stringify({ enabled: enabled }) });
        });
      }

      function testNotify() {
        setBusy(true);
        setNotifyResult(null);
        api("/notify/test", { method: "POST", body: "{}" })
          .then(function (result) {
            if (aliveRef.current) setNotifyResult({ ok: true, sent: result.sent || 0 });
          })
          .catch(function (e) {
            if (aliveRef.current) setNotifyResult({ ok: false, error: String((e && e.message) || e) });
          })
          .then(function () {
            if (aliveRef.current) setBusy(false);
          });
      }

      function tunnelAction(action) {
        run(function () {
          return api("/tunnel/" + action, { method: "POST", body: "{}" });
        });
      }

      function tsnetAction(action) {
        run(function () {
          return api("/tsnet/" + action, { method: "POST", body: "{}" });
        });
      }

      function tsnetPhase(phase) {
        var key =
          phase === "starting"
            ? "tsnetPhaseStarting"
            : phase === "connecting"
              ? "tsnetPhaseConnecting"
              : phase === "need-login"
                ? "tsnetPhaseNeedLogin"
                : phase === "serving"
                  ? "tsnetPhaseServing"
                  : phase === "error"
                    ? "tsnetPhaseError"
                    : "tsnetPhaseStopped";
        return t(key);
      }

      function copyLink(url) {
        if (!url) return;
        var done = function () {
          setCopied(true);
          setTimeout(function () {
            if (aliveRef.current) setCopied(false);
          }, 1500);
        };
        var legacy = function () {
          var ta = document.createElement("textarea");
          ta.value = url;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          try {
            document.execCommand("copy");
          } catch (e) {}
          document.body.removeChild(ta);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(done, function () {
            legacy();
            done();
          });
        } else {
          legacy();
          done();
        }
      }

      if (!state) {
        return h("div", { className: "__dm_root" }, h("p", { className: "__dm_hint" }, t("intro")), error ? h("p", { className: "__dm_err" }, t("err").replace("{msg}", error)) : null);
      }

      var pairing = state.pairing;
      var pairingState = pairing ? pairing.state : null;
      var qrSrc = pairing && pairing.token ? "/plugins/dsh-mobile/api/qr?token=" + encodeURIComponent(pairing.token) + "&v=" + pairing.expiresAt : null;
      var tunnelState = state.tunnel || null;
      var tunnelMode = tunnelState ? tunnelState.mode : "off";
      var tsnetState = state.tsnet || null;
      var mobileEnabled = !state.mobile || state.mobile.enabled !== false;
      var mobileSwitch = h(
        "label",
        { className: "__dm_row", style: { gap: "8px", cursor: "pointer", alignItems: "center" } },
        h("input", {
          type: "checkbox",
          checked: mobileEnabled,
          disabled: busy,
          onChange: function (e) { toggleMobile(e.target.checked); },
        }),
        h("span", { className: "__dm_hint" }, t("mobileEnable")),
      );

      if (!mobileEnabled) {
        return h(
          "div",
          { className: "__dm_root" },
          h("p", { className: "__dm_hint" }, t("intro")),
          mobileSwitch,
          h("p", { className: "__dm_hint" }, t("mobileHint")),
          h("p", { className: "__dm_hint" }, t("mobileDisabled")),
        );
      }

      return h(
        "div",
        { className: "__dm_root" },
        h("p", { className: "__dm_hint" }, t("intro")),
        mobileSwitch,
        h("p", { className: "__dm_hint" }, t("mobileHint")),
        h(
          "div",
          { className: "__dm_row" },
          h("span", { className: "__dm_badge" }, h("span", { className: "__dm_dot" }), state.running ? t("running").replace("{port}", String(state.port)) : t("stopped")),
          state.reachable ? h("span", { className: "__dm_badge" }, t("reachable"), ": ", state.appUrl) : null,
        ),
        !state.reachable ? h("p", { className: "__dm_err" }, t("unreachable")) : null,
        h(
          "div",
          { className: "__dm_row" },
          h("span", { className: "__dm_hint", style: { minWidth: "64px" } }, t("publicUrl")),
          h("input", {
            className: "__dm_input",
            value: draft,
            placeholder: "https://dsh.example.com",
            spellCheck: false,
            onChange: function (e) {
              draftDirty.current = true;
              setDraft(e.target.value);
            },
          }),
          h("button", { type: "button", className: "__dm_btn", disabled: busy, onClick: saveUrl }, saved ? t("saved") : t("save")),
          h("button", { type: "button", className: "__dm_btn", disabled: busy || !state.publicUrl, onClick: runProbe }, t("probe")),
        ),
        h("p", { className: "__dm_hint" }, t("publicUrlHint")),
        probe
          ? h(
              "p",
              { className: probe.ok ? "__dm_hint" : "__dm_err" },
              probe.ok
                ? t("probeOk").replace("{ms}", String(probe.latency || 0))
                : t("probeFail").replace("{err}", probe.error || "HTTP " + probe.status),
            )
          : null,
        h(
          "label",
          { className: "__dm_row", style: { gap: "8px", cursor: "pointer", alignItems: "center" } },
          h("input", {
            type: "checkbox",
            checked: Boolean(lanDraft),
            onChange: function (e) {
              setLanDraft(e.target.checked);
            },
          }),
          h("span", { className: "__dm_hint" }, t("lanLabel")),
        ),
        h("p", { className: "__dm_hint" }, t("lanHint")),
        h("p", { className: "__dm_title" }, t("tunnelTitle")),
        h("p", { className: "__dm_hint" }, t("tunnelHint")),
        tunnelState && !tunnelState.available ? h("p", { className: "__dm_err" }, t("tunnelNoBin")) : null,
        h(
          "div",
          { className: "__dm_row" },
          h(
            "label",
            { className: "__dm_field" },
            h("span", { className: "__dm_label" }, t("tunnelTitle")),
            h(
              "select",
              {
                className: "__dm_select",
                value: tunnelMode,
                disabled: busy || Boolean(tunnelState && tunnelState.running),
                onChange: function (e) {
                  saveSettings({ tunnel: { mode: e.target.value } });
                },
              },
              h("option", { value: "off" }, t("tunnelModeOff")),
              h("option", { value: "quick" }, t("tunnelModeQuick")),
              h("option", { value: "token" }, t("tunnelModeToken")),
            ),
          ),
          tunnelMode !== "off"
            ? h(
                "button",
                {
                  type: "button",
                  className: "__dm_btn" + (tunnelState && tunnelState.running ? "" : " __dm_primary"),
                  disabled: busy || !tunnelState || !tunnelState.available,
                  onClick: function () {
                    tunnelAction(tunnelState && tunnelState.running ? "stop" : "start");
                  },
                },
                tunnelState && tunnelState.running ? t("tunnelStop") : t("tunnelStart"),
              )
            : null,
        ),
        tunnelMode === "token"
          ? h(
              "div",
              { className: "__dm_row" },
              h("input", {
                className: "__dm_input",
                type: "password",
                value: tunnelToken,
                placeholder: t("tunnelToken"),
                spellCheck: false,
                onChange: function (e) {
                  setTunnelToken(e.target.value);
                },
              }),
              h(
                "button",
                {
                  type: "button",
                  className: "__dm_btn",
                  disabled: busy || !tunnelToken.trim(),
                  onClick: function () {
                    saveSettings({ tunnel: { token: tunnelToken.trim() } });
                    setTunnelToken("");
                  },
                },
                t("save"),
              ),
            )
          : null,
        tunnelMode === "token" ? h("p", { className: "__dm_hint" }, t("tunnelTokenHint")) : null,
        h(
          "label",
          { className: "__dm_row", style: { gap: "8px", cursor: "pointer", alignItems: "center" } },
          h("input", {
            type: "checkbox",
            checked: Boolean(tunnelState && tunnelState.autoStart),
            onChange: function (e) {
              saveSettings({ tunnel: { autoStart: e.target.checked } });
            },
          }),
          h("span", { className: "__dm_hint" }, t("tunnelAuto")),
        ),
        tunnelState
          ? h(
              "div",
              { className: "__dm_row" },
              h("span", { className: "__dm_badge" }, tunnelState.running ? t("tunnelRunning") : t("tunnelStopped")),
              tunnelState.url ? h("span", { className: "__dm_url" }, tunnelState.url) : null,
            )
          : null,
        tunnelState && tunnelState.error ? h("p", { className: "__dm_err" }, tunnelState.error) : null,
        tunnelMode === "quick" && tunnelState && tunnelState.running ? h("p", { className: "__dm_hint" }, t("tunnelChangeHint")) : null,
        tsnetState ? h("p", { className: "__dm_title" }, t("tsnetTitle")) : null,
        tsnetState ? h("p", { className: "__dm_hint" }, t("tsnetHint")) : null,
        tsnetState
          ? h(
              "label",
              { className: "__dm_row", style: { gap: "8px", cursor: "pointer", alignItems: "center" } },
              h("input", {
                type: "checkbox",
                checked: Boolean(tsnetState.enabled),
                onChange: function (e) {
                  saveSettings({ tsnet: { enabled: e.target.checked } });
                },
              }),
              h("span", { className: "__dm_hint" }, t("tsnetEnable")),
            )
          : null,
        tsnetState && tsnetState.enabled
          ? h(
              "div",
              { className: "__dm_row" },
              h(
                "button",
                {
                  type: "button",
                  className: "__dm_btn" + (tsnetState.running ? "" : " __dm_primary"),
                  disabled: busy || !tsnetState.available,
                  onClick: function () {
                    tsnetAction(tsnetState.running ? "stop" : "start");
                  },
                },
                tsnetState.running ? t("tsnetStop") : t("tsnetStart"),
              ),
              h("span", { className: "__dm_badge" }, tsnetPhase(tsnetState.phase)),
              tsnetState.funnelURL ? h("span", { className: "__dm_url" }, tsnetState.funnelURL) : null,
            )
          : null,
        tsnetState && tsnetState.enabled
          ? h(
              "label",
              { className: "__dm_row", style: { gap: "8px", cursor: "pointer", alignItems: "center" } },
              h("input", {
                type: "checkbox",
                checked: Boolean(tsnetState.autoStart),
                onChange: function (e) {
                  saveSettings({ tsnet: { autoStart: e.target.checked } });
                },
              }),
              h("span", { className: "__dm_hint" }, t("tsnetAuto")),
            )
          : null,
        tsnetState && !tsnetState.available ? h("p", { className: "__dm_err" }, t("tsnetNoBin")) : null,
        tsnetState && tsnetState.authURL
          ? h(
              "div",
              { className: "__dm_row" },
              h(
                "button",
                {
                  type: "button",
                  className: "__dm_btn __dm_primary",
                  onClick: function () {
                    if (typeof window !== "undefined") window.open(tsnetState.authURL, "_blank", "noopener");
                  },
                },
                t("tsnetLogin"),
              ),
              h(
                "button",
                {
                  type: "button",
                  className: "__dm_btn",
                  onClick: function () {
                    copyLink(tsnetState.authURL);
                  },
                },
                copied ? t("copied") : t("copy"),
              ),
            )
          : null,
        tsnetState && tsnetState.error ? h("p", { className: "__dm_err" }, tsnetState.error) : null,
        tsnetState && tsnetState.enabled && !tsnetState.funnelURL ? h("p", { className: "__dm_hint" }, t("tsnetFirstRun")) : null,
        tsnetState && tsnetState.enabled
          ? h("p", { className: "__dm_hint" }, t("tsnetHostHint").replace("{host}", tsnetState.hostname || "pocket"))
          : null,
        h(
          "div",
          { className: "__dm_row" },
          h("button", { type: "button", className: "__dm_btn __dm_primary", disabled: busy || !state.running, onClick: startPairing }, pairingState === "waiting" ? t("restart") : t("start")),
        ),
        pairingState === "waiting"
          ? h(
              "div",
              { className: "__dm_root", style: { marginTop: "4px" } },
              h("div", { className: "__dm_row", style: { alignItems: "flex-start" } },
                qrSrc ? h("div", { className: "__dm_qr" }, h("img", { src: qrSrc, width: 216, height: 216, alt: "pairing qr" })) : null,
                h(
                  "div",
                  { style: { display: "flex", flexDirection: "column", gap: "8px", flex: "1 1 220px", minWidth: 0 } },
                  h("div", { className: "__dm_hint" }, t("code")),
                  h("div", { className: "__dm_code" }, pairing.code || "------"),
                  h("div", { className: "__dm_hint" }, t("qrHint")),
                  h("div", { className: "__dm_hint" }, t("expires").replace("{t}", clockLeft(pairing.expiresAt))),
                  qrSrc ? h("a", { className: "__dm_hint", href: qrSrc, target: "_blank", rel: "noopener" }, "二维码打不开？新窗口打开") : null,
                  h("div", { className: "__dm_row" },
                    h("div", { className: "__dm_url" }, pairing.url),
                    h("button", { type: "button", className: "__dm_btn", onClick: function () { copyLink(pairing.url); } }, copied ? t("copied") : t("copy")),
                  ),
                ),
              ),
              h("div", { className: "__dm_row" },
                h("button", { type: "button", className: "__dm_btn __dm_primary", disabled: busy, onClick: function () { decide(true); } }, t("approve")),
                h("button", { type: "button", className: "__dm_btn", disabled: busy, onClick: function () { decide(false); } }, t("reject")),
              ),
            )
          : null,
        pairingState === "approved"
          ? h("p", { className: "__dm_hint" }, t("approved"))
          : null,
        pairingState === "expired"
          ? h("p", { className: "__dm_hint" }, t("expired"))
          : null,
        pairingState === "rejected"
          ? h("p", { className: "__dm_hint" }, t("rejected"))
          : null,
        h("p", { className: "__dm_title" }, t("devices")),
        state.devices && state.devices.length
          ? h(
              "div",
              { className: "__dm_list" },
              state.devices.map(function (device) {
                return h(
                  "div",
                  { className: "__dm_item", key: device.id },
                  h(
                    "div",
                    { className: "__dm_itemMain" },
                    h(
                      "div",
                      { className: "__dm_itemName" },
                      h("span", { className: device.online ? "__dm_online" : "__dm_offline" }),
                      device.name || t("unknown"),
                    ),
                    h(
                      "div",
                      { className: "__dm_itemMeta" },
                      [platformOf(device.platform), device.online ? t("online") : t("offline"), ago(device.lastSeen)].filter(Boolean).join(" · "),
                    ),
                  ),
                  h("button", { type: "button", className: "__dm_btn", disabled: busy, onClick: function () { rename(device); } }, t("rename")),
                  h("button", { type: "button", className: "__dm_btn __dm_danger", disabled: busy, onClick: function () { revoke(device.id); } }, t("revoke")),
                );
              }),
            )
          : h("p", { className: "__dm_hint" }, t("noDevices")),
        h("p", { className: "__dm_title" }, t("notifyTitle")),
        state.notify && state.notify.external
          ? h("p", { className: "__dm_hint" }, t("notifyExternal"))
          : !state.notify || !state.notify.available
            ? h("p", { className: "__dm_hint" }, t("notifyUnavailable"))
            : h(
                "div",
                { className: "__dm_root", style: { gap: "6px" } },
                h(
                  "label",
                  { className: "__dm_row", style: { gap: "8px", cursor: "pointer", alignItems: "center" } },
                  h("input", {
                    type: "checkbox",
                    checked: Boolean(state.notify.enabled),
                    onChange: function (e) {
                      toggleNotify(e.target.checked);
                    },
                  }),
                  h("span", { className: "__dm_hint" }, t("notifyEnable")),
                ),
                h("p", { className: "__dm_hint" }, t("notifyHint")),
                h(
                  "div",
                  { className: "__dm_row" },
                  h(
                    "button",
                    {
                      type: "button",
                      className: "__dm_btn",
                      disabled: busy || !state.notify.enabled || !state.notify.subscriptions,
                      onClick: testNotify,
                    },
                    t("notifyTest"),
                  ),
                  h("span", { className: "__dm_hint" }, t("notifySubs").replace("{n}", String(state.notify.subscriptions || 0))),
                ),
                notifyResult
                  ? h(
                      "p",
                      { className: notifyResult.ok ? "__dm_ok" : "__dm_err" },
                      notifyResult.ok
                        ? t("notifyTestOk").replace("{sent}", String(notifyResult.sent || 0))
                        : t("notifyTestFail").replace("{err}", notifyResult.error || "unknown"),
                    )
                  : null,
              ),
        h("p", { className: "__dm_hint" }, t("installHint")),
        error ? h("p", { className: "__dm_err" }, t("err").replace("{msg}", error)) : null,
      );
    }

    function apply(ctx) {
      var t = ctx.locale.bind(NS);
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, "dsh-mobile: dictionaries");
      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register(
          {
            name: "settings.section",
            id: "dsh-mobile",
            order: 8,
            label: function () {
              return t("nav");
            },
            locale: NS,
          },
          function (props) {
            return h(Section, Object.assign({}, props, { t: t }));
          },
        );
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});

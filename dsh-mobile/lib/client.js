/**
 * dsh-mobile client: compact Pocket host panel.
 * Tailnet-only: no QR, no public URL, no tunnel token fields.
 */
window.__ModuleLoader__.load({
  id: "dsh-mobile",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var react = require("react");
    var h = react.createElement;
    var NS = "dsh-mobile";
    var PANEL_ID = "mobile";
    var APK_URL = "https://github.com/Starplume141592/dsh-pocket/releases/download/native-test/DSHRemote.apk";

    var CSS =
      ".__pm_root{max-width:720px;display:flex;flex-direction:column;gap:14px;color:var(--dsw-alias-label-primary)}" +
      ".__pm_hero{display:flex;align-items:center;gap:12px;padding:4px 0 6px}" +
      ".__pm_logo{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;font-size:22px;background:linear-gradient(145deg,#6b8cff,#5b3cff);color:#fff;box-shadow:0 8px 24px rgba(91,91,255,.28)}" +
      ".__pm_hero h1{margin:0;font-size:18px;line-height:1.25;letter-spacing:-.02em}" +
      ".__pm_hero p{margin:2px 0 0;font-size:12px;color:var(--dsw-alias-label-tertiary)}" +
      ".__pm_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:12px}" +
      ".__pm_card h2{margin:0;font-size:14px}" +
      ".__pm_row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}" +
      ".__pm_badge{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:3px 10px;font-size:12px;color:var(--dsw-alias-label-secondary)}" +
      ".__pm_dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#3fb950)}" +
      ".__pm_dot.off{background:var(--dsw-alias-border-l2)}" +
      ".__pm_hint{font-size:12px;line-height:1.65;color:var(--dsw-alias-label-tertiary);margin:0}" +
      ".__pm_label{font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:4px;display:block}" +
      ".__pm_input{width:100%;box-sizing:border-box;font:inherit;font-size:13px;padding:8px 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}" +
      ".__pm_btn{font:inherit;font-size:13px;padding:7px 14px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}" +
      ".__pm_btn:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary)}" +
      ".__pm_btn:disabled{opacity:.5;cursor:default}" +
      ".__pm_primary{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-on-accent)}" +
      ".__pm_danger{color:var(--dsw-alias-state-error-primary)}" +
      ".__pm_switch{display:flex;align-items:center;gap:9px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}" +
      ".__pm_err{font-size:12px;color:var(--dsw-alias-state-error-primary);line-height:1.5}" +
      ".__pm_list{display:flex;flex-direction:column;gap:8px}" +
      ".__pm_item{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);font-size:12px}" +
      ".__pm_itemMain{flex:1;min-width:0}" +
      ".__pm_meta{color:var(--dsw-alias-label-tertiary);font-size:11px;margin-top:2px}" +
      ".__pm_advanced{font-size:12px;color:var(--dsw-alias-label-tertiary)}" +
      ".__pm_advanced summary{cursor:pointer;padding:4px 0}" +
      ".__pm_grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-top:10px}" +
      ".__pm_grid div{padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2)}" +
      ".__pm_grid b{display:block;font-size:11px;color:var(--dsw-alias-label-tertiary);font-weight:500}" +
      ".__pm_page{max-width:760px;margin:0 auto;padding:30px 26px 64px;display:flex;flex-direction:column;gap:16px}" +
      ".__pm_pageHead{padding:2px 0 12px;border-bottom:1px solid var(--dsw-alias-border-l3)}" +
      ".__pm_pageHead h1{margin:0;font-size:22px;letter-spacing:-.02em}" +
      ".__pm_pageHead p{margin:6px 0 0;font-size:13px;color:var(--dsw-alias-label-tertiary)}";

    var tagId = "dsh-mobile/main.css";
    if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "dsh-mobile";
      tag.dataset.pluginCss = tagId;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    var zh = {
      panel: "手机",
      title: "Pocket 手机端",
      subtitle: "Tailnet 内直连，不需要二维码或公网地址",
      running: "运行中",
      stopped: "未运行",
      starting: "启动中",
      entry: "Tailnet 地址",
      noEntry: "等待 Tailscale 启动…",
      copy: "复制",
      copied: "已复制",
      devices: "手机",
      noDevices: "还没有手机连接",
      online: "在线",
      offline: "离线",
      restart: "重新连接",
      login: "登录 Tailscale",
      refresh: "刷新",
      install: "安装手机 App",
      installHint: "手机和电脑登录同一个 Tailscale 账号。装好后打开 App，点登录，浏览器完成授权即可自动发现。",
      download: "下载测试 APK",
      advanced: "高级信息",
      phase: "阶段",
      pid: "进程",
      hostname: "主机名",
      error: "错误",
      log: "日志",
      revoke: "吊销",
      mobile: "手机端总开关",
      mobileOff: "关闭后网关和隧道停止",
      tapLogin: "需要登录 Tailscale",
      ready: "已就绪",
    };
    var en = {
      panel: "Phone",
      title: "Pocket host",
      subtitle: "Tailnet-only, no QR or public URL",
      running: "Running",
      stopped: "Stopped",
      starting: "Starting",
      entry: "Tailnet address",
      noEntry: "Waiting for Tailscale…",
      copy: "Copy",
      copied: "Copied",
      devices: "Phones",
      noDevices: "No phone connected",
      online: "online",
      offline: "offline",
      restart: "Reconnect",
      login: "Log in to Tailscale",
      refresh: "Refresh",
      install: "Install phone app",
      installHint: "Sign in to the same Tailscale account on both devices. Open the app, tap login, finish in the browser.",
      download: "Download test APK",
      advanced: "Advanced",
      phase: "Phase",
      pid: "PID",
      hostname: "Hostname",
      error: "Error",
      log: "Log",
      revoke: "Revoke",
      mobile: "Phone host switch",
      mobileOff: "Stops the gateway and tunnel",
      tapLogin: "Tailscale login required",
      ready: "Ready",
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

    function Section(props) {
      var t = props.t;
      var [state, setState] = react.useState(null);
      var [error, setError] = react.useState("");
      var [busy, setBusy] = react.useState(false);
      var [copied, setCopied] = react.useState(false);
      var alive = react.useRef(true);

      var refresh = react.useCallback(function () {
        return api("/state").then(function (next) {
          if (alive.current) {
            setState(next);
            setError("");
          }
        }).catch(function (e) {
          if (alive.current) setError(String((e && e.message) || e));
        });
      }, []);

      react.useEffect(function () {
        alive.current = true;
        refresh();
        var timer = setInterval(refresh, 2500);
        return function () {
          alive.current = false;
          clearInterval(timer);
        };
      }, [refresh]);

      function run(fn) {
        setBusy(true);
        setError("");
        return Promise.resolve().then(fn).then(function () {
          return refresh();
        }).catch(function (e) {
          setError(String((e && e.message) || e));
        }).then(function () {
          if (alive.current) setBusy(false);
        });
      }

      var tsnet = (state && state.tsnet) || {};
      var mobileEnabled = !state || !state.mobile || state.mobile.enabled !== false;
      var devices = (state && state.devices) || [];
      var online = devices.filter(function (d) { return d.online; });
      var tailnet = tsnet.tailnetURL || "";
      var running = Boolean(tsnet.running);
      var authURL = tsnet.authURL || "";

      function copy(value) {
        if (!value) return;
        var done = function () {
          setCopied(true);
          setTimeout(function () { if (alive.current) setCopied(false); }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value).then(done).catch(function () { window.prompt(t("copy"), value); });
        } else {
          window.prompt(t("copy"), value);
        }
      }

      function restart() {
        run(function () {
          return api("/tsnet/stop", { method: "POST", body: "{}" }).then(function () {
            return api("/tsnet/start", { method: "POST", body: "{}" });
          });
        });
      }

      function toggleMobile(enabled) {
        run(function () {
          return api("/mobile/enable", { method: "POST", body: JSON.stringify({ enabled: enabled }) });
        });
      }

      function revoke(id) {
        if (typeof window !== "undefined" && !window.confirm("吊销这台设备？")) return;
        run(function () {
          return api("/devices/revoke", { method: "POST", body: JSON.stringify({ id: id }) });
        });
      }

      return h(
        "div",
        { className: "__pm_root" },
        h(
          "div",
          { className: "__pm_hero" },
          h("div", { className: "__pm_logo" }, "✦"),
          h("div", null,
            h("h1", null, t("title")),
            h("p", null, t("subtitle"))
          )
        ),
        h(
          "div",
          { className: "__pm_card" },
          h(
            "div",
            { className: "__pm_row" },
            h("span", { className: "__pm_badge" },
              h("span", { className: "__pm_dot" + (running ? "" : " off") }),
              running ? t("running") : (tsnet.phase === "starting" ? t("starting") : t("stopped"))
            ),
            h("span", { className: "__pm_hint" }, online.length + " / " + devices.length + " " + t("online"))
          ),
          h(
            "label",
            { className: "__pm_switch" },
            h("input", {
              type: "checkbox",
              checked: mobileEnabled,
              disabled: busy,
              onChange: function (e) { toggleMobile(e.target.checked); },
            }),
            h("span", null, t("mobile") + " · " + t("mobileOff"))
          ),
          h(
            "div",
            null,
            h("span", { className: "__pm_label" }, t("entry")),
            h("input", { className: "__pm_input", readOnly: true, value: tailnet || t("noEntry") }),
            h(
              "div",
              { className: "__pm_row", style: { marginTop: "8px" } },
              h("button", { type: "button", className: "__pm_btn", disabled: !tailnet, onClick: function () { copy(tailnet); } }, copied ? t("copied") : t("copy")),
              h("button", { type: "button", className: "__pm_btn __pm_primary", disabled: busy, onClick: restart }, t("restart")),
              h("button", { type: "button", className: "__pm_btn", disabled: busy, onClick: function () { run(refresh); } }, t("refresh")),
              authURL ? h("button", { type: "button", className: "__pm_btn", onClick: function () { window.open(authURL, "_blank", "noopener"); } }, t("login")) : null
            )
          ),
          authURL ? h("p", { className: "__pm_hint" }, t("tapLogin") + ": " + authURL) : null,
          error ? h("p", { className: "__pm_err" }, t("error") + ": " + error) : null
        ),
        h(
          "div",
          { className: "__pm_card" },
          h("h2", null, t("install")),
          h("p", { className: "__pm_hint" }, t("installHint")),
          h("a", { className: "__pm_btn __pm_primary", href: APK_URL, target: "_blank", rel: "noopener" }, t("download"))
        ),
        h(
          "div",
          { className: "__pm_card" },
          h("h2", null, t("devices")),
          devices.length === 0
            ? h("p", { className: "__pm_hint" }, t("noDevices"))
            : h(
                "div",
                { className: "__pm_list" },
                devices.map(function (d) {
                  return h(
                    "div",
                    { className: "__pm_item", key: d.id },
                    h("div", { className: "__pm_itemMain" },
                      h("div", null, d.name || "Pocket"),
                      h("div", { className: "__pm_meta" }, (d.online ? t("online") : t("offline")) + (d.lastIp ? " · " + d.lastIp : ""))
                    ),
                    h("button", { type: "button", className: "__pm_btn __pm_danger", disabled: busy, onClick: function () { revoke(d.id); } }, t("revoke"))
                  );
                })
              )
        ),
        h(
          "details",
          { className: "__pm_advanced" },
          h("summary", null, t("advanced")),
          h(
            "div",
            { className: "__pm_grid" },
            h("div", null, h("b", null, t("phase")), tsnet.phase || "-"),
            h("div", null, h("b", null, t("pid")), String(tsnet.pid || 0)),
            h("div", null, h("b", null, t("hostname")), tsnet.hostname || "pocket"),
            h("div", null, h("b", null, t("log")), tsnet.logFile || "-")
          ),
          tsnet.error ? h("p", { className: "__pm_err" }, tsnet.error) : null
        )
      );
    }

    function MobileIcon(props) {
      var size = (props && props.size) || 18;
      return h(
        "svg",
        { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
        h("rect", { x: "6.5", y: "2.5", width: "11", height: "19", rx: "3", stroke: "currentColor", strokeWidth: "1.6" }),
        h("path", { d: "M10 5.5h4", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round" }),
        h("circle", { cx: "12", cy: "18.2", r: "1", fill: "currentColor" })
      );
    }

    function PanelPage(props) {
      var t = props.t;
      return h(
        "div",
        { className: "__pm_page" },
        h("div", { className: "__pm_pageHead" }, h("h1", null, t("title")), h("p", null, t("subtitle"))),
        h(Section, props)
      );
    }

    function apply(ctx) {
      var t = ctx.locale.bind(NS);
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, "dsh-mobile: dictionaries");
      function openPanel() { ctx.layout.selectPanel(PANEL_ID); }
      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register(
          { name: "settings.section", id: "dsh-mobile", order: 8, label: function () { return t("panel"); }, locale: NS },
          function (props) { return h(Section, Object.assign({}, props, { t: t })); }
        );
      });
      ctx.slots.inject("main", function () {
        return ctx.slots.register(
          { name: "main", key: PANEL_ID, locale: NS, inject: function () { return { t: t }; } },
          PanelPage
        );
      });
      ctx.slots.inject("sidebar.panellist", function () {
        return ctx.slots.register(
          { name: "sidebar.panellist", id: PANEL_ID, order: 12, label: function () { return t("panel"); }, locale: NS },
          MobileIcon
        );
      });
    }

    exports.apply = apply;
    exports.inject = ["slots", "locale", "layout"];
    return module.exports;
  },
});

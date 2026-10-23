(function () {
  try {
    var standalone =
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
    if (standalone) document.documentElement.classList.add('dshm-standalone');
  } catch (error) {
    /* ignore */
  }

  if (!('serviceWorker' in navigator)) return;

  // meow-smooth 也会在根 scope 注册它自己的推送 SW。两个 SW 抢同一个 scope
  // 会互相顶掉：后注册的生效，先注册的离线/推送能力就没了。这里把它的
  // 注册请求改成复用当前注册（本 SW 已经 importScripts 了它的推送脚本），
  // 这样推送与离线可以共存。只拦截这一个已知 URL，其余注册照常。
  try {
    var originalRegister = ServiceWorkerContainer.prototype.register;
    ServiceWorkerContainer.prototype.register = function (url, options) {
      try {
        var path = new URL(String(url), location.href).pathname;
        if (path === '/plugins/meow-smooth/sw.js') {
          return navigator.serviceWorker.getRegistration('/').then(function (registration) {
            return registration || originalRegister.call(navigator.serviceWorker, '/__dshm/sw.js', { scope: '/' });
          });
        }
      } catch (error) {
        /* fall through */
      }
      return originalRegister.apply(this, arguments);
    };
  } catch (error) {
    /* ignore */
  }

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/__dshm/sw.js', { scope: '/' }).catch(function () {
      /* 非安全上下文（局域网 http）下会失败，属预期 */
    });
  });

  // ── 系统通知：任务完成 / 待审批推到手机 ───────────────────────────────

  var NOTIFY_DISMISS_KEY = 'dshm-notify-dismissed-v1';
  var notifyBox = null;
  var lastSync = 0;

  function notifySupported() {
    return (
      window.isSecureContext === true &&
      typeof Notification !== 'undefined' &&
      typeof navigator.serviceWorker !== 'undefined' &&
      navigator.serviceWorker.ready !== undefined
    );
  }

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = window.atob(base64);
    var output = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
    return output;
  }

  function postJson(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  }

  function loadPushConfig() {
    return fetch('/__dshm/api/push/key', { cache: 'no-store' })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (config) {
        if (!config || config.ok !== true || config.enabled !== true || typeof config.publicKey !== 'string') return null;
        return config;
      })
      .catch(function () {
        return null;
      });
  }

  function syncSubscription(config) {
    if (!notifySupported() || Notification.permission !== 'granted') return Promise.resolve(false);
    var now = Date.now();
    // 每 6 小时对一次账就够了；重复订阅是幂等的。
    if (now - lastSync < 6 * 60 * 60 * 1000) return Promise.resolve(true);
    var ready = config ? Promise.resolve(config) : loadPushConfig();
    return ready
      .then(function (loaded) {
        if (!loaded) return false;
        return navigator.serviceWorker.ready
          .then(function (registration) {
            return registration.pushManager.getSubscription().then(function (existing) {
              if (existing) return existing;
              return registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(loaded.publicKey),
              });
            });
          })
          .then(function (subscription) {
            if (!subscription) return false;
            return postJson('/__dshm/api/push/subscribe', subscription.toJSON()).then(function (res) {
              if (res.ok) lastSync = now;
              return res.ok;
            });
          });
      })
      .catch(function () {
        return false;
      });
  }

  function removeNotifyBox() {
    if (notifyBox && notifyBox.parentNode) notifyBox.parentNode.removeChild(notifyBox);
    notifyBox = null;
  }

  function requestAndSubscribe() {
    return Notification.requestPermission()
      .then(function (permission) {
        if (permission === 'granted') return syncSubscription();
        try {
          localStorage.setItem(NOTIFY_DISMISS_KEY, '1');
        } catch (error) {
          /* ignore */
        }
        return false;
      })
      .catch(function () {
        return false;
      });
  }

  function buildNotifyBox() {
    if (notifyBox || !notifySupported() || Notification.permission !== 'default') return;
    try {
      if (localStorage.getItem(NOTIFY_DISMISS_KEY) === '1') return;
    } catch (error) {
      /* ignore */
    }
    notifyBox = document.createElement('div');
    notifyBox.id = 'dshm-notify';
    notifyBox.setAttribute('role', 'dialog');
    notifyBox.style.cssText =
      'position:fixed;left:12px;right:12px;bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:2147483000;' +
      'display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:16px;' +
      'background:#1c2128;border:1px solid #2b333d;color:#e8eaed;box-shadow:0 12px 32px rgba(0,0,0,.42);' +
      'font:14px/1.4 system-ui,-apple-system,"PingFang SC",sans-serif;';

    var text = document.createElement('div');
    text.style.cssText = 'flex:1;min-width:0;';
    var title = document.createElement('div');
    title.textContent = '开启通知';
    title.style.cssText = 'font-weight:600;font-size:14px;';
    var sub = document.createElement('div');
    sub.textContent = '任务完成或等待你批准时，手机弹出提醒';
    sub.style.cssText = 'font-size:12px;color:#8b95a3;margin-top:2px;';
    text.appendChild(title);
    text.appendChild(sub);

    var enable = document.createElement('button');
    enable.type = 'button';
    enable.textContent = '开启';
    enable.style.cssText =
      'border:0;border-radius:10px;padding:8px 14px;font:inherit;font-weight:600;color:#fff;background:#4d6bfe;';
    enable.addEventListener('click', function () {
      removeNotifyBox();
      requestAndSubscribe();
    });

    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', '关闭');
    close.style.cssText =
      'border:0;background:transparent;color:#8b95a3;font-size:20px;line-height:1;padding:4px 6px;cursor:pointer;';
    close.addEventListener('click', function () {
      try {
        localStorage.setItem(NOTIFY_DISMISS_KEY, '1');
      } catch (error) {
        /* ignore */
      }
      removeNotifyBox();
    });

    notifyBox.appendChild(text);
    notifyBox.appendChild(enable);
    notifyBox.appendChild(close);
    document.body.appendChild(notifyBox);
  }

  if (notifySupported()) {
    // 只有本机推送真的可用时才提示授权；装了 meow-smooth 由它接管时不会弹这个条。
    loadPushConfig().then(function (config) {
      if (!config) return;
      if (Notification.permission === 'granted') {
        syncSubscription(config);
      } else if (Notification.permission === 'default') {
        window.setTimeout(buildNotifyBox, 8000);
      }
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && Notification.permission === 'granted') {
        syncSubscription();
      }
    });
  }

  // ── 「安装到桌面」提示（仅 Android/Chrome 的 beforeinstallprompt 可用时）──
  var DISMISS_KEY = 'dshm-install-dismissed-v1';
  var deferredPrompt = null;
  var box = null;

  function removeBox() {
    if (box && box.parentNode) box.parentNode.removeChild(box);
    box = null;
  }

  function buildBox() {
    if (box || !deferredPrompt) return;
    if (document.documentElement.classList.contains('dshm-standalone')) return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === '1') return;
    } catch (error) {
      /* ignore */
    }
    box = document.createElement('div');
    box.id = 'dshm-install';
    box.setAttribute('role', 'dialog');
    box.style.cssText =
      'position:fixed;left:12px;right:12px;bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:2147483000;' +
      'display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:16px;' +
      'background:#1c2128;border:1px solid #2b333d;color:#e8eaed;box-shadow:0 12px 32px rgba(0,0,0,.42);' +
      'font:14px/1.4 system-ui,-apple-system,"PingFang SC",sans-serif;';

    var text = document.createElement('div');
    text.style.cssText = 'flex:1;min-width:0;';
    var title = document.createElement('div');
    title.textContent = '把 DSH 安装到桌面';
    title.style.cssText = 'font-weight:600;font-size:14px;';
    var sub = document.createElement('div');
    sub.textContent = '全屏打开，像 App 一样';
    sub.style.cssText = 'font-size:12px;color:#8b95a3;margin-top:2px;';
    text.appendChild(title);
    text.appendChild(sub);

    var install = document.createElement('button');
    install.type = 'button';
    install.textContent = '安装';
    install.style.cssText =
      'border:0;border-radius:10px;padding:8px 14px;font:inherit;font-weight:600;color:#fff;background:#4d6bfe;';
    install.addEventListener('click', function () {
      var prompt = deferredPrompt;
      deferredPrompt = null;
      removeBox();
      if (!prompt) return;
      prompt.prompt();
      Promise.resolve(prompt.userChoice).catch(function () {});
    });

    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', '关闭');
    close.style.cssText =
      'border:0;background:transparent;color:#8b95a3;font-size:20px;line-height:1;padding:4px 6px;cursor:pointer;';
    close.addEventListener('click', function () {
      try {
        localStorage.setItem(DISMISS_KEY, '1');
      } catch (error) {
        /* ignore */
      }
      removeBox();
    });

    box.appendChild(text);
    box.appendChild(install);
    box.appendChild(close);
    document.body.appendChild(box);
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredPrompt = event;
    // 两个底部提示不叠在一起，安装提示优先。
    removeNotifyBox();
    window.setTimeout(buildBox, 1200);
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    removeBox();
  });
})();

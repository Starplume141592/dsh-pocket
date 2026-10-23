// 公网隧道托管：让「设置 → 连接手机」自己启动/停止 cloudflared。
//
// 两种模式：
// - quick：Cloudflare 临时隧道，不用账号，地址形如 https://xxx.trycloudflare.com，
//   每次重启地址都会变（手机需要重新配对）。
// - token：Cloudflare 命名隧道（在控制台建好、绑定自己的域名），地址固定，
//   适合长期使用。token 通过环境变量传入，不出现在进程命令行里。
import fs from 'node:fs';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';

const QUICK_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const QUICK_TIMEOUT_MS = 60_000;
const RESTART_DELAY_MS = 5_000;
const MAX_RESTARTS = 5;
const BIN_NAME = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';

function findBinary(explicit, dataDir) {
  const candidates = [
    explicit,
    process.env.DSH_MOBILE_CLOUDFLARED,
    path.join(dataDir, 'bin', BIN_NAME),
  ].filter((item) => typeof item === 'string' && item.trim() !== '');
  for (const dir of String(process.env.PATH ?? '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, BIN_NAME));
  }
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return '';
}

export function createTunnelManager({
  port,
  dataDir,
  store,
  log = () => {},
  spawnImpl = nodeSpawn,
  cloudflaredPath = '',
  onChange = () => {},
}) {
  let child = null;
  let stopping = false;
  let restartTimer = null;
  let quickTimer = null;
  let pollTimer = null;
  let restarts = 0;
  const logFile = path.join(dataDir, 'tunnel.log');
  const state = {
    running: false,
    mode: 'off',
    url: '',
    startedAt: 0,
    error: '',
    pid: 0,
  };

  const binaryPath = () => findBinary(cloudflaredPath, dataDir);
  const note = () => {
    try {
      onChange();
    } catch {
      /* ignore */
    }
  };

  function settings() {
    return store.settings.tunnel;
  }

  function stopTimer() {
    if (quickTimer) clearTimeout(quickTimer);
    if (pollTimer) clearInterval(pollTimer);
    quickTimer = null;
    pollTimer = null;
  }

  function stop() {
    stopTimer();
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    if (!child) {
      state.running = false;
      return Promise.resolve(status());
    }
    const current = child;
    stopping = true;
    state.running = false;
    return new Promise((resolve) => {
      const done = () => {
        if (child === current) child = null;
        stopping = false;
        state.pid = 0;
        state.running = false;
        resolve(status());
      };
      current.once('exit', done);
      try {
        current.kill();
      } catch {
        /* ignore */
      }
      setTimeout(done, 3000).unref?.();
    });
  }

  function scheduleRestart() {
    if (!settings().autoStart || restartTimer) return;
    if (restarts >= MAX_RESTARTS) {
      state.error = `连续 ${MAX_RESTARTS} 次自动重连失败，已停止重连；请检查 token / 网络后手动启动`;
      note();
      return;
    }
    restarts += 1;
    const delay = Math.min(60_000, RESTART_DELAY_MS * restarts);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (!child && settings().mode !== 'off') {
        start({ fromRestart: true }).catch((error) => log(`隧道自动重连失败：${String(error?.message ?? error)}`));
      }
    }, delay);
    restartTimer.unref?.();
  }

  function start({ fromRestart = false } = {}) {
    if (!fromRestart) restarts = 0;
    const config = settings();
    if (config.mode === 'off') {
      return Promise.reject(new Error('先在设置里选择隧道模式'));
    }
    if (child) return Promise.resolve(status());
    const binary = binaryPath();
    if (!binary) {
      state.error = `没有找到 ${BIN_NAME}，请把它放到 ${path.join(dataDir, 'bin', BIN_NAME)}，或设置 DSH_MOBILE_CLOUDFLARED`;
      note();
      return Promise.reject(new Error(state.error));
    }
    const args =
      config.mode === 'token'
        ? ['tunnel', '--no-autoupdate', 'run']
        : ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate', '--protocol', 'http2'];
    const env = { ...process.env };
    if (config.mode === 'token') {
      if (!config.token) {
        state.error = '固定隧道需要先填写 token';
        note();
        return Promise.reject(new Error(state.error));
      }
      env.TUNNEL_TOKEN = config.token;
    }

    state.running = true;
    state.mode = config.mode;
    state.url = config.mode === 'quick' ? '' : store.settings.publicUrl;
    state.startedAt = Date.now();
    state.error = '';

    // 用文件而不是管道接 cloudflared 的输出：Windows 上管道容易被安全软件/沙箱拦截，
    // 而且日志留下来可以直接给用户排查。
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      const stat = fs.statSync(logFile);
      if (stat.size > 2 * 1024 * 1024) fs.truncateSync(logFile, 0);
    } catch {
      /* 文件不存在时交给 append 创建 */
    }
    try {
      fs.appendFileSync(logFile, `\n--- ${new Date().toISOString()} ${config.mode} ---\n`);
    } catch {
      /* ignore */
    }
    // 只认这次启动之后写入的日志，避免上次运行的旧地址被误读。
    let logStart = 0;
    try {
      logStart = fs.statSync(logFile).size;
    } catch {
      logStart = 0;
    }

    const readNewLog = () => {
      try {
        const stat = fs.statSync(logFile);
        if (stat.size <= logStart) return '';
        const start = Math.max(logStart, stat.size - 32_768);
        const fd = fs.openSync(logFile, 'r');
        try {
          const buffer = Buffer.alloc(stat.size - start);
          fs.readSync(fd, buffer, 0, buffer.length, start);
          return buffer.toString('utf8');
        } finally {
          fs.closeSync(fd);
        }
      } catch {
        return '';
      }
    };

    const scanLog = () => {
      if (config.mode !== 'quick' || state.url) return;
      const match = QUICK_URL_RE.exec(readNewLog());
      if (!match) return;
      state.url = match[0];
      state.error = '';
      stopTimer();
      store.updateSettings({ publicUrl: state.url });
      log(`临时隧道地址：${state.url}`);
      note();
    };

    let fd = null;
    try {
      fd = fs.openSync(logFile, 'a');
      child = spawnImpl(binary, args, {
        windowsHide: true,
        stdio: ['ignore', fd, fd],
        env,
      });
    } catch (error) {
      child = null;
      state.running = false;
      state.error = `启动 cloudflared 失败：${String(error?.message ?? error)}`;
      note();
      return Promise.reject(error);
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          /* ignore */
        }
      }
    }
    state.pid = child.pid ?? 0;
    child.once('error', (error) => {
      state.error = `cloudflared 出错：${String(error?.message ?? error)}`;
      state.running = false;
      stopTimer();
      note();
    });
    child.once('exit', (code) => {
      const wasStopping = stopping;
      child = null;
      state.running = false;
      state.pid = 0;
      stopTimer();
      if (!wasStopping) {
        // 稳定跑过一分钟再挂，说明配置没问题，重置重连计数。
        if (Date.now() - state.startedAt > 60_000) restarts = 0;
        state.error = `隧道已退出（code ${code ?? '?'}）`;
        log(state.error);
        scheduleRestart();
      }
      note();
    });

    if (config.mode === 'quick') {
      pollTimer = setInterval(scanLog, 400);
      pollTimer.unref?.();
      quickTimer = setTimeout(() => {
        if (state.url) return;
        state.error = '60 秒内没拿到临时隧道地址，请检查网络或 cloudflared 日志';
        note();
      }, QUICK_TIMEOUT_MS);
      quickTimer.unref?.();
    } else {
      log('固定隧道已启动');
    }
    note();
    return Promise.resolve(status());
  }

  async function autoStart() {
    const config = settings();
    if (!config.autoStart || config.mode === 'off') return null;
    try {
      return await start();
    } catch (error) {
      log(`隧道自动启动失败：${String(error?.message ?? error)}`);
      return null;
    }
  }

  function status() {
    const binary = binaryPath();
    return {
      ...state,
      autoStart: settings().autoStart,
      mode: state.running ? state.mode : settings().mode,
      available: Boolean(binary),
      binary,
      logFile,
      publicUrl: store.settings.publicUrl,
    };
  }

  return {
    start,
    stop,
    status,
    autoStart,
  };
}

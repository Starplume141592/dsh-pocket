// 内嵌 Tailscale Funnel：拉起 tsnet sidecar，轮询它的状态接口，把 Funnel 地址写回 publicUrl。
//
// sidecar 是用户态的（不装 Tailscale、不建虚拟网卡、不要管理员），由本插件管理生命周期。
// 状态接口约定见 sidecar/README.md：GET http://127.0.0.1:<controlPort>/status
import fs from 'node:fs';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';

const BIN_NAME = process.platform === 'win32' ? 'tsnet-sidecar.exe' : 'tsnet-sidecar';
const RESTART_DELAY_MS = 5_000;
const MAX_RESTARTS = 5;

function findBinary(explicit, dataDir) {
  const candidates = [
    explicit,
    process.env.DSH_MOBILE_TSNET,
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

export function createTsnetManager({
  port,
  dataDir,
  store,
  log = () => {},
  spawnImpl = nodeSpawn,
  sidecarPath = '',
  controlPort = 8479,
  pollMs = 1_000,
  fetchImpl = (input, init) => fetch(input, init),
  onChange = () => {},
}) {
  let child = null;
  let pollTimer = null;
  let pollKick = null;
  let restartTimer = null;
  let stopping = false;
  let polling = false;
  let restarts = 0;
  let lastPublicUrl = '';
  const logFile = path.join(dataDir, 'tsnet.log');
  const stateDir = path.join(dataDir, 'tsnet');
  const state = {
    running: false,
    phase: 'stopped',
    authURL: '',
    funnelURL: '',
    error: '',
    startedAt: 0,
    pid: 0,
  };

  const binaryPath = () => findBinary(sidecarPath, dataDir);
  const settings = () => store.settings.tsnet;
  const controlUrl = () => `http://127.0.0.1:${controlPort}/status`;

  function note() {
    try {
      onChange();
    } catch {
      /* ignore */
    }
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    if (pollKick) clearTimeout(pollKick);
    pollTimer = null;
    pollKick = null;
  }

  function applyStatus(body) {
    if (!body || typeof body !== 'object') return;
    if (typeof body.phase === 'string' && body.phase) state.phase = body.phase;
    if (typeof body.authURL === 'string') state.authURL = body.authURL;
    if (typeof body.error === 'string') state.error = body.error;
    if (body.phase === 'serving') {
      state.error = '';
      state.authURL = '';
    }
    if (typeof body.funnelURL === 'string' && body.funnelURL) {
      state.funnelURL = body.funnelURL;
      if (body.funnelURL !== lastPublicUrl) {
        lastPublicUrl = body.funnelURL;
        try {
          store.updateSettings({ publicUrl: body.funnelURL });
          log(`内嵌 Funnel 地址：${body.funnelURL}`);
        } catch (error) {
          log(`写入公网地址失败：${String(error?.message ?? error)}`);
        }
      }
    }
    note();
  }

  async function poll() {
    if (!state.running || polling) return;
    polling = true;
    try {
      const res = await fetchImpl(controlUrl(), { cache: 'no-store', signal: AbortSignal.timeout(1500) });
      if (!res || !res.ok) return;
      applyStatus(await res.json());
    } catch {
      /* sidecar 还没起来或正在退出，下一次再试 */
    } finally {
      polling = false;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(poll, pollMs);
    pollTimer.unref?.();
    pollKick = setTimeout(poll, 250);
    pollKick.unref?.();
  }

  function scheduleRestart() {
    if (!settings().autoStart || restartTimer) return;
    if (restarts >= MAX_RESTARTS) {
      state.error = `连续 ${MAX_RESTARTS} 次自动重连失败，已停止重连；请检查 sidecar 日志后手动启动`;
      note();
      return;
    }
    restarts += 1;
    const delay = Math.min(60_000, RESTART_DELAY_MS * restarts);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (!child && settings().enabled) {
        start({ fromRestart: true }).catch((error) => log(`内嵌 Funnel 自动重连失败：${String(error?.message ?? error)}`));
      }
    }, delay);
    restartTimer.unref?.();
  }

  function start({ fromRestart = false } = {}) {
    if (!fromRestart) restarts = 0;
    if (child) return Promise.resolve(status());
    const binary = binaryPath();
    if (!binary) {
      state.error = `没有找到 ${BIN_NAME}：把它放到 ${path.join(dataDir, 'bin', BIN_NAME)}，或设置 DSH_MOBILE_TSNET`;
      note();
      return Promise.reject(new Error(state.error));
    }

    const config = settings();
    const args = [
      '-listen', `127.0.0.1:${controlPort}`,
      '-target', `http://127.0.0.1:${port}`,
      '-hostname', config.hostname || 'pocket',
      '-dir', stateDir,
    ];
    // auth key 走环境变量，不出现在进程命令行里。
    const env = { ...process.env };
    if (config.authKey) env.TS_AUTHKEY = config.authKey;

    try {
      fs.mkdirSync(dataDir, { recursive: true });
      const stat = fs.statSync(logFile);
      if (stat.size > 2 * 1024 * 1024) fs.truncateSync(logFile, 0);
    } catch {
      /* 文件不存在时交给 append 创建 */
    }
    try {
      fs.appendFileSync(logFile, `\n--- ${new Date().toISOString()} tsnet ---\n`);
    } catch {
      /* ignore */
    }

    state.running = true;
    state.phase = 'starting';
    state.authURL = '';
    state.funnelURL = '';
    state.error = '';
    state.startedAt = Date.now();
    lastPublicUrl = '';

    let fd = null;
    try {
      fd = fs.openSync(logFile, 'a');
      child = spawnImpl(binary, args, { windowsHide: true, stdio: ['ignore', fd, fd], env });
    } catch (error) {
      child = null;
      state.running = false;
      state.phase = 'error';
      state.error = `启动 tsnet-sidecar 失败：${String(error?.message ?? error)}`;
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
      state.error = `tsnet-sidecar 出错：${String(error?.message ?? error)}`;
      state.phase = 'error';
      state.running = false;
      stopPolling();
      note();
    });
    child.once('exit', (code) => {
      const wasStopping = stopping;
      child = null;
      state.running = false;
      state.pid = 0;
      stopPolling();
      if (!wasStopping) {
        if (Date.now() - state.startedAt > 60_000) restarts = 0;
        state.phase = 'error';
        state.error = `tsnet-sidecar 已退出（code ${code ?? '?'}），详见 ${logFile}`;
        log(state.error);
        scheduleRestart();
      }
      note();
    });

    startPolling();
    note();
    return Promise.resolve(status());
  }

  function stop() {
    stopPolling();
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    if (!child) {
      state.running = false;
      state.phase = 'stopped';
      return Promise.resolve(status());
    }
    const current = child;
    stopping = true;
    state.running = false;
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        if (child === current) child = null;
        stopping = false;
        state.pid = 0;
        state.running = false;
        state.phase = 'stopped';
        state.authURL = '';
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

  async function autoStart() {
    const config = settings();
    if (!config.enabled || !config.autoStart) return null;
    try {
      return await start();
    } catch (error) {
      log(`内嵌 Funnel 自动启动失败：${String(error?.message ?? error)}`);
      return null;
    }
  }

  function status() {
    const binary = binaryPath();
    const config = settings();
    return {
      running: state.running,
      phase: state.phase,
      authURL: state.authURL,
      funnelURL: state.funnelURL,
      error: state.error,
      pid: state.pid,
      available: Boolean(binary),
      binary,
      logFile,
      hostname: config.hostname,
      enabled: config.enabled,
      autoStart: config.autoStart,
      controlPort,
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

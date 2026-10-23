// dsh-mobile — host 半：启动手机网关，并把桌面端设置卡需要的 API 挂到主 Web 服务。
//
// 手机端访问的是本插件自己监听的端口（默认 127.0.0.1:8470），
// 由 Cloudflare Tunnel / frp / 局域网把它暴露出去；
// 主 Web 服务（端口由 DSH 启动时分配）保持只监听回环，不直接对外。
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createStore } from './store.js';
import { createUpstream } from './upstream.js';
import { createMobileGateway } from './gateway.js';
import { createPushService } from './push.js';
import { installNotifications } from './notify.js';
import { createTunnelManager } from './tunnel.js';

export const name = 'dsh-mobile';
export const inject = ['webServer', 'connection'];

const TAG = '[dsh-mobile]';
const log = (...args) => console.log(TAG, ...args);
const require = createRequire(import.meta.url);

/** 装没装某个插件包（用于避免和 meow-smooth 的通知重复推送）。 */
function hasPackage(id) {
  try {
    require.resolve(`${id}/package.json`);
    return true;
  } catch {
    return false;
  }
}

export function apply(ctx, config = {}) {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const dataDir = path.join(home, '.dsh-mobile');
  const store = createStore(dataDir);
  const envPort = Number(process.env.DSH_MOBILE_PORT);
  const port = Number(config.port) > 0 ? Number(config.port) : envPort > 0 ? envPort : 8470;

  const origin = ctx.webServer.getOrigin();
  try {
    fs.writeFileSync(
      path.join(dataDir, 'last-load.json'),
      JSON.stringify({ at: new Date().toISOString(), origin, profile: process.env.DSH_PROFILE ?? '' }, null, 2),
    );
  } catch {
    /* 诊断文件写失败不影响运行 */
  }
  const upstream = createUpstream({
    origin,
    authenticatedUrl: (url) => ctx.connection.authenticatedUrl(url),
    log: (message) => log(message),
  });

  const externalNotify = hasPackage('meow-smooth') ? 'meow-smooth' : '';
  if (externalNotify) log('检测到 meow-smooth，通知交给它发送，避免重复推送');
  const push = externalNotify ? null : createPushService({ dir: dataDir, store, log });
  const tunnel = createTunnelManager({
    port,
    dataDir,
    store,
    log,
    cloudflaredPath: typeof config.cloudflaredPath === 'string' ? config.cloudflaredPath : '',
    onChange: () => {
      /* 设置卡每 2 秒轮询 /state，无需额外事件 */
    },
  });

  const gateway = createMobileGateway({
    upstream,
    store,
    port,
    bind:
      typeof config.bind === 'string' && config.bind
        ? config.bind
        : store.settings.lan
          ? '0.0.0.0'
          : '127.0.0.1',
    log,
    push,
    tunnel,
    notifyExternal: externalNotify,
  });

  ctx.effect(() => {
    const disposeNotify = externalNotify ? null : installNotifications(ctx, { push, store, log });
    gateway
      .start()
      .then((info) => {
        try {
          fs.writeFileSync(
            path.join(dataDir, 'last-start.json'),
            JSON.stringify({ at: new Date().toISOString(), port: info.port, lanUrl: info.lanUrl, upstream: origin }, null, 2),
          );
        } catch {
          /* 诊断文件写失败不影响运行 */
        }
        return tunnel.autoStart();
      })
      .catch((error) => {
        const message = `网关启动失败：${String(error?.message ?? error)}（端口 ${port} 可能被占用）`;
        log(message);
        try {
          fs.writeFileSync(path.join(dataDir, 'last-error.log'), `${new Date().toISOString()} ${message}\n`);
        } catch {
          /* ignore */
        }
      });
    return async () => {
      disposeNotify?.();
      await tunnel.stop();
      await gateway.stop();
    };
  }, 'dsh-mobile: gateway');

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/plugins/dsh-mobile/api',
        handler: (req, res) => {
          gateway.handleDesktop(req, res).catch((error) => {
            log(`桌面 API 出错：${String(error?.message ?? error)}`);
            if (!res.headersSent) {
              res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ ok: false, error: 'internal' }));
            } else {
              res.destroy();
            }
          });
        },
      }),
    'dsh-mobile: desktop api',
  );

  // 便于在控制台确认插件已加载。
  ctx.effect(() => () => {}, 'dsh-mobile: loaded');
  log(`已加载，数据目录 ${dataDir}，上游 ${origin}`);
}

// 0.2.x 的 Loader 会优先取 default 导出作为插件定义；只默认导出 apply 函数会
// 丢掉 name/inject 元数据（表现为 "cannot get property webServer without inject"）。
// 用对象形式导出，和 dsh-whale-widget 等 0.2.x 插件保持一致。
export default { name, inject, apply };

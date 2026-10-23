// Web Push：把「待审批 / 任务完成 / 运行失败」推到手机。
//
// 依赖 web-push（VAPID + RFC 8291 加密）。密钥第一次用时生成，
// 存在 $DSH_HOME/.dsh-mobile/vapid.json；订阅按设备保存，吊销设备时一起删。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SUBJECT = 'https://github.com/deepseek-ai/deepseek-harness';

function loadWebPush() {
  try {
    const mod = require('web-push');
    return mod?.default ?? mod;
  } catch {
    return null;
  }
}

export function createPushService({ dir, store, log = () => {} }) {
  const webpush = loadWebPush();
  const keyFile = path.join(dir, 'vapid.json');
  let keys = null;
  let ready = false;

  function ensureKeys() {
    if (ready) return true;
    if (!webpush) return false;
    try {
      if (fs.existsSync(keyFile)) {
        const saved = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
        if (saved && typeof saved.publicKey === 'string' && typeof saved.privateKey === 'string') {
          keys = saved;
        }
      }
      if (!keys) {
        const generated = webpush.generateVAPIDKeys();
        keys = { publicKey: generated.publicKey, privateKey: generated.privateKey };
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(keyFile, JSON.stringify(keys, null, 2), { mode: 0o600 });
      }
      webpush.setVapidDetails(SUBJECT, keys.publicKey, keys.privateKey);
      ready = true;
      return true;
    } catch (error) {
      log(`推送密钥初始化失败：${String(error?.message ?? error)}`);
      return false;
    }
  }

  ensureKeys();

  return {
    get available() {
      return Boolean(webpush);
    },
    get publicKey() {
      ensureKeys();
      return keys?.publicKey ?? '';
    },
    count() {
      return store.listSubscriptions().length;
    },
    subscribe(deviceId, subscription, ua = '') {
      return store.addSubscription(deviceId, subscription, ua);
    },
    unsubscribe(endpoint) {
      return store.removeSubscription(endpoint);
    },
    /** 给所有已订阅手机发一条通知；返回送达/失败数量。 */
    async send(payload, { deviceId = '' } = {}) {
      if (!ensureKeys()) return { sent: 0, failed: 0, skipped: 'unavailable' };
      const targets = store.listSubscriptions(deviceId);
      if (targets.length === 0) return { sent: 0, failed: 0, skipped: 'no-subscriptions' };
      const body = JSON.stringify(payload);
      let sent = 0;
      let failed = 0;
      for (const target of targets) {
        try {
          await webpush.sendNotification(
            { endpoint: target.endpoint, keys: target.keys },
            body,
            { TTL: 3600, urgency: payload.kind === 'approval' ? 'high' : 'normal' },
          );
          sent += 1;
        } catch (error) {
          failed += 1;
          const status = error?.statusCode;
          if (status === 400 || status === 401 || status === 403 || status === 404 || status === 410) {
            store.removeSubscription(target.endpoint);
          } else if (failed <= 2) {
            log(`推送失败（${status ?? 'unknown'}）：${String(error?.message ?? error).slice(0, 160)}`);
          }
        }
      }
      return { sent, failed };
    },
  };
}

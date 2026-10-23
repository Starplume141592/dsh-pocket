// 设备与设置的持久化存储：$DSH_HOME/.dsh-mobile/state.json
// 设备令牌只保存 sha256，明文只在配对成功时下发一次给手机。
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const VERSION = 1;
const MAX_SUBSCRIPTIONS = 16;

const DEFAULT_SETTINGS = {
  publicUrl: '',
  lan: false,
  // 手机通知总开关；具体事件（审批/完成/失败）在 host 侧固定发送。
  notify: { enabled: true },
  // 公网隧道托管：off | quick | token；autoStart 表示 DSH 启动时自动拉起。
  tunnel: { mode: 'off', token: '', autoStart: false },
};

function atomicWrite(file, text) {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function normalizeSettings(raw) {
  const settings = {
    publicUrl: '',
    lan: false,
    notify: { ...DEFAULT_SETTINGS.notify },
    tunnel: { ...DEFAULT_SETTINGS.tunnel },
  };
  if (!raw || typeof raw !== 'object') return settings;
  if (typeof raw.publicUrl === 'string') settings.publicUrl = raw.publicUrl;
  if (typeof raw.lan === 'boolean') settings.lan = raw.lan;
  if (raw.notify && typeof raw.notify === 'object' && typeof raw.notify.enabled === 'boolean') {
    settings.notify.enabled = raw.notify.enabled;
  }
  if (raw.tunnel && typeof raw.tunnel === 'object') {
    if (raw.tunnel.mode === 'off' || raw.tunnel.mode === 'quick' || raw.tunnel.mode === 'token') {
      settings.tunnel.mode = raw.tunnel.mode;
    }
    if (typeof raw.tunnel.token === 'string') settings.tunnel.token = raw.tunnel.token;
    if (typeof raw.tunnel.autoStart === 'boolean') settings.tunnel.autoStart = raw.tunnel.autoStart;
  }
  return settings;
}

export function createStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'state.json');
  let data;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    data = parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    data = null;
  }
  if (!data || data.version !== VERSION) {
    data = {
      version: VERSION,
      secret: randomBytes(32).toString('base64url'),
      devices: [],
      subscriptions: [],
      settings: {},
      createdAt: Date.now(),
    };
  }
  if (!data.secret || typeof data.secret !== 'string' || data.secret.length < 32) {
    data.secret = randomBytes(32).toString('base64url');
  }
  if (!Array.isArray(data.devices)) data.devices = [];
  if (!Array.isArray(data.subscriptions)) data.subscriptions = [];
  if (!data.settings || typeof data.settings !== 'object') data.settings = {};
  const normalized = normalizeSettings(data.settings);
  data.settings = normalized;

  const save = () => atomicWrite(file, JSON.stringify(data, null, 2));

  return {
    dir,
    file,
    get secret() {
      return data.secret;
    },
    get settings() {
      return {
        ...data.settings,
        notify: { ...data.settings.notify },
        tunnel: { ...data.settings.tunnel },
      };
    },
    updateSettings(patch = {}) {
      if (typeof patch.publicUrl === 'string') {
        data.settings.publicUrl = patch.publicUrl.trim().replace(/\/+$/, '');
      }
      if (typeof patch.lan === 'boolean') {
        data.settings.lan = patch.lan;
      }
      if (patch.notify && typeof patch.notify === 'object' && typeof patch.notify.enabled === 'boolean') {
        data.settings.notify.enabled = patch.notify.enabled;
      }
      if (patch.tunnel && typeof patch.tunnel === 'object') {
        if (patch.tunnel.mode === 'off' || patch.tunnel.mode === 'quick' || patch.tunnel.mode === 'token') {
          data.settings.tunnel.mode = patch.tunnel.mode;
        }
        if (typeof patch.tunnel.token === 'string') {
          data.settings.tunnel.token = patch.tunnel.token.trim();
        }
        if (typeof patch.tunnel.autoStart === 'boolean') {
          data.settings.tunnel.autoStart = patch.tunnel.autoStart;
        }
      }
      save();
      return this.settings;
    },
    listDevices() {
      return data.devices.map((device) => ({
        id: device.id,
        name: device.name,
        platform: device.platform ?? '',
        createdAt: device.createdAt,
        lastSeen: device.lastSeen,
        lastIp: device.lastIp,
        subscriptions: data.subscriptions.filter((item) => item.deviceId === device.id).length,
      }));
    },
    renameDevice(id, name) {
      const device = data.devices.find((item) => item.id === id);
      const label = String(name ?? '').trim().slice(0, 40);
      if (!device || label === '') return false;
      device.name = label;
      save();
      return true;
    },
    listSubscriptions(deviceId = '') {
      return data.subscriptions
        .filter((item) => (deviceId ? item.deviceId === deviceId : true))
        .map((item) => ({ ...item, keys: { ...item.keys } }));
    },
    addSubscription(deviceId, subscription, ua = '') {
      if (!subscription || typeof subscription.endpoint !== 'string') return false;
      if (!/^https:\/\//i.test(subscription.endpoint)) return false;
      const keys = subscription.keys;
      if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return false;
      if (!data.devices.some((device) => device.id === deviceId)) return false;
      data.subscriptions = data.subscriptions.filter((item) => item.endpoint !== subscription.endpoint);
      data.subscriptions.push({
        endpoint: subscription.endpoint,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
        deviceId,
        ua: String(ua || '').slice(0, 200),
        createdAt: Date.now(),
      });
      if (data.subscriptions.length > MAX_SUBSCRIPTIONS) {
        data.subscriptions = data.subscriptions.slice(-MAX_SUBSCRIPTIONS);
      }
      save();
      return true;
    },
    removeSubscription(endpoint) {
      const before = data.subscriptions.length;
      data.subscriptions = data.subscriptions.filter((item) => item.endpoint !== endpoint);
      if (data.subscriptions.length === before) return false;
      save();
      return true;
    },
    removeSubscriptionsForDevice(deviceId) {
      const before = data.subscriptions.length;
      data.subscriptions = data.subscriptions.filter((item) => item.deviceId !== deviceId);
      if (data.subscriptions.length === before) return false;
      save();
      return true;
    },
    /** 新建一台已批准设备，返回明文令牌（仅此一次）。 */
    addDevice({ name, platform = '', ip = '' }) {
      const id = randomUUID();
      const token = randomBytes(32).toString('base64url');
      const now = Date.now();
      const device = {
        id,
        name: name || '手机',
        platform,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        createdAt: now,
        lastSeen: now,
        lastIp: ip,
      };
      data.devices.push(device);
      save();
      return { device: { ...device, tokenHash: undefined }, token };
    },
    findDevice(id) {
      return data.devices.find((device) => device.id === id) ?? null;
    },
    /** cookie 值形如 `<id>.<token>`，校验通过返回设备。 */
    authenticate(cookieValue) {
      if (typeof cookieValue !== 'string' || cookieValue.length < 40) return null;
      const dot = cookieValue.indexOf('.');
      if (dot <= 0) return null;
      const id = cookieValue.slice(0, dot);
      const token = cookieValue.slice(dot + 1);
      const device = this.findDevice(id);
      if (!device) return null;
      const hash = createHash('sha256').update(token).digest('hex');
      if (hash.length !== device.tokenHash.length) return null;
      let diff = 0;
      for (let i = 0; i < hash.length; i += 1) diff |= hash.charCodeAt(i) ^ device.tokenHash.charCodeAt(i);
      if (diff !== 0) return null;
      return device;
    },
    touchDevice(id, ip = '') {
      const device = this.findDevice(id);
      if (!device) return;
      const now = Date.now();
      // 每个请求都落盘会拖慢手机端（一次会话几十个资源请求）。60 秒节流足够。
      if (now - (device.lastSeen ?? 0) < 60_000 && (!ip || device.lastIp === ip)) return;
      device.lastSeen = now;
      if (ip) device.lastIp = ip;
      save();
    },
    revokeDevice(id) {
      const index = data.devices.findIndex((device) => device.id === id);
      if (index === -1) return false;
      data.devices.splice(index, 1);
      data.subscriptions = data.subscriptions.filter((item) => item.deviceId !== id);
      save();
      return true;
    },
  };
}

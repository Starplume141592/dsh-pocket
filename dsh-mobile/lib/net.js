// 本机网络与设备识别的小工具。
import os from 'node:os';

// 虚拟网卡（WSL/Hyper-V/安卓模拟器/VPN/容器）经常排在物理网卡前面，
// 直接取第一个私网地址会给手机一个连不上的 IP。
const VIRTUAL_NAME =
  /(vEthernet|VMware|VirtualBox|Hyper-?V|WSL|MEmu|Loopback|Bluetooth|Tailscale|ZeroTier|docker|br-|utun|tun\d|tap\d|VPN|Npcap|Radmin|Hamachi|Virtual Adapter)/i;
const PHYSICAL_HINT = /(WLAN|Wi-?Fi|Wireless|Ethernet|以太网|无线|本地连接)/i;

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/**
 * 选一个手机可达的局域网 IPv4。
 * 打分：物理网卡 +20、私网 +10、虚拟网卡 -50、169.254 链路本地 -100；
 * 没有正分候选时退回第一个非回环地址，再不行就 127.0.0.1。
 */
export function lanAddress(interfaces = os.networkInterfaces()) {
  let best = null;
  let fallback = null;
  for (const name of Object.keys(interfaces)) {
    for (const entry of interfaces[name] ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      const ip = entry.address;
      if (!ip.startsWith('169.254.') && fallback === null) fallback = ip;

      let score = 0;
      if (isPrivateIPv4(ip)) score += 10;
      if (PHYSICAL_HINT.test(name)) score += 20;
      if (VIRTUAL_NAME.test(name)) score -= 50;
      if (ip.startsWith('169.254.')) score -= 100;

      if (score > 0 && (best === null || score > best.score)) best = { ip, score };
    }
  }
  if (best) return best.ip;
  return fallback ?? '127.0.0.1';
}

export function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false;
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1' ||
    address.startsWith('127.')
  );
}

/** 从 User-Agent 生成一个给人看的设备名。 */
export function deviceLabel(ua = '') {
  const platform = /iPhone/i.test(ua)
    ? 'iPhone'
    : /iPad/i.test(ua)
      ? 'iPad'
      : /Android/i.test(ua)
        ? 'Android'
        : /Windows/i.test(ua)
          ? 'Windows'
          : /Macintosh|Mac OS X/i.test(ua)
            ? 'Mac'
            : '未知设备';
  const browser = /EdgA?\/|Edg\//i.test(ua)
    ? 'Edge'
    : /MicroMessenger/i.test(ua)
      ? '微信'
      : /CriOS|Chrome\//i.test(ua)
        ? 'Chrome'
        : /FxiOS|Firefox\//i.test(ua)
          ? 'Firefox'
          : /Safari\//i.test(ua)
            ? 'Safari'
            : '';
  return browser ? `${platform} · ${browser}` : platform;
}

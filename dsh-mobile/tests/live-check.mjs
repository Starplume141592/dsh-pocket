// 对一个正在运行的 DSH 实例做完整联调：配对 → 领取 cookie → 代理真实 UI → WS → 吊销。
//
// 默认对着 scripts/dev-host.ps1 起的隔离实例（GUI 39001、网关 8470）。
// 也可以对着正在用的实例跑，但要先知道它的 GUI 端口：
//   $env:DSH_MAIN = 'http://127.0.0.1:30148'; node .\dsh-mobile\tests\live-check.mjs
import http from 'node:http';

const MAIN = process.env.DSH_MAIN ?? 'http://127.0.0.1:39001';
const GW = process.env.DSH_GW ?? 'http://127.0.0.1:8470';
const GW_PORT = Number(new URL(GW).port || 80);
const results = [];
const ok = (name, extra = '') => {
  results.push(['PASS', name, extra]);
  console.log('PASS', name, extra);
};
const fail = (name, extra = '') => {
  results.push(['FAIL', name, extra]);
  console.log('FAIL', name, extra);
};

async function post(url, body, origin) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify(body ?? {}),
  });
}

let res = await fetch(`${MAIN}/plugins/dsh-mobile/api/state`);
const state = await res.json();
res.ok && state.ok ? ok('state', `running=${state.running} appUrl=${state.appUrl}`) : fail('state', JSON.stringify(state));

res = await post(`${MAIN}/plugins/dsh-mobile/api/pair/start`, {}, MAIN);
const started = await res.json();
started.ok ? ok('pair/start', `code=${started.pairing.code}`) : fail('pair/start', JSON.stringify(started));
const token = started.pairing.token;

res = await fetch(`${GW}/__dshm/pair?t=${encodeURIComponent(token)}`, {
  headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/120' },
});
const pairPage = await res.text();
const pageHasCode = pairPage.includes(started.pairing.code);
const pageHasToken = pairPage.includes(started.pairing.token);
res.ok && pairPage.includes('正在等待电脑确认') && pageHasCode && pageHasToken
  ? ok('pair page', `code=${pageHasCode} token=${pageHasToken}`)
  : fail('pair page', `status=${res.status} code=${pageHasCode} token=${pageHasToken}`);

res = await post(`${MAIN}/plugins/dsh-mobile/api/pair/decide`, { approve: true }, MAIN);
const decided = await res.json();
decided.ok && decided.pairing.state === 'approved'
  ? ok('pair/decide', `device=${decided.pairing.deviceName}`)
  : fail('pair/decide', JSON.stringify(decided));

res = await post(`${GW}/__dshm/api/pair/claim?t=${encodeURIComponent(token)}`, {});
const claim = await res.json();
const cookie = res.headers.getSetCookie()[0]?.split(';')[0] ?? '';
claim.ok && cookie.startsWith('dshm_device=')
  ? ok('pair/claim', cookie.slice(0, 24) + '…')
  : fail('pair/claim', String(res.status));

res = await fetch(`${GW}/`, { headers: { cookie, accept: 'text/html' } });
const home = await res.text();
const hasManifest = home.includes('href="/__dshm/manifest.webmanifest"');
const hasBoot = home.includes('/__dshm/boot.js');
const realApp = home.includes('assets/') || home.includes('root');
res.status === 200 && hasManifest && hasBoot
  ? ok('proxy home', `len=${home.length} manifest=${hasManifest} boot=${hasBoot} app=${realApp}`)
  : fail('proxy home', `status=${res.status} len=${home.length} manifest=${hasManifest} boot=${hasBoot}`);

res = await fetch(`${GW}/__dshm/api/push/key`, { headers: { cookie } });
const pushKey = await res.json().catch(() => ({}));
res.ok && typeof pushKey.publicKey === 'string' && pushKey.publicKey.length > 60
  ? ok('push key', `len=${pushKey.publicKey.length}`)
  : fail('push key', `status=${res.status} body=${JSON.stringify(pushKey).slice(0, 160)}`);

res = await fetch(`${GW}/__dshm/api/push/subscribe`, {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ endpoint: 'https://push.example.com/live-check', keys: { p256dh: 'live-p256dh', auth: 'live-auth' } }),
});
const subscribed = await res.json().catch(() => ({}));
subscribed.ok === true ? ok('push subscribe', `count=${subscribed.count}`) : fail('push subscribe', JSON.stringify(subscribed));

res = await fetch(`${MAIN}/plugins/dsh-mobile/api/state`);
const withPush = await res.json();
res = await post(`${MAIN}/plugins/dsh-mobile/api/devices/rename`, { id: withPush.devices?.[0]?.id, name: '联调设备' }, MAIN);
const renamed = await res.json();
renamed.ok ? ok('device rename', renamed.state?.devices?.[0]?.name ?? '') : fail('device rename', JSON.stringify(renamed).slice(0, 160));

const wsStatus = await new Promise((resolve) => {
  const req = http.request({
    host: '127.0.0.1',
    port: GW_PORT,
    path: '/api/remote.mux',
    headers: {
      connection: 'Upgrade',
      upgrade: 'websocket',
      'sec-websocket-key': Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64'),
      'sec-websocket-version': '13',
      cookie,
    },
  });
  req.on('upgrade', (upRes, socket) => {
    socket.destroy();
    resolve(upRes.statusCode);
  });
  req.on('response', (upRes) => {
    upRes.resume();
    resolve(upRes.statusCode);
  });
  req.on('error', () => resolve(0));
  req.end();
});
wsStatus === 101 ? ok('websocket', String(wsStatus)) : fail('websocket', `status=${wsStatus}`);

res = await fetch(`${MAIN}/plugins/dsh-mobile/api/state`);
const afterState = await res.json();
const deviceId = afterState.devices?.[0]?.id;
res = await post(`${MAIN}/plugins/dsh-mobile/api/devices/revoke`, { id: deviceId }, MAIN);
const revoked = await res.json();
const after = await fetch(`${GW}/`, { headers: { cookie, accept: 'text/html' } });
revoked.ok && (after.status === 401 || after.status === 403)
  ? ok('revoke', `device=${deviceId} home after revoke=${after.status}`)
  : fail('revoke', `ok=${revoked.ok} status=${after.status}`);

const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed === 0 ? 0 : 1;

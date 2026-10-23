// 临时探针：验证「手机能不能通过公网 IPv6 直接连到这台电脑」。
// 只监听一个端口、只回显访问者地址，不碰 DSH 和 8470 网关。
//   node scripts/ipv6-probe.mjs 9999
// 手机（关 Wi-Fi 用流量）打开日志里打印的 http://[地址]:端口/ 即可。
import http from 'node:http';
import os from 'node:os';

const port = Number(process.argv[2] || process.env.PROBE_PORT || 9999);
const started = new Date().toISOString();
let hits = 0;

function globalV6() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family !== 'IPv6' || item.internal) continue;
      if (item.address.startsWith('fe80')) continue;
      out.push(item.address);
    }
  }
  return out;
}

const server = http.createServer((req, res) => {
  hits += 1;
  const remote = req.socket.remoteAddress || '';
  const family = req.socket.remoteFamily || '';
  const url = req.url || '/';
  const ua = String(req.headers['user-agent'] || '').slice(0, 80);
  console.log(`[${new Date().toISOString()}] #${hits} ${req.method} ${url} from ${remote} (${family}) ua="${ua}"`);

  if (url.startsWith('/__dshm/health') || String(req.headers.accept || '').includes('application/json')) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, probe: 'ipv6', remote, family, time: new Date().toISOString(), hits }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(
    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>IPv6 probe</title>' +
      '<body style="font:17px/1.6 system-ui;padding:28px;background:#0b0d12;color:#e8eaf0">' +
      '<h1 style="color:#4ade80">IPv6 已连通</h1>' +
      `<p>你的地址：<code>${remote}</code></p>` +
      `<p>协议族：${family}</p>` +
      `<p>本次第 ${hits} 次请求，服务器时间 ${new Date().toISOString()}</p>` +
      `<p style="color:#8b93a7">服务启动于 ${started}</p>` +
      '</body>',
  );
});

server.on('error', (error) => {
  console.error('listen failed:', error.message);
  process.exit(1);
});

server.listen(port, '::', () => {
  console.log(`listening on [::]:${port} (dual-stack)`);
  for (const addr of globalV6()) console.log(`  http://[${addr}]:${port}/`);
  console.log('等待手机访问……');
});

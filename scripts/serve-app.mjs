import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'F:/dshapp/app');
const port = Number(process.argv[3] || 8788);
const upstreamPort = Number(process.env.DSH_GW_PORT || 8470);
const upstreamHost = '127.0.0.1';
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function isProxyPath(url) {
  return url.startsWith('/api/') || url.startsWith('/__dshm/');
}

function proxyHttp(req, res) {
  const headers = { ...req.headers, host: upstreamHost + ':' + upstreamPort };
  const proxy = http.request({ host: upstreamHost, port: upstreamPort, path: req.url, method: req.method, headers }, (upstream) => {
    res.writeHead(upstream.statusCode || 502, upstream.headers);
    upstream.pipe(res);
  });
  proxy.on('error', (error) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('gateway unavailable: ' + error.message);
  });
  req.pipe(proxy);
}

function proxyUpgrade(req, socket, head) {
  if (!isProxyPath(req.url || '')) { socket.destroy(); return; }
  const upstream = net.connect(upstreamPort, upstreamHost, () => {
    const lines = [req.method + ' ' + req.url + ' HTTP/' + req.httpVersion];
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) for (const item of value) lines.push(key + ': ' + item);
      else if (value !== undefined) lines.push(key + ': ' + value);
    }
    lines.push('host: ' + upstreamHost + ':' + upstreamPort);
    upstream.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
}

const server = http.createServer((req, res) => {
  if (isProxyPath(req.url || '')) { proxyHttp(req, res); return; }
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (url.pathname === '/' || url.pathname.endsWith('/')) file = path.join(file, 'index.html');
  if (!file.startsWith(root)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
});

server.on('upgrade', proxyUpgrade);
server.listen(port, '127.0.0.1', () => {
  console.log('Pocket preview: http://127.0.0.1:' + port + '/');
  console.log('Proxying /api and /__dshm to http://' + upstreamHost + ':' + upstreamPort);
});

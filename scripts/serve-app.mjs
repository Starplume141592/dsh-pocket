import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.argv[2] || 'F:/dshapp/app');
const port = Number(process.argv[3] || 8788);
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon' };
http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (url.pathname === '/' || url.pathname.endsWith('/')) file = path.join(file, 'index.html');
  if (!file.startsWith(root)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log('Pocket preview: http://127.0.0.1:' + port + '/'));

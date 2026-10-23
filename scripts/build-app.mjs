import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'F:/dshapp');
const src = path.join(root, 'app');
const dest = path.join(root, 'dsh-mobile', 'assets', 'pocket');
const skip = new Set(['node_modules', '.git', 'tools']);
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
function copy(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    if (entry.isDirectory()) { fs.mkdirSync(b, { recursive: true }); copy(a, b); }
    else fs.copyFileSync(a, b);
  }
}
copy(src, dest);
const releaseSrc = path.join(root, 'docs', 'releases');
if (fs.existsSync(releaseSrc)) {
  const releaseDest = path.join(dest, 'release');
  fs.mkdirSync(releaseDest, { recursive: true });
  for (const name of ['index.html', 'config.json']) {
    const from = path.join(releaseSrc, name);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(releaseDest, name));
  }
  const installer = path.join(root, 'docs', 'install.ps1');
  if (fs.existsSync(installer)) fs.copyFileSync(installer, path.join(releaseDest, 'install.ps1'));
  const hostZip = path.join(root, 'dist', 'PocketHost.zip');
  if (fs.existsSync(hostZip)) fs.copyFileSync(hostZip, path.join(releaseDest, 'PocketHost.zip'));
  const apk = path.join(root, 'dist', 'Pocket-0.4.2-debug.apk');
  if (fs.existsSync(apk)) fs.copyFileSync(apk, path.join(releaseDest, 'Pocket-0.4.2-debug.apk'));
}
const files = fs.readdirSync(dest);
console.log('Pocket assets ->', dest);
console.log(files.join(', '));

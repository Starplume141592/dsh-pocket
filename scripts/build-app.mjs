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
const files = fs.readdirSync(dest);
console.log('Pocket assets ->', dest);
console.log(files.join(', '));

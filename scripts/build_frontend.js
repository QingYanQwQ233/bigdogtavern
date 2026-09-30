/*
 * 前端 bundle 构建 + 资源版本戳维护。
 *
 * 背景：public/index.html 与 public/sw.js 里的 `?v=` / ASSET_VERSION 以前靠手动改。
 * 忘记改的话，浏览器与 WebView 会命中旧缓存，表现为「改了不生效」——排查成本很高。
 * 现在版本号由资源内容的哈希派生：内容一变、版本必变；内容不变则版本稳定。
 * 版本键自身的值不参与哈希（先把 ?v= 归一化），避免自引用。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const sourceFiles = [
  'frontend/app-core.js',
  'frontend/rpg-world.js',
  'frontend/ai-protocol.js',
  'frontend/ai-prompt.js',
  'frontend/app-render.js',
  'frontend/tavern-rp.js',
  'frontend/ai-runtime.js',
  'frontend/app-ui.js',
];
const outputFile = 'public/app.js';
const header = '/* AUTO-GENERATED: edit frontend/*.js, then run node scripts/build_frontend.js. */\n';
// 参与版本哈希的资源：任一变化都会换版本号，破缓存。
const versionedAssets = ['public/app.js', 'public/styles.css', 'public/mapgen.js', 'public/index.html'];
const htmlPath = path.join(root, 'public/index.html');
const swPath = path.join(root, 'public/sw.js');

function build() {
  return header + sourceFiles.map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('');
}

// 归一化 ?v=<值>，使版本键自身不影响哈希。
function normalizeVersionKeys(text) {
  return text.replace(/(\?v=)[0-9A-Za-z._-]*/g, '$1');
}

function computeVersion() {
  const hash = crypto.createHash('sha1');
  for (const file of versionedAssets) {
    const raw = fs.readFileSync(path.join(root, file), 'utf8');
    hash.update(file === 'public/index.html' ? normalizeVersionKeys(raw) : raw);
  }
  return hash.digest('hex').slice(0, 8);
}

// 把版本号写进 index.html 的 ?v= 与 sw.js 的 ASSET_VERSION，返回是否有改动。
function applyVersion(version) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const nextHtml = html.replace(/(\?v=)[0-9A-Za-z._-]*/g, '$1' + version);
  const sw = fs.readFileSync(swPath, 'utf8');
  const nextSw = sw.replace(/(const ASSET_VERSION = ')[^']*(')/, '$1' + version + '$2');
  const changed = nextHtml !== html || nextSw !== sw;
  return { changed, write() { fs.writeFileSync(htmlPath, nextHtml, 'utf8'); fs.writeFileSync(swPath, nextSw, 'utf8'); } };
}

const expected = build();
const outputPath = path.join(root, outputFile);
const checkOnly = process.argv.includes('--check');
const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';

if (current !== expected) {
  if (checkOnly) console.error('public/app.js is stale. Run: node scripts/build_frontend.js');
  else { fs.writeFileSync(outputPath, expected, 'utf8'); console.log('generated public/app.js'); }
}

const version = computeVersion();
const stamp = applyVersion(version);
if (stamp.changed) {
  if (checkOnly) console.error(`asset version stamp is stale (expected ${version}). Run: node scripts/build_frontend.js`);
  else { stamp.write(); console.log('updated asset version ->', version); }
}

if (checkOnly) {
  if (process.exitCode) { /* 已报错 */ }
  else console.log('frontend source split + asset version check passed');
} else if (current === expected && !stamp.changed) {
  console.log('public/app.js is already current');
}

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourceFiles = [
  'frontend/app-core.js',
  'frontend/rpg-world.js',
  'frontend/ai-protocol.js',
  'frontend/app-render.js',
  'frontend/tavern-rp.js',
  'frontend/ai-runtime.js',
  'frontend/app-ui.js',
];
const outputFile = 'public/app.js';
const header = '/* AUTO-GENERATED: edit frontend/*.js, then run node scripts/build_frontend.js. */\n';

function build() {
  return header + sourceFiles.map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('');
}

const expected = build();
const outputPath = path.join(root, outputFile);
const checkOnly = process.argv.includes('--check');
const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';

if (checkOnly) {
  if (current !== expected) {
    console.error('public/app.js is stale. Run: node scripts/build_frontend.js');
    process.exitCode = 1;
  } else {
    console.log('frontend source split check passed');
  }
} else if (current !== expected) {
  fs.writeFileSync(outputPath, expected, 'utf8');
  console.log('generated public/app.js');
} else {
  console.log('public/app.js is already current');
}

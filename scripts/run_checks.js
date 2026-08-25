'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const scriptFiles = fs.readdirSync(__dirname)
  .filter(name => name.endsWith('.js'))
  .sort();
const syntaxFiles = [
  'server.js',
  'public/app.js',
  'public/mapgen.js',
  'public/sw.js',
  ...scriptFiles.map(name => `scripts/${name}`),
];
const checks = scriptFiles.filter(name => /^check_.*\.js$/.test(name));
const tasks = [
  ...syntaxFiles.map(file => ({ label: `syntax ${file}`, args: ['--check', file] })),
  ...checks.map(file => ({ label: file, args: [`scripts/${file}`] })),
];

let failed = 0;
const startedAt = Date.now();
for (const task of tasks) {
  const started = Date.now();
  const result = spawnSync(process.execPath, task.args, {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
  });
  const duration = Date.now() - started;
  if (!result.error && result.status === 0) {
    console.log(`[PASS] ${task.label} (${duration}ms)`);
    continue;
  }
  failed += 1;
  console.error(`[FAIL] ${task.label} (${duration}ms)`);
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) console.error(result.error.stack || result.error.message);
}

console.log(`\n${tasks.length - failed}/${tasks.length} checks passed in ${Date.now() - startedAt}ms`);
if (failed) process.exitCode = 1;

#!/usr/bin/env node
'use strict';

// 把仓库 skills/ 同步到 Operit 的全局 skill 目录。
//
// 为什么需要：Agent 实际读取技能的位置是 Operit 全局目录
//   /sdcard/Download/Operit/skills/<name>/SKILL.md
// 那个目录不进版本控制、换机就没了。仓库里的 skills/ 是唯一可信来源。
//
// 用法：
//   node scripts/sync_skills.js --check    只比对，不写盘
//   node scripts/sync_skills.js            推送新增与差异；同名冲突默认停下并报告
//   node scripts/sync_skills.js --force    冲突时覆盖目标
//
// 目标目录可用环境变量 OPERIT_SKILLS_DIR 覆盖。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'skills');
const dstDir = process.env.OPERIT_SKILLS_DIR || '/sdcard/Download/Operit/skills';

const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has('--check');
const FORCE = args.has('--force');

// ── 工具 ────────────────────────────────────────────────────────────────

function listSkillDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .filter(name => fs.existsSync(path.join(dir, name, 'SKILL.md')))
    .sort();
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full).map(p => path.join(entry.name, p)));
    else out.push(entry.name);
  }
  return out.sort();
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// ── 主流程 ──────────────────────────────────────────────────────────────

if (!fs.existsSync(srcDir)) {
  console.error(`[ERROR] 仓库中没有 skills 目录：${srcDir}`);
  process.exit(1);
}

const skills = listSkillDirs(srcDir);
if (!skills.length) {
  console.error('[ERROR] skills 目录下没有任何含 SKILL.md 的技能');
  process.exit(1);
}

if (!fs.existsSync(dstDir)) {
  if (CHECK_ONLY) {
    console.log(`[SKIP] 目标目录不存在：${dstDir}`);
    console.log('       这不是失败，只是说明当前环境没有 Operit 全局 skill 目录。');
    process.exit(0);
  }
  fs.mkdirSync(dstDir, { recursive: true });
}

const newSkills = [];
const newFiles = [];
const conflicts = [];
const same = [];

for (const name of skills) {
  const from = path.join(srcDir, name);
  const to = path.join(dstDir, name);
  const targetExists = fs.existsSync(to);

  if (!targetExists) newSkills.push(name);

  for (const rel of walk(from)) {
    const srcFile = path.join(from, rel);
    const dstFile = path.join(to, rel);
    if (!fs.existsSync(dstFile)) {
      newFiles.push(`${name}/${rel}`);
      continue;
    }
    if (sha256(srcFile) === sha256(dstFile)) same.push(`${name}/${rel}`);
    else conflicts.push(`${name}/${rel}`);
  }
}

const willWrite = newSkills.length + newFiles.length + (FORCE ? conflicts.length : 0);

console.log(`来源：${srcDir}`);
console.log(`目标：${dstDir}`);
console.log(`技能：${skills.length} 个（${skills.join(', ')}）`);
console.log('');
console.log(`新增技能目录 : ${newSkills.length}${newSkills.length ? ` — ${newSkills.join(', ')}` : ''}`);
console.log(`新增文件     : ${newFiles.length}`);
console.log(`内容一致     : ${same.length}`);
console.log(`冲突（有差异）: ${conflicts.length}${conflicts.length ? ` — ${conflicts.join(', ')}` : ''}`);

if (conflicts.length && !FORCE) {
  console.error('');
  console.error('[STOP] 目标目录里存在同名但内容不同的文件，默认不覆盖。');
  console.error('       先确认哪一份是对的：如果仓库是对的，用 --force 覆盖；');
  console.error('       如果目标是手工改过的，请把改动搬回仓库再同步。');
  process.exit(1);
}

if (CHECK_ONLY) {
  console.log('');
  console.log(willWrite ? `[DIFF] 有 ${willWrite} 项未同步（--check 模式未写盘）` : '[OK] 两侧一致');
  process.exit(willWrite ? 1 : 0);
}

for (const name of skills) {
  const from = path.join(srcDir, name);
  const to = path.join(dstDir, name);
  for (const rel of walk(from)) {
    const srcFile = path.join(from, rel);
    const dstFile = path.join(to, rel);
    const sameContent = fs.existsSync(dstFile) && sha256(srcFile) === sha256(dstFile);
    if (sameContent) continue;
    fs.mkdirSync(path.dirname(dstFile), { recursive: true });
    fs.copyFileSync(srcFile, dstFile);
  }
}

console.log('');
console.log(`[OK] 已同步，写入 ${newSkills.length + newFiles.length + (FORCE ? conflicts.length : 0)} 项。`);

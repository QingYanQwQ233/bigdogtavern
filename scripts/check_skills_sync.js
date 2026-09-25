'use strict';

// skills/ 守卫。
//
// 为什么需要：仓库里的 skills/ 是唯一可信来源，但 Agent 实际读的是 Operit 全局目录。
// 两份副本之间没有任何机制防漂移 —— 手工改了全局那份、或者加了技能忘了同步，
// 都不会报错，只会让 Agent 用上过时的知识。这类静默退化和"内核版本过低"
// "CSS 变量未定义"是同一种病。
//
// 守三件事：
//   1. 仓库内部自洽（每个技能有 SKILL.md、路由表指向的文件真实存在、第三方带 LICENSE）
//   2. 第三方来源在 README 里有登记（防止收录了没记录）
//   3. 与全局目录逐文件一致（目标目录不存在时优雅跳过）

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const skillsDir = path.join(root, 'skills');
const dstDir = process.env.OPERIT_SKILLS_DIR || '/sdcard/Download/Operit/skills';

// ── 1. 仓库内部自洽 ─────────────────────────────────────────────────────

assert.ok(fs.existsSync(skillsDir), 'skills/ 目录不存在');

const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
  .filter(e => e.isDirectory())
  .map(e => e.name)
  .sort();

assert.ok(entries.length > 0, 'skills/ 下没有任何技能目录');

for (const name of entries) {
  const skillFile = path.join(skillsDir, name, 'SKILL.md');
  assert.ok(fs.existsSync(skillFile), `skills/${name}/ 缺少 SKILL.md`);
  const body = fs.readFileSync(skillFile, 'utf8');
  assert.ok(body.trim().length > 0, `skills/${name}/SKILL.md 是空文件`);
  assert.match(body, /^---[\s\S]*?name:\s*\S+/m, `skills/${name}/SKILL.md 的 frontmatter 缺少 name`);
  assert.match(body, /^---[\s\S]*?description:\s*\S+/m, `skills/${name}/SKILL.md 的 frontmatter 缺少 description`);
}

// 统一入口的 references 必须齐全，且路由表指向的每个文件都要真实存在
const ownSkill = 'ui-design-system';
const ownDir = path.join(skillsDir, ownSkill);
assert.ok(fs.existsSync(ownDir), `${ownSkill} 入口技能缺失`);

const expectedRefs = [
  'ux-principles.md',
  'information-architecture.md',
  'visual-hierarchy.md',
  'typography.md',
  'color.md',
  'spacing.md',
  'components.md',
  'responsive.md',
  'accessibility.md',
  'design-review.md',
];
const refsDir = path.join(ownDir, 'references');
for (const ref of expectedRefs) {
  assert.ok(fs.existsSync(path.join(refsDir, ref)), `${ownSkill}/references/${ref} 缺失`);
}

const routing = fs.readFileSync(path.join(ownDir, 'SKILL.md'), 'utf8');
const routed = [...routing.matchAll(/references\/[a-z0-9-]+\.md/g)].map(m => m[0]);
assert.ok(routed.length >= expectedRefs.length, `${ownSkill}/SKILL.md 的路由表条目少于 ${expectedRefs.length} 条`);
for (const target of new Set(routed)) {
  assert.ok(
    fs.existsSync(path.join(ownDir, target)),
    `${ownSkill}/SKILL.md 路由到了不存在的文件：${target}`
  );
}

// 第三方技能必须带 LICENSE 且在 README 的来源表里登记
const readme = fs.readFileSync(path.join(skillsDir, 'README.md'), 'utf8');
const thirdParty = entries.filter(name => name !== ownSkill);
assert.ok(thirdParty.length > 0, '没有任何第三方技能');
for (const name of thirdParty) {
  assert.ok(
    fs.existsSync(path.join(skillsDir, name, 'LICENSE')),
    `第三方技能 skills/${name}/ 缺少 LICENSE（MIT 要求随副本保留版权声明）`
  );
  assert.ok(
    readme.includes(`\`${name}\``),
    `skills/README.md 的来源表里没有登记 ${name}`
  );
}

// ── 2. 与全局目录一致 ───────────────────────────────────────────────────

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

if (!fs.existsSync(dstDir)) {
  console.log(`[SKIP] 全局 skill 目录不存在，跳过一致性比对：${dstDir}`);
  console.log('       这只说明当前环境没有部署目标，不是失败。');
} else {
  const missing = [];
  const drifted = [];
  let compared = 0;

  for (const name of entries) {
    const from = path.join(skillsDir, name);
    const to = path.join(dstDir, name);
    if (!fs.existsSync(to)) {
      missing.push(name);
      continue;
    }
    for (const rel of walk(from)) {
      const dstFile = path.join(to, rel);
      if (!fs.existsSync(dstFile)) {
        missing.push(`${name}/${rel}`);
        continue;
      }
      compared += 1;
      if (sha256(path.join(from, rel)) !== sha256(dstFile)) drifted.push(`${name}/${rel}`);
    }
  }

  assert.ok(
    !missing.length,
    `以下技能尚未同步到全局目录（跑 node scripts/sync_skills.js）：\n  ${missing.join('\n  ')}`
  );
  assert.ok(
    !drifted.length,
    `以下文件在仓库与全局目录之间漂移（以仓库为准，跑 node scripts/sync_skills.js --force）：\n  ${drifted.join('\n  ')}`
  );
  console.log(`skills 一致性检查通过（${entries.length} 个技能 / ${compared} 个文件）`);
}

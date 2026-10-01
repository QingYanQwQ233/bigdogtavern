'use strict';
/* 产品契约守卫：契约是“宪法”，这里只校验它的完整性与引用真实性，
   不校验内容含义 —— 语义变更必须走 docs/product-contract-v1.md §5 的变更流程。 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const contractPath = path.join(ROOT, 'docs', 'product-contract-v1.md');
const roadmapPath = path.join(ROOT, 'docs', 'rpg-card-product-roadmap.md');

assert(fs.existsSync(contractPath), '缺少 docs/product-contract-v1.md');
const contract = fs.readFileSync(contractPath, 'utf8');

// ① 版本与状态
assert(/\*\*版本\*\*：\s*\d+\.\d+/.test(contract), '契约缺少版本号');
assert(contract.includes('冻结'), '契约未声明冻结状态');

// ② 不变量编号必须连续覆盖 INV-1..INV-10（新增编号须同步本检查）
const numbers = [...new Set((contract.match(/INV-\d+/g) || []).map(s => Number(s.slice(4))))].sort((a, b) => a - b);
assert(numbers.length > 0, '契约未登记任何不变量');
for (let i = 1; i <= numbers[numbers.length - 1]; i += 1) {
  assert(numbers.includes(i), `契约缺少 INV-${i}（编号不得跳号或复用）`);
}
assert(numbers[numbers.length - 1] === 10, `不变量编号出现未登记的新号（当前最大 INV-${numbers[numbers.length - 1]}），请同步本检查`);

// ③ 判据列引用的检查脚本必须真实存在
const referenced = [...new Set(contract.match(/check_[a-z_]+/g) || [])];
for (const name of referenced) {
  assert(fs.existsSync(path.join(ROOT, 'scripts', `${name}.js`)), `契约判据引用了不存在的脚本：${name}`);
}

// ④ roadmap 必须指向契约（§1 是投影，不能各说各话）
assert(fs.existsSync(roadmapPath), '缺少 roadmap');
const roadmap = fs.readFileSync(roadmapPath, 'utf8');
assert(roadmap.includes('product-contract-v1.md'), 'roadmap §1 未指向 docs/product-contract-v1.md');

console.log(`契约校验通过：${numbers.length} 条不变量，判据引用 ${referenced.length} 个检查脚本`);

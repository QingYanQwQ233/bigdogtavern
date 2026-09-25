'use strict';
// UI 绑定守卫：frontend 中 $('id') / getElementById('id') 引用的 id，
// 必须存在于 index.html，或属于「动态创建 / 引用点自带 null 守护」的白名单。
// 缺 id 且未守护的绑定会在初始化时抛错，并中断其后整段绑定（“点了没反应”的根因）。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));

// 白名单：新增条目必须写理由；条目从白名单消失说明对应元素已回归 index.html 或引用已删除。
const ALLOW = new Set([
  'edit-msg', // 消息编辑框：按需动态创建，引用点自带 null 守护
  'typing-msg', // 输入中指示器：动态创建
  'img-pending-msg', // 生图占位：动态创建，引用点自带 null 守护
  'rpg-factions', // 由 renderRPG 按需动态创建
  'cm-preset', 'cm-lore', // 角色卡绑定下拉：父面板已移除，引用点自带 null 守护（待清理）
  'api-status', // 顶部状态条：引用点自带 null 守护
]);

const files = fs.readdirSync(path.join(root, 'frontend')).filter(f => f.endsWith('.js'));
const unexpected = [];
for (const f of files) {
  const s = fs.readFileSync(path.join(root, 'frontend', f), 'utf8');
  s.split('\n').forEach((l, i) => {
    const refs = [];
    for (const m of l.matchAll(/\$\(\s*'([A-Za-z0-9_-]+)'\s*\)/g)) refs.push(m[1]);
    for (const m of l.matchAll(/getElementById\(\s*'([A-Za-z0-9_-]+)'\s*\)/g)) refs.push(m[1]);
    for (const id of refs) {
      if (!ids.has(id) && !ALLOW.has(id)) unexpected.push(`${f}:${i + 1} $('${id}')`);
    }
  });
}
assert.deepStrictEqual(unexpected, [], '引用了不存在的元素 id（会中断初始化绑定；请删除引用或加入白名单并说明理由）:\n' + unexpected.join('\n'));
console.log('check_ui_bindings: ok');
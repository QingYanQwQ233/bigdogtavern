/*
 * ST（酒馆）模式移除的防回退守卫。
 *
 * ST 模式停产后按簇物理删除，这里把每一簇锁死：删掉的东西不得复活。
 * 同时列出「有意保留」的机制 —— 它们看着像 ST，其实被 RPG 读取，
 * 误删比漏删更贵，所以一并断言存在。
 *
 * 原 check_tavern_memory.js 整份探针都指向已删除的自动记忆簇，失去测试对象，
 * 由本文件接替其位置。
 */
'use strict';
const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('public/app.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');

/* ── 已删除，不得复活 ── */
const removed = [
  // 模式切换本身
  ['switchMode', '模式切换函数'],
  ['js-mode-switch', '模式切换按钮'],
  ['mode-switch-label', '模式切换文案'],
  // 自动写卡（AI 生成角色卡 + 角色工坊向导）
  ['aiGenChar', 'AI 填写基本信息'],
  ['aiGenFullChar', 'AI 生成完整角色卡'],
  ['setCharWizardStep', '角色工坊步骤机'],
  ['cm-ai-desc', '角色工坊输入框'],
  ['btn-ai-char', '角色工坊按钮'],
  // 自动滚动记忆
  ['tavernAutoMemory', '自动记忆配置'],
  ['maybeRollTavernMemory', '自动记忆滚动'],
  ['ensureTavernSessionMemory', '会话记忆容器'],
  ['getTavernUnsummarizedTurns', '未总结轮次'],
  ['tavernTurnHistory', '自动记忆历史分支'],
  ['invalidateTavernAutoMemory', '摘要失效'],
  ['mem-auto', '自动记忆表单'],
  // 角色卡 prompt 覆盖链
  ['resolveCharacterPromptOverride', '角色卡 systemPrompt / postHistory 覆盖'],
  ['cardOutputRegexApplied', '只写不读的孤儿标记'],
];
removed.forEach(([token, label]) => {
  assert.doesNotMatch(app, new RegExp(token), label + ' 已随 ST 模式移除，不得重新引入');
});

removed.filter(([token]) => !token.startsWith('switchMode')).forEach(([token, label]) => {
  assert.doesNotMatch(html, new RegExp(token), label + ' 的界面不得重新引入');
});
assert.doesNotMatch(html, /id="rpg-(hp|mp|exp)-(bar|text)"|id="rpg-gold2"|id="rpg-buffs"/, '状态条不得再写死玩法数值行');

/* ── 看着像 ST、实则被 RPG 读取的机制，必须在 ── */
const kept = [
  ['tavernPromptHistoryMessages', '请求历史构造器（RPG 与 RP 共用）'],
  ['regexHistoryContent', '历史内容的正则处理'],
  ['buildWorldInfo', '世界书装配（RPG payload 路径）'],
  ['buildUserPromptPart', '玩家设定注入（RPG 读取）'],
  ['buildMemoryPromptPart', '记忆条目注入（RPG 读取）'],
  ['tavernReplyOptionRules', '行动选项解析（RPG 复用）'],
  ['aiGenerate', 'AI 生成底层（RPG 生成玩家角色在用）'],
  ['aiGenWI', '世界书条目生成（世界书保留在 RPG）'],
  ['cm-profile-fields', '基本信息机制（RPG 迁移读取 profileFields）'],
];
kept.forEach(([token, label]) => {
  assert.ok(app.includes(token), label + ' 是被 RPG 复用的机制，不得删除');
});

console.log('✓ ST 模式移除守卫：' + removed.length + ' 项已删不得复活，' + kept.length + ' 项机制必须保留');
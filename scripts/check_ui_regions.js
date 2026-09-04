'use strict';

const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('public/app.js', 'utf8');
const server = fs.readFileSync('server.js', 'utf8');
const css = fs.readFileSync('public/styles.css', 'utf8');
const docs = fs.readFileSync('docs/world-app-contract.md', 'utf8');
const declaration = fs.readFileSync('docs/ui-beauty-declaration.md', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const defaults = JSON.parse(fs.readFileSync('public/data/_defaults.json', 'utf8'));

const slots = ['topbar', 'sidebar.left', 'narrative', 'options', 'input', 'sidebar.right', 'status', 'overlay'];
const modes = ['decorate', 'replace', 'append', 'hide'];
assert.match(app, /function worldUiRegions\(world = currentWorldCard\(\)\)/);
for (const mode of modes) assert.match(app, new RegExp(`['"]${mode}['"]`));
for (const slot of slots) {
  const escapedSlot = slot.replace(/\./g, '\\.');
  assert.match(server, new RegExp(`['"]${escapedSlot}['"]`));
}
assert.match(server, /function validateWorldUiRegions\(value\)/);
assert.match(server, /ui\.regions/);
assert.match(css, /body\[data-mode="rpg"\] \[data-ui-hidden="true"\]/);
assert.match(html, /<code>regions<\/code>/);
assert.match(app, /function enterWorldWorkspace\(\) \{[\s\S]*?syncModeNavigation\('chat'\)/);
assert.match(app, /function openWorldLibrary\(restoreWorkspace = false\) \{[\s\S]*?syncModeNavigation\(restoringSave \? 'chat' : 'worlds'\)/);
assert.match(docs, /四种模式[^\n]*共存/);
assert.match(declaration, /"schemaVersion": 1/);
assert.match(declaration, /五级/);
assert.match(declaration, /反斜杠/);
const template = defaults?.ui?.worldUiTemplate;
assert.strictEqual(template?.schemaVersion, 1);
assert.deepStrictEqual(Object.keys(template.regions).sort(), slots.slice().sort());
assert.deepStrictEqual([...new Set(Object.values(template.regions).map(item => item.mode))].sort(), modes.slice().sort());
assert.ok(template.sidebar.panels.some(panel => panel.fields?.includes('$key')));
assert.match(app, /const MOBILE_MANAGER_IDS = \['char-mgr', 'prompt-mgr', 'regex-mgr', 'lore-mgr', 'memory-mgr', 'world-mgr'\]/);
assert.match(app, /function setMobileManagerPanel\(managerId, panel = 'list'/);
assert.match(app, /function handleManagerBack\(button\)/);
assert.match(app, /function useCharById\(id\)/);
assert.match(app, /world-lb-use[\s\S]*data-act="use"/);
assert.match(css, /\.char-mgr\[data-mobile-panel="list"\] \.cm-edit/);
assert.match(css, /#prompt-mgr\[data-mobile-prompt-panel="entry"\] \.pg-sequence/);
assert.match(css, /\.pg-reply-options-controls\s*\{[^}]*grid-template-columns:\s*minmax\(210px, 1fr\)/);
assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.pg-reply-options-controls\s*\{[^}]*grid-template-columns:\s*1fr/);
assert.match(css, /\.pg-reply-options input,[\s\S]*?\.pg-reply-options textarea,[\s\S]*?font-size:\s*16px/);
assert.match(css, /#lore-mgr\[data-mobile-lore-panel="entry"\] \.wi-list/);
assert.match(css, /\.char-mgr \.mobile-manager-head/);
assert.match(html, /data-manager-back data-parent-label="角色库"/);
assert.match(html, /class="mobile-manager-head"/);
assert.match(html, /data-rpg-drawer="right"[^>]*aria-controls="rpg-right"[^>]*>任务与世界状态<\/button>/);
assert.doesNotMatch(html, /data-rpg-drawer="right"[^>]*\shidden(?:\s|>)/, '移动端右侧 RPG 抽屉入口不能默认隐藏');
assert.doesNotMatch(html, /label[^>]+for="world-draft-(?:player-preview|growth-sources-preview|growth-candidates-preview|failure-modes-preview|ending-endings-preview|events-preview|factions-preview|conflicts-preview)"/);
assert.match(html, /id="world-extension-permission-read-public" name="worldExtensionPermission"/);
assert.match(html, /class="field-label">已有记忆/);
assert.match(html, /class="field-label">在场 NPC/);
console.log('check_ui_regions: ok');

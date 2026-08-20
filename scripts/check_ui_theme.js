'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const storage = new Map();
const style = {
  values: new Map(),
  setProperty(name, value) { this.values.set(name, String(value)); },
  removeProperty(name) { this.values.delete(name); },
  getPropertyValue(name) { return this.values.get(name) || ''; },
};
const bodyStyle = {
  values: new Map(),
  setProperty(name, value) { this.values.set(name, String(value)); },
  removeProperty(name) { this.values.delete(name); },
  getPropertyValue(name) { return this.values.get(name) || ''; },
};
const elements = new Map();
for (const id of [
  'ui-theme-preset', 'ui-theme-preset-desc', 'ui-theme-status', 'ui-custom-vars',
  'ui-line-opacity', 'ui-line-soft-opacity', 'ui-radius', 'ui-sidebar-width',
  'ui-rpg-panel-width', 'ui-scale', ...['bg-0', 'bg-1', 'panel', 'panel-2', 'bg-scene', 'accent', 'accent-2', 'danger', 'danger-2', 'ok', 'text', 'muted', 'line'],
]) elements.set(`ui-${id.replace(/^ui-/, '')}`, { value: '', textContent: '', className: '' });
const context = vm.createContext({
  console,
  localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, String(value)) },
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  window: {},
  document: {
    documentElement: { style },
    body: { style: bodyStyle },
    getElementById: id => elements.get(id) || null,
    createElement: () => ({ value: '', textContent: '' }),
  },
  Date, Math, JSON, Set, Map,
});

const source = fs.readFileSync('public/app.js', 'utf8').replace(/\ninit\(\);\s*$/, '');
const css = fs.readFileSync('public/styles.css', 'utf8');
assert.match(css, /:root\s*\{\s*--bg-0:/, 'base theme tokens must be declared on :root');
assert.doesNotMatch(css, /body\[data-theme="vibrancy"\]\s*\{\s*--bg-0:/, 'base theme tokens must not outrank custom root variables');
vm.runInContext(source, context);
const defaultsFile = JSON.parse(fs.readFileSync('public/data/_defaults.json', 'utf8'));
vm.runInContext(`
  defaults = ${JSON.stringify(defaultsFile)};
  presetIds = Object.keys(uiThemePresetCatalog());
`, context);
elements.get('ui-theme-preset').appendChild = () => {};
assert.deepStrictEqual(Array.from(context.presetIds), ['macos-dark', 'nord', 'dracula', 'catppuccin-mocha', 'tokyo-night', 'daylight', 'parchment']);
assert.match(fs.readFileSync('public/app.js', 'utf8'), /ui-theme-preset'\)\.addEventListener\('change'[\s\S]{0,500}applyUiThemePreset\(id\)/, 'preset selection must apply immediately');
assert.match(fs.readFileSync('public/app.js', 'utf8'), /if \(e\.target\.id === 'ui-theme-preset'\) return;\s+readUiThemeForm\(\{ parseCustom: false \}\)/, 'generic theme hot-save must not consume preset selection');
for (const id of context.presetIds) {
  const preset = defaultsFile.prefs.uiThemePresets[id];
  assert.ok(preset.theme && preset.theme.colors && preset.theme.colors.accent, `${id} preset is incomplete`);
}
vm.runInContext(`
  prefs = { uiTheme: {}, uiThemePreset: 'custom' };
  for (const id of presetIds) if (!applyUiThemePreset(id)) throw new Error('preset failed: ' + id);
`, context);
assert.strictEqual(vm.runInContext('prefs.uiThemePreset', context), 'parchment');
vm.runInContext(`
  defaults = { prefs: { uiTheme: { colors: { bg0: '#102030' } } } };
  prefs = { uiTheme: { colors: { accent: '#ff00aa' }, radius: 18, customVars: { '--glow': 'rgba(255,0,170,.2)' } } };
  applyUiTheme(uiThemeFromPrefs());
`, context);

assert.strictEqual(style.values.get('--bg-0'), '#102030');
assert.strictEqual(style.values.get('--bg-0-rgb'), '16, 32, 48');
assert.strictEqual(style.values.get('--accent'), '#ff00aa');
assert.strictEqual(style.values.get('--accent-rgb'), '255, 0, 170');
assert.strictEqual(style.values.get('--radius'), '18px');
assert.strictEqual(style.values.get('--glow'), 'rgba(255,0,170,.2)');

// Regression: form input must update both persisted values and inline tokens;
// reset must also remove a custom variable instead of leaving it stuck inline.
vm.runInContext(`
  prefs = { uiTheme: { colors: {}, radius: 10, sidebarWidth: 196, rpgPanelWidth: 210, scale: 1, customVars: {} } };
  defaults = { prefs: { uiTheme: ${JSON.stringify(defaultsFile.prefs.uiTheme)} } };
  document.getElementById('ui-custom-vars').value = '{"--font-body":"monospace"}';
  document.getElementById('ui-line-opacity').value = '0.77';
  document.getElementById('ui-line-soft-opacity').value = '0.22';
  document.getElementById('ui-radius').value = '24';
  document.getElementById('ui-sidebar-width').value = '320';
  document.getElementById('ui-rpg-panel-width').value = '300';
  document.getElementById('ui-scale').value = '1.2';
  for (const id of Object.values(UI_THEME_FIELD_IDS)) { const element = document.getElementById(id); if (!element) throw new Error('missing test element: ' + id); element.value = '#123456'; }
  readUiThemeForm({ parseCustom: true, save: false });
`, context);
assert.strictEqual(vm.runInContext('prefs.uiTheme.radius', context), 24);
assert.strictEqual(vm.runInContext('prefs.uiTheme.sidebarWidth', context), 320);
assert.strictEqual(vm.runInContext('prefs.uiTheme.scale', context), 1.2);
assert.strictEqual(style.values.get('--radius'), '24px');
assert.strictEqual(bodyStyle.values.get('--radius'), '24px');
assert.strictEqual(style.values.get('--font-body'), 'monospace');
vm.runInContext('resetUiTheme();', context);
assert.strictEqual(style.values.has('--font-body'), false);
assert.strictEqual(bodyStyle.values.has('--font-body'), false);
console.log('ui theme check passed');

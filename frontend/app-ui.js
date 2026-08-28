/* ─────────── 配置存档 Profile ─────────── */
const PROFILE_KEYS = ['preset', 'baseUrl', 'apiKey', 'model', 'temperature', 'maxTokens',
  'topP', 'frequencyPenalty', 'presencePenalty', 'seed', 'history', 'stream'];

function renderProfileSelect() {
  const sel = $('s-profile');
  const cur = sel.value;
  sel.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = '默认配置';
  sel.appendChild(opt0);
  for (const name of Object.keys(profiles)) {
    const o = document.createElement('option');
    o.value = name;
    o.textContent = name;
    sel.appendChild(o);
  }
  if (cur && profiles[cur]) sel.value = cur;
}

function profileSwitch() {
  const name = $('s-profile').value;
  if (!name || !profiles[name]) return;
  settings = { ...settings, ...profiles[name] };
  saveSettings();
  fillSettingsForm();
  updateApiStatusFromSettings();
  const out = $('test-result');
  out.textContent = `✅ 已切换到「${name}」`;
  out.className = 'ok';
}

function profileSave() {
  readSettingsForm();
  const name = prompt('为新配置存档命名：', '配置 ' + (Object.keys(profiles).length + 1));
  if (!name) return;
  const snap = {};
  for (const k of PROFILE_KEYS) snap[k] = settings[k];
  profiles[name] = snap;
  saveJSON(LS_PROFILES, profiles);
  renderProfileSelect();
  $('s-profile').value = name;
  const out = $('test-result');
  out.textContent = `✅ 已存档「${name}」`;
  out.className = 'ok';
}

function profileDelete() {
  const name = $('s-profile').value;
  if (!name || !profiles[name]) return;
  if (!confirm(`删除配置存档「${name}」？`)) return;
  delete profiles[name];
  saveJSON(LS_PROFILES, profiles);
  renderProfileSelect();
  const out = $('test-result');
  out.textContent = '已删除';
  out.className = 'ok';
}

/* ─────────── 设置面板 ─────────── */
/* ─────────── 排版设置（设置 → 排版；改动即时生效并自动保存到 prefs） ─────────── */
const TYPO_DEFAULTS = { font: 'default', fontSize: 15, lineHeight: 1.8, paraGap: 0.7, indent: 'none', sidePad: 24 };
const TYPO_FONT_STACKS = {
  default: 'var(--font-body)',
  sans: '-apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", "Songti SC", "STSong", "SimSun", "Noto Serif SC", serif',
  kai: '"Kaiti SC", "STKaiti", "KaiTi", "TW-Kai", "DFKai-SB", serif',
  fangsong: '"Fangsong SC", "STFangsong", "FangSong", "FangSong_GB2312", serif',
  mono: 'ui-monospace, "Cascadia Mono", Consolas, "JetBrains Mono", "Courier New", monospace',
};
function typographyFromPrefs() {
  const saved = prefs && prefs.typography && typeof prefs.typography === 'object' ? prefs.typography : {};
  const merged = { ...TYPO_DEFAULTS, ...saved };
  for (const key of ['fontSize', 'lineHeight', 'paraGap', 'sidePad']) {
    merged[key] = typoNum(merged[key], TYPO_DEFAULTS[key]); // Number(null)/Number('') 是 0，必须显式排除
  }
  if (!TYPO_FONT_STACKS[merged.font]) merged.font = 'default';
  if (!['2em', '1em'].includes(merged.indent)) merged.indent = 'none';
  return merged;
}
function typoNum(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function applyTypography(typo = typographyFromPrefs()) {
  const style = document.documentElement.style;
  const fontSize = typoNum(typo.fontSize, TYPO_DEFAULTS.fontSize);
  const lineHeight = typoNum(typo.lineHeight, TYPO_DEFAULTS.lineHeight);
  const paraGap = typoNum(typo.paraGap, TYPO_DEFAULTS.paraGap);
  const sidePad = typoNum(typo.sidePad, TYPO_DEFAULTS.sidePad);
  style.setProperty('--chat-font', TYPO_FONT_STACKS[typo.font] || TYPO_FONT_STACKS.default);
  style.setProperty('--chat-font-size', fontSize + 'px');
  style.setProperty('--chat-line-height', String(lineHeight));
  style.setProperty('--chat-para-gap', paraGap + 'em');
  style.setProperty('--chat-indent', typo.indent === '2em' || typo.indent === '1em' ? typo.indent : '0em');
  style.setProperty('--chat-side-pad', sidePad + 'px');
}
function clampNum(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
function updateTypographyLabels(typo = typographyFromPrefs()) {
  const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };
  set('t-font-size-val', typo.fontSize + 'px');
  set('t-line-height-val', String(typo.lineHeight));
  set('t-para-gap-val', typo.paraGap + 'em');
  set('t-side-pad-val', typo.sidePad + 'px');
}
function fillTypographyForm() {
  const typo = typographyFromPrefs();
  $('t-font').value = TYPO_FONT_STACKS[typo.font] ? typo.font : 'default';
  $('t-font-size').value = typo.fontSize;
  $('t-line-height').value = typo.lineHeight;
  $('t-para-gap').value = typo.paraGap;
  $('t-indent').value = typo.indent;
  $('t-side-pad').value = typo.sidePad;
  updateTypographyLabels(typo);
}
function readTypographyForm() {
  prefs.typography = {
    font: TYPO_FONT_STACKS[$('t-font').value] ? $('t-font').value : 'default',
    fontSize: clampNum($('t-font-size').value, 10, 32, TYPO_DEFAULTS.fontSize),
    lineHeight: clampNum($('t-line-height').value, 1, 4, TYPO_DEFAULTS.lineHeight),
    paraGap: clampNum($('t-para-gap').value, 0, 4, TYPO_DEFAULTS.paraGap),
    indent: ['2em', '1em'].includes($('t-indent').value) ? $('t-indent').value : 'none',
    sidePad: clampNum($('t-side-pad').value, 0, 320, TYPO_DEFAULTS.sidePad),
  };
  updateTypographyLabels(prefs.typography);
  applyTypography(prefs.typography);
}
function resetTypography() {
  prefs.typography = { ...TYPO_DEFAULTS };
  fillTypographyForm();
  applyTypography(prefs.typography);
  saveJSON(LS_PREFS, prefs);
}

/* ─────────── 界面主题设置（设置 → 界面） ───────────
 * 只覆盖现有 CSS token，不另起主题系统；高级变量使用 setProperty，避免把用户输入拼进 <style>。 */
const UI_THEME_DEFAULTS = {
  colors: {
    bg0: '#1c1c1e', bg1: '#232326', panel: '#2c2c2e', panel2: '#3a3a3c', bgScene: '#1c1c1e',
    accent: '#0a84ff', accent2: '#0a6dd4', danger: '#ff453a', danger2: '#c0342b', ok: '#30d158',
    text: '#ffffff', muted: '#98989d', line: '#ffffff',
  },
  lineOpacity: 0.1, lineSoftOpacity: 0.06, radius: 10, sidebarWidth: 196, rpgPanelWidth: 210, scale: 1, customVars: {},
};
const UI_THEME_COLOR_FIELDS = ['bg0', 'bg1', 'panel', 'panel2', 'bgScene', 'accent', 'accent2', 'danger', 'danger2', 'ok', 'text', 'muted', 'line'];
const UI_THEME_FIELD_IDS = Object.fromEntries(UI_THEME_COLOR_FIELDS.map(key => [key, `ui-${key.replace(/[A-Z0-9]/g, match => '-' + match.toLowerCase())}`]));
let appliedHostUiThemeVars = new Set();

function uiThemePresetCatalog() {
  const source = defaults?.prefs?.uiThemePresets;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  return Object.fromEntries(Object.entries(source).filter(([, preset]) => preset && typeof preset === 'object'
    && preset.theme && typeof preset.theme === 'object' && !Array.isArray(preset.theme)));
}

function renderUiThemePresets() {
  const select = $('ui-theme-preset');
  if (!select) return;
  const current = prefs?.uiThemePreset && uiThemePresetCatalog()[prefs.uiThemePreset] ? prefs.uiThemePreset : 'custom';
  select.innerHTML = '<option value="custom">自定义（当前颜色）</option>';
  for (const [id, preset] of Object.entries(uiThemePresetCatalog())) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = String(preset.label || id);
    select.appendChild(option);
  }
  select.value = current;
  updateUiThemePresetDescription(current);
}

function updateUiThemePresetDescription(id = $('ui-theme-preset')?.value || 'custom') {
  const desc = $('ui-theme-preset-desc');
  if (!desc) return;
  const preset = uiThemePresetCatalog()[id];
  desc.textContent = preset ? String(preset.description || '可继续手动微调颜色与布局。') : '手动修改颜色后会变为自定义。';
}

function applyUiThemePreset(id) {
  const preset = uiThemePresetCatalog()[id];
  if (!preset) {
    updateUiThemePresetDescription('custom');
    return false;
  }
  const base = uiThemeDefaults();
  const theme = preset.theme;
  prefs.uiTheme = {
    ...base,
    ...theme,
    colors: { ...base.colors, ...(theme.colors && typeof theme.colors === 'object' ? theme.colors : {}) },
    customVars: validCustomThemeVars(theme.customVars) || {},
  };
  prefs.uiThemePreset = id;
  fillUiThemeForm();
  applyUiTheme(prefs.uiTheme);
  saveJSON(LS_PREFS, prefs);
  $('ui-theme-status').textContent = `已套用「${String(preset.label || id)}」。还可以继续手动微调。`;
  $('ui-theme-status').className = 'hint ok';
  return true;
}

function uiThemeDefaults() {
  const source = defaults?.prefs?.uiTheme && typeof defaults.prefs.uiTheme === 'object' ? defaults.prefs.uiTheme : {};
  return {
    ...UI_THEME_DEFAULTS,
    ...source,
    colors: { ...UI_THEME_DEFAULTS.colors, ...(source.colors && typeof source.colors === 'object' ? source.colors : {}) },
    customVars: source.customVars && typeof source.customVars === 'object' && !Array.isArray(source.customVars) ? source.customVars : {},
  };
}

function uiThemeFromPrefs() {
  const base = uiThemeDefaults();
  const saved = prefs?.uiTheme && typeof prefs.uiTheme === 'object' ? prefs.uiTheme : {};
  return {
    ...base,
    ...saved,
    colors: { ...base.colors, ...(saved.colors && typeof saved.colors === 'object' ? saved.colors : {}) },
    lineOpacity: clampNum(saved.lineOpacity, 0, 1, base.lineOpacity),
    lineSoftOpacity: clampNum(saved.lineSoftOpacity, 0, 1, base.lineSoftOpacity),
    radius: clampNum(saved.radius, 0, 24, base.radius),
    sidebarWidth: clampNum(saved.sidebarWidth, 160, 320, base.sidebarWidth),
    rpgPanelWidth: clampNum(saved.rpgPanelWidth, 160, 320, base.rpgPanelWidth),
    scale: clampNum(saved.scale, 0.85, 1.2, base.scale),
    customVars: saved.customVars && typeof saved.customVars === 'object' && !Array.isArray(saved.customVars) ? saved.customVars : {},
  };
}

function hexToRgb(value) {
  const raw = String(value || '').trim().replace(/^#/, '');
  const hex = raw.length === 3 ? raw.split('').map(char => char + char).join('') : raw;
  if (!/^[\da-f]{6}$/i.test(hex)) return null;
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function safeThemeColor(value, fallback) {
  const raw = String(value || '').trim().replace(/^#/, '');
  if (!/^[\da-f]{3}(?:[\da-f]{3})?$/i.test(raw)) return fallback;
  const hex = raw.length === 3 ? raw.split('').map(char => char + char).join('') : raw;
  return `#${hex.toLowerCase()}`;
}

function validCustomThemeVars(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > 64) return null;
  const output = {};
  for (const [name, raw] of entries) {
    if (!/^--[A-Za-z0-9_-]{1,64}$/.test(name)) return null;
    const text = String(raw ?? '').trim();
    if (!text || text.length > 300) return null;
    output[name] = text;
  }
  return output;
}

function applyUiTheme(uiTheme = uiThemeFromPrefs()) {
  // 宿主主题始终写入 root/body；世界卡有自己的 token 时会在下方重新叠加，
  // 避免 RPG 中 body 留下的旧变量遮住用户刚改的界面设置。
  const rootStyle = document.documentElement?.style;
  const bodyStyle = document.body?.style;
  const worldOwnsUi = typeof worldModeActive === 'function' && worldModeActive();
  for (const name of appliedHostUiThemeVars) {
    rootStyle?.removeProperty(name);
    bodyStyle?.removeProperty(name);
  }
  const styles = [rootStyle, bodyStyle].filter(Boolean);
  if (!styles.length) return;
  const set = (name, value) => styles.forEach(style => style.setProperty(name, value));
  const colors = uiTheme.colors || {};
  const get = (key) => safeThemeColor(colors[key], UI_THEME_DEFAULTS.colors[key]);
  const customVars = validCustomThemeVars(uiTheme.customVars) || {};
  const colorVars = {
    '--bg-0': get('bg0'), '--bg-1': get('bg1'), '--panel': get('panel'), '--panel-2': get('panel2'), '--bg-scene': get('bgScene'),
    '--accent': get('accent'), '--accent-2': get('accent2'), '--danger': get('danger'), '--danger-2': get('danger2'), '--ok': get('ok'),
    '--text': get('text'), '--muted': get('muted'), '--on-accent': '#ffffff',
  };
  Object.entries(colorVars).forEach(([name, value]) => set(name, value));
  const rgbNames = { bg0: '--bg-0-rgb', panel: '--panel-rgb', accent: '--accent-rgb', danger: '--danger-rgb', ok: '--ok-rgb' };
  Object.entries(rgbNames).forEach(([key, name]) => {
    if (Object.prototype.hasOwnProperty.call(customVars, name)) return;
    const rgb = hexToRgb(get(key));
    if (rgb) set(name, rgb.join(', '));
  });
  const lineRgb = hexToRgb(get('line')) || [255, 255, 255];
  if (!Object.prototype.hasOwnProperty.call(customVars, '--line')) set('--line', `rgba(${lineRgb.join(', ')}, ${uiTheme.lineOpacity})`);
  if (!Object.prototype.hasOwnProperty.call(customVars, '--line-soft')) set('--line-soft', `rgba(${lineRgb.join(', ')}, ${uiTheme.lineSoftOpacity})`);
  set('--radius', `${uiTheme.radius}px`);
  set('--sidebar-width', `${uiTheme.sidebarWidth}px`);
  set('--rpg-panel-width', `${uiTheme.rpgPanelWidth}px`);
  set('--ui-scale', String(uiTheme.scale));
  for (const [name, value] of Object.entries(customVars)) set(name, value);
  // 高级变量覆盖颜色时，若没有同时提供 rgb token，自动同步 rgba 使用的派生值。
  for (const [colorName, rgbName] of Object.entries(rgbNames)) {
    if (Object.prototype.hasOwnProperty.call(customVars, rgbName) || !Object.prototype.hasOwnProperty.call(customVars, `--${colorName === 'bg0' ? 'bg-0' : colorName}`)) continue;
    const rgb = hexToRgb(customVars[`--${colorName === 'bg0' ? 'bg-0' : colorName}`]);
    if (rgb) set(rgbName, rgb.join(', '));
  }
  appliedHostUiThemeVars = new Set([
    ...Object.keys(colorVars), ...Object.values(rgbNames), '--line', '--line-soft',
    '--radius', '--sidebar-width', '--rpg-panel-width', '--ui-scale', ...Object.keys(customVars),
  ]);
  if (worldOwnsUi) applyWorldUiTheme();
}

function updateUiThemeLabels(uiTheme = uiThemeFromPrefs()) {
  const set = (id, value) => { const el = $(id); if (el) el.textContent = value; };
  set('ui-line-opacity-val', `${Math.round(uiTheme.lineOpacity * 100)}%`);
  set('ui-line-soft-opacity-val', `${Math.round(uiTheme.lineSoftOpacity * 100)}%`);
  set('ui-radius-val', `${uiTheme.radius}px`);
  set('ui-sidebar-width-val', `${uiTheme.sidebarWidth}px`);
  set('ui-rpg-panel-width-val', `${uiTheme.rpgPanelWidth}px`);
  set('ui-scale-val', `${Math.round(uiTheme.scale * 100)}%`);
}

function fillUiThemeForm() {
  const uiTheme = uiThemeFromPrefs();
  renderUiThemePresets();
  for (const key of UI_THEME_COLOR_FIELDS) if ($(UI_THEME_FIELD_IDS[key])) $(UI_THEME_FIELD_IDS[key]).value = safeThemeColor(uiTheme.colors[key], UI_THEME_DEFAULTS.colors[key]);
  $('ui-line-opacity').value = uiTheme.lineOpacity;
  $('ui-line-soft-opacity').value = uiTheme.lineSoftOpacity;
  $('ui-radius').value = uiTheme.radius;
  $('ui-sidebar-width').value = uiTheme.sidebarWidth;
  $('ui-rpg-panel-width').value = uiTheme.rpgPanelWidth;
  $('ui-scale').value = uiTheme.scale;
  $('ui-custom-vars').value = JSON.stringify(uiTheme.customVars || {}, null, 2);
  updateUiThemeLabels(uiTheme);
}

function readUiThemeForm({ parseCustom = true, save = false } = {}) {
  const previous = uiThemeFromPrefs();
  let customVars = previous.customVars;
  if (parseCustom) {
    try {
      const parsed = JSON.parse($('ui-custom-vars').value || '{}');
      customVars = validCustomThemeVars(parsed);
      if (!customVars) throw new Error('变量名必须是 --name，最多 64 项，每项值不超过 300 字符。');
    } catch (error) {
      $('ui-theme-status').textContent = `高级变量未保存：${error.message}`;
      $('ui-theme-status').className = 'hint err';
      return false;
    }
  }
  prefs.uiTheme = {
    ...previous,
    colors: Object.fromEntries(UI_THEME_COLOR_FIELDS.map(key => [key, safeThemeColor($(UI_THEME_FIELD_IDS[key]).value, previous.colors[key])])),
    lineOpacity: clampNum($('ui-line-opacity').value, 0, 1, previous.lineOpacity),
    lineSoftOpacity: clampNum($('ui-line-soft-opacity').value, 0, 1, previous.lineSoftOpacity),
    radius: clampNum($('ui-radius').value, 0, 24, previous.radius),
    sidebarWidth: clampNum($('ui-sidebar-width').value, 160, 320, previous.sidebarWidth),
    rpgPanelWidth: clampNum($('ui-rpg-panel-width').value, 160, 320, previous.rpgPanelWidth),
    scale: clampNum($('ui-scale').value, 0.85, 1.2, previous.scale),
    customVars,
  };
  prefs.uiThemePreset = 'custom';
  const preset = $('ui-theme-preset');
  if (preset) preset.value = 'custom';
  updateUiThemePresetDescription('custom');
  applyUiTheme(prefs.uiTheme);
  updateUiThemeLabels(prefs.uiTheme);
  $('ui-theme-status').textContent = save ? '界面设置已保存。' : '预览中；松开滑块或离开输入框后自动保存。';
  $('ui-theme-status').className = 'hint ok';
  if (save) saveJSON(LS_PREFS, prefs);
  return true;
}

function resetUiTheme() {
  prefs.uiTheme = { ...uiThemeDefaults(), colors: { ...uiThemeDefaults().colors }, customVars: {} };
  prefs.uiThemePreset = uiThemePresetCatalog()['macos-dark'] ? 'macos-dark' : 'custom';
  fillUiThemeForm();
  applyUiTheme(prefs.uiTheme);
  saveJSON(LS_PREFS, prefs);
  $('ui-theme-status').textContent = '已恢复界面默认值。';
  $('ui-theme-status').className = 'hint ok';
}

function fillSettingsForm() {
  const s = settings;
  $('s-preset').value = s.preset || '';
  $('s-base-url').value = s.baseUrl || '';
  $('s-api-key').value = s.apiKey || '';
  $('s-model').value = s.model || '';
  $('s-temperature').value = s.temperature;
  $('s-temp-val').textContent = s.temperature;
  $('s-max-tokens').value = s.maxTokens;
  $('s-top-p').value = s.topP;
  $('s-top-p-val').textContent = s.topP;
  $('s-freq-p').value = s.frequencyPenalty;
  $('s-pres-p').value = s.presencePenalty;
  $('s-seed').value = s.seed;
  $('s-history').value = s.history;
  $('s-stream').checked = !!s.stream;
  // 格式偏好
  $('f-preset').value = prefs.formatPreset || '';
  $('f-custom').value = prefs.formatCustom || '';
  $('f-stop').value = prefs.stop || '';
  $('f-bubbles').checked = !!prefs.tavernDialogueBubbles;
  $('s-cot').checked = !!prefs.cotEnabled;
  $('s-cot-effort').value = prefs.cotEffort || 'medium';
  const g = genSettings || {};
  if ($('g-char-basic')) $('g-char-basic').value = g.charBasicPrompt || '';
  if ($('g-char-full')) $('g-char-full').value = g.charFullPrompt || '';
  if ($('g-lore')) $('g-lore').value = g.lorePrompt || '';
  if ($('g-char-fields')) $('g-char-fields').value = JSON.stringify(Array.isArray(g.charFields) ? g.charFields : [], null, 2);
  // 文生图（测试）
  const ig = s.imageGen || {};
  $('ig-enabled').checked = !!ig.enabled;
  $('ig-kind').value = ig.kind || 'openai';
  $('ig-base-url').value = ig.baseUrl || '';
  $('ig-api-key').value = ig.apiKey || '';
  $('ig-model').value = ig.model || '';
  $('ig-size').value = ig.size || '1024x1024';
  $('ig-steps').value = ig.steps || 20;
  $('ig-cfg').value = ig.cfgScale || 7;
  $('ig-sampler').value = ig.sampler || '';
  $('ig-negative').value = ig.negativePrompt || '';
  $('ig-prompt-suffix').value = ig.promptSuffix || '';
  $('ig-negative-suffix').value = ig.negativeSuffix || '';
  $('ig-prompt-source').value = ig.promptSource || 'llm';
  $('ig-auto').checked = !!ig.auto;
  $('ig-ref-use').checked = !!ig.refUse;
  $('ig-ref-strength').value = ig.refStrength || 0.5;
  $('ig-prompt-instr').value = ig.promptInstruction || '';
  fillTypographyForm();
  fillUiThemeForm();
}

function readSettingsForm() {
  settings.preset = $('s-preset').value;
  settings.baseUrl = $('s-base-url').value.trim();
  settings.apiKey = $('s-api-key').value.trim();
  settings.model = $('s-model').value.trim();
  settings.temperature = parseFloat($('s-temperature').value) || 0.9;
  settings.maxTokens = parseInt($('s-max-tokens').value, 10) || 1024;
  settings.topP = parseFloat($('s-top-p').value) ?? 1;
  settings.frequencyPenalty = parseFloat($('s-freq-p').value) || 0;
  settings.presencePenalty = parseFloat($('s-pres-p').value) || 0;
  settings.seed = parseInt($('s-seed').value, 10);
  if (!Number.isFinite(settings.seed)) settings.seed = -1; // 热保存下空输入不能落成 NaN
  settings.history = parseInt($('s-history').value, 10) || 20;
  settings.stream = $('s-stream').checked;
  prefs.formatPreset = $('f-preset').value;
  prefs.formatCustom = $('f-custom').value;
  prefs.stop = $('f-stop').value;
  prefs.tavernDialogueBubbles = $('f-bubbles').checked;
  prefs.cotEnabled = $('s-cot').checked;
  prefs.cotEffort = $('s-cot-effort').value || 'medium';
  if (!readGenerationForm()) return false;
  // 文生图（测试）
  const ig = settings.imageGen = settings.imageGen || {};
  ig.enabled = $('ig-enabled').checked;
  ig.kind = $('ig-kind').value;
  ig.baseUrl = $('ig-base-url').value.trim();
  ig.apiKey = $('ig-api-key').value.trim();
  ig.model = $('ig-model').value.trim();
  ig.size = $('ig-size').value;
  ig.steps = parseInt($('ig-steps').value, 10) || 20;
  ig.cfgScale = parseFloat($('ig-cfg').value) || 7;
  ig.sampler = $('ig-sampler').value.trim();
  ig.negativePrompt = $('ig-negative').value.trim();
  ig.promptSuffix = $('ig-prompt-suffix').value;
  ig.negativeSuffix = $('ig-negative-suffix').value;
  ig.promptSource = $('ig-prompt-source').value;
  ig.auto = $('ig-auto').checked;
  ig.refUse = $('ig-ref-use').checked;
  ig.refStrength = parseFloat($('ig-ref-strength').value) || 0.5;
  ig.promptInstruction = $('ig-prompt-instr').value;
  readTypographyForm();
  saveSettings();
  saveJSON(LS_PREFS, prefs);
  return true;
}

function readGenerationForm() {
  if (!$('g-char-fields')) return true;
  let fields;
  try { fields = JSON.parse($('g-char-fields').value || '[]'); }
  catch {
    $('g-gen-status').textContent = '字段定义不是有效 JSON，尚未保存。';
    $('g-gen-status').className = 'hint err';
    return false;
  }
  const valid = Array.isArray(fields) && fields.length <= 64 && fields.every(field => field && typeof field === 'object' && !Array.isArray(field) && /^[A-Za-z][A-Za-z0-9_-]{0,48}$/.test(String(field.key || '')) && String(field.label || '').trim());
  if (!valid) {
    $('g-gen-status').textContent = '字段定义必须是最多 64 项的 JSON 数组，每项至少包含安全 key 与 label。';
    $('g-gen-status').className = 'hint err';
    return false;
  }
  genSettings = {
    ...genSettings,
    charBasicPrompt: $('g-char-basic').value,
    charFullPrompt: $('g-char-full').value,
    lorePrompt: $('g-lore').value,
    charFields: fields.map(field => ({ ...field, key: String(field.key), label: String(field.label).trim() })),
  };
  saveGenerationSettings();
  $('g-gen-status').textContent = 'AI 工坊配置已保存。';
  $('g-gen-status').className = 'hint ok';
  return true;
}

function resetGenerationForm() {
  if (!defaults?.gen || !confirm('恢复内置的一键写卡提示词和角色字段？当前自定义内容会被覆盖。')) return;
  genSettings = cloneValue(defaults.gen);
  fillSettingsForm();
  saveGenerationSettings();
  $('g-gen-status').textContent = '已恢复内置提示词。';
  $('g-gen-status').className = 'hint ok';
}

function setApiStatus(text, isErr = false) {
  const el = $('api-status');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('ok', !isErr && !!settings.baseUrl);
}

function openSettings() {
  closeNavDrawer();
  fillSettingsForm();
  renderProfileSelect();
  $('settings-modal').classList.remove('hidden');
}

function closeSettings() {
  $('settings-modal').classList.add('hidden');
  $('test-result').textContent = '';
  $('test-result').className = '';
  updateApiStatusFromSettings();
}

function updateApiStatusFromSettings() {
  const s = settings;
  if (!s.baseUrl) return setApiStatus('尚未接上 API → 点头部「🏮」→ 设置');
  const who = s.model ? `${s.model}` : '（模型未填）';
  setApiStatus(`已接上：${s.baseUrl} · ${who}`);
}

/* ─────────── 调试终端：当前会话的 AI 请求历史（仅本页内存） ─────────── */
function ensureDebugTraceHistory(scope) {
  if (!scope) return [];
  const stored = debugTraces.get(scope.id);
  if (!stored) return [];
  if (Array.isArray(stored.history)) return stored.history;
  const trace = { ...stored, id: stored.id || `trace-${uid()}`, createdAt: stored.createdAt || Date.now() };
  debugTraces.set(scope.id, { ...trace, history: [trace] });
  return [trace];
}

function writeDebugTraceHistory(scope, history) {
  if (!scope) return;
  const bounded = history.slice(-DEBUG_TRACE_HISTORY_LIMIT);
  if (!bounded.length) {
    debugTraces.delete(scope.id);
    debugTraceSelection.delete(scope.id);
    return;
  }
  if (!bounded.some(trace => trace.id === debugTraceSelection.get(scope.id))) {
    debugTraceSelection.set(scope.id, bounded.at(-1).id);
  }
  // 兼容旧调用方：Map 顶层继续暴露最新一条 trace，同时新增 history。
  debugTraces.set(scope.id, { ...bounded.at(-1), history: bounded });
}

function selectedDebugTrace(scope, history = ensureDebugTraceHistory(scope)) {
  if (!history.length) return null;
  return history.find(trace => trace.id === debugTraceSelection.get(scope?.id)) || history.at(-1);
}

function startDebugTrace(scope, patch = {}) {
  if (!scope) return null;
  const history = [...ensureDebugTraceHistory(scope)];
  const trace = { ...patch, id: `trace-${uid()}`, createdAt: Date.now() };
  history.push(trace);
  debugTraceSelection.set(scope.id, trace.id);
  writeDebugTraceHistory(scope, history);
  if (scope === activeConversationScope()) renderDebugTerminal();
  return trace;
}

function debugRequestInput(payload, kind = '') {
  return JSON.stringify({
    ...(kind ? { kind } : {}),
    endpoint: String(payload?.baseUrl || '').replace(/\/$/, '') + '/chat/completions',
    ...(payload?.body || {}),
  }, null, 2);
}

function beginDebugRequest(scope, payload, { label = 'AI 请求', kind = '', ...patch } = {}) {
  return startDebugTrace(scope, {
    label,
    status: '请求中',
    input: debugRequestInput(payload, kind),
    output: '等待 AI 响应…',
    rawOutput: '等待 AI 响应…',
    outputTag: '等待 AI 响应…',
    reasoning: '',
    error: '',
    ...patch,
  });
}

function setDebugTrace(session, patch) {
  if (!session) return null;
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'input')) return startDebugTrace(session, patch);
  const history = ensureDebugTraceHistory(session);
  const trace = history.at(-1);
  if (!trace) return startDebugTrace(session, patch);
  Object.assign(trace, patch);
  writeDebugTraceHistory(session, history);
  if (session === activeConversationScope()) renderDebugTerminal();
  return trace;
}

function selectDebugTab(tab = 'output') {
  const allowed = new Set(['output', 'input', 'sections', 'memory']);
  debugTab = allowed.has(tab) ? tab : 'output';
  document.querySelectorAll('[data-debug-tab]').forEach(button => {
    const active = button.dataset.debugTab === debugTab;
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll('[data-debug-pane]').forEach(pane => {
    pane.hidden = pane.dataset.debugPane !== debugTab;
  });
}

function extractDebugOutputTag(text) {
  const matches = String(text || '').match(/<tavern_state_update>[\s\S]*?<\/tavern_state_update>|<tavern_options\b[\s\S]*?<\/tavern_options\s*>|```rpg[\s\S]*?```/gi);
  return matches?.length ? matches.join('\n\n') : '本次输出未找到结构化标签。';
}

function formatDebugOutput(trace) {
  const raw = trace?.rawOutput ?? trace?.output ?? '';
  const tag = trace?.outputTag || extractDebugOutputTag(raw);
  const reasoning = trace?.reasoning || '本次响应未返回 reasoning_content。';
  return [
    ...(trace?.error ? ['── 校验 / 请求错误 ──', String(trace.error)] : []),
    '── 正则前原始输出（完整响应） ──', raw || '尚未收到 AI 响应。',
    '── 结构化标签（原文摘录） ──', tag,
    '── 思维链 reasoning_content ──', reasoning,
  ].join('\n\n');
}

function debugTracePreview(trace) {
  try {
    const messages = JSON.parse(trace?.input || '{}')?.messages;
    const message = Array.isArray(messages) ? [...messages].reverse().find(item => item?.role === 'user' && String(item.content || '').trim()) : null;
    const text = String(message?.content || '').replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, 72) + (text.length > 72 ? '…' : '');
  } catch {}
  return String(trace?.status || trace?.label || '等待请求详情').slice(0, 72);
}

function debugTraceTimestamp(trace) {
  const timestamp = Number(trace?.createdAt);
  if (!Number.isFinite(timestamp)) return '';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(timestamp));
}

function renderDebugTraceHistory(history, selected) {
  const host = $('debug-history');
  if (!host) return;
  host.replaceChildren();
  host.classList.toggle('is-empty', !history.length);
  if (!history.length) {
    host.textContent = '当前会话尚无 AI 请求；发送消息后会按顺序保留在这里。';
    return;
  }
  history.forEach((trace, index) => {
    const button = document.createElement('button');
    const label = String(trace.label || 'AI 请求');
    const status = String(trace.status || '等待响应');
    const preview = debugTracePreview(trace);
    button.type = 'button';
    button.className = 'debug-history-entry';
    button.dataset.debugTraceId = trace.id;
    button.setAttribute('aria-pressed', trace.id === selected?.id ? 'true' : 'false');
    button.setAttribute('aria-label', `请求 ${index + 1}，${label}，${status}：${preview}`);
    button.title = `${label} · ${status}\n${preview}`;
    const meta = document.createElement('span');
    meta.className = 'debug-history-meta';
    meta.textContent = `#${index + 1} · ${debugTraceTimestamp(trace) || '刚刚'}`;
    const name = document.createElement('strong');
    name.textContent = label;
    const text = document.createElement('span');
    text.className = 'debug-history-preview';
    text.textContent = preview;
    button.append(meta, name, text);
    host.appendChild(button);
  });
}

function selectDebugTrace(traceId) {
  const session = activeConversationScope();
  const history = ensureDebugTraceHistory(session);
  if (!session || !history.some(trace => trace.id === traceId)) return;
  debugTraceSelection.set(session.id, traceId);
  renderDebugTerminal();
}

function renderDebugTerminal() {
  const session = activeConversationScope();
  const history = ensureDebugTraceHistory(session);
  const trace = selectedDebugTrace(session, history);
  const scope = $('debug-scope');
  if (!scope) return;
  scope.textContent = session
    ? `${worldModeActive() ? (currentWorldCard()?.title || '世界') : (currentChar()?.name || '未命名角色')} · ${worldModeActive() ? '世界存档' : (session.kind === 'rpg' ? 'RPG' : '酒馆')} · ${session.name || session.id} · 本页 ${history.length}/${DEBUG_TRACE_HISTORY_LIMIT} 条请求${trace?.commandId ? ` · ${trace.commandId}` : ''}${trace?.status ? ` · ${trace.status}` : ''}`
    : '当前会话 · 暂无记录';
  renderDebugTraceHistory(history, trace);
  $('debug-input').textContent = trace?.input || '尚未向 AI 发送请求。';
  $('debug-output').textContent = formatDebugOutput(trace);
  $('debug-sections').textContent = trace?.promptSections?.length || trace?.agentEvents?.length
    ? JSON.stringify({ agentSessionId: trace.agentSessionId || null, agentEvents: trace.agentEvents || [], agentProfile: trace.agentProfile || null, agentContext: trace.agentContext || null, sections: trace.promptSections }, null, 2)
    : '尚未生成 RPG Prompt 分区。';
  renderDebugMemory();
  selectDebugTab(debugTab);
}

function renderDebugMemory() {
  const pre = $('debug-memory');
  const button = $('debug-memory-rebuild');
  if (!pre || !button) return;
  if (!worldModeActive()) {
    pre.textContent = '仅世界存档提供派生记忆诊断。';
    button.disabled = true;
    return;
  }
  button.disabled = false;
  const saveId = currentWorldSaveId;
  const diagnostics = debugMemoryDiagnostics.get(saveId);
  if (diagnostics && diagnostics.revision !== currentWorldSave?.revision) {
    debugMemoryDiagnostics.delete(saveId);
    return renderDebugMemory();
  }
  if (!diagnostics) {
    pre.textContent = '正在读取当前存档的记忆来源…';
    loadDebugMemoryDiagnostics(saveId);
    return;
  }
  pre.textContent = JSON.stringify(diagnostics, null, 2);
}

async function loadDebugMemoryDiagnostics(saveId = currentWorldSaveId) {
  if (!saveId || !worldModeActive() || saveId !== currentWorldSaveId || debugMemoryDiagnostics.has(saveId) || debugMemoryPending.has(saveId)) return;
  debugMemoryPending.add(saveId);
  try {
    const res = await fetch('/api/world-saves/' + encodeURIComponent(saveId) + '/memory');
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(worldApiError(data, '记忆诊断读取失败（HTTP ' + res.status + '）'));
    if (worldModeActive() && currentWorldSaveId === saveId) {
      debugMemoryDiagnostics.set(saveId, data);
      renderDebugMemory();
    }
  } catch (err) {
    if (worldModeActive() && currentWorldSaveId === saveId) $('debug-memory').textContent = `读取失败：${err.message}`;
  } finally {
    debugMemoryPending.delete(saveId);
  }
}

async function rebuildDebugMemory() {
  if (!worldModeActive() || !currentWorldSave) return;
  if (!confirm('将用当前存档的正式事件与成长事实重建派生记忆；不会修改叙事、状态或世界卡。继续？')) return;
  const button = $('debug-memory-rebuild');
  const oldLabel = button.textContent;
  button.disabled = true;
  button.textContent = '重建中…';
  try {
    const saveId = currentWorldSave.id;
    const res = await fetch('/api/world-saves/' + encodeURIComponent(saveId) + '/memory/rebuild', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ commandId: 'memory-rebuild-' + uid(), expectedRevision: currentWorldSave.revision }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.save?.id) throw new Error(worldApiError(data, '派生记忆重建失败（HTTP ' + res.status + '）'));
    if (currentWorldSaveId === saveId) {
      hydrateWorldSave(data.save);
      currentWorldSave = data.save;
      debugMemoryDiagnostics.set(saveId, data.diagnostics);
      renderRPG();
      renderMessages();
      renderDebugMemory();
    }
  } catch (err) {
    $('debug-memory').textContent = `重建失败：${err.message}`;
  } finally {
    button.disabled = false;
    button.textContent = oldLabel;
  }
}

function openDebugTerminal() {
  const panel = $('debug-panel');
  if (!panel.open) panel.showModal();
  $('btn-debug').setAttribute('aria-expanded', 'true');
  renderDebugTerminal();
  $('debug-close').focus();
}

function closeDebugTerminal() {
  const panel = $('debug-panel');
  if (panel.open) panel.close();
  $('btn-debug').setAttribute('aria-expanded', 'false');
  $('btn-debug').focus();
}

function clearDebugTerminal() {
  const session = activeConversationScope();
  if (session) {
    debugTraces.delete(session.id);
    debugTraceSelection.delete(session.id);
  }
  if (worldModeActive()) debugMemoryDiagnostics.delete(currentWorldSaveId);
  renderDebugTerminal();
}

function copyDebugTerminal() {
  const session = activeConversationScope();
  const history = ensureDebugTraceHistory(session);
  if (!history.length) return;
  const memory = worldModeActive() ? ($('debug-memory')?.textContent || '') : '';
  const records = history.map((trace, index) => {
    const sections = trace.promptSections?.length || trace.agentEvents?.length
      ? JSON.stringify({ agentSessionId: trace.agentSessionId || null, agentEvents: trace.agentEvents || [], agentProfile: trace.agentProfile || null, agentContext: trace.agentContext || null, sections: trace.promptSections }, null, 2)
      : '';
    return `── 请求 ${index + 1}/${history.length} · ${trace.label || 'AI 请求'} · ${trace.status || '未知状态'} · ${debugTraceTimestamp(trace) || '刚刚'} ──\n\nINPUT\n${trace.input || ''}\n\nOUTPUT\n${formatDebugOutput(trace)}${sections ? `\n\nSECTIONS\n${sections}` : ''}`;
  });
  const text = records.join('\n\n') + (memory ? `\n\nMEMORY\n${memory}` : '');
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard')))
    .catch(() => { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); });
}

/* ─────────── 开发者实验台（?dev=1，仅复用正式世界存档提交链） ─────────── */
function devtoolsConfig() {
  return defaults?.devtools && typeof defaults.devtools === 'object' ? defaults.devtools : {};
}
function devtoolsTokens() {
  const world = currentWorldCard() || {};
  const save = currentWorldSave || {};
  const locationId = save.state?.locationId || world.start?.locationId || world.locations?.[0]?.id || '';
  const locations = Array.isArray(world.locations) ? world.locations : [];
  const nextLocationId = locations.find(item => item?.id && item.id !== locationId)?.id || locationId;
  const resource = Array.isArray(world.playerCreation?.resources)
    ? world.playerCreation.resources.find(item => item?.id === 'hp') || world.playerCreation.resources.find(item => item?.id)
    : null;
  const resourceId = resource?.id || '';
  const current = Number(save.state?.player?.resources?.[resourceId] ?? resource?.initial ?? resource?.default ?? 0);
  const min = Number(resource?.min ?? 0);
  const max = Number(resource?.max ?? Number.POSITIVE_INFINITY);
  const resourceDelta = current < max ? 1 : current > min ? -1 : 0;
  const negativeResourceDelta = current > min ? -1 : 0;
  const runtimeDefinitions = Array.isArray(world.runtime?.variables) ? world.runtime.variables : [];
  const runtimeNumber = runtimeDefinitions.find(item => item?.id === 'hp' && item?.type === 'number')
    || runtimeDefinitions.find(item => item?.type === 'number' && item?.id);
  const runtimeCurrent = runtimeNumber ? Number(save.state?.runtime?.variables?.[runtimeNumber.id] ?? runtimeNumber.initial ?? 0) : 0;
  const runtimeMin = Number(runtimeNumber?.min ?? Number.NEGATIVE_INFINITY);
  const runtimeNegativeDelta = runtimeNumber && runtimeCurrent > runtimeMin ? -1 : 0;
  const activeTemplateIds = new Set(Object.values(save.state?.conflicts || {}).filter(item => item?.status === 'active').map(item => item.templateId).filter(Boolean));
  const conflictDefinitions = Array.isArray(world.conflicts) ? world.conflicts : [];
  const checkDefinition = [...conflictDefinitions.filter(definition => activeTemplateIds.has(definition.id)), ...conflictDefinitions]
    .map(definition => ({ definition, action: (definition.actions || []).find(item => item?.check) }))
    .find(item => item.action);
  const configuredChecks = world.rules?.checks || world.checks;
  const configuredCheckId = typeof configuredChecks === 'string' ? configuredChecks
    : Array.isArray(configuredChecks) ? (configuredChecks.find(item => typeof item === 'string') || configuredChecks.find(item => item?.id || item?.ruleId)?.id || configuredChecks.find(item => item?.ruleId)?.ruleId || '')
      : configuredChecks && typeof configuredChecks === 'object' ? Object.keys(configuredChecks)[0] || '' : '';
  return {
    locationId,
    nextLocationId,
    firstResourceId: resourceId,
    resourceDelta,
    negativeResourceDelta,
    runtimeNumberId: runtimeNumber?.id || '',
    runtimeNegativeDelta,
    timeValue: Number(save.state?.time?.value ?? save.revision ?? 0),
    checkRuleId: checkDefinition?.action?.id || configuredCheckId,
  };
}
function resolveDevtoolsTemplate(value, tokens = devtoolsTokens()) {
  if (typeof value === 'string') {
    const exact = value.match(/^\{\{([A-Za-z0-9_]+)\}\}$/);
    if (exact && Object.prototype.hasOwnProperty.call(tokens, exact[1])) return tokens[exact[1]];
    return value.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (match, key) => Object.prototype.hasOwnProperty.call(tokens, key) ? String(tokens[key]) : match);
  }
  if (Array.isArray(value)) return value.map(item => resolveDevtoolsTemplate(item, tokens));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveDevtoolsTemplate(item, tokens)]));
  return value;
}
function devtoolsScenario() {
  const id = $('devtools-scenario')?.value;
  return devtoolsScenarios.find(item => item?.id === id) || devtoolsScenarios[0] || null;
}
function devtoolsSetOutput(value) {
  const output = $('devtools-output');
  if (output) output.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}
function devtoolsJson(id, fallback) {
  const text = $(id)?.value?.trim() || '';
  if (!text) return fallback;
  try { return JSON.parse(text); } catch (error) { throw new Error(`${id} JSON 无效：${error.message}`); }
}
function devtoolsFillJson(id, value) {
  const input = $(id);
  if (input) input.value = JSON.stringify(value ?? [], null, 2);
}
function devtoolsFeedback({ dice, patch, options, agentCalls, agentTrace, entities, memory }) {
  const lines = ['---', '**开发者测试反馈**'];
  const check = (agentTrace || []).find(item => item?.name === 'rules.check');
  const roll = (agentTrace || []).find(item => item?.name === 'dice.roll');
  if (check || roll) {
    lines.push('**Agent 判定回路**');
    lines.push(`- rules.check：${check?.result?.ok ? '通过' : `失败（${check?.result?.error || '未通过'}）`}`);
    lines.push(`- dice.roll：${roll?.result?.ok ? '客户端已执行' : `未执行（${roll?.result?.error || '未通过'}）`}`);
    lines.push('- tool 回传 → AI 继续叙事：已模拟');
  }
  if (dice.length) {
    lines.push('**骰子**');
    for (const roll of dice) lines.push(`- 🎲 ${roll.expr}：${roll.rolls.join(' + ')}${roll.bonus ? ` ${roll.bonus > 0 ? '+' : '-'} ${Math.abs(roll.bonus)}` : ''} = **${roll.total}**`);
  }
  const updates = Array.isArray(patch?.updates) ? patch.updates : [];
  if (updates.length) {
    lines.push('**状态变更**');
    for (const update of updates) {
      const detail = update.type === 'location.set' ? `→ ${update.locationId}` : `${update.id || update.itemId || ''} ${update.delta > 0 ? '+' : ''}${update.delta}`;
      lines.push(`- ${update.type}：${detail}`);
    }
  } else lines.push('- 状态变更：无（仅验证提交链）');
  if (options.length) lines.push(`**行动选项**：已生成 ${options.length} 个，可在叙事栏下方直接点击。`);
  if (agentCalls.length) lines.push(`**Agent 工具**：已记录 ${agentCalls.length} 个候选调用。`);
  if (entities.length) lines.push(`**实体**：已提交 ${entities.length} 个实体候选。`);
  if (memory.length) lines.push(`**记忆**：已提交 ${memory.length} 条事件记忆候选。`);
  return lines.join('\n');
}
function loadDevtoolsScenario() {
  const scenario = devtoolsScenario();
  if (!scenario) return;
  const resolved = resolveDevtoolsTemplate(scenario);
  $('devtools-action').value = resolved.action || '';
  $('devtools-dice').value = resolved.dice || '';
  $('devtools-narrative').value = resolved.narrative || '';
  devtoolsFillJson('devtools-options', resolved.options || []);
  devtoolsFillJson('devtools-patch', resolved.patch || { updates: [] });
  devtoolsFillJson('devtools-agent-calls', resolved.agentCalls || []);
  devtoolsFillJson('devtools-entities', resolved.createEntities || []);
  devtoolsFillJson('devtools-memory', resolved.eventMemory || []);
  devtoolsSetOutput(`${scenario.label || scenario.id}\n\n${scenario.description || ''}`);
}
function copyDevtoolsState() {
  if (!currentWorldSave) return;
  const text = JSON.stringify(currentWorldSave, null, 2);
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard')))
    .then(() => devtoolsSetOutput('已复制当前世界存档 JSON。'))
    .catch(() => { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); devtoolsSetOutput('已复制当前世界存档 JSON。'); });
}
function devtoolsAgentSnapshot() {
  const world = currentWorldCard();
  const save = cloneValue(currentWorldSave);
  const active = Object.values(save.state?.conflicts || {}).some(item => item?.status === 'active');
  if (!active) {
    const definition = (Array.isArray(world?.conflicts) ? world.conflicts : []).find(item => Array.isArray(item.actions) && item.actions.some(action => action?.check));
    if (definition) save.state.conflicts = { ...(save.state.conflicts || {}), [`devtools-${definition.id}`]: { status: 'active', templateId: definition.id } };
  }
  return { world: cloneValue(world), save };
}
function renderDevtools() {
  const button = $('btn-devtools');
  if (!button) return;
  button.hidden = !devtoolsEnabled;
  if (!devtoolsEnabled) return;
  const select = $('devtools-scenario');
  const configured = Array.isArray(devtoolsConfig().scenarios) ? devtoolsConfig().scenarios : [];
  devtoolsScenarios = configured.filter(item => item && item.id);
  if (select) {
    const selected = select.value;
    select.innerHTML = devtoolsScenarios.map(item => `<option value="${esc(item.id)}">${esc(item.label || item.id)}</option>`).join('');
    if (devtoolsScenarios.some(item => item.id === selected)) select.value = selected;
  }
  const scope = $('devtools-scope');
  if (scope) scope.textContent = worldModeActive()
    ? `${currentWorldCard()?.title || currentWorldSave.worldId} · ${currentWorldSave.name} · revision ${currentWorldSave.revision}`
    : '仅在 ?dev=1 开启 · 当前没有世界存档';
  const submit = $('devtools-submit');
  if (submit) submit.disabled = !worldModeActive() || worldSavePlanning() || worldTurnPendingActive() || sending;
}
function openDevtools() {
  if (!devtoolsEnabled) return;
  renderDevtools();
  const panel = $('devtools-panel');
  if (!panel.open) panel.showModal();
  $('btn-devtools')?.setAttribute('aria-expanded', 'true');
  if (!$('devtools-action')?.value) loadDevtoolsScenario();
  $('devtools-close')?.focus();
}
function closeDevtools() {
  const panel = $('devtools-panel');
  if (panel?.open) panel.close();
  $('btn-devtools')?.setAttribute('aria-expanded', 'false');
  $('btn-devtools')?.focus();
}
async function submitDevtoolsScenario() {
  if (!worldModeActive()) throw new Error('请先打开正式 RPG 世界存档');
  if (worldSavePlanning()) throw new Error('当前存档仍在开局规划，请先完成开局配置');
  if (worldTurnPendingActive()) throw new Error('当前已有回合正在提交');
  const selectedScenario = devtoolsScenario();
  const tokens = devtoolsTokens();
  if (selectedScenario?.id === 'runtime-mvu-debug' && !tokens.runtimeNumberId) throw new Error('当前世界卡未声明可调试的数字 runtime 变量');
  if (selectedScenario?.id === 'hp-debug' && !tokens.firstResourceId) throw new Error('当前世界卡未声明可调试的角色资源');
  const options = devtoolsJson('devtools-options', []);
  if (!Array.isArray(options)) throw new Error('行动选项必须是 JSON 数组');
  const parsedPatch = devtoolsJson('devtools-patch', { updates: [] });
  if (!parsedPatch || typeof parsedPatch !== 'object' || Array.isArray(parsedPatch)) throw new Error('Typed Patch 必须是 JSON 对象');
  const patch = resolveDevtoolsTemplate(cloneValue(parsedPatch));
  const currentLocationId = currentWorldSave.state?.locationId || null;
  patch.updates = (Array.isArray(patch.updates) ? patch.updates : []).filter(update => {
    if (!update || typeof update !== 'object') return false;
    if (update.type === 'player.resource.delta' && Number(update.delta) === 0) return false;
    if (update.type === 'location.set' && update.locationId === currentLocationId) return false;
    return true;
  });
  patch.protocol = 'tavern.rpg.turn';
  patch.version = 1;
  patch.baseRevision = currentWorldSave.revision;
  patch.options = options;
  const action = $('devtools-action')?.value?.trim() || '[开发者测试] 推进一回合。';
  const narrative = $('devtools-narrative')?.value?.trim() || '开发者实验台提交了一个测试回合。';
  const diceText = $('devtools-dice')?.value?.trim() || '';
  const agentCalls = devtoolsJson('devtools-agent-calls', []);
  const entities = devtoolsJson('devtools-entities', []);
  const memory = devtoolsJson('devtools-memory', []);
  if (!Array.isArray(agentCalls)) throw new Error('Agent 工具调用必须是 JSON 数组');
  if (diceText && !agentCalls.some(call => call?.name === 'dice.roll')) agentCalls.push({ callId: 'dev-dice', name: 'dice.roll', arguments: { expr: diceText } });
  const profile = buildRpgAgentProfile();
  const devtoolsGate = { anchorOffset: narrative.length, checkpoints: [] };
  const executed = await executeRpgNativeToolCalls(agentCalls, profile, null, devtoolsAgentSnapshot(), devtoolsGate);
  const agentTrace = executed.trace;
  const toolErrors = agentTrace.filter(item => item?.result?.ok === false);
  if (toolErrors.length) throw new Error(`Agent 工具测试失败：${toolErrors.map(item => `${item.name}：${item.result.error}`).join('；')}`);
  const dice = agentTrace.filter(item => item?.name === 'dice.roll' && Array.isArray(item.result?.rolls)).flatMap(item => item.result.rolls);
  const visibleNarrative = `${narrative}\n\n${devtoolsFeedback({ dice: [], patch, options, agentCalls, agentTrace, entities, memory })}`;
  const payload = {
    commandId: 'dev-' + uid(),
    expectedRevision: currentWorldSave.revision,
    actionIntent: buildRpgTurnIntent(action, { source: 'devtools', dice }),
    patch,
    turns: [{ role: 'user', content: action }, { role: 'assistant', content: visibleNarrative, ...(devtoolsGate.checkpoints.length ? { checkpoints: serializeRpgCheckpoints(devtoolsGate.checkpoints) } : {}) }],
    options,
    ...(Array.isArray(agentCalls) && agentCalls.length ? { agentCalls } : {}),
    ...(Array.isArray(entities) && entities.length ? { createEntities: resolveDevtoolsTemplate(entities) } : {}),
    ...(Array.isArray(memory) && memory.length ? { eventMemory: resolveDevtoolsTemplate(memory) } : {}),
  };
  const response = await fetch('/api/world-saves/' + encodeURIComponent(currentWorldSave.id), {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.id) throw new Error(worldApiError(data, `开发者回合提交失败（HTTP ${response.status}）`));
  hydrateWorldSave(data);
  currentWorldSave = data;
  currentWorldSaveId = data.id;
  renderRPG(); renderSessions(); renderMessages(); renderWorldDetail(); renderDevtools();
  devtoolsSetOutput({ ok: true, revision: data.revision, agentTrace, evidence: data.lastReceipt || data.lastTurn || null, dice: dice.length ? dice : undefined });
}
async function runDevtoolsSubmit() {
  const button = $('devtools-submit');
  if (button) button.disabled = true;
  try { await submitDevtoolsScenario(); }
  catch (error) { devtoolsSetOutput(`提交失败：${error.message}`); }
  finally { renderDevtools(); }
}

async function testConnection() {
  const out = $('test-result');
  readSettingsForm();
  try {
    out.textContent = '正在测试…';
    out.className = '';
    const data = await callAPI(buildPayload({ test: true }));
    const reply = data?.choices?.[0]?.message?.content;
    out.textContent = `✅ 连接成功！模型响应：${(reply || '(空)').slice(0, 40)}`;
    out.className = 'ok';
    updateApiStatusFromSettings();
  } catch (err) {
    out.textContent = `❌ 连接失败：${err.message}`;
    out.className = 'err';
  }
}

async function exportSettings() {
  readSettingsForm();
  await downloadBlob(new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' }), 'tavern-settings.json');
}

function importSettingsFromText(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error('不是合法的 JSON'); }
  if (!obj || typeof obj !== 'object') throw new Error('配置格式不正确');
  settings = { ...DEFAULT_SETTINGS, ...settings, ...obj };
  saveSettings();
  fillSettingsForm();
  updateApiStatusFromSettings();
}

function importSettings() {
  const out = $('test-result');
  const text = prompt('粘贴要导入的配置 JSON（也可双击「导入配置」选择文件）');
  if (text === null) return;
  try { importSettingsFromText(text); out.textContent = '✅ 配置已导入'; out.className = 'ok'; }
  catch (err) { out.textContent = `❌ 导入失败：${err.message}`; out.className = 'err'; }
}

function importSettingsFromFile(file) {
  const out = $('test-result');
  const reader = new FileReader();
  reader.onload = () => {
    try { importSettingsFromText(reader.result); out.textContent = '✅ 配置已导入'; out.className = 'ok'; }
    catch (err) { out.textContent = `❌ 导入失败：${err.message}`; out.className = 'err'; }
  };
  reader.readAsText(file);
}

/* ─────────── 聊天渲染 ─────────── */

/* 消息操作按钮（编辑/删除/重生成/复制） */
function attachMsgActions(el, m, opts) {
  const wrap = document.createElement('div');
  wrap.className = 'msg-actions';
  const btns = opts || {};
  if (btns.regen) {
    const b = document.createElement('button');
    b.className = 'ma-btn'; b.title = '重新生成'; b.setAttribute('aria-label', b.title); b.textContent = '🔄';
    b.addEventListener('click', (e) => { e.stopPropagation(); regenAssistant(m); });
    wrap.appendChild(b);
  }
  if (btns.edit) {
    const b = document.createElement('button');
    b.className = 'ma-btn'; b.title = '编辑'; b.setAttribute('aria-label', b.title); b.textContent = '✏️';
    b.addEventListener('click', (e) => { e.stopPropagation(); editMessage(m); });
    wrap.appendChild(b);
  }
  if (btns.copy) {
    const b = document.createElement('button');
    b.className = 'ma-btn'; b.title = '复制'; b.setAttribute('aria-label', b.title); b.textContent = '⧉';
    b.addEventListener('click', (e) => { e.stopPropagation(); copyMessage(m); });
    wrap.appendChild(b);
  }
  if (btns.del) {
    const b = document.createElement('button');
    b.className = 'ma-btn'; b.title = '删除'; b.setAttribute('aria-label', b.title); b.textContent = '🗑';
    b.addEventListener('click', (e) => { e.stopPropagation(); deleteMessage(m); });
    wrap.appendChild(b);
  }
  if (wrap.children.length) el.appendChild(wrap);
}

/* 消息操作实现 */
function editMessage(m) {
  m._editing = true;
  renderMessages();
  const ta = $('edit-msg');
  if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}
function saveEdit(m) {
  const ta = $('edit-msg');
  if (ta) {
    const stage = m.role === 'user' ? 'user_input' : (m.role === 'assistant' ? 'ai_response' : 'system_prompt');
    m.content = applyRegexStage(ta.value, stage, { editing: true });
    delete m.rawContent;
  }
  delete m._editing;
  if (worldModeActive()) queueWorldSave(currentWorldSave);
  else {
    const session = curSession();
    invalidateTavernAutoMemory(session, m.id);
    saveSessions(session);
  }
  renderMessages();
}
function cancelEdit(m) {
  delete m._editing;
  renderMessages();
}
function deleteMessage(m) {
  if (worldModeActive()) {
    if (m._opening) return;
    if (!confirm('删除这条消息？')) return;
    const i = (currentWorldSave.turns || []).indexOf(m);
    if (i < 0) return;
    currentWorldSave.turns.splice(i, 1);
    queueWorldSave(currentWorldSave);
    renderMessages();
    return;
  }
  const s = curSession();
  if (!s) return;
  const i = s.messages.indexOf(m);
  if (i < 0) return;
  if (!confirm('删除这条消息？')) return;
  invalidateTavernAutoMemory(s, m.id);
  s.messages.splice(i, 1);
  saveSessions(s);
  renderMessages();
}
function copyMessage(m) {
  const text = m.content || '';
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard')))
    .then(() => { /* 复制成功 */ })
    .catch(() => { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); });
}
/* 重新生成：删除该条 assistant 及之后，用现有历史重新请求 */
async function regenAssistant(m) {
  if (worldModeActive()) {
    if (m._opening || sending) return;
    const i = (currentWorldSave.turns || []).indexOf(m);
    if (i < 0 || currentWorldSave.turns[i].role !== 'assistant') return;
    currentWorldSave.turns = currentWorldSave.turns.slice(0, i);
    queueWorldSave(currentWorldSave);
    renderMessages();
    await requestReply();
    return;
  }
  const s = curSession();
  if (!s || sending) return;
  const i = s.messages.indexOf(m);
  if (i < 0 || s.messages[i].role !== 'assistant') return;
  invalidateTavernAutoMemory(s, s.messages.slice(i).map(message => message.id));
  s.messages = s.messages.slice(0, i);
  saveSessions(s);
  renderMessages();
  await requestReply();
}

/* 编辑模式渲染：消息内容替换为 textarea */
function renderEditBubble(m, className = 'bubble edit-bubble') {
  return `<div class="${className}"><textarea id="edit-msg" rows="4">${esc(m.content)}</textarea><div class="edit-actions"><button class="btn gold small" data-edit-save>保存</button><button class="ghost-btn small" data-edit-cancel>取消</button></div></div>`;
}

function resetMessageRenderWindow() {
  messageRenderWindow.start = 0;
  messageRenderWindow.preserveScroll = false;
}

function scrollChatToLatest(chat, conversationKey = activeConversationKey()) {
  const scroll = () => {
    if (!chat || chat.isConnected === false || activeConversationKey() !== conversationKey) return;
    if (typeof chat.scrollTo === 'function') chat.scrollTo({ top: chat.scrollHeight, behavior: 'instant' });
    else chat.scrollTop = chat.scrollHeight;
  };
  scroll();
  window.requestAnimationFrame?.(() => {
    scroll();
    window.requestAnimationFrame?.(scroll);
  });
}

function renderMessages() {
  const chat = $('chat');
  const previousScrollHeight = chat.scrollHeight;
  const previousScrollTop = chat.scrollTop;
  const preserveScroll = messageRenderWindow.preserveScroll;
  messageRenderWindow.preserveScroll = false;
  const conversationKey = activeConversationKey();
  if (messageRenderWindow.key !== conversationKey) {
    messageRenderWindow = { key: conversationKey, start: 0, preserveScroll: false };
  }
  syncConversationResetButton();
  initTavernCardFrameBridge();
  renderDebugTerminal();
  renderTavernAutoMemoryStatus();
  if (mode !== 'rpg') clearWorldExtension();
  applyWorldUiSlots();
  chat.innerHTML = '';
  if (mode === 'rpg') renderRPG(); // RPG 模式联动状态面板
  const msgs = curMessages();
  const pendingAssistantVisible = worldTurnPendingActive() && !!worldTurnPending.assistantMessage;
  const preview = responsePreview && responsePreview.targetKey === activeConversationKey() && !pendingAssistantVisible ? [responsePreview] : [];
  const renderMsgs = preview.length ? [...msgs, ...preview] : msgs;
  const windowStart = renderMsgs.length > MESSAGE_RENDER_WINDOW_SIZE
    ? Math.max(0, renderMsgs.length - MESSAGE_RENDER_WINDOW_SIZE - messageRenderWindow.start)
    : 0;
  const visibleMsgs = windowStart > 0 ? renderMsgs.slice(windowStart) : renderMsgs;
  renderQuickActions(); // 从当前会话最后一条 AI 回复恢复选项，切换会话不串线
  const ended = mode === 'rpg' && worldModeActive() && (currentWorldSave?.state?.ending?.status === 'ended' || currentWorldSave?.state?.failure?.status === 'terminal');
  const planning = mode === 'rpg' && worldModeActive() && worldSavePlanning();
  const input = $('input');
  const sendButton = $('btn-send');
  if (input) { input.disabled = ended || planning; input.placeholder = ended ? '世界线已终止，请从右侧重开独立存档后继续…' : planning ? '请先完成开局配置，再开始游戏…' : '写下你的话或行动（可用 *动作* 表示）… Enter 发送 · Shift+Enter 换行'; }
  if (sendButton && !sending) sendButton.disabled = ended || planning;
  if (!renderMsgs.length) {
    chat.innerHTML = `<div class="chat-empty"><div class="ce-icon">🐾</div><div class="ce-title">${esc(emptyTitle())}</div><div class="ce-desc">${esc(buildGuide())}</div></div>`;
    return;
  }
  if (windowStart > 0) {
    const earlier = document.createElement('button');
    earlier.type = 'button';
    earlier.className = 'message-window-control ghost-btn small';
    earlier.textContent = `加载更早消息（还剩 ${windowStart} 条）`;
    earlier.title = '只加载更早消息，不会删除或改变历史';
    earlier.addEventListener('click', () => {
      messageRenderWindow.start += MESSAGE_RENDER_WINDOW_STEP;
      messageRenderWindow.preserveScroll = true;
      renderMessages();
    });
    chat.appendChild(earlier);
  }
  for (let visibleIndex = 0; visibleIndex < visibleMsgs.length; visibleIndex++) {
    const m = visibleMsgs[visibleIndex];
    // 文生图图片消息
    if (m.role === 'image') {
      const imgEl = document.createElement('div');
      imgEl.className = 'msg image-msg';
      imgEl.innerHTML = `<div class="bubble img-bubble"><img src="${esc(m.content)}" alt="生成图" loading="lazy" /></div><button class="regen-btn" title="用同一提示词重新生成">🔄 重新生成</button>`;
      const img = imgEl.querySelector('img');
      if (img) {
        img.style.cursor = 'zoom-in';
        img.addEventListener('click', () => openLightbox(m.content));
        img.onerror = () => {
          imgEl.innerHTML = '<div class="bubble img-bubble img-fail">🖼 图片加载失败（文件可能已删除或不可访问）</div>';
        };
      }
      const btn = imgEl.querySelector('.regen-btn');
      if (btn) btn.addEventListener('click', () => regenImage(m));
      attachMsgActions(imgEl, m, { copy: true, del: true });
      chat.appendChild(imgEl);
      continue;
    }
    // AI 回复：RPG 是连续叙事；酒馆才按引号拆分「旁白行 + 角色气泡」。
    if (m.role === 'assistant') {
      // 思维链独立呈现（旁白样式），不占用角色气泡
      if (m.cot) {
        const cotEl = document.createElement('div');
        cotEl.className = 'msg cot-msg';
        cotEl.innerHTML = `<div class="nar-icon">🧠</div><div class="bubble"><details class="cot"><summary>🧠 思维链</summary><pre>${esc(m.cot)}</pre></details></div>`;
        chat.appendChild(cotEl);
      }
      if (mode === 'rpg') {
        const el = document.createElement('article');
        el.className = 'msg rpg-narrative';
        if (m._editing) {
          el.innerHTML = renderEditBubble(m, 'rpg-prose rpg-prose-editor');
          const sb = el.querySelector('[data-edit-save]');
          const cb = el.querySelector('[data-edit-cancel]');
          if (sb) sb.addEventListener('click', () => saveEdit(m));
          if (cb) cb.addEventListener('click', () => cancelEdit(m));
        } else {
          const { html, md } = renderRpgNarrativeWithCheckpoints(m.rawContent ?? m.content, m.checkpoints, { fromRaw: typeof m.rawContent === 'string' });
          el.innerHTML = `<div class="rpg-prose${md ? ' md' : ''}" data-tavern-rendered>${html}</div>`;
          if (!m._preview) attachMsgActions(el, m, m._opening ? { copy: true } : { regen: true, edit: true, copy: true, del: true });
        }
        chat.appendChild(el);
        continue;
      }
      const tavernContent = renderOutputContent(m.rawContent ?? m.content, 'tavern', { fromRaw: typeof m.rawContent === 'string' });
      const bubbleDialogue = !!prefs.tavernDialogueBubbles;
      const segs = bubbleDialogue ? splitNarration(tavernContent) : [{ type: 'narration', text: tavernContent }];
      segs.forEach((seg, si) => {
        const el = document.createElement('div');
        let html;
        if (m._editing) {
          el.className = 'msg assistant';
          el.innerHTML = renderEditBubble(m);
        } else {
          const { html: h, md } = renderBubble(seg.type === 'dialogue' ? seg.text.slice(1, -1) : seg.text, { allowCardScripts: true });
          html = h;
          if (seg.type === 'narration') {
            el.className = `msg narration${bubbleDialogue ? '' : ' tavern-prose'}`;
            el.innerHTML = `<div class="nar-icon">✦</div><div class="bubble${md ? ' md' : ''}" data-tavern-rendered>${html}</div>`;
          } else {
            el.className = 'msg assistant';
            el.innerHTML = `<div class="bubble tavern-dialogue${md ? ' md' : ''}" data-tavern-rendered>${html}</div>`;
          }
        }
        // 操作按钮只挂在第一段（整条消息共享操作）
        if (si === 0) {
          if (m._editing) {
            const sb = el.querySelector('[data-edit-save]');
            const cb = el.querySelector('[data-edit-cancel]');
            if (sb) sb.addEventListener('click', () => saveEdit(m));
            if (cb) cb.addEventListener('click', () => cancelEdit(m));
          } else {
            if (!m._preview) attachMsgActions(el, m, { regen: true, edit: true, copy: true, del: true });
          }
        }
        chat.appendChild(el);
      });
      // AI 回复选项已统一渲染在底部快捷行动栏（renderQuickActions），不再挂消息下方
      continue;
    }
    // 用户 / 系统消息（meta 消息：内部注入如掷骰结果，居中显示）
    const el = document.createElement('div');
    el.className = 'msg ' + (m.meta ? 'system' : m.role);
    if (m.role === 'user' && !m.meta && m._editing) {
      el.innerHTML = renderEditBubble(m);
      const sb = el.querySelector('[data-edit-save]');
      const cb = el.querySelector('[data-edit-cancel]');
      if (sb) sb.addEventListener('click', () => saveEdit(m));
      if (cb) cb.addEventListener('click', () => cancelEdit(m));
    } else {
      const { html, md } = renderBubble(m.content);
      el.innerHTML = `<div class="bubble${md ? ' md' : ''}" data-tavern-rendered>${html}</div>`;
      attachMsgActions(el, m,
        m.role === 'user' ? { edit: true, copy: true, del: true }
        : m.role === 'system' ? { copy: true, del: true }
        : { edit: true, copy: true, del: true });
    }
    chat.appendChild(el);
  }
  if (preserveScroll) chat.scrollTop = Math.max(0, chat.scrollHeight - previousScrollHeight + previousScrollTop);
  else scrollChatToLatest(chat, conversationKey);
}

function pushMessage(role, content, extra) {
  resetMessageRenderWindow();
  if (worldModeActive()) {
    const msg = { id: uid(), role, content, ts: Date.now() };
    if (extra) Object.assign(msg, extra);
    if (worldTurnPendingActive()) {
      worldTurnPending.messages.push(msg);
      renderMessages();
      return;
    }
    currentWorldSave.turns = Array.isArray(currentWorldSave.turns) ? currentWorldSave.turns : [];
    currentWorldSave.turns.push(msg);
    queueWorldSave(currentWorldSave);
    renderMessages();
    renderSessions();
    return;
  }
  const s = curSession();
  if (!s) return;
  const msg = { id: uid(), role, content, ts: Date.now() };
  if (extra) Object.assign(msg, extra);
  s.messages.push(msg);
  saveSessions(s);
  renderMessages();
  renderSessions();
}

function addTyping() {
  const chat = $('chat');
  const el = document.createElement(mode === 'rpg' ? 'article' : 'div');
  el.className = mode === 'rpg' ? 'msg rpg-narrative typing' : 'msg assistant typing';
  el.id = 'typing-msg';
  el.innerHTML = mode === 'rpg'
    ? '<div class="rpg-prose" data-tavern-rendered>世界正在回应…</div>'
    : '<div class="bubble" data-tavern-rendered>正在思索…</div>';
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
}
function removeTyping() {
  const t = $('typing-msg');
  if (t) t.remove();
}

/* 保留已经生成的正文，但不提前应用 patch 或写入历史；协议收尾完成后由正式消息替换。 */
function setResponsePreview(reply, resolution = null, targetKey = activeConversationKey(), checkpoints = null) {
  if (targetKey !== activeConversationKey()) return;
  const parsed = mode === 'rpg'
    ? parseRpgOutput(reply)
    : parseTavernReplyOutput(reply, resolvePromptPreset()?.preset || null);
  const rawContent = mode === 'rpg'
    ? stripRpgNarrativeOptions(parsed.narrative)
    : String(parsed.content || '');
  responsePreview = {
    _preview: true,
    role: 'assistant',
    content: applyOutputRegex(rawContent),
    rawContent,
    ts: Date.now(),
    targetKey,
    ...(resolution ? { checkResolution: cloneValue(resolution) } : {}),
    ...(mode === 'rpg' && Array.isArray(checkpoints) && checkpoints.length ? { checkpoints: serializeRpgCheckpoints(checkpoints) } : {}),
  };
  removeTyping();
  renderMessages();
}

function clearResponsePreview() {
  responsePreview = null;
}

const RPG_CHECK_TONES = {
  'critical-success': ['is-gold', '★'],
  success: ['is-success', '✓'],
  'success-with-cost': ['is-warning', '◆'],
  'partial-success': ['is-warning', '◆'],
  failure: ['is-failure', '✕'],
  'critical-failure': ['is-failure', '✕'],
};

function serializeRpgCheckpoints(checkpoints) {
  return (Array.isArray(checkpoints) ? checkpoints : []).slice(0, 8).map((checkpoint, index) => {
    const roll = checkpoint?.roll && typeof checkpoint.roll === 'object' ? checkpoint.roll : null;
    const resolution = checkpoint?.resolution && typeof checkpoint.resolution === 'object' ? checkpoint.resolution : null;
    return {
      id: String(checkpoint?.id || `check-${index + 1}`).slice(0, 80),
      offset: Math.max(0, Math.min(200000, Math.trunc(Number(checkpoint?.offset) || 0))),
      expr: String(checkpoint?.expr || roll?.expr || resolution?.roll || '骰子').slice(0, 80),
      completed: checkpoint?.completed === true,
      settled: checkpoint?.settled === true,
      ...(roll ? { roll: {
        expr: String(roll.expr || checkpoint?.expr || '骰子').slice(0, 80),
        ...(Number.isFinite(Number(roll.total)) ? { total: Number(roll.total) } : {}),
      } } : {}),
      ...(resolution ? { resolution: {
        grade: Object.prototype.hasOwnProperty.call(RPG_CHECK_TONES, resolution.grade) ? resolution.grade : '',
        label: String(resolution.label || '骰点完成').slice(0, 80),
        ...(Number.isFinite(Number(resolution.target)) ? { target: Number(resolution.target) } : {}),
        ...(Number.isFinite(Number(resolution.total)) ? { total: Number(resolution.total) } : {}),
        ...(Number.isFinite(Number(resolution.modifier)) ? { modifier: Number(resolution.modifier) } : {}),
        roll: String(resolution.roll || roll?.expr || checkpoint?.expr || '骰子').slice(0, 80),
      } } : {}),
    };
  });
}

function rpgCheckFeedbackMarkup(checkpoint) {
  const state = serializeRpgCheckpoints([checkpoint])[0];
  if (!state) return '';
  const resolution = state.resolution;
  const roll = state.roll;
  const tone = RPG_CHECK_TONES[resolution?.grade] || ['', '◆'];
  const resultTotal = Number.isFinite(Number(resolution?.total)) ? Number(resolution.total) : Number.isFinite(Number(roll?.total)) ? Number(roll.total) : null;
  const modifier = Number(resolution?.modifier) || 0;
  const formula = resolution && resultTotal !== null
    ? `${resolution.roll}${modifier ? `${modifier > 0 ? '+' : ''}${modifier}` : ''} = ${resultTotal}`
    : resultTotal !== null ? `${roll?.expr || state.expr} = ${resultTotal}` : `${state.expr} · 等待结果`;
  const detail = resolution && Number.isFinite(Number(resolution.target)) ? `${formula} · 目标 ${resolution.target}` : formula;
  const classes = ['rpg-check-feedback', state.completed ? 'is-result' : 'is-pending', state.settled ? 'is-settled' : '', tone[0]].filter(Boolean).join(' ');
  return `<div class="rpg-check-anchor" data-rpg-checkpoint="${esc(state.id)}"><div class="${classes}" role="status" aria-live="polite"><span class="rpg-check-die" aria-hidden="true">${resolution ? tone[1] : '◆'}</span><span class="rpg-check-copy"><strong>${esc(resolution?.label || (roll ? '骰点完成' : '判定中'))}</strong><small>${esc(detail)}</small></span></div></div>`;
}

function renderRpgNarrativeWithCheckpoints(content, checkpoints, { fromRaw = false, streaming = false } = {}) {
  const source = String(content || '');
  const ordered = serializeRpgCheckpoints(checkpoints)
    .map((checkpoint, index) => ({ ...checkpoint, order: index }))
    .sort((a, b) => a.offset - b.offset || a.order - b.order);
  const renderSegment = segment => renderBubble(streaming ? applyOutputRegex(segment) : renderOutputContent(segment, 'rpg', { fromRaw }));
  if (!ordered.length) return renderSegment(source);
  let cursor = 0;
  let html = '';
  let md = false;
  const appendSegment = segment => {
    if (!segment) return;
    const rendered = renderSegment(segment);
    html += `<div class="rpg-prose-segment">${rendered.html}</div>`;
    if (!md) md = rendered.md;
  };
  for (const checkpoint of ordered) {
    const offset = Math.max(cursor, Math.min(source.length, checkpoint.offset));
    appendSegment(source.slice(cursor, offset));
    html += rpgCheckFeedbackMarkup(checkpoint);
    cursor = offset;
  }
  appendSegment(source.slice(cursor));
  return { html, md };
}

function showRpgCheckAnimation(expr, anchorOffset = 0, checkpoints = null) {
  if (mode !== 'rpg' || !worldModeActive()) return;
  const list = Array.isArray(checkpoints) ? checkpoints : (rpgCheckAnimation?.checkpoints || []);
  rpgCheckAnimation = { checkpoints: list };
  const state = { id: uid(), offset: Math.max(0, Math.trunc(Number(anchorOffset) || 0)), expr: String(expr || '骰子').slice(0, 80), completed: false, settled: false };
  list.push(state);
  if (list.length > 8) list.splice(0, list.length - 8);
  renderTypingContentFrame();
  return state;
}

function updateRpgCheckAnimation(state, roll, resolution = null) {
  if (!state) return;
  state.roll = roll ? cloneValue(roll) : null;
  state.resolution = resolution ? cloneValue(resolution) : null;
}

function finishRpgCheckAnimation(state) {
  if (!state) return;
  state.completed = true;
  state.settled = false;
  const anchor = typeof document?.querySelectorAll === 'function'
    ? [...document.querySelectorAll('[data-rpg-checkpoint]')].find(node => node.getAttribute('data-rpg-checkpoint') === state.id)
    : null;
  if (anchor) anchor.outerHTML = rpgCheckFeedbackMarkup(state);
  else renderTypingContentFrame();
  state.settled = true;
  if (responsePreview?.targetKey === activeConversationKey()) responsePreview.checkpoints = serializeRpgCheckpoints(rpgCheckAnimation?.checkpoints);
}

function clearRpgCheckAnimation() {
  rpgCheckAnimation = null;
}

/* ─────────── 文生图（测试功能） ─────────── */
function igSettings() { return settings.imageGen || (settings.imageGen = {}); }

/* 聊天栏「正在生图」占位提示 */
function addImagePending() {
  const chat = $('chat');
  if (!chat || $('img-pending-msg')) return;
  const el = document.createElement('div');
  el.className = 'msg image-msg pending';
  el.id = 'img-pending-msg';
  el.innerHTML = '<div class="bubble img-bubble pending-bubble">🖼 正在生成图片…</div>';
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
}
function removeImagePending() {
  const t = $('img-pending-msg');
  if (t) t.remove();
}

/* 图片转 data URI：本地相对路径先 fetch 再转（中转服务端无法访问我们的 /images/ 相对路径） */
async function imageToDataUri(src) {
  if (!src) return src;
  if (src.startsWith('data:')) return src;
  if (src.startsWith('http://') || src.startsWith('https://')) return src; // 绝对 URL 直接给中转
  try {
    const r = await fetch(src);
    const blob = await r.blob();
    return await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsDataURL(blob);
    });
  } catch (e) { return src; }
}

async function buildImageBody(ig, prompt, refImage) {
  // 约束后缀：无论提示词来源（LLM/剧情/手动）都自动附加，兽人禁人脸
  const fullPrompt = (prompt || '') + (ig.promptSuffix || '');
  const body = { prompt: fullPrompt };
  if (ig.kind === 'sd') {
    const [w, h] = (ig.size || '512x512').split('x').map(Number);
    body.width = w || 512;
    body.height = h || 512;
    body.steps = ig.steps || 20;
    body.cfg_scale = ig.cfgScale || 7;
    if (ig.sampler) body.sampler_name = ig.sampler;
    const neg = [ig.negativePrompt, ig.negativeSuffix].filter(Boolean)
      .map(s => s.replace(/^,\s*/, '').trim()).filter(Boolean).join(', ');
    if (neg) body.negative_prompt = neg;
    body.seed = -1;
    // 形象参考：SD 走 img2img（低重绘幅度 → 形象延续）
    if (ig.refUse && refImage) {
      body.init_images = [refImage];
      body.denoising_strength = ig.refStrength || 0.5;
    }
  } else {
    if (ig.model) body.model = ig.model;
    if (ig.size) body.size = ig.size;
    body.n = 1;
    // 形象参考：OpenAI 兼容中转（chatgpt2api 等）generations 白名单丢弃未知字段，
    // 参考图必须走 /images/edits（body.images 数组，服务端据此自动选端点）
    if (ig.refUse && refImage) {
      body.images = [await imageToDataUri(refImage)];
      // 图生图引导：参考图 = 角色形象基准，生成「该角色在当前场景中」的画面；
      // 明确禁止输出角色设计图/立绘（否则 gpt-image 会把参考图当设计对象重绘）
      body.prompt = `Using the character in the reference image as the exact character design, show this same character acting in the following scene: ${fullPrompt} Do NOT output a character sheet, turnaround, or design diagram.`;
    }
    // 不发送 response_format：dall-e 系列默认返回 url；gpt-image 系列不接受该参数、总是返回 b64（解析端已兼容两者）
  }
  return body;
}

function parseImageSrc(data) {
  if (!data) return null;
  if (Array.isArray(data.data) && data.data[0]) {
    const it = data.data[0];
    return it.b64_json ? 'data:image/png;base64,' + it.b64_json : (it.url || null);
  }
  if (Array.isArray(data.images) && data.images[0]) {
    return 'data:image/png;base64,' + data.images[0]; // SD WebUI
  }
  return null;
}

/* 生图请求（120s 超时防挂起）；refImage = 角色形象参考图 */
async function callImageAPI(ig, prompt, refImage) {
  if (!ig.baseUrl) throw new Error('请先在 设置 → 文生图 中填写 Base URL');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch('/api/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      signal: ctrl.signal,
      body: JSON.stringify({ baseUrl: ig.baseUrl, apiKey: ig.apiKey, kind: ig.kind || 'openai', body: await buildImageBody(ig, prompt, refImage) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data && data.error && (data.error.message || data.error)) || ('生图 API 返回 ' + res.status);
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    const src = parseImageSrc(data);
    if (!src) throw new Error('响应中没有图片字段（期望 data[].url / data[].b64_json / images[]）— 原始响应: ' + JSON.stringify(data).slice(0, 160));
    return src;
  } finally {
    clearTimeout(timer);
  }
}

/* LLM 生成生图提示词（走 /api/chat 代理，复用对话配置；60s 超时防挂起） */
async function llmImagePrompt(ig, story) {
  const instr = ig.promptInstruction || '根据以下剧情输出英文文生图提示词：';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      signal: ctrl.signal,
      body: JSON.stringify({
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        body: {
          model: settings.model || 'default',
          messages: [
            { role: 'system', content: instr },
            { role: 'user', content: story },
          ],
          temperature: settings.temperature,
          max_tokens: settings.maxTokens,
          top_p: settings.topP,
          frequency_penalty: settings.frequencyPenalty,
          presence_penalty: settings.presencePenalty,
          stream: false,
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.choices || !data.choices[0]) throw new Error('提示词生成失败（对话 API 未配置？）');
    const choice = data.choices[0];
    const content = choice.message && choice.message.content;
    if (!content || choice.finish_reason === 'length') {
      throw new Error('提示词生成被截断：请在设置中提高最大 Token，或关闭模型思维链。');
    }
    return content.trim();
  } finally {
    clearTimeout(timer);
  }
}

/* 图片本地化：data URI / http url → server 保存到 public/images/ → 返回 /images/xxx.png（刷新不丢） */
async function saveImageLocally(src) {
  if (!src) return src;
  if (src.startsWith('/images/')) return src; // 已是本地路径
  const res = await fetch('/api/image-save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(src.startsWith('data:') ? { b64: src } : { url: src }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.path) throw new Error('图片本地保存失败: ' + (data.error || res.status));
  return data.path;
}

/* 点击图片放大查看（lightbox）：点遮罩关闭，点图片切换 适应窗口 / 原始尺寸（可滚动） */
let lightboxEl = null;
function openLightbox(src, caption) {
  if (!lightboxEl) {
    lightboxEl = document.createElement('div');
    lightboxEl.className = 'lightbox hidden';
    lightboxEl.innerHTML = '<div class="lightbox-tools">'
      + '<button class="lb-btn" data-act="fit">🖼 适应窗口</button>'
      + '<button class="lb-btn" data-act="orig">🔍 原始尺寸</button>'
      + '<span class="lb-hint">或点击图片切换</span>'
      + '</div>'
      + '<div class="lightbox-cap" hidden></div>'
      + '<img alt="大图" />';
    lightboxEl.addEventListener('click', (e) => {
      const act = e.target.dataset && e.target.dataset.act;
      const img = lightboxEl.querySelector('img');
      if (act === 'fit') { img.classList.remove('zoomed'); img.classList.add('fit'); lightboxEl.scrollTop = 0; return; }
      if (act === 'orig') { img.classList.add('zoomed'); img.classList.remove('fit'); lightboxEl.scrollTop = 0; return; }
      if (e.target === lightboxEl) { closeLightbox(); return; } // 点遮罩关闭
      img.classList.toggle('zoomed'); // 点图片切换缩放
      img.classList.remove('fit');
      lightboxEl.scrollTop = 0;
    });
    document.body.appendChild(lightboxEl);
  }
  const img = lightboxEl.querySelector('img');
  img.src = src;
  img.classList.remove('zoomed');
  img.classList.add('fit');
  const cap = lightboxEl.querySelector('.lightbox-cap');
  if (cap) { cap.textContent = caption || ''; cap.hidden = !caption; }
  lightboxEl.scrollTop = 0;
  lightboxEl.classList.remove('hidden');
}
function closeLightbox() { if (lightboxEl) lightboxEl.classList.add('hidden'); }

/* 地图查看原图：优先当前可见源（窗口美化图 → 预览美化图 → 窗口画布 → 预览画布 → 高清重渲），
 * 无 mapData 也不静默失效；标题取 mm-info 当前内容首行 */
function zoomMap() {
  let src = null;
  const mmBeauty = $('mm-beauty'), mmImg = $('mm-beauty-img');
  const beauty = $('map-beauty'), bImg = $('map-beauty-img');
  if (mmBeauty && !mmBeauty.hidden && mmImg && mmImg.src) src = mmImg.src;
  else if (beauty && !beauty.hidden && bImg && bImg.src) src = bImg.src;
  if (!src) {
    const map = curMapData();
    const canvas = $('mm-canvas') || $('map-canvas');
    if (map && window.MapGen) {
      const c = document.createElement('canvas');
      window.MapGen.renderWorldMap(c, map, { pixelSize: 12 }); // 高清重渲（128×12=1536px）
      src = c.toDataURL('image/png');
    } else if (canvas && canvas.toDataURL) {
      src = canvas.toDataURL('image/png'); // 兜底：直接取当前画布
    }
  }
  const info = $('mm-info');
  const caption = info && info.innerText ? info.innerText.split('\n')[0].trim() : '';
  if (src) openLightbox(src, caption);
}

/* 查看生图参考图（带地形标记：山脉▲/森林树/湿地波纹）——用于确认 AI 收到的标注图 */
function showMapRef() {
  const map = curMapData();
  if (!map || !window.MapGen) return;
  const c = document.createElement('canvas');
  window.MapGen.renderWorldMap(c, map, { pixelSize: 12, markers: true, labels: 'bold' });
  openLightbox(c.toDataURL('image/png'), '生图参考图（标注：山脉/森林/湿地）');
}

/* 地图数据 JSON 查看：结构化导出（区域/路径点/邻接/网格统计），不包含全量 grid */
let lastMapJson = '';
function buildMapJson() {
  const map = curMapData();
  if (!map) return null;
  let land = 0, ocean = 0;
  for (let i = 0; i < map.grid.length; i++) { if (map.grid[i]) land++; else ocean++; }
  return {
    engine: map.engine, seed: map.seed, size: map.size,
    regions: map.regions.map(r => ({ id: r.id, name: r.name, biome: r.biome, seedX: r.seedX, seedY: r.seedY })),
    points: map.points.map(p => ({ name: p.name, type: p.type, x: p.x, y: p.y, regionId: p.regionId, desc: p.desc })),
    adjacency: map.adjacency,
    gridStats: { landPx: land, oceanPx: ocean, total: map.size * map.size, regions: map.regions.length },
  };
}
function showMapJson() {
  const data = buildMapJson();
  if (!data) return;
  lastMapJson = JSON.stringify(data, null, 2);
  const pre = $('map-json-content');
  if (pre) pre.textContent = lastMapJson;
  const mj = $('map-json-modal');
  if (mj) mj.classList.remove('hidden');
}
function copyMapJson() {
  const data = buildMapJson();
  const txt = data ? JSON.stringify(data, null, 2) : lastMapJson;
  if (!txt) return;
  navigator.clipboard.writeText(txt).then(
    () => alert('✅ 地图数据 JSON 已复制'),
    () => alert('复制失败（浏览器剪贴板权限）')
  );
}

/* 生图并作为图片消息上屏 */
async function generateImageFor(story) {
  const ig = igSettings();
  if (!ig.enabled || !ig.baseUrl) return;
  const targetKey = activeConversationKey();
  const targetTurnEpoch = worldModeActive() ? worldTurnEpoch : null;
  const status = $('ig-test-result');
  if (status) status.textContent = '⏳ 正在生成图片…';
  addImagePending(); // 聊天栏占位提示：开始生图
  try {
    const char = worldModeActive() ? (currentWorldSave.player?.snapshot || null) : currentChar();
    const refImage = (char && char.refImage) ? char.refImage : null;
    let prompt;
    if (ig.promptSource === 'story') {
      prompt = story;
    } else {
      try { prompt = await llmImagePrompt(ig, story); }
      catch (e) { console.warn('[Tavern] LLM 提示词生成失败，回退用剧情文本:', e.message); prompt = story; }
    }
    // 角色形象 + 当前场景统一：把角色外貌与场景描述注入提示词（图生图与对话场景一致）
    if (char) {
      const look = [char.race, char.persona].filter(Boolean).join('，').slice(0, 150);
      const scene = (char.scenario && char.scenario.trim()) ? `当前场景：${char.scenario.trim()}` : '';
      prompt = `角色形象：${char.name || ''}（${look}）。${scene}保持一致的形象设定。${prompt}`;
    }
    console.info('[Tavern] 🖼 生图提示词', prompt.slice(0, 120),
      '| 参考图:', refImage ? ('有(' + refImage.slice(0, 40) + ')') : '无',
      '| refUse:', ig.refUse,
      '| 端点:', (ig.refUse && refImage) ? (ig.kind === 'sd' ? 'img2img' : '/images/edits') : (ig.kind === 'sd' ? 'txt2img' : '/images/generations'));
    const src = await callImageAPI(ig, prompt, refImage);
    removeImagePending();
    let local = src;
    try { local = await saveImageLocally(src); } // 存本地，刷新不丢
    catch (e) { console.warn('[Tavern] 图片本地保存失败，本轮仍显示:', e.message); }
    if (activeConversationKey() !== targetKey || (worldModeActive() && targetTurnEpoch !== worldTurnEpoch)) return;
    pushMessage('image', local, { imgPrompt: prompt }); // 记住提示词，供「重新生成」复用
    if (status) status.textContent = '✅ 图片已生成并显示在聊天栏';
  } catch (err) {
    console.error('[Tavern] 文生图失败:', err.message);
    removeImagePending();
    if (status) status.textContent = '❌ ' + err.message;
    if (activeConversationKey() === targetKey && (!worldModeActive() || targetTurnEpoch === worldTurnEpoch)) pushMessage('system', `⚠️ 文生图失败：${err.message}`);
  }
}

/* 测试按钮：用测试提示词直接生图 */
async function testImageGen() {
  const ig = igSettings();
  const prompt = ($('ig-test-prompt').value || '').trim() || 'a fox knight in a tavern, anime style';
  const status = $('ig-test-result');
  const targetKey = activeConversationKey();
  if (status) status.textContent = '⏳ 正在生成测试图…';
  addImagePending();
  try {
    const char = worldModeActive() ? (currentWorldSave.player?.snapshot || null) : currentChar();
    const refImage = (char && char.refImage) ? char.refImage : null;
    // 测试按钮同样注入当前角色形象描述
    let p = prompt;
    if (char && (char.race || char.persona)) {
      const look = [char.race, char.persona].filter(Boolean).join('，').slice(0, 150);
      p = `角色形象：${char.name || ''}（${look}），保持一致的形象设定。${p}`;
    }
    const src = await callImageAPI(ig, p, refImage);
    removeImagePending();
    if (status) status.textContent = '✅ 成功（见聊天栏）';
    let local = src;
    try { local = await saveImageLocally(src); }
    catch (e) { console.warn('[Tavern] 图片本地保存失败，本轮仍显示:', e.message); }
    if (activeConversationKey() !== targetKey) return;
    pushMessage('image', local, { imgPrompt: prompt });
  } catch (err) {
    console.error('[Tavern] 文生图测试失败:', err.message);
    removeImagePending();
    if (status) status.textContent = '❌ ' + err.message;
  }
}

/* 重新生成：用同一提示词再次生图并替换该条图片消息 */
async function regenImage(msg) {
  const ig = igSettings();
  if (!ig.enabled || !ig.baseUrl) { pushMessage('system', '⚠️ 文生图未启用或未配置 Base URL'); return; }
  if (!msg.imgPrompt) { pushMessage('system', '⚠️ 该图片没有提示词记录（旧消息），无法重新生成'); return; }
  const targetKey = activeConversationKey();
  addImagePending();
  try {
    const refChar = worldModeActive() ? (currentWorldSave.player?.snapshot || null) : currentChar();
    const refImage = refChar?.refImage || null;
    const src = await callImageAPI(ig, msg.imgPrompt, refImage);
    removeImagePending();
    if (activeConversationKey() !== targetKey) return;
    let local = src;
    try { local = await saveImageLocally(src); }
    catch (e) { console.warn('[Tavern] 图片本地保存失败，本轮仍显示:', e.message); }
    msg.content = local;
    msg.ts = Date.now();
    if (worldModeActive()) queueWorldSave(currentWorldSave); else saveSessions();
    renderMessages();
  } catch (err) {
    console.error('[Tavern] 重新生成失败:', err.message);
    removeImagePending();
    pushMessage('system', `⚠️ 重新生成失败：${err.message}`);
  }
}

/* 核心请求：用当前历史请求一次回复（发送消息 / 重新生成共用） */
function syncSendButton() {
  const button = $('btn-send');
  if (!button) return;
  const busy = sending;
  button.classList.toggle('is-loading', busy);
  button.setAttribute('aria-label', busy ? '停止生成' : '发送');
  button.title = busy ? '停止生成' : '发送';
  button.innerHTML = busy
    ? '<span class="send-spinner" aria-hidden="true"></span><span class="send-label">停止</span>'
    : '<span class="send-icon" aria-hidden="true">➤</span><span class="send-label">发送</span>';
  if (busy) button.disabled = false;
}

function stopGeneration() {
  if (!sending) return false;
  requestAbortRequested = true;
  activeRequestController?.abort();
  return true;
}

function openInputFullscreen() {
  const dialog = $('input-fullscreen-dialog');
  const fullInput = $('input-fullscreen');
  if (!dialog || !fullInput) return;
  fullInput.value = $('input')?.value || '';
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => fullInput.focus());
}

function closeInputFullscreen(send = false) {
  const dialog = $('input-fullscreen-dialog');
  const fullInput = $('input-fullscreen');
  const input = $('input');
  if (input && fullInput) input.value = fullInput.value;
  if (dialog?.open) dialog.close(send ? 'send' : 'cancel');
  input?.focus();
  if (send) void sendMessage();
}

async function requestReply() {
  if (sending) return;
  const targetScope = activeConversationScope();
  if (!targetScope) return;
  const targetKey = activeConversationKey();
  const targetWorldTurnEpoch = worldModeActive() ? worldTurnEpoch : null;
  const responseOutdated = () => activeConversationKey() !== targetKey || (targetWorldTurnEpoch !== null && worldTurnEpoch !== targetWorldTurnEpoch);
  const preserveRetryPreview = worldTurnPendingActive()
    && !!worldTurnPending.protocolRepairDraft
    && responsePreview?.targetKey === targetKey;
  if (!preserveRetryPreview) {
    clearResponsePreview();
    clearRpgCheckAnimation();
  }
  const requestController = new AbortController();
  activeRequestController = requestController;
  requestAbortRequested = false;
  sending = true;
  syncSendButton();
  if (!preserveRetryPreview) addTyping();
  let cot = '';
  let rpgAgentSession = null;
  let payload = null;
  let reply = '';
  let nativeCalls = [];
  let toolTrace = [];
  let rpgResolvedCheck = null;
  try {
    payload = buildPayload();
    beginDebugRequest(targetScope, payload, {
      label: mode === 'rpg' ? '玩家回合' : '玩家消息',
      commandId: worldTurnPendingActive() ? worldTurnPending.commandId : null,
      promptSections: (payload.promptSections || []).map(section => ({ id: section.id, source: section.source, chars: section.text.length })),
      agentProfile: payload.agentProfile || null,
      agentContext: payload.rpgContext || null,
    });
    // 请求 / 响应日志输出到浏览器控制台
    console.debug('[Tavern] → 请求', payload.baseUrl + '/chat/completions', {
      model: payload.body.model,
      stream: payload.body.stream,
      temperature: payload.body.temperature,
      max_tokens: payload.body.max_tokens,
      thinking: payload.body.thinking,
      messages: payload.body.messages,
    });
    if (mode === 'rpg') {
      const repairDraft = worldTurnPendingActive() ? String(worldTurnPending.protocolRepairDraft || '').trim() : '';
      if (repairDraft) {
        reply = repairDraft;
        rpgAgentSession = worldTurnPending.agentSession ? cloneValue(worldTurnPending.agentSession) : null;
        cot = String(rpgAgentSession?.cot || '');
        toolTrace = cloneValue(worldTurnPending.agentToolTrace || rpgAgentSession?.toolTrace || []);
        nativeCalls = rpgAgentCallsFromTrace(toolTrace);
        setDebugTrace(targetScope, { status: '从已完成检查点恢复，仅重试输出协议', output: reply, rawOutput: reply, error: '' });
      } else {
        const r = await requestRpgAgentReply(payload, targetScope);
        reply = r.reply;
        cot = r.cot;
        rpgAgentSession = r.session || rpgAgentRequestSessions.get(payload) || null;
        nativeCalls = r.nativeCalls || [];
        toolTrace = r.toolTrace || [];
      }
      rpgResolvedCheck = [...toolTrace].reverse().find(item => item?.name === 'dice.roll' && item.result?.resolution)?.result?.resolution || null;
      postWorldExtensionEvent('agent.complete', {
        commandId: worldTurnPending?.commandId || null,
        revision: currentWorldSave?.revision ?? null,
        calls: toolTrace.filter(item => item?.callId && item?.name).map(item => ({
          callId: item.callId,
          name: item.name,
          phase: item.phase || rpgAgentToolPhase(item.name),
          status: item.result?.ok === true ? 'passed' : 'rejected',
        })),
      });
    } else if (payload.body.stream) {
      const r = await callAPIStream(payload);
      reply = r.content;
      cot = r.cot;
    } else {
      const data = await callAPI(payload);
      reply = data?.choices?.[0]?.message?.content;
      cot = data?.choices?.[0]?.message?.reasoning_content || '';
    }
    if (!reply) {
      const msg = cot
        ? '模型只输出了思维链、未生成正文（可能被 max_tokens 截断，或模型选择不回答）'
        : '模型未返回内容（请检查模型名与 API 是否匹配；请求详情见浏览器控制台）';
      throw new Error(msg);
    }
    cot = applyRegexStage(cot, 'reasoning');
    setDebugTrace(targetScope, {
      status: '已完成',
      output: cot ? `${reply}\n\n[reasoning_content]\n${cot}` : String(reply),
      rawOutput: String(reply),
      outputTag: extractDebugOutputTag(reply),
      reasoning: cot || '',
      agentToolTrace: toolTrace,
      ...(rpgAgentSession ? { agentSessionId: rpgAgentSession.id, agentEvents: cloneValue(rpgAgentSession.events) } : {}),
    });
    // 请求期间可能切换角色 / 模式 / 会话；迟到响应不得写入新的当前会话。
    if (responseOutdated()) {
      setDebugTrace(targetScope, { status: '已完成（响应因切换存档/会话未写入历史）' });
      console.warn('[Tavern] 当前存档/会话已切换，已丢弃原范围的迟到响应');
      if (worldTurnPending && worldTurnPending.saveId === targetScope.id) discardWorldTurnPending();
      clearResponsePreview();
      removeTyping();
      return;
    }
    console.debug('[Tavern] ← 响应', reply);
    if (cot) console.debug('[Tavern] 🧠 思维链', cot);
    // 正文先从临时节点升级为可见预览；后续选项/协议/状态提交继续等待。
    setResponsePreview(mode === 'rpg' && rpgAgentSession?.previewNarrative ? rpgAgentSession.previewNarrative : reply, rpgResolvedCheck, targetKey, rpgAgentSession?.checkpoints);
    // RPG 模式：统一正则处理（```rpg``` 状态/掷骰），剔除 rpg 块
    let processed = processAIOutput(reply);
    if (mode !== 'rpg' && tavernReplyNeedsOptionRepair(processed, resolvePromptPreset()?.preset || null)) {
      const tavernPreset = resolvePromptPreset()?.preset || null;
      setDebugTrace(targetScope, { status: 'RP 输出缺少行动选项，正在修复', output: String(reply || ''), rawOutput: String(reply || '') });
      try {
        const repaired = await repairTavernReplyOptions(payload, reply, tavernPreset, targetScope);
        reply = mergeRepairedReply(reply, repaired.content, 'tavern');
        processed = processAIOutput(reply);
        if (repaired.cot) cot += (cot ? '\n\n' : '') + repaired.cot;
        setResponsePreview(reply, rpgResolvedCheck, targetKey, rpgAgentSession?.checkpoints);
      } catch (error) {
        console.warn('[Tavern] RP 选项协议修复失败:', error.message);
        setDebugTrace(targetScope, { status: 'RP 选项修复失败（保留原正文）', output: String(reply || ''), rawOutput: String(reply || ''), outputTag: extractDebugOutputTag(reply) });
      }
    }
    if (responseOutdated()) {
      setDebugTrace(targetScope, { status: '已完成（修复响应因切换存档/会话未写入历史）' });
      console.warn('[Tavern] 修复期间切换了存档/会话，已丢弃迟到响应');
      clearResponsePreview();
      return;
    }
    // 已通过执行器校验的原生工具候选先转换为内部协议；模型正文里的重复 patch 不能覆盖它。
    const nativeCandidate = mode === 'rpg' ? nativeCandidatesToRpgData(nativeCalls, currentWorldSave?.revision) : { patch: null, createEntities: null, eventMemory: null };
    if (nativeCandidate.patch) processed.patch = nativeCandidate.patch;
    if (!processed.createEntities && nativeCandidate.createEntities) processed.createEntities = nativeCandidate.createEntities;
    if (!processed.eventMemory && nativeCandidate.eventMemory) processed.eventMemory = nativeCandidate.eventMemory;
    if (worldTurnPendingActive()) {
      const recoveredActionPatch = recoverExplicitWorldActionPatch(processed.patch, worldTurnPending.actionIntent, currentWorldSave?.revision);
      if (recoveredActionPatch) {
        processed.patch = recoveredActionPatch.patch;
        setDebugTrace(targetScope, { status: '已接管卡内声明动作结算', error: '', actionIntentRecovery: recoveredActionPatch.reason });
      }
      const optionRules = worldOptionRules();
      let options = normalizeRpgOptions(processed.options, optionRules);
      processed.options = options.length ? options : null;
      let patchContractInvalid = processed.patch && (
          processed.patch.protocol !== 'tavern.rpg.turn'
          || Number(processed.patch.version) !== 1
          || Number(processed.patch.baseRevision) !== Number(currentWorldSave?.revision)
        );
      let patchShapeError = processed.patch ? (validateRpgPatchShape(processed.patch) || validateRpgPatchRuntimeActions(processed.patch)) : '';
      let unexpectedFinalCalls = Array.isArray(processed.agentCalls) && processed.agentCalls.length > 0;
      let outputContractInvalid = !!processed.protocol?.errorCode || patchContractInvalid || !!patchShapeError || unexpectedFinalCalls || options.length < optionRules.min || options.length > optionRules.max;
      if (outputContractInvalid) {
        const originalNarrativeReply = reply;
        const originalProcessed = processed;
        for (let attempt = 1; attempt <= RPG_PROTOCOL_REPAIR_ATTEMPTS && outputContractInvalid; attempt++) {
          setDebugTrace(targetScope, { status: `输出协议不合规，正在修复（${attempt}/${RPG_PROTOCOL_REPAIR_ATTEMPTS}）`, output: String(reply || ''), error: '' });
          try {
            const contractError = processed.protocol?.errorMessage
              || patchShapeError
              || (patchContractInvalid ? `baseRevision 必须等于 ${currentWorldSave?.revision}` : '')
              || (unexpectedFinalCalls ? '最终输出不得包含 toolCalls' : '')
              || ((options.length < optionRules.min || options.length > optionRules.max) ? `options 需要 ${optionRules.min}-${optionRules.max} 个非空字符串，实际 ${options.length} 个` : '');
            const repairedReply = await repairRpgOutput(payload, reply, optionRules, targetScope, toolTrace, contractError);
            reply = mergeRepairedReply(originalNarrativeReply, repairedReply, 'rpg');
            processed = preserveValidRpgRepairFields(originalProcessed, processAIOutput(reply), optionRules);
            setResponsePreview(rpgAgentSession?.previewNarrative || reply, rpgResolvedCheck, targetKey, rpgAgentSession?.checkpoints);
          } catch (error) {
            console.warn('[Tavern] RPG 协议修复失败:', error.message);
            setDebugTrace(targetScope, { status: `RPG 协议修复失败（第${attempt}次）`, error: String(error.message || '协议修复失败') });
            continue;
          }
          options = normalizeRpgOptions(processed.options, optionRules);
          processed.options = options.length ? options : null;
          patchContractInvalid = processed.patch && (
            processed.patch.protocol !== 'tavern.rpg.turn'
            || Number(processed.patch.version) !== 1
            || Number(processed.patch.baseRevision) !== Number(currentWorldSave?.revision)
          );
          patchShapeError = processed.patch ? (validateRpgPatchShape(processed.patch) || validateRpgPatchRuntimeActions(processed.patch)) : '';
          unexpectedFinalCalls = Array.isArray(processed.agentCalls) && processed.agentCalls.length > 0;
          outputContractInvalid = !!processed.protocol?.errorCode || patchContractInvalid || !!patchShapeError || unexpectedFinalCalls || options.length < optionRules.min || options.length > optionRules.max;
          if (!outputContractInvalid) setDebugTrace(targetScope, { status: `协议自动修复成功（第${attempt}次）`, error: '' });
        }
        // 只在正文、标签和 patch 都完整时复用上一回合的合法选项；不伪造世界状态。
        if (outputContractInvalid && !processed.protocol?.errorCode && !patchContractInvalid && !patchShapeError && !unexpectedFinalCalls) {
          const fallbackOptions = previousWorldTurnOptions();
          if (fallbackOptions.length >= optionRules.min && fallbackOptions.length <= optionRules.max) {
            processed.options = options = fallbackOptions;
            outputContractInvalid = false;
            setDebugTrace(targetScope, { status: '选项协议已使用上一回合合法选项兜底', output: String(reply || '') });
          }
        }
        if (outputContractInvalid) {
          const finalContractError = processed.protocol?.errorMessage
            || patchShapeError
            || (patchContractInvalid ? `baseRevision 必须等于 ${currentWorldSave?.revision}` : '')
            || (unexpectedFinalCalls ? '最终输出仍包含 toolCalls' : '')
            || `options 需要 ${optionRules.min}-${optionRules.max} 个非空字符串`;
          throw new Error(`RPG 输出协议仍不完整：${finalContractError}`);
        }
      }
    }
    const clean = processed.content;
    const extra = {
      outputRegexApplied: true,
      ...(typeof processed.rawContent === 'string' ? { rawContent: processed.rawContent } : {}),
      ...(mode === 'tavern' ? { cardOutputRegexApplied: true } : {}),
    };
    if (cot) extra.cot = cot;
    if (processed.options && processed.options.length) extra.options = processed.options;
    if (mode === 'rpg' && rpgResolvedCheck) extra.checkResolution = cloneValue(rpgResolvedCheck);
    if (mode === 'rpg' && rpgAgentSession?.checkpoints?.length) extra.checkpoints = serializeRpgCheckpoints(rpgAgentSession.checkpoints);
    if (responseOutdated()) {
      setDebugTrace(targetScope, { status: '已完成（当前回合已重置，迟到响应未写入历史）' });
      clearResponsePreview();
      removeTyping();
      return;
    }
    if (worldTurnPendingActive()) {
      const agentToolRolls = toolTrace.filter(item => item.name === 'dice.roll' && Array.isArray(item.result?.rolls)).flatMap(item => item.result.rolls);
      // 原生与兼容 Agent 都只有在工具循环内完成客户端掷骰并回传结果后，
      // 才把骰子记录写入待提交回合；这里不再对 toolCalls 事后补掷。
      const toolRolls = agentToolRolls;
      if (toolRolls.length) worldTurnPending.actionIntent.dice = [...(worldTurnPending.actionIntent.dice || []), ...toolRolls];
      // 世界回合的 assistant 正文先留在临时槽；只有服务端原子提交成功后才进入正式历史。
      // 预览继续显示，避免“正文先出现、提交阶段又消失”。
      worldTurnPending.assistantMessage = { id: uid(), role: 'assistant', content: clean, ts: Date.now(), ...extra };
      worldTurnPending.agentSession = rpgAgentSession ? cloneValue(rpgAgentSession) : null;
      renderMessages();
      const optionRules = worldOptionRules();
      const options = Array.isArray(processed.options) ? processed.options : [];
      if (options.length < optionRules.min || options.length > optionRules.max) throw new Error(`RPG 回合需要 ${optionRules.min}-${optionRules.max} 个行动选项，当前候选未提交`);
      worldTurnPending.options = options;
      worldTurnPending.createEntities = processed.createEntities;
      worldTurnPending.eventMemory = processed.eventMemory;
      worldTurnPending.agentToolTrace = normalizeRpgAgentCommitTrace(toolTrace);
      worldTurnPending.agentCalls = rpgAgentCallsFromTrace(worldTurnPending.agentToolTrace);
      worldTurnPending.protocolRepairDraft = null;
      worldTurnPending.patch = processed.patch ? normalizeRpgPatch(processed.patch, options) : null;
      worldTurnPending.state = processed.patch ? worldTurnPending.beforeState : serializeWorldState(currentWorldSave);
      if (worldTurnPending.patch) {
        worldTurnPending.agentPhase = 'execute';
        const history = buildRpgAgentPhaseHistory(worldTurnPending.agentToolTrace, 'execute');
        worldTurnPending.agentPhaseHistory = [...history, { phase: 'narrate', status: 'pending', order: history.length + 1 }];
      }
      await submitWorldTurn(worldTurnPending);
    } else {
      // 请求期间先显示的是临时预览；正式消息入库前必须移除它，
      // 否则正文会同时渲染“预览 + 历史”，快捷选项也会一直被“整理中”占位遮住。
      clearResponsePreview();
      pushMessage('assistant', clean, extra);
      void maybeRollTavernMemory(curSession());
    }
    // 文生图（测试）：回复完成后自动生图（异步，不阻塞对话）
    const ig = settings.imageGen;
    if (ig && ig.enabled && ig.auto && ig.baseUrl) {
      generateImageFor(clean).catch(e => console.error('[Tavern] 文生图失败', e.message));
    }
    return true;
  } catch (err) {
    const stopped = requestAbortRequested || err?.name === 'AbortError';
    if (stopped) {
      removeTyping();
      clearResponsePreview();
      clearRpgCheckAnimation();
      if (mode === 'rpg' && worldTurnPendingActive()) failWorldTurnPending('已停止生成');
      setDebugTrace(targetScope, { status: '已停止生成', error: '' });
      setApiStatus('已停止生成');
      return false;
    }
    console.error('[Tavern] ✗ 请求失败', err.message);
    rpgAgentSession = rpgAgentSession || (payload ? rpgAgentRequestSessions.get(payload) : null) || null;
    if (mode === 'rpg' && worldTurnPendingActive()) {
      const draft = String(reply || rpgAgentSession?.previewNarrative || '').trim();
      const trace = toolTrace.length ? toolTrace : (rpgAgentSession?.toolTrace || []);
      if (draft) {
        worldTurnPending.protocolRepairDraft = draft;
        worldTurnPending.agentSession = rpgAgentSession ? cloneValue(rpgAgentSession) : null;
        worldTurnPending.agentToolTrace = normalizeRpgAgentCommitTrace(trace);
        worldTurnPending.agentCalls = rpgAgentCallsFromTrace(worldTurnPending.agentToolTrace);
      }
    }
    if (worldModeActive()) postWorldExtensionEvent('turn.error', { commandId: worldTurnPending?.commandId || null, message: String(err.message || '请求失败').slice(0, 240) });
    if (rpgAgentSession) {
      rpgAgentSession.status = 'error';
      appendRpgAgentEvent(rpgAgentSession, 'turn.error', { message: String(err.message || '请求失败').slice(0, 240) });
      syncRpgAgentDebug(rpgAgentSession, targetScope, 'Agent 失败');
    }
    removeTyping();
    const keptWorldTurn = failWorldTurnPending(err.message);
    if (!keptWorldTurn) {
      clearResponsePreview();
      clearRpgCheckAnimation();
    }
    const autoRetrying = keptWorldTurn && worldTurnError?.autoRetry === true;
    setDebugTrace(targetScope, { status: autoRetrying ? '失败，正在自动重试' : '失败', error: String(err.message || '请求失败') });
    if (!responseOutdated() && !keptWorldTurn) pushMessage('system', `⚠️ 请求失败：${err.message}`);
    setApiStatus(`最近一次请求失败：${err.message}`, true);
    return false;
  } finally {
    sending = false;
    if (activeRequestController === requestController) activeRequestController = null;
    syncSendButton();
    $('btn-send').disabled = mode === 'rpg' && worldSavePlanning();
    const input = $('input');
    if (input) input.focus();
  }
}

async function submitWorldActionText(text, { throwOnError = false, kind = 'text', source = 'input', optionId = null, actionId = null, input = null } = {}) {
  if (sending || worldTurnPreparing || worldTurnPending || !worldModeActive()) {
    const message = !worldModeActive() ? '当前没有打开的世界存档' : '当前回合仍在处理中';
    if (throwOnError) throw new Error(message);
    return false;
  }
  if (worldSavePlanning() || currentWorldSave?.state?.ending?.status === 'ended' || currentWorldSave?.state?.failure?.status === 'terminal') {
    const message = worldSavePlanning() ? '当前存档仍在开局规划' : '当前世界线已经终止';
    if (throwOnError) throw new Error(message);
    return false;
  }
  const value = applyRegexStage(String(text || '').trim(), 'user_input');
  if (!value) {
    if (throwOnError) throw new Error('行动不能为空');
    return false;
  }
  const matchedAction = !actionId && kind === 'text' && source === 'input'
    ? matchExactWorldRuntimeAction(value)
    : null;
  const resolvedActionId = actionId || matchedAction?.id || null;
  const resolvedKind = resolvedActionId ? 'action' : kind;
  worldTurnPreparing = true;
  try {
    await worldSaveWriteChain.catch(() => {});
    if (!worldModeActive()) throw new Error('世界存档已切换');
    hideWorldStateFeedback();
    worldTurnEpoch++;
    worldTurnPending = {
      commandId: uid(),
      saveId: currentWorldSave.id,
      expectedRevision: currentWorldSave.revision,
      beforeState: cloneValue(serializeWorldState(currentWorldSave)),
      state: serializeWorldState(currentWorldSave),
      messages: [{ id: uid(), role: 'user', content: value, ts: Date.now() }],
      assistantMessage: null,
      agentSession: null,
      actionIntent: buildRpgTurnIntent(value, { kind: resolvedKind, source, optionId, actionId: resolvedActionId, input }),
      options: null,
      createEntities: null,
      eventMemory: null,
      agentCalls: null,
      agentToolTrace: null,
      patch: null,
      agentPhase: null,
      agentPhaseHistory: [],
      agentOrchestration: null,
      agentExecution: null,
      autoRetryCount: 0,
      protocolRepairDraft: null,
    };
    postWorldExtensionEvent('turn.start', { commandId: worldTurnPending.commandId, revision: worldTurnPending.expectedRevision });
    renderMessages();
    // RPG 判定由 Agent 先调用 rules.check 决定是否需要，再由 dice.roll 触发客户端随机。
    // 不在发送前扫描玩家文本，避免普通叙事中的 d20/d6 被误当成掷骰。
    const committed = await requestReply();
    if (committed) return true;
    const message = worldTurnError?.message || '本回合未提交';
    if (throwOnError) throw new Error(message);
    return false;
  } catch (err) {
    if (!worldTurnErrorActive()) failWorldTurnPending(err.message);
    setApiStatus(`最近一次请求失败：${err.message}`, true);
    if (throwOnError) throw err;
    return false;
  } finally {
    worldTurnPreparing = false;
  }
}

async function sendMessage() {
  if (sending || worldTurnPreparing || worldTurnPending || (worldModeActive() && (worldSavePlanning() || currentWorldSave?.state?.ending?.status === 'ended' || currentWorldSave?.state?.failure?.status === 'terminal'))) return;
  if (mode === 'rpg' && !worldModeActive()) { openWorldLibrary(); return; }
  const input = $('input');
  const rawText = input.value.trim();
  if (!rawText) return;
  input.value = '';
  if (worldModeActive()) {
    await submitWorldActionText(rawText);
    return;
  }
  const text = applyRegexStage(rawText, 'user_input');
  if (!text) return;
  pushMessage('user', text);
  // 掷骰：玩家输入含 d20+5 / 2d6-1 → 自动掷骰并显示结果（不进 AI 上下文）
  const rolls = rollDiceIn(text);
  for (const r of rolls) {
    const detail = r.rolls.length > 1 ? `（${r.rolls.join(' + ')}${r.bonus ? (r.bonus >= 0 ? ' + ' + r.bonus : ' - ' + Math.abs(r.bonus)) : ''}）` : (r.bonus ? `（+${r.bonus}）` : '');
    // 掷骰结果以 meta 用户消息注入：居中显示 + 进入 AI 上下文（AI 能基于结果推进）
    pushMessage('user', `🎲 ${r.expr} = ${r.total} ${detail}`, { meta: true });
  }
  await requestReply();
}

/* ─────────── 视图切换 ─────────── */
const VIEW_PLACEHOLDER = {};

function syncModeNavigation(view = 'chat') {
  syncConversationResetButton();
  const visibleButtons = [...document.querySelectorAll('.nav-item[data-view]')].filter(button => {
    const group = button.closest('[data-mode-nav]');
    return !group || group.dataset.modeNav === mode;
  });
  const activeView = visibleButtons.some(button => button.dataset.view === view) ? view : 'chat';
  document.body.dataset.uiView = activeView;
  const main = document.querySelector('.main');
  if (main) main.dataset.uiView = activeView;
  document.querySelectorAll('.nav-item[data-view]').forEach(button => {
    const group = button.closest('[data-mode-nav]');
    const visible = !group || group.dataset.modeNav === mode;
    const active = visible && button.dataset.view === activeView;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

// 手机端管理页采用“列表 → 详情”钻取；桌面端继续保留双栏编辑器。
const MOBILE_MANAGER_IDS = ['char-mgr', 'prompt-mgr', 'regex-mgr', 'lore-mgr', 'memory-mgr', 'world-mgr'];
function isMobileViewport() { return window.matchMedia('(max-width: 960px)').matches; }
function syncMobileManagerBackLabel(managerId) {
  const manager = $(managerId);
  if (!manager) return;
  const backs = [...manager.querySelectorAll('[data-manager-back]')];
  if (!backs.length) return;
  const detail = manager.dataset.mobilePanel === 'detail';
  if (managerId === 'world-mgr') {
    const label = isMobileViewport() && detail ? '‹ 返回世界库' : '返回工作台';
    backs.forEach(back => {
      back.textContent = label;
      back.setAttribute('aria-label', label);
    });
    return;
  }
  const nestedParent = managerId === 'prompt-mgr' && manager.dataset.mobilePromptPanel === 'entry'
    ? '提示词顺序'
    : managerId === 'lore-mgr' && manager.dataset.mobileLorePanel === 'entry'
      ? '世界书条目' : (backs[0].dataset.parentLabel || '列表');
  const label = isMobileViewport() && detail ? `‹ 返回${nestedParent}` : '回到对话';
  backs.forEach(back => {
    back.textContent = label;
    back.setAttribute('aria-label', isMobileViewport() && detail ? `返回${nestedParent}` : '回到对话');
  });
}
function setMobileManagerPanel(managerId, panel = 'list', options = {}) {
  const manager = $(managerId);
  if (!manager || !MOBILE_MANAGER_IDS.includes(managerId)) return;
  const detail = panel === 'detail';
  manager.dataset.mobilePanel = detail ? 'detail' : 'list';
  manager.querySelector('.cm-side')?.setAttribute('aria-hidden', detail ? 'true' : 'false');
  manager.querySelector('.cm-edit')?.setAttribute('aria-hidden', detail ? 'false' : 'true');
  syncMobileManagerBackLabel(managerId);
  const back = manager.querySelector('.cm-edit-head [data-manager-back]') || manager.querySelector('[data-manager-back]');
  if (isMobileViewport() && detail && options.focus !== false) {
    requestAnimationFrame(() => back?.focus());
  }
}

function handleManagerBack(button) {
  const manager = button.closest('.char-mgr');
  if (manager && isMobileViewport() && manager.dataset.mobilePanel === 'detail') {
    if (manager.id === 'prompt-mgr' && manager.dataset.mobilePromptPanel === 'entry') {
      setMobilePromptPanel('sequence');
      requestAnimationFrame(() => manager.querySelector('.pg-prompt-row')?.focus());
      return;
    }
    if (manager.id === 'lore-mgr' && manager.dataset.mobileLorePanel === 'entry') {
      setMobileLorePanel('book');
      requestAnimationFrame(() => manager.querySelector('#wi-list .wi-item')?.focus());
      return;
    }
    setMobileManagerPanel(manager.id, 'list', { focus: false });
    requestAnimationFrame(() => manager.querySelector('.cm-side :is(.cm-item, button, input, select, textarea)')?.focus());
    return;
  }
  switchView('chat');
}

function setMobilePromptPanel(panel = 'sequence') {
  const manager = $('prompt-mgr');
  if (manager) {
    manager.dataset.mobilePromptPanel = panel === 'entry' ? 'entry' : 'sequence';
    syncMobileManagerBackLabel('prompt-mgr');
  }
}

function setMobileLorePanel(panel = 'book') {
  const manager = $('lore-mgr');
  if (manager) {
    manager.dataset.mobileLorePanel = panel === 'entry' ? 'entry' : 'book';
    syncMobileManagerBackLabel('lore-mgr');
  }
}
function openMobileMemoryEntries() {
  setMobileManagerPanel('memory-mgr', 'detail');
}

function buildWorldSetupPromptPart() {
  if (!worldModeActive()) return '';
  const save = currentWorldSave;
  const setup = save.setup || {};
  const world = currentWorldCard() || {};
  const game = setup.game && typeof setup.game === 'object' ? setup.game : {};
  const sessionFields = Array.isArray(world.sessionSetup?.fields) ? world.sessionSetup.fields : [];
  const gameText = sessionFields.map(field => `${field.label || field.id}=${game[field.id] ?? field.default ?? '未设置'}`).join('；');
  const plan = setup.plan && typeof setup.plan === 'object' ? setup.plan : null;
  const planText = plan ? JSON.stringify(plan) : '尚未提交开局规划';
  const hooks = Array.isArray(save.state?.activeHooks) ? save.state.activeHooks.filter(hook => hook && hook.status !== 'done' && hook.status !== 'failed') : [];
  const hookText = hooks.length ? hooks.map(hook => `${hook.title || hook.id}${hook.description ? `：${hook.description}` : ''}${hook.optional ? '（可选）' : ''}`).join('；') : '无';
  return `【本局游戏配置】
本局绑定 WorldCard ${world.id || save.worldId}@v${world.version || save.worldVersion}；Worldbook=${Array.isArray(world.lorebookIds) && world.lorebookIds.length ? world.lorebookIds.join(',') : 'default'}；RPG Preset=${world.rpgPresetName || '当前默认预设'}。
存档专属规则：${gameText || '世界卡未声明额外动态规则，遵循 WorldCard 已有 time / turnContract / failure / ending 规则。'}
开局配置（只读事实来源）：${planText}
当前开放 Hook（可选叙事抓手，不是强制主线）：${hookText}
Hook 状态只能通过唯一状态块的 objective.status(kind=hooks) 更新，不能凭正文宣称完成。`;
}

function buildWorldKnowledgePromptPart() {
  if (!worldModeActive()) return '';
  const state = currentWorldSave?.state || {};
  const info = state.knownInformation && typeof state.knownInformation === 'object' ? state.knownInformation : {};
  const lines = [
    ['World Truth（叙事者可见，玩家不自动知道）', info.worldTruth],
    ['Character Knowledge（玩家角色已知）', info.characterKnowledge],
    ['Player-visible Information（可直接作为玩家可见内容）', info.playerVisible],
    ['Hidden Information（仅叙事者内部使用，禁止直接泄露）', info.hidden],
    ['Rumor / Unconfirmed（必须明确是不确定传闻）', info.rumors],
  ].filter(([, values]) => Array.isArray(values) && values.length).map(([label, values]) => `${label}：\n${values.map(value => `- ${value}`).join('\n')}`);
  return lines.length ? `【开局知识权限】\n${lines.join('\n')}` : '';
}

function switchView(name) {
  closeNavDrawer(); // 手机抽屉：切换视图后自动收起
  renderDebugTerminal();
  syncModeNavigation(name);
  ['char-mgr', 'prompt-mgr', 'regex-mgr', 'lore-mgr', 'memory-mgr', 'world-mgr'].forEach(id => { const el = $(id); if (el) el.classList.add('hidden'); });
  if (name === 'worlds') { openWorldLibrary(false); return; }
  if (name === 'chat') {
    if (mode === 'rpg') {
      if (worldModeActive()) enterWorldWorkspace();
      else if (currentWorldSaveId) openWorldLibrary(true);
      else openWorldLibrary(false);
    }
    return;
  }
  if (name === 'chars') {
    if (mode === 'rpg') { openWorldLibrary(false); return; }
    renderBindSelects();
    $('char-mgr').classList.remove('hidden');
    renderCharList();
    if (!cmEditingId && !cmCreating && characters.length) selectCharForEdit(currentCharId || characters[0].id);
    setMobileManagerPanel('char-mgr', 'list', { focus: false });
    return;
  }
  if (name === 'prompts') {
    $('prompt-mgr').classList.remove('hidden');
    const editingPreset = promptPresets[pgEditingName];
    if (!editingPreset || !['both', mode].includes(presetMode(pgEditingName, editingPreset))) selectPresetForEdit(activePresetNameForMode(mode) || GLOBAL_PRESET_KEY);
    else renderPGList();
    setMobilePromptPanel('sequence');
    setMobileManagerPanel('prompt-mgr', 'list', { focus: false });
    return;
  }
  if (name === 'regex') {
    $('regex-mgr').classList.remove('hidden');
    renderRegexList();
    const selected = selectedOutputRegex();
    if (selected) renderRegexEditor(selected, regexEditingSource);
    else resetRegexEditor();
    setMobileManagerPanel('regex-mgr', 'list', { focus: false });
    return;
  }
  if (name === 'lore') {
    $('lore-mgr').classList.remove('hidden');
    if (!lbEditingId) lbEditingId = Object.keys(lorebooks)[0] || null;
    fillLorebookSettings();
    renderLBList();
    renderWIList();
    setMobileLorePanel('book');
    setMobileManagerPanel('lore-mgr', 'list', { focus: false });
    return;
  }
  if (name === 'memory') {
    $('memory-mgr').classList.remove('hidden');
    ensureUserData();
    fillUserForm();
    fillTavernAutoMemoryForm();
    renderMemList();
    setMobileManagerPanel('memory-mgr', 'list', { focus: false });
    return;
  }
}

/* ─────────── 主题 / 布局 ─────────── */
let bgRaf = null;
function initBackground() {
  if (bgRaf) cancelAnimationFrame(bgRaf);
  bgRaf = null;
}

function applyTheme() {
  theme = FIXED_THEME;
  document.body.dataset.theme = theme;
  localStorage.setItem(LS_THEME, theme);
  applyUiTheme();
  initBackground();
}

function applyLayout() {
  document.body.dataset.layout = 'classic';
}

/* 模式：酒馆 / RPG（body[data-mode] 控制布局与渲染分支） */
function applyMode(name) {
  if (worldTurnPending) discardWorldTurnPending();
  setRpgMobileDrawer('');
  closeNavDrawer();
  mode = (name === 'rpg') ? 'rpg' : 'tavern';
  document.body.dataset.mode = mode;
  localStorage.setItem(LS_MODE, mode);
  document.querySelectorAll('.js-mode-switch').forEach(btn => {
    btn.querySelector('.icon').textContent = mode === 'rpg' ? '⚔' : '🍺';
    btn.querySelector('.mode-switch-label').textContent = mode === 'rpg' ? '模式：RPG' : '模式：酒馆';
  });
  syncModeNavigation('chat');
  if (mode === 'tavern') activateSessionScope();
  // 酒馆使用角色会话；RPG 只使用 WorldCard → WorldSave，不创建/激活普通角色会话。
  renderSessions();
  renderMessages();
  if (mode === 'rpg') {
    ['char-mgr', 'prompt-mgr', 'regex-mgr', 'lore-mgr', 'memory-mgr'].forEach(id => $(id)?.classList.add('hidden'));
    openWorldLibrary(true);
  }
  else { exitWorldImmersiveMode(); closeWorldLibrary(); renderCharacter(); }
}

function switchMode() {
  const next = mode === 'rpg' ? 'tavern' : 'rpg';
  // 每种模式记住自己的预设；首次进入时使用对应示例。
  const defaultPreset = next === 'rpg' ? 'RPG 叙事引擎（示例）' : 'RP 基础（示例）';
  prefs.currentPresetByMode = { ...(prefs.currentPresetByMode || {}) };
  const hasSavedPreset = Object.prototype.hasOwnProperty.call(prefs.currentPresetByMode, next);
  const savedPreset = prefs.currentPresetByMode[next];
  if (!hasSavedPreset || (savedPreset && !promptPresets[savedPreset])) prefs.currentPresetByMode[next] = promptPresets[defaultPreset] ? defaultPreset : '';
  prefs.currentPreset = prefs.currentPresetByMode[next] || '';
  saveJSON(LS_PREFS, prefs);
  applyMode(next);
  renderSessions();
  renderMessages();
  renderQuickActions(); // 快捷行动预设随模式切换
  renderPGList(); // 提示词页「当前预设」高亮/下拉刷新
  renderBindSelects(); // 角色绑定预设下拉刷新
}

/* ─────────── 手机导航抽屉 ─────────── */
const NAVIGATION_DESKTOP_QUERY = '(min-width: 961px)';
function usesDesktopNavigation() {
  if (typeof window.matchMedia === 'function') return window.matchMedia(NAVIGATION_DESKTOP_QUERY).matches;
  return window.innerWidth >= 961;
}
function setNavDrawerOpen(open) {
  const drawer = $('nav-drawer');
  if (drawer) drawer.classList.toggle('open', Boolean(open));
  const trigger = $('btn-nav-drawer');
  if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
}
function openNavDrawer() { setNavDrawerOpen(true); }
function closeNavDrawer() { setNavDrawerOpen(false); }

/* ─────────── AI 生成（角色卡 / 世界书条目） ─────────── */
/* 调用对话 API 生成，返回解析后的对象 */
async function aiGenerate(instruction, desc) {
  if (!settings.baseUrl) throw new Error('请先配置 API（设置 → 连接）');
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      body: {
        model: settings.model || 'default',
        messages: [
          { role: 'system', content: instruction },
          { role: 'user', content: desc },
        ],
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        top_p: settings.topP,
        frequency_penalty: settings.frequencyPenalty,
        presence_penalty: settings.presencePenalty,
        ...(settings.seed != null && settings.seed >= 0 ? { seed: settings.seed } : {}),
        stream: false,
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.choices || !data.choices[0]) {
    throw new Error('生成失败：' + ((data.error && data.error.message) || ('HTTP ' + res.status)));
  }
  const choice = data.choices[0];
  const content = choice.message && choice.message.content;
  if (!content || choice.finish_reason === 'length') {
    throw new Error('AI 输出被截断：请在设置中提高最大 Token，或关闭模型思维链。');
  }
  return parseLLMJson(content);
}

/* 容错解析 LLM 输出的 JSON（容忍 ```json 围栏 / 前后杂文） */
function parseLLMJson(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

/* 第一步 → 第二步：一句话生成由 JSON 定义的基本信息表 */
async function aiGenChar() {
  const desc = $('cm-ai-desc').value.trim();
  if (!desc) { alert('先描述你想要的角色，例如：傲娇的猫娘旅店老板娘'); return; }
  const gen = genSettings || {};
  if (!gen.charBasicPrompt || !charFieldDefs().length) { alert('未配置角色基本信息字段或生成指令'); return; }
  const btn = $('btn-ai-char');
  btn.disabled = true; btn.textContent = '填写中…';
  $('cm-ai-status').textContent = 'AI 正在填写基本信息…';
  try {
    const schema = charFieldDefs().map(({ key, label }) => ({ key, label }));
    const instruction = gen.charBasicPrompt + '\n字段定义：' + JSON.stringify(schema);
    const obj = await aiGenerate(instruction, desc);
    const fields = obj && obj.fields && typeof obj.fields === 'object' ? obj.fields : obj;
    renderCharProfileFields(characters.find(c => c.id === cmEditingId) || null, fields);
    syncProfileFieldsToForm();
    setCharWizardStep(2);
    $('cm-ai-status').textContent = '基本信息已填写，可直接修改或添加自定义条目。';
  } catch (err) {
    console.error('[Tavern] AI 生成角色卡失败:', err.message);
    alert('❌ ' + err.message);
    $('cm-ai-status').textContent = '基本信息生成失败，请检查 API 设置后重试。';
  } finally {
    btn.disabled = false; btn.textContent = 'AI 填写基本信息';
  }
}

/* 第二步 → 第三步：基于用户确认的信息生成完整 JSON 角色卡 */
async function aiGenFullChar() {
  const gen = genSettings || {};
  if (!gen.charFullPrompt) { alert('未配置完整角色卡生成指令'); return; }
  const profileFields = collectCharProfileFields();
  if (!profileFields.length) { alert('请先填写至少一项基本信息'); return; }
  const btn = $('btn-ai-char-full');
  btn.disabled = true; btn.textContent = '生成中…';
  $('cm-ai-status').textContent = 'AI 正在完善完整角色卡…';
  try {
    const obj = await aiGenerate(gen.charFullPrompt, JSON.stringify({ summary: $('cm-ai-desc').value.trim(), profileFields }));
    const confirmed = Object.fromEntries(profileFields.map(field => [field.key, field.value]));
    const bindings = {
      name: 'cm-name', race: 'cm-race', role: 'cm-role', persona: 'cm-persona',
      description: 'cm-persona', personality: 'cm-personality',
      scenario: 'cm-scenario', firstMes: 'cm-first-mes', systemPrompt: 'cm-system',
      mesExample: 'cm-mes-example', postHistory: 'cm-post', creatorNotes: 'cm-creator-notes',
      creator: 'cm-creator', characterVersion: 'cm-character-version', tags: 'cm-tags',
    };
    for (const [key, id] of Object.entries(bindings)) {
      const value = Object.prototype.hasOwnProperty.call(confirmed, key) ? confirmed[key] : obj[key];
      if (typeof value === 'string') $(id).value = value;
    }
    if (Array.isArray(obj.alternateGreetings)) $('cm-alt-greetings').value = obj.alternateGreetings.join('\n\n');
    if (cmCreating) renderCharList();
    setCharWizardStep(3);
    $('cm-ai-status').textContent = '完整角色卡已生成，基本信息条目会随角色一起保存。';
  } catch (err) {
    console.error('[Tavern] AI 完整角色卡生成失败:', err.message);
    alert('❌ ' + err.message);
    $('cm-ai-status').textContent = '完整角色卡生成失败，已保留当前基本信息。';
  } finally {
    btn.disabled = false; btn.textContent = 'AI 完善并生成完整角色卡';
  }
}

/* 生成世界书条目 → 填入条目编辑器（用户确认后保存） */
async function aiGenWI() {
  const desc = $('wi-ai-desc').value.trim();
  if (!desc) { alert('先描述要生成的设定，例如：北方沉睡古龙的龙之谷'); return; }
  const gen = genSettings || {};
  if (!gen.lorePrompt) { alert('未配置生成指令（_defaults.json → gen.lorePrompt）'); return; }
  const btn = $('btn-ai-wi');
  btn.disabled = true; btn.textContent = '生成中…';
  try {
    const obj = await aiGenerate(gen.lorePrompt, desc);
    $('wi-title').value = obj.title || '';
    $('wi-keys').value = obj.keys || '';
    $('wi-content').value = obj.content || '';
    $('wi-order').value = 100;
    $('wi-constant').checked = !!obj.constant;
    alert('✅ 已生成并填入 —— 检查后点「保存条目」');
  } catch (err) {
    console.error('[Tavern] AI 生成世界书失败:', err.message);
    alert('❌ ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = '✨ 生成';
  }
}

/* ─────────── RPG 手动管理（背包 / 任务 / 快捷行动） ─────────── */

function addRpgItem() {
  const rs = curRpgState();
  if (!rs) { alert('当前不是 RPG 会话'); return; }
  const name = (prompt('道具名称：') || '').trim();
  if (!name) return;
  const n = parseInt(prompt('数量（默认 1）：', '1'), 10);
  const count = isNaN(n) ? 1 : n;
  const desc = (prompt('描述（可留空）：') || '').trim();
  const exist = rs.inventory.find(i => i.name === name);
  if (exist) exist.count += count;
  else rs.inventory.push({ name, count, desc });
  commitRpgState(rs); renderRPG();
}

function addRpgQuest() {
  const rs = curRpgState();
  if (!rs) { alert('当前不是 RPG 会话'); return; }
  const title = (prompt('任务标题：') || '').trim();
  if (!title) return;
  const desc = (prompt('任务内容（可留空）：') || '').trim();
  rs.quests.push({ id: uid(), title, desc, status: 'active' });
  commitRpgState(rs); renderRPG();
}

function toggleRpgQuest(idx) {
  const rs = curRpgState();
  if (!rs || !rs.quests[idx]) return;
  rs.quests[idx].status = rs.quests[idx].status === 'done' ? 'active' : 'done';
  commitRpgState(rs); renderRPG();
}

function removeRpgItem(idx) {
  const rs = curRpgState();
  if (!rs) return;
  rs.inventory.splice(idx, 1);
  commitRpgState(rs); renderRPG();
}

function removeRpgQuest(idx) {
  const rs = curRpgState();
  if (!rs) return;
  rs.quests.splice(idx, 1);
  commitRpgState(rs); renderRPG();
}

/* ═══════════ 世界地图兼容层（世界卡数据 + 上下文注入；运行时 UI 暂隐藏） ═══════════ */
/* 世界模式地图归属 WorldSave.state.map；旧 RPG 兼容路径仍读 session.rpgState。 */

function currentWorldMapState() {
  if (!worldModeActive()) return null;
  const state = currentWorldSave.state || (currentWorldSave.state = {});
  state.map = state.map && typeof state.map === 'object' ? state.map : { strategy: 'worldCard', data: null, imagePath: null, markers: [] };
  return state.map;
}
function curMapImage() {
  const mapState = currentWorldMapState();
  return mapState ? mapState.imagePath : (curRpgState()?.mapImage || null);
}
function setCurMapImage(value) {
  const mapState = currentWorldMapState();
  if (mapState) mapState.imagePath = value || null;
  else {
    const rs = curRpgState();
    if (rs) rs.mapImage = value || null;
  }
}

function curMapData() {
  const worldMap = currentWorldMapState();
  if (worldMap) {
    if (worldMap.data && !(worldMap.data.grid instanceof Uint16Array) && window.MapGen?.hydrateMap) worldMap.data = window.MapGen.hydrateMap(worldMap.data);
    return worldMap.data || null;
  }
  const rs = curRpgState();
  if (!rs) return null;
  return rs.mapData || null;
}

/* 渲染：小预览（缩略） + 地图窗口（若打开，高清） */
function renderMap() {
  const canvas = $('map-canvas');
  if (!canvas || !window.MapGen) return;
  const rs = curRpgState();
  const map = curMapData();
  if (!map) return;
  if (curMapImage()) {
    canvas.style.display = 'none';
    $('map-beauty').hidden = false;
    $('map-beauty-img').src = curMapImage();
  } else {
    $('map-beauty').hidden = true;
    canvas.style.display = 'block';
    window.MapGen.renderWorldMap(canvas, map, { pixelSize: 6 });
  }
  renderMapModal();
}

let mmShowOriginal = false; // 地图窗口：true = 显示美化前的算法原图，false = 显示 AI 美化图

/* 地图窗口渲染（打开时刷新窗口内画布 / 美化图） */
function renderMapModal() {
  const modal = $('map-modal');
  if (!modal || modal.classList.contains('hidden')) return;
  const canvas = $('mm-canvas');
  if (!canvas || !window.MapGen) return;
  const rs = curRpgState();
  const map = curMapData();
  if (!map) return;
  const toggle = $('mm-toggle');
  const mapImage = curMapImage();
  const hasImage = !!mapImage;
  if (toggle) toggle.style.display = hasImage ? '' : 'none'; // 无美化图时切换按钮隐藏
  const showOriginal = !hasImage || mmShowOriginal;
  if (!showOriginal) {
    canvas.style.display = 'none';
    $('mm-beauty').hidden = false;
    $('mm-beauty-img').src = mapImage;
    if (toggle) toggle.textContent = '🖼 原始底图';
  } else {
    $('mm-beauty').hidden = true;
    canvas.style.display = 'block';
    window.MapGen.renderWorldMap(canvas, map, { pixelSize: 12 }); // 窗口内高清
    if (toggle) toggle.textContent = hasImage ? '✨ 美化图' : '✨ AI 美化';
  }
}

/* 切换 美化图 / 美化前的算法原图 */
function toggleMapView() {
  mmShowOriginal = !mmShowOriginal;
  renderMapModal();
  const info = $('mm-info');
  if (info) {
    info.innerHTML = mmShowOriginal
      ? '<span class="hint">🖼 正在查看美化前的算法原图（数据层不变，点击地图可查看区域 / 地点信息）</span>'
      : '<span class="hint">✨ 已切回 AI 美化图</span>';
  }
}

function openMapModal() {
  const modal = $('map-modal');
  if (!modal) return;
  mmShowOriginal = false; // 每次打开默认显示美化图（如有）
  modal.classList.remove('hidden');
  renderMapModal();
}
function closeMapModal() {
  const modal = $('map-modal');
  if (modal) modal.classList.add('hidden');
}

/* 点击命中（地图窗口内 canvas / 美化图共用）：DOM 坐标 → 网格坐标 → mapHit，信息显示在窗口底部 */
function mapCanvasClick(e) {
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  const px = (e.clientX - rect.left) / rect.width;
  const py = (e.clientY - rect.top) / rect.height;
  const map = curMapData();
  if (!map) return;
  const gx = Math.floor(px * map.size), gy = Math.floor(py * map.size);
  const hit = window.MapGen.mapHit(map, gx, gy);
  const info = $('mm-info');
  if (!info) return;
  if (!hit || hit.kind === 'ocean') {
    info.innerHTML = '<span class="hint">（浩瀚的海洋，尚无定居点）</span>'
      + '<div><button class="ghost-btn small" id="mm-view-orig">🔍 查看原图</button></div>';
    return;
  }
  if (hit.kind === 'point') {
    const p = hit.point;
    info.innerHTML = `<div class="map-info-title">📍 ${esc(p.name)} <span class="tag">${esc(p.type)}</span></div>`
      + `<div class="map-info-desc">${esc(p.desc)}</div>`
      + '<div><button class="ghost-btn small" id="mm-view-orig">🔍 查看原图</button></div>';
    return;
  }
  const r = map.regions[hit.region - 1];
  if (!r) return;
  const neighbors = map.adjacency
    .filter(([a, b]) => a === r.id || b === r.id)
    .map(([a, b]) => map.regions[(a === r.id ? b : a) - 1].name);
  const pts = map.points.filter(p => p.regionId === r.id);
  info.innerHTML = `<div class="map-info-title">🗺 ${esc(r.name)} <span class="tag">${esc(r.biome)}</span></div>`
    + `<div class="map-info-desc">${esc(r.name)}的${esc(r.biome)}地带${neighbors.length ? '，可前往：' + esc(neighbors.join('、')) : ''}</div>`
    + (pts.length ? `<div class="map-info-desc">${pts.map(p => '📍 ' + esc(p.name) + '（' + esc(p.type) + '）').join('　')}</div>` : '')
    + '<div><button class="ghost-btn small" id="mm-view-orig">🔍 查看原图</button></div>';
}

/* 兼容入口：地图现在只由世界卡提供，运行时不再随机重建。 */
function mapRegenerate() {
  // 地图由世界卡提供；不再在运行时随机生成或重生成。
  return null;
}

/* AI 美化提示词：携带地图数据约束（区域数/biome 列表/区域明细），让 AI 遵循原图群系不破坏 */
function buildBeautifyPrompt(map) {
  const biomes = [...new Set(map.regions.map(r => r.biome))].join('、');
  const regionDetails = map.regions.map(r => r.biome + '「' + r.name + '」').join('，');
  return 'Beautify this procedurally generated fantasy world map into a beautiful hand-drawn cartography style map. '
    + 'Keep the landmass shapes and landmark positions exactly as they are. '
    + 'This is a single-region map with ' + map.regions.length + ' regions whose biomes are: ' + biomes + '. '
    + 'Preserve each region\'s color area and biome exactly as in the reference image — do not merge or split regions, do not change or invent biomes. '
    + 'Region details: ' + regionDetails + '. '
    + 'IMPORTANT: the reference image is a labeled reference map: '
    + 'thin boundary lines mark region borders, text labels show each region\'s biome name (e.g. 森林/草原), '
    + 'ridge mountain symbols = mountains, tree symbols = forest, wavy lines = wetland, blue = water. '
    + 'Use the boundary lines to know exactly where each region starts and ends, and use the text labels to know its terrain type. '
    + 'Draw realistic mountains, forests and wetlands in exactly the areas where the corresponding symbols appear, '
    + 'and replace every annotation (boundary lines, text labels, marker symbols) with actual terrain — do not keep any of them in the final image. '
    + 'Keep each region\'s color area and biome as the reference, blending softly at borders. '
    + 'Add coastline details, rivers and a compass rose. '
    + 'Do NOT add any new text, labels, place names or town names. '
    + 'Fantasy cartography, parchment color palette, clean and quiet.';
}

/* AI 美化（三步法第②③步）：独立渲染【带地形标记的参考图】（展示图无标记，参考图标山脉/森林/湿地）
 * → gpt-image /images/edits → 美化图 + 数据层不变 */
async function mapBeautify() {
  if (!window.MapGen) return;
  const rs = curRpgState();
  const map = curMapData();
  if (!map) return;
  const ig = (settings && settings.imageGen) || {};
  if (!ig.baseUrl) {
    alert('请先在 设置 → 文生图 中配置 Base URL（gpt-image 反代）');
    return;
  }
  const status = $('mm-info');
  const targetKey = activeConversationKey();
  const targetMap = map;
  if (status) status.innerHTML = '<span class="hint">⏳ AI 美化中…（标注版参考图已上传）</span>';
  const refCanvas = document.createElement('canvas');
  window.MapGen.renderWorldMap(refCanvas, map, { pixelSize: 12, markers: true, labels: 'bold' }); // 参考图：标注边界线+文字+地形符号
  const dataUrl = refCanvas.toDataURL('image/png');
  try {
    const res = await fetch('/api/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        baseUrl: ig.baseUrl, apiKey: ig.apiKey || '', kind: 'openai',
        body: {
          model: ig.model || 'gpt-image-2',
          size: ig.size || '1024x1024',
          prompt: buildBeautifyPrompt(map),
          images: [dataUrl],
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data.error && (data.error.message || data.error)) || ('生图 API 返回 ' + res.status);
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    const src = parseImageSrc(data);
    if (!src) throw new Error('响应中没有图片字段');
    const local = await saveImageLocally(src);
    if (worldModeActive()
      ? (activeConversationKey() !== targetKey || currentWorldMapState()?.data?.seed !== targetMap.seed)
      : activeConversationKey() !== targetKey) return;
    setCurMapImage(local || src);
    if (worldModeActive()) queueWorldSave(currentWorldSave); else saveSessions();
    renderMap();
    if (status) status.innerHTML = '<span class="hint">✅ 美化完成 —— 数据层（区域/路径点/邻接）保持不变，点击仍有效</span>';
  } catch (err) {
    console.error('[Tavern] 地图美化失败', err.message);
    if (status) status.innerHTML = `<span class="hint">❌ 地图美化失败：${esc(err.message)}</span>`;
  }
}

/* 地图数据注入 AI 上下文（保障叙事：区域/可达性/当前位置/地标） */
function buildMapContext() {
  if (mode !== 'rpg') return '';
  const map = curMapData();
  if (!map || !map.regions) return '';
  const rs = curRpgState();
  // 当前区域：location 含「区域 N」→ N；否则按名称模糊匹配
  const locText = (rs && rs.location) || '';
  const m = /区域\s*(\d+)/.exec(locText);
  let cur = m ? map.regions.find(r => r.id === parseInt(m[1], 10)) : null;
  if (!cur) cur = map.regions.find(r => r.name === locText) || null;
  const adjacentIds = new Set(cur ? [cur.id, ...map.adjacency
    .filter(([a, b]) => a === cur.id || b === cur.id)
    .map(([a, b]) => a === cur.id ? b : a)] : []);
  const scopedRegions = adjacentIds.size
    ? map.regions.filter(region => adjacentIds.has(region.id))
    : map.regions.slice(0, 6);
  const scopedRegionIds = new Set(scopedRegions.map(region => region.id));
  const lines = [];
  lines.push('【地图】当前世界卡提供一张地图，共 ' + map.regions.length + ' 个区域。'
    + '玩家当前位置：' + (cur ? cur.name + '（' + cur.biome + '）' : (locText || '未知')) + '。');
  lines.push('当前区域与可达性（仅注入当前位置及相邻区域）：');
  for (const r of scopedRegions) {
    const nb = map.adjacency
      .filter(([a, b]) => a === r.id || b === r.id)
      .map(([a, b]) => map.regions.find(region => region.id === (a === r.id ? b : a)))
      .filter(region => region && scopedRegionIds.has(region.id))
      .map(region => region.name)
      .filter(Boolean);
    lines.push('· ' + r.name + '（' + r.biome + '）' + (nb.length ? ' — 可前往：' + nb.join('、') : '（孤立）'));
  }
  const pts = map.points.filter(point => adjacentIds.has(point.regionId)).slice(0, 12);
  if (pts.length) {
    lines.push('当前区域地标：');
    lines.push('· ' + pts.map(p => p.type + '「' + p.name + '」（' + (map.regions.find(region => region.id === p.regionId)?.name || p.regionId) + '）').join('　'));
  }
  lines.push('（玩家移动时，请让 location 使用区域名，如「区域 3」；叙事应遵循区域可达性）');
  return lines.join('\n');
}

/* 快捷行动栏：RPG / 酒馆模式都读取最后一条 AI 回复的结构化 options（点击即发送）。 */
function renderQuickActions() {
  const qa = $('quick-actions');
  if (!qa) return;
  qa.innerHTML = '';
  if (worldTurnErrorActive()) {
    const box = document.createElement('div');
    box.className = 'world-turn-error';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    const text = document.createElement('span');
    text.className = 'world-turn-error-text';
    const phase = worldTurnPendingActive() && worldTurnPending.agentPhase ? `（Agent ${worldTurnPending.agentPhase} 阶段）` : '';
    text.textContent = `本回合未提交${phase}：${worldTurnError.message}`;
    box.appendChild(text);
    const actions = document.createElement('span');
    actions.className = 'world-turn-error-actions';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn gold small';
    retry.textContent = '重试 AI';
    retry.addEventListener('click', retryWorldTurn);
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'btn ghost small';
    reset.textContent = '重置本回合';
    reset.addEventListener('click', discardWorldTurnPending);
    actions.append(retry, reset);
    box.appendChild(actions);
    qa.appendChild(box);
    return;
  }
  if (responsePreview && responsePreview.targetKey === activeConversationKey()) {
    const pending = document.createElement('span');
    pending.className = 'quick-hint';
    pending.textContent = '正文已生成，正在整理后续选项…';
    qa.appendChild(pending);
    return;
  }
  if (worldTurnPendingActive() && worldTurnPending.agentExecution && !worldTurnErrorActive()) {
    const box = document.createElement('div');
    box.className = 'world-turn-error';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    const text = document.createElement('span');
    text.className = 'world-turn-error-text';
    const phase = worldTurnPending.agentPhase || 'narrate';
    const counts = worldTurnPending.agentOrchestration?.counts;
    const planCount = Array.isArray(worldTurnPending.agentOrchestration?.plan) ? worldTurnPending.agentOrchestration.plan.length : 0;
    const summary = counts ? `计划 ${planCount}，候选 ${Number(counts.candidates) || 0}，通过 ${Number(counts.passed) || 0}，拒绝 ${Number(counts.rejected) || 0}` : '暂无工具摘要';
    text.textContent = `已恢复 Agent 回合：当前阶段 ${phase}；${summary}。正式状态尚未提交。`;
    const actions = document.createElement('span');
    actions.className = 'world-turn-error-actions';
    const resume = document.createElement('button');
    resume.type = 'button';
    resume.className = 'btn gold small';
    resume.textContent = '继续提交';
    resume.addEventListener('click', resumeWorldAgentNarration);
    actions.append(resume);
    box.append(text, actions);
    qa.appendChild(box);
    return;
  }
  if (mode === 'rpg') {
    if (worldModeActive() && (currentWorldSave?.state?.ending?.status === 'ended' || currentWorldSave?.state?.failure?.status === 'terminal')) {
      const done = document.createElement('span');
      done.className = 'quick-hint';
      done.textContent = '世界线已终止；如要继续，请从右侧重开独立存档。';
      qa.appendChild(done);
      return;
    }
    const msgs = curMessages();
    let opts = null;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role !== 'assistant') continue;
      opts = Array.isArray(msgs[i].options) && msgs[i].options.length ? msgs[i].options : null;
      break;
    }
    if (!opts && worldModeActive() && Array.isArray(currentWorldSave.openingOptions) && currentWorldSave.openingOptions.length) opts = currentWorldSave.openingOptions;
    if (opts) {
      for (const o of opts) {
        const b = document.createElement('button');
        b.className = 'chip';
        b.textContent = o;
        b.addEventListener('click', () => { $('input').value = o; sendMessage(); });
        qa.appendChild(b);
      }
    } else {
      // 无 AI 选项时显示提示（数据外置 defaults.rpg.noOptions）
      const hint = (defaults && defaults.rpg && defaults.rpg.noOptions) || '（等待 AI 给出行动选项…）';
      const s = document.createElement('span');
      s.className = 'quick-hint';
      s.textContent = hint;
      qa.appendChild(s);
    }
    return;
  }
  // 酒馆模式：与 RPG 相同，读取最后一条 AI 回复生成的选项；没有标签时只显示提示。
  const msgs = curMessages();
  let opts = null;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role !== 'assistant') continue;
    opts = Array.isArray(msgs[i].options) && msgs[i].options.length ? msgs[i].options : null;
    break;
  }
  if (opts) {
    for (const option of opts) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = option;
      b.addEventListener('click', () => { $('input').value = option; sendMessage(); });
      qa.appendChild(b);
    }
  } else {
    const hint = tavernReplyOptionRules(resolvePromptPreset()?.preset).noOptions;
    if (hint) {
      const s = document.createElement('span');
      s.className = 'quick-hint';
      s.textContent = hint;
      qa.appendChild(s);
    }
  }
}

function setRpgMobileDrawer(panel) {
  const current = document.body.dataset.rpgDrawer || '';
  const next = panel && current !== panel ? panel : '';
  if (!current && next) {
    rpgDrawerReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  if (next) document.body.dataset.rpgDrawer = next;
  else delete document.body.dataset.rpgDrawer;
  const scrim = $('rpg-mobile-scrim');
  if (scrim) scrim.hidden = !next;
  document.querySelectorAll('[data-rpg-drawer]').forEach(button => {
    button.setAttribute('aria-expanded', button.dataset.rpgDrawer === next ? 'true' : 'false');
  });
  if (next) {
    requestAnimationFrame(() => document.querySelector(`#rpg-${next} [data-rpg-drawer-close]`)?.focus());
  } else if (current && rpgDrawerReturnFocus instanceof HTMLElement && document.contains(rpgDrawerReturnFocus)) {
    const restore = rpgDrawerReturnFocus;
    rpgDrawerReturnFocus = null;
    requestAnimationFrame(() => restore.focus());
  }
}

/* ─────────── 事件绑定 ─────────── */
function bindEvents() {
  window.addEventListener('message', handleWorldExtensionMessage);
  $('rpg-extension-reload')?.addEventListener('click', () => {
    const surface = worldExtensionState.surface || 'play';
    clearWorldExtension();
    renderWorldExtension(surface);
  });
  $('rpg-extension-setup-exit')?.addEventListener('click', closeWorldSetupExtension);
  // 发送
  $('btn-send').addEventListener('click', () => { if (sending) stopGeneration(); else sendMessage(); });
  $('input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  $('btn-input-fullscreen')?.addEventListener('click', openInputFullscreen);
  $('input-fullscreen-close')?.addEventListener('click', () => closeInputFullscreen());
  $('input-fullscreen-cancel')?.addEventListener('click', () => closeInputFullscreen());
  $('input-fullscreen-send')?.addEventListener('click', () => closeInputFullscreen(true));
  $('input-fullscreen')?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); closeInputFullscreen(true); }
  });
  $('input-fullscreen-dialog')?.addEventListener('click', event => {
    if (event.target === $('input-fullscreen-dialog')) closeInputFullscreen();
  });
  $('input-fullscreen-dialog')?.addEventListener('close', () => {
    const fullInput = $('input-fullscreen');
    const input = $('input');
    if (fullInput && input) input.value = fullInput.value;
  });
  syncSendButton();
  // 快捷行动（按模式渲染）
  renderQuickActions();
  // RPG 功能区：背包/任务管理
  $('btn-rpg-item').addEventListener('click', addRpgItem);
  $('btn-rpg-quest').addEventListener('click', addRpgQuest);
  // 世界地图：生成/美化/点击
  // 小预览 → 打开地图窗口（功能全部在窗口内）
  const mapCanvas = $('map-canvas');
  if (mapCanvas) mapCanvas.addEventListener('click', openMapModal);
  const mapBeautyImg = $('map-beauty-img');
  if (mapBeautyImg) mapBeautyImg.addEventListener('click', openMapModal);
  // 地图窗口
  const mmCanvas = $('mm-canvas');
  if (mmCanvas) mmCanvas.addEventListener('click', mapCanvasClick);
  const mmBeautyImg = $('mm-beauty-img');
  if (mmBeautyImg) mmBeautyImg.addEventListener('click', mapCanvasClick);
  $('mm-toggle').addEventListener('click', toggleMapView);
  $('mm-zoom').addEventListener('click', zoomMap);
  $('mm-json').addEventListener('click', showMapJson);
  $('mm-gen').addEventListener('click', mapRegenerate);
  $('mm-beautify').addEventListener('click', mapBeautify);
  $('mm-close').addEventListener('click', closeMapModal);
  const mmModal = $('map-modal');
  if (mmModal) mmModal.addEventListener('click', (e) => { if (e.target === mmModal) closeMapModal(); });
  const btnRef = $('mm-view-ref');
  if (btnRef) btnRef.addEventListener('click', showMapRef);
  // 地图数据 JSON 查看
  const mjModal = $('map-json-modal');
  if (mjModal) mjModal.addEventListener('click', (e) => { if (e.target === mjModal) mjModal.classList.add('hidden'); });
  const mjCopy = $('mm-json-copy');
  if (mjCopy) mjCopy.addEventListener('click', copyMapJson);
  const mjClose = $('mm-json-close');
  if (mjClose) mjClose.addEventListener('click', () => { if (mjModal) mjModal.classList.add('hidden'); });
  // 信息条内「查看原图」按钮（事件委托，innerHTML 重建后仍有效）
  const mmInfoEl = $('mm-info');
  if (mmInfoEl) mmInfoEl.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'mm-view-orig') zoomMap();
  });
  const rpgInv = $('rpg-inventory');
  if (rpgInv) rpgInv.addEventListener('click', e => {
    const el = e.target;
    if (el.dataset && el.dataset.kind === 'inv') removeRpgItem(parseInt(el.dataset.idx, 10));
  });
  const rpgQ = $('rpg-quests');
  if (rpgQ) rpgQ.addEventListener('click', e => {
    const el = e.target;
    if (el.dataset && el.dataset.kind === 'quest-del') removeRpgQuest(parseInt(el.dataset.idx, 10));
    else if (el.dataset && el.dataset.kind === 'quest') toggleRpgQuest(parseInt(el.dataset.idx, 10));
  });
  const rpgGrowth = $('rpg-growth-candidates');
  if (rpgGrowth) rpgGrowth.addEventListener('click', e => {
    const el = e.target?.closest?.('[data-growth-action]');
    if (!el) return;
    decideGrowthCandidate(el.dataset.growthId, el.dataset.growthAction);
  });
  // 导航
  document.querySelectorAll('.nav-item[data-view]').forEach(b =>
    b.addEventListener('click', () => switchView(b.dataset.view)));
  window.addEventListener('resize', () => {
    for (const id of MOBILE_MANAGER_IDS) {
      const manager = $(id);
      if (manager && !manager.classList.contains('hidden')) setMobileManagerPanel(id, manager.dataset.mobilePanel || 'list', { focus: false });
    }
  });
  // 手机导航抽屉 / 桌面侧栏收起（与 CSS 的媒体查询共用断点，避免旧 WebView 视口测量不一致）。
  $('btn-nav-drawer').addEventListener('click', e => {
    e.stopPropagation();
    if (usesDesktopNavigation()) {
      document.body.classList.toggle('sidebar-hidden'); // 侧栏滑出 + main 回满宽（CSS transform/margin 动画，可靠无抽搐）
    } else {
      openNavDrawer();
    }
  });
  $('btn-nav-drawer-close').addEventListener('click', closeNavDrawer);
  const nd = $('nav-drawer');
  const ndm = nd && nd.querySelector('.nd-mask');
  if (ndm) ndm.addEventListener('click', closeNavDrawer);
  // 形象参考图导入
  $('btn-import-ref').addEventListener('click', () => { const f = $('cm-ref-file'); if (f) f.click(); });
  $('btn-remove-ref').addEventListener('click', removeRefImage);
  $('cm-ref-file').addEventListener('change', (e) => { importRefImage(e.target.files && e.target.files[0]); e.target.value = ''; });
  // 记忆 / 玩家设定
  $('um-preset').addEventListener('change', () => { userData.currentPreset = $('um-preset').value; fillUserForm(); saveUserData(); });
  $('um-save').addEventListener('click', saveUserForm);
  $('um-save-new').addEventListener('click', saveUserAsNew);
  $('um-del').addEventListener('click', deleteUserPreset);
  $('mem-add').addEventListener('click', addMemory);
  $('mem-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') addMemory(); });
  $('mem-auto-enabled')?.addEventListener('change', readTavernAutoMemoryForm);
  ['mem-auto-window', 'mem-auto-summarize', 'mem-auto-chars'].forEach(id =>
    $(id)?.addEventListener('change', readTavernAutoMemoryForm));
  $('mem-auto-run')?.addEventListener('click', manualRollTavernMemory);
  $('mem-auto-clear')?.addEventListener('click', clearTavernAutoMemory);
  // AI 生成
  $('btn-ai-char').addEventListener('click', aiGenChar);
  $('btn-ai-char-full').addEventListener('click', aiGenFullChar);
  $('cm-profile-add').addEventListener('click', addCharProfileField);
  $('cw-back-1').addEventListener('click', () => setCharWizardStep(1));
  $('cw-back-2').addEventListener('click', () => setCharWizardStep(2));
  $('cm-ai-desc').addEventListener('keydown', e => { if (e.key === 'Enter') aiGenChar(); });
  $('btn-ai-wi').addEventListener('click', aiGenWI);
  // 会话
  $('btn-session').addEventListener('click', e => {
    e.stopPropagation();
    if (mode === 'rpg') { openWorldLibrary(); return; }
    $('session-menu').classList.toggle('hidden');
  });
  document.addEventListener('click', e => {
    if (!$('session-menu').contains(e.target)) $('session-menu').classList.add('hidden');
  });
  $('session-menu-new').addEventListener('click', () => { newSession(); $('session-menu').classList.add('hidden'); });
  // 角色管理
  $('cm-new').addEventListener('click', newCharEditor);
  $('cm-name').addEventListener('input', () => { if (cmCreating) renderCharList(); });
  $('cm-save').addEventListener('click', () => { saveCharFromEditor(); renderCharList(); });
  $('cm-use').addEventListener('click', useCharInEditor);
  $('cm-del').addEventListener('click', () => {
    if (cmCreating) {
      if (!confirm('取消新建角色？未保存内容将丢失。')) return;
      cmCreating = false;
      if (currentCharId) selectCharForEdit(currentCharId);
      else renderCharList();
      return;
    }
    if (cmEditingId) deleteChar(cmEditingId);
  });
  $('cm-export').addEventListener('click', exportCurrentChar);
  $('cm-import').addEventListener('click', () => charFileInput.click());
  // 世界书
  $('wi-new').addEventListener('click', newWIEditor);
  $('wi-save').addEventListener('click', saveWI);
  $('wi-del').addEventListener('click', deleteWI);
  // 注入测试
  $('wi-test').addEventListener('click', wiTestHits);
  // 提示词预设页
  $('pg-new').addEventListener('click', pgNew);
  $('pg-del').addEventListener('click', () => { if (pgEditingName) pgDelete(pgEditingName); });
  $('pg-save').addEventListener('click', pgSave);
  $('pg-mode').addEventListener('change', () => renderPGRegexBindings());
  $('pg-prompt-new').addEventListener('click', pgPromptNew);
  $('pg-prompt-del').addEventListener('click', pgPromptDelete);
  $('pg-library').addEventListener('change', () => { insertPGLibraryPrompt($('pg-library').value); $('pg-library').value = ''; });
  $('pg-prompt-position').addEventListener('change', () => { capturePGPromptEditor(); fillPGPromptEditor(); });
  $('pg-import').addEventListener('click', () => $('pg-file').click());
  $('pg-export').addEventListener('click', exportPromptPreset);
  $('pg-file').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('文件超过 5 MB，拒绝导入');
      const report = importSTPreset(JSON.parse(await file.text()), file.name);
      alert(`已导入「${report.name}」：素材 ${report.prompts} 条，当前顺序 ${report.ordered} 条。${report.regexes ? `已识别并启用 ${report.regexes} 条输出正则。` : ''}`);
    } catch (err) {
      alert('导入失败：' + err.message);
    } finally {
      e.target.value = '';
    }
  });
  $('pg-active').addEventListener('change', () => {
    setActivePresetName($('pg-active').value || '');
    renderPGList();
    renderRegexList();
    resetRegexEditor();
  });
  // 输出正则
  $('regex-new').addEventListener('click', resetRegexEditor);
  $('regex-reset').addEventListener('click', resetRegexEditor);
  $('regex-save').addEventListener('click', saveRegexEditor);
  $('regex-copy').addEventListener('click', copyPresetRegexToCustom);
  $('regex-del').addEventListener('click', deleteRegexEditor);
  // 世界书页
  $('lb-new').addEventListener('click', lbNew);
  $('lb-import').addEventListener('click', () => $('lb-import-file').click());
  $('lb-import-file').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('世界书文件超过 10 MB，拒绝导入');
      const report = importSTLorebookText(await file.text(), file.name);
      alert(`✅ 世界书已导入：「${report.name}」· ${report.entries} 条目`);
    } catch (error) {
      alert('❌ 世界书导入失败：' + error.message);
    } finally {
      event.target.value = '';
    }
  });
  $('lb-export').addEventListener('click', exportCurrentLorebook);
  $('lb-del').addEventListener('click', lbDelete);
  $('lb-rename').addEventListener('click', renameCurrentLB);
  ['lb-scan-depth', 'lb-budget', 'lb-max-recursion', 'lb-min-activations', 'lb-min-depth', 'lb-include-names', 'lb-case-sensitive', 'lb-whole-word', 'lb-recursive', 'lb-group-scoring', 'lb-strategy']
    .forEach(id => $(id).addEventListener('change', saveLorebookSettings));
  // 设置 tab
  document.querySelectorAll('.st-tab').forEach(b =>
    b.addEventListener('click', () => {
      document.querySelectorAll('.st-tab').forEach(x => {
        const active = x === b;
        x.classList.toggle('active', active);
        x.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      document.querySelectorAll('#settings-modal [id^="st-panel-"]').forEach(p => {
        const active = p.id === 'st-panel-' + b.dataset.st;
        p.classList.toggle('hidden', !active);
        p.toggleAttribute('hidden', !active);
      });
      const box = $('settings-modal').querySelector('.modal-box');
      if (box) box.scrollTop = 0;
    }));
  // 设置
  document.querySelectorAll('.js-settings').forEach(b => b.addEventListener('click', openSettings));
  $('btn-debug').addEventListener('click', () => $('debug-panel').open ? closeDebugTerminal() : openDebugTerminal());
  $('btn-devtools')?.addEventListener('click', () => $('devtools-panel')?.open ? closeDevtools() : openDevtools());
  const debugTabs = [...document.querySelectorAll('[data-debug-tab]')];
  debugTabs.forEach((button, index) => {
    button.addEventListener('click', () => selectDebugTab(button.dataset.debugTab));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? debugTabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + debugTabs.length) % debugTabs.length;
      debugTabs[next].focus();
      selectDebugTab(debugTabs[next].dataset.debugTab);
    });
  });
  $('rpg-end-world').addEventListener('click', endCurrentWorld);
  $('rpg-reopen-world').addEventListener('click', reopenCurrentWorld);
  $('rpg-summary-rebuild').addEventListener('click', rebuildWorldLineSummary);
  $('debug-close').addEventListener('click', closeDebugTerminal);
  $('debug-clear').addEventListener('click', clearDebugTerminal);
  $('debug-copy').addEventListener('click', copyDebugTerminal);
  $('debug-history')?.addEventListener('click', event => {
    const button = event.target.closest('[data-debug-trace-id]');
    if (button) selectDebugTrace(button.dataset.debugTraceId);
  });
  $('debug-memory-rebuild').addEventListener('click', rebuildDebugMemory);
  $('debug-panel').addEventListener('cancel', e => { e.preventDefault(); closeDebugTerminal(); });
  $('debug-panel').addEventListener('click', e => { if (e.target === e.currentTarget) closeDebugTerminal(); });
  $('devtools-scenario')?.addEventListener('change', loadDevtoolsScenario);
  $('devtools-submit')?.addEventListener('click', runDevtoolsSubmit);
  $('devtools-copy-state')?.addEventListener('click', copyDevtoolsState);
  $('devtools-close')?.addEventListener('click', closeDevtools);
  $('devtools-panel')?.addEventListener('cancel', e => { e.preventDefault(); closeDevtools(); });
  $('devtools-panel')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeDevtools(); });
  // 模式切换：刷新快捷行动与 RPG 面板
  document.querySelectorAll('.js-mode-switch').forEach(button => button.addEventListener('click', switchMode));
  renderQuickActions();
  // 世界库：当前存档接管 RPG 主链；旧 RPG 回合仍保留兼容出口
  $('world-refresh').addEventListener('click', async () => {
    const btn = $('world-refresh');
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '刷新中…';
    await loadWorldLibraryData();
    btn.disabled = false;
    btn.textContent = old;
  });
  $('world-new-draft').addEventListener('click', openWorldDraftChoice);
  $('world-draft-open-existing').addEventListener('click', openSelectedWorldDraft);
  $('world-draft-create-blank').addEventListener('click', openBlankWorldDraft);
  $('world-draft-choice-close').addEventListener('click', closeWorldDraftChoice);
  $('world-draft-choice-cancel').addEventListener('click', closeWorldDraftChoice);
  $('world-draft-choice-dialog').addEventListener('cancel', e => { e.preventDefault(); closeWorldDraftChoice(); });
  $('world-draft-choice-dialog').addEventListener('click', e => { if (e.target === e.currentTarget) closeWorldDraftChoice(); });
  $('world-import').addEventListener('click', openWorldPackageImport);
  $('world-import-file').addEventListener('change', e => previewWorldPackageImport(e.target.files?.[0]));
  $('world-import-form').addEventListener('submit', async e => { e.preventDefault(); await commitWorldPackageImport(); });
  $('world-import-close').addEventListener('click', closeWorldPackageImport);
  $('world-import-cancel').addEventListener('click', closeWorldPackageImport);
  $('world-import-dialog').addEventListener('cancel', e => { e.preventDefault(); closeWorldPackageImport(); });
  $('world-import-dialog').addEventListener('click', e => { if (e.target === e.currentTarget) closeWorldPackageImport(); });
  $('world-export').addEventListener('click', exportCurrentWorldPackage);
  $('world-edit-draft').addEventListener('click', () => openWorldDraftEditor({ createNew: false }));
  $('world-lorebook-edit').addEventListener('click', () => openWorldDraftEditor({ createNew: false }));
  $('world-delete').addEventListener('click', event => deleteWorldCard(currentWorldId, event.currentTarget));
  $('world-draft-form').addEventListener('input', () => { worldDraftDirty = true; worldDraftPublishId = null; clearWorldDraftCheckReport(); });
  $('world-draft-runtime-form')?.addEventListener('click', handleWorldDraftRuntimeClick);
  $('world-draft-runtime-form')?.addEventListener('input', handleWorldDraftRuntimeInput);
  $('world-draft-runtime').addEventListener('input', event => setWorldDraftJsonRawState(event.target));
  $('world-draft-runtime-load-json')?.addEventListener('click', loadWorldDraftRuntimeJson);
  $('world-ui-load-template').addEventListener('click', loadWorldUiTemplate);
  $('world-extension-load-json').addEventListener('click', () => {
    const text = $('world-draft-ui').value.trim();
    let ui = {};
    if (text) {
      try { ui = JSON.parse(text); }
      catch { setWorldDraftStatus('RPG 界面配置不是有效 JSON，无法载入扩展。', 'error'); $('world-draft-ui').focus(); return; }
    }
    fillWorldDraftExtensionEditor(ui?.extension);
    worldDraftDirty = true;
    setWorldDraftStatus('已从高级 JSON 载入扩展字段，保存草稿后生效。', 'ok');
  });
  $('world-draft-map-regions').addEventListener('input', updateWorldDraftMapOutputs);
  $('world-draft-map-land').addEventListener('input', updateWorldDraftMapOutputs);
  $('world-draft-map-random').addEventListener('click', randomizeWorldDraftMapSeed);
  $('world-draft-map-preview').addEventListener('click', previewWorldDraftMap);
  $('world-draft-player-schema').addEventListener('input', () => { if (requireWorldDraftPlayerRawSync()) syncWorldDraftPlayerCreationFromForm(); worldDraftPlayerPreview(); });
  $('world-draft-player-schema').addEventListener('click', handleWorldDraftPlayerCreationClick);
  $('world-draft-player-creation').addEventListener('input', e => setWorldDraftJsonRawState(e.target));
  $('world-draft-player-validate-json').addEventListener('click', validateWorldDraftPlayerCreationJson);
  $('world-draft-player-load-json').addEventListener('click', loadWorldDraftPlayerCreationJson);
  for (const definition of WORLD_DRAFT_JSON_ARRAY_DEFS) {
    const editor = $(definition.editorId || `world-draft-${definition.key}-editor`);
    editor?.addEventListener('input', () => { if (requireWorldDraftJsonArraysRawSync()) syncWorldDraftJsonArraysFromForm(); worldDraftJsonArrayPreview(definition.key); });
    editor?.parentElement?.addEventListener('click', handleWorldDraftJsonArrayClick);
    const raw = $(definition.rawId || `world-draft-${definition.key}`);
    raw?.addEventListener('input', e => setWorldDraftJsonRawState(e.target));
    $(definition.validateId || `world-draft-${definition.key}-validate-json`)?.addEventListener('click', () => validateWorldDraftJsonArrayRaw(definition.key));
    $(definition.loadId || `world-draft-${definition.key}-load-json`)?.addEventListener('click', () => loadWorldDraftJsonArray(definition.key));
  }
  $('world-draft-add-location').addEventListener('click', addWorldDraftLocation);
  $('world-draft-add-npc').addEventListener('click', addWorldDraftNpc);
  $('world-draft-check').addEventListener('click', () => checkWorldDraftPublishability({ focus: true }));
  $('world-draft-check-report').addEventListener('click', event => {
    const button = event.target.closest('[data-world-draft-check-target]');
    if (button) focusWorldDraftCheckTarget(button.dataset.worldDraftCheckTarget);
  });
  $('world-draft-form').addEventListener('submit', async e => { e.preventDefault(); await saveWorldDraft(); });
  $('world-draft-publish').addEventListener('click', publishWorldDraft);
  $('world-draft-close').addEventListener('click', requestCloseWorldDraft);
  $('world-draft-cancel').addEventListener('click', requestCloseWorldDraft);
  $('world-draft-dialog').addEventListener('cancel', e => { e.preventDefault(); requestCloseWorldDraft(); });
  $('world-draft-dialog').addEventListener('click', e => { if (e.target === e.currentTarget) requestCloseWorldDraft(); });
  window.addEventListener('popstate', () => { syncWorldDraftRoute({ fromPopstate: true }); });
  $('world-player-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = $('world-player-form');
    if (!form.reportValidity() || (!pendingWorldSaveName && !editingWorldPlayerSaveId)) return;
    const createButton = $('world-player-create');
    const worldButton = pendingWorldSaveButton;
    createButton.disabled = true;
    setWorldPlayerStatus('正在创建独立存档…');
    try {
      const player = collectWorldPlayerInput();
      if (editingWorldPlayerSaveId && currentWorldSave?.id === editingWorldPlayerSaveId) {
        const response = await fetch('/api/world-saves/' + encodeURIComponent(currentWorldSave.id) + '/setup', { method: 'PUT', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ commandId: 'player-' + uid(), expectedRevision: currentWorldSave.revision, player, playerPresetId: $('world-player-preset')?.value || currentWorldSave.setup?.playerPresetId || '', game: currentWorldSave.setup?.game || {}, plan: currentWorldSave.setup?.plan || null }) });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(worldApiError(data, '角色保存失败（HTTP ' + response.status + '）'));
        hydrateWorldSave(data); currentWorldSave = data;
        closeWorldPlayerDialog('updated'); renderWorldOpeningDialog(currentWorldSave); $('world-opening-dialog').showModal();
      } else {
        await createWorldSave(pendingWorldSaveName, player, $('world-player-preset')?.value || pendingWorldPlayerPresetId);
        const input = $('world-save-name');
        if (input) input.value = '';
        closeWorldPlayerDialog('created');
        const status = $('world-open-status');
        if (status) status.textContent = `已创建存档「${currentWorldSave.name}」；完成开局配置并确认后才会开始 RPG。`;
        enterWorldWorkspace();
        if (worldSavePlanning()) resumeWorldSaveSetup(currentWorldSave);
      }
    } catch (err) {
      setWorldPlayerStatus(err.message, 'error');
    } finally {
      createButton.disabled = false;
      if (worldButton) worldButton.disabled = false;
    }
  });
  $('world-player-form').addEventListener('input', () => {
    updateWorldPlayerBudget($('world-player-fields'));
    scheduleWorldPlayerDraftAutosave();
  });
  $('world-player-close').addEventListener('click', () => closeWorldPlayerDialog());
  $('world-player-cancel').addEventListener('click', () => closeWorldPlayerDialog());
  $('world-player-dialog').addEventListener('cancel', e => { e.preventDefault(); closeWorldPlayerDialog(); });
  $('world-player-dialog').addEventListener('click', e => { if (e.target === e.currentTarget) closeWorldPlayerDialog(); });
  $('world-opening-form').addEventListener('submit', async e => {
    e.preventDefault();
    try { await saveWorldOpeningPlan(); }
    catch (err) { $('world-opening-status').textContent = err.message; }
  });
  $('world-player-ai-basic').addEventListener('click', aiFillWorldPlayerBasic);
  $('world-player-ai-full').addEventListener('click', aiFillWorldPlayerFull);
  $('world-player-preset').addEventListener('change', () => {
    const world = currentWorldCard();
    if (!world || editingWorldPlayerSaveId) return;
    pendingWorldPlayerPresetId = $('world-player-preset').value || '';
    renderWorldPlayerForm(world, 'world-player-fields', worldPlayerWithPreset(world, pendingWorldPlayerPresetId));
    setWorldPlayerStatus(pendingWorldPlayerPresetId ? '已套用预设；仍可继续让 AI 填写或手动修改。' : '已切换为自定义配置。');
  });
  $('world-save-preset').addEventListener('change', () => { pendingWorldPlayerPresetId = $('world-save-preset').value || ''; });
  $('world-opening-confirm').addEventListener('click', confirmWorldOpeningCandidate);
  $('world-opening-edit-player').addEventListener('click', () => { closeWorldOpeningDialog(); openWorldPlayerEditor(currentWorldSave); });
  $('world-opening-regenerate').addEventListener('click', async () => {
    if (!currentWorldSave || worldOpeningGeneration) return;
    currentWorldSave.setup.candidate = null;
    renderWorldOpeningDialog(currentWorldSave);
    try { await saveWorldOpeningPlan(); }
    catch (err) { $('world-opening-status').textContent = err.message; }
  });
  $('world-opening-npcs').addEventListener('change', () => { const plan = collectWorldOpeningPlan(); renderWorldOpeningNpcContexts(plan); });
  $('world-opening-close').addEventListener('click', closeWorldOpeningDialog);
  $('world-opening-cancel').addEventListener('click', closeWorldOpeningDialog);
  $('world-opening-dialog').addEventListener('cancel', e => { e.preventDefault(); closeWorldOpeningDialog(); });
  $('world-opening-dialog').addEventListener('click', e => { if (e.target === e.currentTarget) closeWorldOpeningDialog(); });
  $('world-opening-dialog').addEventListener('input', e => { if (!e.target.closest('#world-opening-candidate')) { renderWorldOpeningConfirmSummary(currentWorldSave, collectWorldOpeningPlan()); scheduleWorldSetupAutosave(); } });
  $('world-upgrade-target').addEventListener('change', previewWorldSaveUpgrade);
  $('world-upgrade-form').addEventListener('submit', async e => { e.preventDefault(); await commitWorldSaveUpgrade(); });
  $('world-upgrade-close').addEventListener('click', closeWorldSaveUpgrade);
  $('world-upgrade-cancel').addEventListener('click', closeWorldSaveUpgrade);
  $('world-upgrade-dialog').addEventListener('cancel', e => { e.preventDefault(); closeWorldSaveUpgrade(); });
  $('world-upgrade-dialog').addEventListener('click', e => { if (e.target === e.currentTarget) closeWorldSaveUpgrade(); });
  window.addEventListener('beforeunload', e => {
    if (!worldDraftDirty) return;
    e.preventDefault();
    e.returnValue = '';
  });
  $('world-save-form').addEventListener('submit', async e => {
    e.preventDefault();
    const input = $('world-save-name');
    const btn = $('world-save-create');
    const name = input.value.trim();
    showWorldError('');
    if (!name) { showWorldError('请填写存档名称。'); input.focus(); return; }
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '创建中…';
    try {
      const bypassGate = worldEntryGateBypass;
      worldEntryGateBypass = false;
      if (!bypassGate && await openWorldEntryGate(name, btn)) return;
      const created = await openWorldPlayerCreation(name, btn);
      if (created) {
        input.value = '';
        const status = $('world-open-status');
        if (status) status.textContent = `已创建并打开「${currentWorldSave.name}」——世界状态、地图和叙事已绑定当前存档；当前存档 ID：${currentWorldSave.id}`;
        enterWorldWorkspace();
        if (worldSavePlanning()) resumeWorldSaveSetup(currentWorldSave);
      }
    } catch (err) {
      showWorldError(err.message);
      input.focus();
    } finally {
      if (!$('world-player-dialog')?.open) btn.disabled = false;
      btn.textContent = old;
    }
  });
  $('world-close').addEventListener('click', () => {
    if (isMobileViewport() && $('world-mgr')?.dataset.mobilePanel === 'detail') {
      setMobileManagerPanel('world-mgr', 'list', { focus: false });
      requestAnimationFrame(() => $('world-list')?.querySelector('[data-world-id]')?.focus());
      return;
    }
    exitWorldImmersiveMode();
    if (mode === 'rpg' && worldModeActive()) {
      closeWorldLibrary();
      enterWorldWorkspace();
      syncModeNavigation('chat');
      return;
    }
    if (mode === 'rpg' && !worldModeActive()) {
      closeWorldLibrary();
      renderMessages();
      syncModeNavigation('chat');
      return;
    }
    closeWorldLibrary();
    switchView('chat');
  });
  $('memory-open-entries')?.addEventListener('click', openMobileMemoryEntries);
  $('world-entry-gate-form')?.addEventListener('submit', e => { e.preventDefault(); confirmWorldEntryGate(); });
  $('world-entry-gate-cancel')?.addEventListener('click', closeWorldEntryGate);
  $('world-entry-gate-dialog')?.addEventListener('cancel', e => { e.preventDefault(); closeWorldEntryGate(); });
  $('world-entry-gate-dialog')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeWorldEntryGate(); });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && worldImmersiveSession) exitWorldImmersiveMode();
    else if (!document.fullscreenElement) document.body.classList.remove('world-immersive');
  });
  document.querySelectorAll('[data-rpg-drawer]').forEach(button => button.addEventListener('click', () => setRpgMobileDrawer(button.dataset.rpgDrawer)));
  document.querySelectorAll('[data-rpg-drawer-close]').forEach(button => button.addEventListener('click', () => setRpgMobileDrawer('')));
  $('rpg-mobile-scrim')?.addEventListener('click', () => setRpgMobileDrawer(''));
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (worldImmersiveSession) {
      const escapeMode = worldUiShell().escape;
      if (escapeMode === 'none') return;
      e.preventDefault();
      e.stopPropagation();
      if (escapeMode === 'world') {
        exitWorldImmersiveMode();
        setWorldCustomLayout(false);
        clearWorldExtension();
        openWorldLibrary(false);
        return;
      }
      exitWorldImmersiveMode();
      return;
    }
    if (document.body.dataset.rpgDrawer) setRpgMobileDrawer('');
  });
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeSettings));
  $('btn-test-image').addEventListener('click', testImageGen);
  $('settings-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeSettings(); });
  // 热保存：排版控件拖动即时预览（防抖写盘）；任意设置 change 即读取并保存，不再依赖「保存」按钮
  let typoSaveTimer = null;
  let uiThemeSaveTimer = null;
  $('settings-modal').addEventListener('input', e => {
    if (!e.target.closest) return;
    if (e.target.closest('#st-panel-typo')) {
      readTypographyForm();
      clearTimeout(typoSaveTimer);
      typoSaveTimer = setTimeout(() => saveJSON(LS_PREFS, prefs), 400);
      return;
    }
    if (e.target.closest('#st-panel-ui')) {
      // 预设下拉框由专用 change 处理器套用；通用热保存会把它提前改回 custom。
      if (e.target.id === 'ui-theme-preset') return;
      readUiThemeForm({ parseCustom: false });
      clearTimeout(uiThemeSaveTimer);
      uiThemeSaveTimer = setTimeout(() => saveJSON(LS_PREFS, prefs), 400);
    }
  });
  $('settings-modal').addEventListener('change', e => {
    if (e.target.closest && e.target.closest('#st-panel-typo')) {
      clearTimeout(typoSaveTimer);
      saveJSON(LS_PREFS, prefs);
      return;
    }
    if (e.target.closest && e.target.closest('#st-panel-ui')) {
      if (e.target.id === 'ui-theme-preset') return;
      clearTimeout(uiThemeSaveTimer);
      readUiThemeForm({ parseCustom: true, save: true });
      renderMessages();
      return;
    }
    readSettingsForm();
    renderMessages();
  });
  $('btn-typo-reset').addEventListener('click', resetTypography);
  $('btn-ui-theme-reset').addEventListener('click', resetUiTheme);
  $('ui-theme-preset').addEventListener('change', e => {
    const id = e.target.value;
    updateUiThemePresetDescription(id);
    // 选择即套用，避免用户只看到下拉值变化却误以为预设失效；按钮仍保留作重复套用入口。
    if (id !== 'custom') applyUiThemePreset(id);
    else {
      prefs.uiThemePreset = 'custom';
      saveJSON(LS_PREFS, prefs);
      $('ui-theme-status').textContent = '已切换到自定义；当前颜色保持不变。';
      $('ui-theme-status').className = 'hint ok';
    }
  });
  $('btn-ui-theme-preset-apply').addEventListener('click', () => {
    const id = $('ui-theme-preset').value;
    if (id === 'custom') {
      prefs.uiThemePreset = 'custom';
      saveJSON(LS_PREFS, prefs);
      $('ui-theme-status').textContent = '已切换到自定义；当前颜色保持不变。';
      $('ui-theme-status').className = 'hint ok';
      return;
    }
    applyUiThemePreset(id);
  });
  $('g-gen-save').addEventListener('click', () => { if (readGenerationForm()) renderMessages(); });
  $('g-gen-reset').addEventListener('click', resetGenerationForm);
  $('btn-save-settings').addEventListener('click', () => { if (readSettingsForm() === false) return; closeSettings(); renderMessages(); });
  $('btn-test').addEventListener('click', testConnection);
  $('btn-export').addEventListener('click', exportSettings);
  $('btn-import').addEventListener('click', importSettings);
  $('s-preset').addEventListener('change', () => {
    const p = providers.find(x => x.id === $('s-preset').value);
    if (p) {
      $('s-base-url').value = p.baseUrl;
      $('s-model').value = p.model;
    }
  });
  $('s-temperature').addEventListener('input', () => { $('s-temp-val').textContent = $('s-temperature').value; });
  $('s-top-p').addEventListener('input', () => { $('s-top-p-val').textContent = $('s-top-p').value; });
  $('btn-fetch-models').addEventListener('click', fetchModels);
  $('s-profile').addEventListener('change', profileSwitch);
  $('btn-profile-save').addEventListener('click', profileSave);
  $('btn-profile-del').addEventListener('click', profileDelete);
  // RPG 重置存档；酒馆仍只清空当前对话并重新加载开场白。
  $('btn-clear-chat').addEventListener('click', async () => {
    if (worldModeActive()) {
      if (!confirm('确定重置当前 RPG 存档？\n\n回合记录、MVU/runtime 变量、事件记忆和动态状态都会恢复到开局基线。')) return;
      const button = $('btn-clear-chat');
      if (button) { button.disabled = true; button.textContent = '重置中…'; }
      try { await resetCurrentWorldSave(); }
      catch (err) { alert(err.message); }
      finally { if (button) button.disabled = false; syncConversationResetButton(); }
      return;
    }
    if (!confirm('确定清空当前对话？将重新加载开场白。')) return;
    const s = curSession();
    if (!s) return;
    // 清空时连同临时预览、思考占位和进行中的请求一起失效，避免旧回复在异步返回后残留。
    if (sending) stopGeneration();
    clearResponsePreview();
    removeTyping();
    clearRpgCheckAnimation();
    // 清空后重新加载开场白（getGreeting：char → preset → settings）
    const greeting = getGreeting();
    s.messages = greeting
      ? [createTavernGreetingMessage(greeting)] // 开场白：与 AI 回复共用协议解析
      : (defaults && defaults.ui && defaults.ui.noGreeting
        ? [{ role: 'system', content: defaults.ui.noGreeting, ts: Date.now() }]
        : []);
    saveSessions(); renderMessages(); renderSessions();
  });
  // 文件导入（配置 / 角色卡）
  const cfgFileInput = document.createElement('input');
  cfgFileInput.id = 'settings-import-file';
  cfgFileInput.name = 'settingsImportFile';
  cfgFileInput.type = 'file';
  cfgFileInput.accept = '.json,application/json';
  cfgFileInput.style.display = 'none';
  cfgFileInput.addEventListener('change', () => {
    if (cfgFileInput.files[0]) importSettingsFromFile(cfgFileInput.files[0]);
    cfgFileInput.value = '';
  });
  document.body.appendChild(cfgFileInput);
  $('btn-import').addEventListener('dblclick', () => cfgFileInput.click());
  $('btn-import').title = '单击：粘贴 JSON；双击：选择文件';
  const charFileInput = document.createElement('input');
  charFileInput.id = 'character-import-file';
  charFileInput.name = 'characterImportFile';
  charFileInput.type = 'file';
  charFileInput.accept = '.json,.png,application/json,image/png';
  charFileInput.style.display = 'none';
  charFileInput.addEventListener('change', () => {
    const file = charFileInput.files[0];
    if (!file) return;
    const fileName = file.name;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = importCharOrLorebookFromBuffer(reader.result, fileName);
        if (result.kind === 'lorebook') {
          switchView('lore');
          alert(`✅ 检测到这是 ST 世界书，已导入「${result.report.name}」· ${result.report.entries} 条目`);
        } else {
          const report = result.report;
          alert(report?.lorebook?.created
            ? `✅ 角色卡已导入；内嵌世界书已注册为「${report.lorebook.name}」`
            : '✅ 角色卡已导入');
        }
      }
      catch (err) { alert('❌ 导入失败：' + err.message); }
    };
    reader.readAsArrayBuffer(file);
    charFileInput.value = '';
  });
  document.body.appendChild(charFileInput);
  // 回到对话
  document.querySelectorAll('[data-back-chat]').forEach(b =>
    b.addEventListener('click', () => handleManagerBack(b)));
}

/* 服务预设 / 格式指令下拉：从 JSON 数据动态渲染，不写死选项 */
function renderProviderOptions() {
  const sel = $('s-preset');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">—— 自定义 ——</option>'
    + providers.map(p => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('');
  sel.value = cur;
}
function renderFormatOptions() {
  const sel = $('f-preset');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">自由对话（无附加指令）</option>'
    + Object.entries(formatInstructions).map(([k, v]) =>
      `<option value="${esc(k)}">${esc((v && v.label) || k)}</option>`).join('');
  sel.value = cur;
}

/* ─────────── 启动 ─────────── */
async function init() {
  // 从 server 加载默认模板（服务预设 / 格式指令 / 偏好），失败回退空结构
  defaults = await fetchDefaults();
  if (!defaults) defaults = { characters: [], presets: {}, lorebooks: {}, settings: {}, prefs: {}, format: {}, providers: [] };
  providers = Array.isArray(defaults.providers) ? defaults.providers : [];
  formatInstructions = (defaults.format && typeof defaults.format === 'object') ? defaults.format : {};

  settings = { ...DEFAULT_SETTINGS, ...settings };
  prefs = { ...(defaults.prefs || {}), ...prefs };
  genSettings = { ...(defaults.gen || {}), ...genSettings };

  // 从 server 加载 JSON 数据（失败回退本地缓存）
  const [chars, presets, lore, s, u, srvSessions, g] = await Promise.all([
    loadServerData('characters'),
    loadServerData('presets'),
    loadServerData('lorebooks'),
    loadServerData('settings'),
    loadServerData('user'),
    loadServerData('sessions'),
    loadServerData('gen'),
  ]);
  if (chars && Array.isArray(chars)) characters = chars;
  if (presets && typeof presets === 'object') promptPresets = presets;
  if (lore && typeof lore === 'object') lorebooks = lore;
  if (u && typeof u === 'object' && u.presets) userData = u;
  if (s && typeof s === 'object') settings = { ...DEFAULT_SETTINGS, ...s };
  if (g && typeof g === 'object' && !Array.isArray(g)) genSettings = { ...(defaults.gen || {}), ...g };
  saveGenerationSettings();
  // 会话与 server 合并（首次迁移 / 跨浏览器取并集），必须在 ensureSessions 之前
  syncSessionsFromServer(srvSessions);

  // 迁移：_defaults 新增的示例预设自动并入（不覆盖用户已修改的同名预设）
  if (defaults && defaults.presets && typeof defaults.presets === 'object') {
    let changed = false;
    for (const k of Object.keys(defaults.presets)) {
      if (promptPresets[k] === undefined) {
        promptPresets[k] = defaults.presets[k];
        changed = true;
      }
    }
    if (changed) savePresets();
  }

  renderProviderOptions();
  renderFormatOptions();

  ensureChars();
  ensureLorebooks();
  ensureCharacterBookLorebooks();
  renderBindSelects();
  ensureEntryIds();
  // 清理旧版遗留的纯占位角色
  if (characters.length && characters.every(c => !c.name || c.name === '？？？')) {
    characters = [];
    currentCharId = null;
    localStorage.removeItem(LS_CURRENT_CHAR);
    saveChars();
  }
  let presetsMigrated = ensurePromptPresetsV2();
  if (migrateBuiltInTavernPreset(defaults)) presetsMigrated = true;
  prefs.currentPresetByMode = { ...(prefs.currentPresetByMode || {}) };
  for (const targetMode of ['tavern', 'rpg']) {
    const hasSavedPreset = Object.prototype.hasOwnProperty.call(prefs.currentPresetByMode, targetMode);
    const savedPreset = prefs.currentPresetByMode[targetMode];
    if (!hasSavedPreset || (savedPreset && !promptPresets[savedPreset])) prefs.currentPresetByMode[targetMode] = activePresetNameForMode(targetMode);
  }
  prefs.currentPreset = prefs.currentPresetByMode[mode] || '';
  saveJSON(LS_PREFS, prefs);
  if (presetsMigrated) savePresets();
  applyTypography(); // 启动即恢复用户排版（覆盖 :root 默认变量）
  ensureSessions();
  applyTheme();
  applyMode(mode);
  bindEvents();
  renderMessages();
  renderCharacter();
  renderSessions();
  renderCharList();
  renderDevtools();
  updateApiStatusFromSettings();
  await syncWorldDraftRoute();
}
init();

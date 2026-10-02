import io

# ═══════ 1) sw.js：预缓存 vendor；非文档请求失败时不要拿 index.html 顶替 ═══════
p = 'public/sw.js'
s = io.open(p, encoding='utf-8').read()
old = "const SHELL = ['/', '/index.html', '/styles.css', '/mapgen.js?v=' + ASSET_VERSION, '/app.js?v=' + ASSET_VERSION, '/vendor/marked.min.js', '/vendor/purify.min.js', '/vendor/mapgen2.bundle.js', '/manifest.json'];"
new = "const SHELL = ['/', '/index.html', '/styles.css', '/mapgen.js?v=' + ASSET_VERSION, '/app.js?v=' + ASSET_VERSION, '/vendor/marked.min.js', '/vendor/purify.min.js', '/vendor/mapgen2.bundle.js', '/vendor/coloris/coloris.min.js', '/vendor/coloris/coloris.min.css', '/manifest.json'];"
assert s.count(old) == 1, 'SHELL 锚点不符'
s = s.replace(old, new, 1)

old = """      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('/')))"""
new = """      /* 注意：这里不能拿 '/' 兜底。脚本/样式请求若返回 index.html，
        浏览器会报 "Unexpected token '<'"（表现为第三方库失效），
         而且错误现场很难和“文件不存在”区分开。命中缓存就返回，否则明确失败。 */
      .catch(() => caches.match(e.request).then((hit) => hit || new Response('', { status: 504, statusText: 'Offline' })))"""
assert s.count(old) == 1, 'fetch 回退锚点不符'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('sw.js OK')

# ═══════ 2) index.html：设置页文案 ═══════
p = 'public/index.html'
s = io.open(p, encoding='utf-8').read()
old = """            <p id="toast-status" class="hint" role="status" aria-live="polite">修改即时生效并自动保存。</p>"""
new = """            <p id="toast-status" class="hint" role="status" aria-live="polite">修改后自动保存并立即生效。</p>"""
assert s.count(old) == 1, '文案锚点不符'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('index.html OK')

# ═══════ 3) app-ui.js：颜色校验 + 同步 Coloris + 保存弹提示 ═══════
p = 'frontend/app-ui.js'
s = io.open(p, encoding='utf-8').read()

old = """function fillToastForm() {
  if (!$('toast-bg')) return;
  const cfg = toastConfig();
  $('toast-bg').value = cfg.bg;
  $('toast-fg').value = cfg.fg;
  $('toast-accent').value = cfg.accent;
  $('toast-success-color').value = cfg.success;
  $('toast-warning-color').value = cfg.warning;
  $('toast-error-color').value = cfg.error;"""
new = """/* 规范化颜色：支持 #rgb / #rrggbb，统一小写；非法返回 ''（由调用方决定兜底）。 */
function normalizeHexColor(value) {
  const text = String(value || '').trim();
  const m = text.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return '';
  let hex = m[1].toLowerCase();
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  return '#' + hex;
}
const TOAST_COLOR_FIELDS = [
  ['toast-bg', 'bg'],
  ['toast-fg', 'fg'],
  ['toast-accent', 'accent'],
  ['toast-success-color', 'success'],
  ['toast-warning-color', 'warning'],
  ['toast-error-color', 'error'],
];
/* 写值时必须派发 input：Coloris 靠这个事件刷新旁边的预览块，
   只改 input.value 的话，设置页看起来“没恢复”。 */
function setColorField(id, value) {
  const el = $(id);
  if (!el) return;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function fillToastForm() {
  if (!$('toast-bg')) return;
  const cfg = toastConfig();
  TOAST_COLOR_FIELDS.forEach(([id, key]) => setColorField(id, cfg[key]));"""
assert s.count(old) == 1, 'fillToastForm 锚点不符'
s = s.replace(old, new, 1)

old = """function readToastForm(save = false) {
  if (!$('toast-bg')) return;
  settings.toast = {
    bg: $('toast-bg').value,
    fg: $('toast-fg').value,
    accent: $('toast-accent').value,
    success: $('toast-success-color').value,
    warning: $('toast-warning-color').value,
    error: $('toast-error-color').value,"""
new = """function readToastForm(save = false) {
  if (!$('toast-bg')) return;
  const previous = Object.assign({}, toastConfig());
  const colors = {};
  let invalid = null;
  TOAST_COLOR_FIELDS.forEach(([id, key]) => {
    const hex = normalizeHexColor($(id).value);
    if (hex) colors[key] = hex;
    else {
      // 空值/乱写一律回落到原值，避免把空颜色存进设置（那会让字段看起来是空的）
      invalid = invalid || key;
      colors[key] = previous[key];
      setColorField(id, previous[key]);
    }
  });
  settings.toast = {
    ...colors,"""
assert s.count(old) == 1, 'readToastForm 锚点不符'
s = s.replace(old, new, 1)

old = """  applyToastTheme(); // 即时预览
  clearTimeout(toastSaveTimer);
  toastSaveTimer = setTimeout(async () => {
    let saved = false;
    try { saved = await saveSettings(); } catch (error) { console.warn('[Tavern] 消息外观保存失败:', error.message); }
    notify(saved ? '消息外观已保存。' : '已应用，但设置保存失败。', {
      slot: 'toast-status',
      slotClass: saved ? 'hint' : 'hint err',
      level: saved ? 'success' : 'error',
      silent: saved,
    });
  }, save ? 0 : 400);
}"""
new = """  applyToastTheme(); // 即时预览
  clearTimeout(toastSaveTimer);
  toastSaveTimer = setTimeout(async () => {
    let saved = false;
    try { saved = await saveSettings(); } catch (error) { console.warn('[Tavern] 消息外观保存失败:', error.message); }
    // 保存结果要弹出来（灵动岛）：静默只适用于“只写消息栏”的次要提示
    notify(saved ? '消息外观已保存。' : '已应用，但设置保存失败。', {
      slot: 'toast-status',
      slotClass: saved ? 'hint' : 'hint err',
      level: saved ? 'success' : 'error',
    });
  }, save ? 0 : 400);
  return invalid;
}"""
assert s.count(old) == 1, '保存回调锚点不符'
s = s.replace(old, new, 1)

old = """function resetToastForm() {
  settings.toast = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.toast));
  fillToastForm();
  applyToastTheme();
  readToastForm(true);
}"""
new = """function resetToastForm() {
  settings.toast = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.toast));
  fillToastForm();          // 表单 + Coloris 预览块一起回默认
  applyToastTheme();
  readToastForm(true);       // 再走一次读写，保证设置与表单完全一致
}"""
assert s.count(old) == 1, 'resetToastForm 锚点不符'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('app-ui.js OK')

# ═══════ 4) styles.css：热更改也要有过渡 ═══════
p = 'public/styles.css'
s = io.open(p, encoding='utf-8').read()
old = """  transition:
    width var(--toast-in, 250ms) var(--motion-out),"""
new = """  /* 热更改（提示已经弹出时改外观）也要平滑：否则字号/圆角/颜色都是瞬变，
     看起来像“没动效 + 闪一下”。颜色与圆角不参与尺寸过渡，单独给时长。 */
  transition:
    width var(--toast-in, 250ms) var(--motion-out),
    font-size var(--toast-out, 300ms) var(--motion-out),
    border-radius var(--toast-out, 300ms) var(--motion-out),
    background-color var(--toast-out, 300ms) var(--motion-out),
    color var(--toast-out, 300ms) var(--motion-out),
    border-color var(--toast-out, 300ms) var(--motion-out),"""
assert s.count(old) == 1, '.toast transition 锚点不符'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('styles.css OK')
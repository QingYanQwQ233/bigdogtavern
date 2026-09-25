'use strict';

// §7 无障碍约束的「运行时审计」——静态检查证明不了的测量项。
//
// 用法（浏览器控制台，或 Playwright 的 page.evaluate）：
//     const report = await auditUiAccessibility();
// 它**只读**，不改页面、不导航、不写存储。会短暂开合设置弹窗以测量其内部控件，
// 结束后恢复原状。
//
// 为什么需要它：§7 的两条核心约束（44px 命中区、输入框 16px）**只能测量**，
// 无法从源码证明——选择器匹配不到的元素、被覆盖的规则、祖先容器造成的实际尺寸，
// 都只有拿到 getBoundingClientRect / getComputedStyle 才看得见。
// 静态部分见 scripts/check_ui_accessibility.js。
//
// 阈值：命中区 44px、文字输入控件字号 16px（避免移动端聚焦自动缩放）。
// 复选框/单选框不参与字号判定（它们不触发文字缩放），但仍参与命中区判定。

async function auditUiAccessibility(options) {
  const opts = options || {};
  const MIN_HIT = opts.minHit || 44;
  const MIN_FONT = opts.minFont || 16;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const SEL = 'button, a[href], input, select, textarea, summary, [role="button"]';
  const TEXTUAL = /^(?:text|search|url|email|password|number|tel)$/i;

  const label = (el) => el.tagName.toLowerCase()
    + (el.id ? '#' + el.id : '')
    + ((typeof el.className === 'string' && el.className.trim()) ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');

  const isTextual = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea' || tag === 'select') return true;
    if (tag === 'input') return TEXTUAL.test(el.getAttribute('type') || 'text');
    return false;
  };

  const scan = (root) => {
    const hit = { checked: 0, below: [] };
    const font = { checked: 0, below: [] };
    for (const el of (root || document).querySelectorAll(SEL)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.closest('[hidden]') || el.closest('.hidden')) continue;
      hit.checked += 1;
      if (r.width < MIN_HIT || r.height < MIN_HIT) hit.below.push(`${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      if (!isTextual(el)) continue;
      font.checked += 1;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < MIN_FONT) font.below.push(`${label(el)} ${fs}px`);
    }
    return { hit, font };
  };

  const out = { viewport: `${innerWidth}x${innerHeight}`, states: {}, escape: [] };
  const modal = document.getElementById('settings-modal');
  const trigger = document.querySelector('.js-settings');

  // 回到干净状态
  if (modal && !modal.classList.contains('hidden')) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(250);
  }

  out.states['干净页面'] = scan(null);

  // 弹窗状态：只扫弹窗子树，避免背景元素重复计数
  if (modal && trigger) {
    trigger.click();
    await sleep(opts.settleMs || 700);
    const openedVisible = !modal.classList.contains('hidden');
    out.states['设置弹窗'] = scan(modal);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(opts.settleMs || 700);
    out.escape.push({
      modal: 'settings-modal',
      openedVisible,
      closedAfterEsc: modal.classList.contains('hidden'),
      focusReturnedToTrigger: document.activeElement === trigger,
      activeAfter: document.activeElement ? label(document.activeElement) : null,
    });
  }

  return out;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { auditUiAccessibility };
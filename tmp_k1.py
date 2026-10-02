import io

p = 'frontend/ai-runtime.js'
s = io.open(p, encoding='utf-8').read()

# ── ① summary 必须是 details 的直接子节点，否则 <details> 不认它（会显示默认文案）──
old = """      const main = document.createElement('div');
      main.className = 'cot-step-main';
      const text = document.createElement('div');
      text.className = 'cot-step-body';
      main.appendChild(head);
      main.appendChild(text);
      cot.appendChild(main);"""
new = """      const main = document.createElement('div');
      main.className = 'cot-step-main';
      const text = document.createElement('div');
      text.className = 'cot-step-body';
      main.appendChild(text);
      // summary 必须是 details 的直接子节点：放进 div 里 <details> 不认，
      // 会退化成默认文案（WebView 显示「详情」），而且折叠标题也没了。
      cot.appendChild(head);
      cot.appendChild(main);"""
assert s.count(old) == 1, 'summary 归属锚点不符'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('ai-runtime.js OK（summary 归属）')

# ── ② 交互优先：用户正在操作时不要因为「刚程序滚过」而忽略他的滚动 ──
p = 'frontend/app-ui.js'
s = io.open(p, encoding='utf-8').read()
old = """  chat.addEventListener('scroll', () => {
    if (Date.now() < chatScrollSuppressedUntil) return;
    if (Date.now() > userInteractingUntil) return;
    const distance = chat.scrollHeight - chat.scrollTop - chat.clientHeight;
    chatFollowLatest = distance <= 60;
  }, { passive: true });"""
new = """  chat.addEventListener('scroll', () => {
    const interacting = Date.now() <= userInteractingUntil;
    // 用户正在操作时优先级最高：程序每帧滚到底会不断刷新抑制窗口，
    // 如果这里无条件忽略，用户的滚动就永远落进抑制窗口，跟随状态再也改不掉
    // （表现就是「人拉不过程序」）。
    if (!interacting) return;
    const distance = chat.scrollHeight - chat.scrollTop - chat.clientHeight;
    chatFollowLatest = distance <= 60;
  }, { passive: true });"""
assert s.count(old) == 1, 'scroll 监听锚点不符'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('app-ui.js OK（交互优先）')
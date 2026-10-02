import io

p = 'frontend/app-ui.js'
s = io.open(p, encoding='utf-8').read()

old = """  chat.addEventListener('scroll', () => {
    if (Date.now() < chatScrollSuppressedUntil) return;
    const distance = chat.scrollHeight - chat.scrollTop - chat.clientHeight;
    // 到底了就恢复跟随：这一步不需要交互证明，否则用户「甩」到底部（惯性滚动
    // 结束时早已超出交互窗口）之后就一直不跟了。
    if (distance <= 60) {
      chatFollowLatest = true;
      return;
    }
    if (Date.now() > userInteractingUntil) return;
    chatFollowLatest = false;
  }, { passive: true });"""
new = """  // 只在「用户正在操作」时改跟随状态：
  //   用户往上翻 → 停止跟随（不抢他的滚动条）
  //   用户自己滚回底部 → 恢复跟随
  // 其余时刻（内容增长、程序滚动、浏览器滚动锚定）一律不动 —— 那些也会派发 scroll，
  // 之前凭它们改状态就会出现「明明没碰却突然不跟了 / 突然跳到底」。
  chat.addEventListener('scroll', () => {
    if (Date.now() < chatScrollSuppressedUntil) return;
    if (Date.now() > userInteractingUntil) return;
    const distance = chat.scrollHeight - chat.scrollTop - chat.clientHeight;
    chatFollowLatest = distance <= 60;
  }, { passive: true });"""
assert s.count(old) == 1, 'scroll 监听锚点不符'
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('app-ui.js OK（不抢交互）')
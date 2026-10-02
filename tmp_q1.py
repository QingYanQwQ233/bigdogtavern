import io

p = 'frontend/app-ui.js'
s = io.open(p, encoding='utf-8').read()

# 双保险：只要用户还在交互窗口内，程序一律不滚。
# 上一版依赖 touchmove 事件到达顺序，真机上仍被黏住 —— 这里从「滚动函数」本身拦。
old = """function chatStickToBottom(chat) {
  if (!chat || !chatFollowLatest) return false;"""
assert s.count(old) == 1, 'chatStickToBottom 锚点不符'
new = """function chatStickToBottom(chat) {
  if (!chat || !chatFollowLatest) return false;
  // 用户正在操作（触摸/滚轮/按键）：程序绝对不抢，哪怕 followLatest 还没更新
  if (typeof userInteractingUntil === 'number' && Date.now() <= userInteractingUntil) return false;"""
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('app-ui.js OK（交互窗口内程序不滚）')
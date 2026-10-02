import io

p = 'frontend/app-ui.js'
s = io.open(p, encoding='utf-8').read()

# userInteractingUntil 原本是 initChatFollowTracking 内的局部变量，
# chatStickToBottom 拿不到 —— 提升为模块级，供两处共用。
old = """  let userInteractingUntil = 0;
  const markInteraction = () => { userInteractingUntil = Date.now() + 600; };"""
assert s.count(old) == 1, '局部声明锚点不符'
new = """  const markInteraction = () => { chatUserInteractingUntil = Date.now() + 600; };"""
s = s.replace(old, new, 1)

old2 = """function chatStickToBottom(chat) {
  if (!chat || !chatFollowLatest) return false;
  // 用户正在操作（触摸/滚轮/按键）：程序绝对不抢，哪怕 followLatest 还没更新
  if (typeof userInteractingUntil === 'number' && Date.now() <= userInteractingUntil) return false;"""
assert s.count(old2) == 1, 'chatStickToBottom 锚点不符'
new2 = """function chatStickToBottom(chat) {
  if (!chat || !chatFollowLatest) return false;
  // 用户正在操作（触摸/滚轮/按键）：程序绝对不抢，哪怕 followLatest 还没更新
  if (Date.now() <= chatUserInteractingUntil) return false;"""
s = s.replace(old2, new2, 1)

# 模块级声明放在 chatStickToBottom 之前
old3 = """function chatStickToBottom(chat) {"""
assert s.count(old3) == 1, '函数锚点不符'
s = s.replace(old3, """let chatUserInteractingUntil = 0;
/* 用户是否正在操作聊天列表（触摸/滚轮/按键后 600ms 内）。 */
function chatStickToBottom(chat) {""", 1)

io.open(p, 'w', encoding='utf-8').write(s)
print('app-ui.js OK（提升作用域 + 双保险）')
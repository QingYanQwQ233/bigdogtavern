import io

p = 'frontend/app-ui.js'
s = io.open(p, encoding='utf-8').read()

old = """  let userInteractingUntil = 0;
  const markInteraction = () => { userInteractingUntil = Date.now() + 600; };"""
assert s.count(old) == 1, 'A'
s = s.replace(old, """  const markInteraction = () => { chatUserInteractingUntil = Date.now() + 600; };""", 1)

old2 = """function chatStickToBottom(chat) {
  if (!chat || !chatFollowLatest) return false;"""
assert s.count(old2) == 1, 'B'
s = s.replace(old2, """let chatUserInteractingUntil = 0;
/* 用户是否正在操作聊天列表（触摸/滚轮/按键后 600ms 内）。 */
function chatStickToBottom(chat) {
  if (!chat || !chatFollowLatest) return false;
  // 用户正在操作：程序绝对不抢，哪怕 followLatest 还没更新
  if (Date.now() <= chatUserInteractingUntil) return false;""", 1)

old3 = "const interacting = Date.now() <= userInteractingUntil;"
assert s.count(old3) == 1, 'C'
s = s.replace(old3, "const interacting = Date.now() <= chatUserInteractingUntil;", 1)

io.open(p, 'w', encoding='utf-8').write(s)
print('app-ui.js OK（提升作用域 + 双保险）')
import io

p = 'frontend/app-ui.js'
s = io.open(p, encoding='utf-8').read()

# 1) 重置渲染窗口 = 有新消息/用户主动操作 ⇒ 下一次渲染应当贴底
old = """function resetMessageRenderWindow() {
  messageRenderWindow.start = 0;
  messageRenderWindow.preserveScroll = false;
}"""
new = """function resetMessageRenderWindow() {
  messageRenderWindow.start = 0;
  messageRenderWindow.preserveScroll = false;
  // 只有这里（新消息落地）才强制贴底。
  // 生成结束、刷新列表等其他渲染一律不动用户的位置，否则看到一半就被拽回底部。
  messageRenderWindow.stickToLatest = true;
}"""
assert s.count(old) == 1, 'resetMessageRenderWindow 锚点不符'
s = s.replace(old, new, 1)

# 2) 渲染尾部：区分「该贴底」与「只在贴底时跟随」
old = """  if (preserveScroll) chat.scrollTop = Math.max(0, chat.scrollHeight - previousScrollHeight + previousScrollTop);
  else scrollChatToLatest(chat, conversationKey);
}"""
new = """  const stick = messageRenderWindow.stickToLatest === true;
  messageRenderWindow.stickToLatest = false;
  if (preserveScroll) chat.scrollTop = Math.max(0, chat.scrollHeight - previousScrollHeight + previousScrollTop);
  else if (stick) scrollChatToLatest(chat, conversationKey);
  // 其余情况（生成完成、列表刷新）只在用户本来就贴底时才跟随
  else chatStickToBottom(chat);
}"""
assert s.count(old) == 1, 'renderMessages 滚动锚点不符'
s = s.replace(old, new, 1)

# 3) messageRenderWindow 初始值补字段
old = """const messageRenderWindow = {"""
new = """const messageRenderWindow = { stickToLatest: false,"""
assert s.count(old) == 1, 'messageRenderWindow 定义锚点不符'
s = s.replace(old, new, 1)

io.open(p, 'w', encoding='utf-8').write(s)
print('app-ui.js OK')
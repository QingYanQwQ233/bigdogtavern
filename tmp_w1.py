import io

p = 'frontend/ai-runtime.js'
s = io.open(p, encoding='utf-8').read()

# 回合收尾：模型只给推理不给正文时，之前会静默「完成」并返回空回复，
# 界面看起来就是「正文凭空消失」。这里明确报出来。
old = """    if (!response.calls.length) {
      session.status = 'complete';
      appendRpgAgentEvent(session, 'turn.complete', { contentChars: String(response.content || '').length });"""
assert s.count(old) == 1, 'A'
new = """    if (!response.calls.length) {
      // 思考型模型可能把输出预算全烧在推理上，正文一个字没有。
      // 静默「完成」会让界面显示空回复（看起来像正文丢了），必须明确报错。
      if (!String(response.content || '').trim() && String(response.cot || '').trim()) {
        session.status = 'error';
        appendRpgAgentEvent(session, 'turn.error', { reason: 'reasoning_budget_exhausted' });
        throw new Error('模型把输出预算全用在「思考」上了（正文为空、推理约 ' + String(response.cot || '').length + ' 字）。请到「设置 → 连接」把「回复 Token 上限」调大（建议 8000 以上）后重试。');
      }
      session.status = 'complete';
      appendRpgAgentEvent(session, 'turn.complete', { contentChars: String(response.content || '').length });"""
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('ai-runtime.js OK（回合空正文明确报错）')
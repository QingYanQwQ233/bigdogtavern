import io

# ═══════ ai-runtime.js：把该步正文片段传进步骤记录 ═══════
p = 'frontend/ai-runtime.js'
s = io.open(p, encoding='utf-8').read()

old = """    appendRpgAgentStep(session, {
      label: stepLabel,
      cot: response.cot,
      tools: (response.calls || []).map(call => ({ name: call.name, args: call.arguments })),
    });"""
new = """    appendRpgAgentStep(session, {
      label: stepLabel,
      cot: response.cot,
      narrative: response.content,
      tools: (response.calls || []).map(call => ({ name: call.name, args: call.arguments })),
    });"""
assert s.count(old) == 1, 'native 分支 appendRpgAgentStep 锚点不符'
s = s.replace(old, new, 1)

old = """    session.cot = appendRpgAgentCot(session.cot, { label: stepLabel, cot: response.cot });"""
assert s.count(old) >= 1
# 兼容分支（requestRpgCompatReply）也补上 narrative：先找它那一处
old2 = """      label: stepLabel,
      cot: response.cot,
      tools: (response.calls || response.nativeCalls || []).map(call => ({ name: call.name, args: call.arguments })),"""
if s.count(old2) == 1:
    s = s.replace(old2, """      label: stepLabel,
      cot: response.cot,
      narrative: response.content,
      tools: (response.calls || response.nativeCalls || []).map(call => ({ name: call.name, args: call.arguments })),""", 1)
    print('compat 分支已补')
else:
    print('compat 分支锚点未命中，跳过（后续 grep 确认）')

io.open(p, 'w', encoding='utf-8').write(s)
print('ai-runtime.js OK')
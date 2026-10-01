import io, re

# ═══════════ A) rpg-world.js：思维链按步骤分段 + 失败记录持久化 ═══════════
p = 'frontend/rpg-world.js'
s = io.open(p, encoding='utf-8').read()

# A1) 分段 helper（单回合可能跑多步，合成一段就看不出 agent loop 结构）
anchor = """function publishRpgAgentStep(session, response, targetScope, status = 'Agent 步骤完成') {"""
helper = """/* 思维链按 Agent 步骤分段：一个回合可能跑多步（夹杂工具调用），
   合成一整段会让玩家看不出 loop 结构，也分不清哪段思考对应哪次工具调用。 */
function appendRpgAgentCot(previous, { label = '', cot = '' } = {}) {
  const head = label ? `── ${label} ──` : '';
  const body = String(cot || '').trim();
  if (!head && !body) return previous || '';
  return `${previous ? `${previous}\\n\\n` : ''}${[head, body].filter(Boolean).join('\\n')}`;
}

"""
assert s.count(anchor) == 1, 'publishRpgAgentStep 锚点不符'
s = s.replace(anchor, helper + anchor)

# A2) 失败记录持久化：只放内存的话，退出重进就查无此事，玩家回合卡住却没有任何入口
anchor2 = """function worldTurnErrorActive() {"""
persist = """/* 回合失败要能扛住重启：失败原因与它属于哪个存档要落盘，
   否则退出重进后错误提示消失，回合却仍是未提交状态，玩家无从处理。 */
function persistWorldTurnFailure(message) {
  const session = typeof curSession === 'function' ? curSession() : null;
  if (!session) return;
  session.worldTurnFailure = {
    saveId: currentWorldSaveId,
    message: String(message || '本回合未提交'),
    ts: Date.now(),
  };
  saveSessions(session);
}
function clearWorldTurnFailure() {
  const session = typeof curSession === 'function' ? curSession() : null;
  if (session && session.worldTurnFailure) {
    delete session.worldTurnFailure;
    saveSessions(session);
  }
}
function restoredWorldTurnFailure() {
  const session = typeof curSession === 'function' ? curSession() : null;
  const record = session && session.worldTurnFailure;
  if (!record || record.saveId !== currentWorldSaveId) return null;
  return record;
}
/* 界面统一从这里取失败原因：内存里的最新，落盘里的用于重进后恢复。 */
function currentWorldTurnFailureMessage() {
  if (worldTurnError && worldTurnError.saveId === currentWorldSaveId) return worldTurnError.message;
  const record = restoredWorldTurnFailure();
  return record ? record.message : '';
}

function worldTurnErrorActive() {"""
assert s.count(anchor2) == 1, 'worldTurnErrorActive 锚点不符'
s = s.replace(anchor2, persist)

# A3) 有落盘记录时，也视为「失败待处理」
old = """function worldTurnErrorActive() {
  return worldModeActive() && !!worldTurnError && worldTurnError.saveId === currentWorldSaveId;
}"""
new = """function worldTurnErrorActive() {
  if (!worldModeActive()) return false;
  if (worldTurnError && worldTurnError.saveId === currentWorldSaveId) return true;
  // 重进后内存状态没了，但落盘的失败记录还在 —— 仍要给出处理入口。
  return !!restoredWorldTurnFailure();
}"""
assert s.count(old) == 1, 'worldTurnErrorActive 主体锚点不符'
s = s.replace(old, new)

# A4) 失败时落盘
old = """  worldTurnError = {
    saveId: worldTurnPending.saveId,
    commandId: worldTurnPending.commandId,
    message: String(message || '本回合未提交'),
  };"""
new = """  worldTurnError = {
    saveId: worldTurnPending.saveId,
    commandId: worldTurnPending.commandId,
    message: String(message || '本回合未提交'),
  };
  persistWorldTurnFailure(message);"""
assert s.count(old) == 1, 'failWorldTurnPending 锚点不符'
s = s.replace(old, new)

# A5) 清内存状态的地方，一并清落盘记录
lines = s.split('\n')
out, cleared = [], 0
for line in lines:
    out.append(line)
    if line.strip() == 'worldTurnError = null;':
        out.append(f"{line[:len(line) - len(line.lstrip())]}clearWorldTurnFailure();")
        cleared += 1
assert cleared == 3, 'worldTurnError 清理点数量变化：%d' % cleared
s = '\n'.join(out)
io.open(p, 'w', encoding='utf-8').write(s)
print('rpg-world.js OK（cot 分段 helper + 失败落盘，清理点 %d 处）' % cleared)

# ═══════════ B) ai-runtime.js：每步思维链带步骤标签与工具名 ═══════════
p = 'frontend/ai-runtime.js'
s = io.open(p, encoding='utf-8').read()

old = """    session.cot += `${session.cot && response.cot ? '\\n\\n' : ''}${response.cot || ''}`;
    if (!response.calls.length) {"""
new = """    session.cot = appendRpgAgentCot(session.cot, {
      label: `${finalOnly ? '最终步骤' : `步骤 ${step + 1}`}${(response.calls || []).length ? `（${response.calls.map(call => call.name || '工具').join('、')}）` : ''}`,
      cot: response.cot,
    });
    if (!response.calls.length) {"""
assert s.count(old) == 1, 'native cot 累积锚点不符'
s = s.replace(old, new)

old = """    session.cot += `${session.cot && response.cot ? '\\n\\n' : ''}${response.cot || ''}`;
    const previousPreview = session.previewNarrative;"""
new = """    session.cot = appendRpgAgentCot(session.cot, {
      label: `${finalOnly ? '最终步骤' : `步骤 ${step + 1}`}${(response.calls || []).length ? `（${response.calls.map(call => call.name || '工具').join('、')}）` : ''}`,
      cot: response.cot,
    });
    const previousPreview = session.previewNarrative;"""
assert s.count(old) == 1, 'compat cot 累积锚点不符'
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8').write(s)
print('ai-runtime.js OK')

# ═══════════ C) app-ui.js：错误提示用统一取数 + 无草稿时不给「重试 AI」 ═══════════
p = 'frontend/app-ui.js'
s = io.open(p, encoding='utf-8').read()
old = """    syncWorldTurnErrorNotice(`本回合未提交${phase}：${worldTurnError.message}`);
    const actions = document.createElement('div');
    actions.className = 'world-turn-actions';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn gold small';
    retry.textContent = '重试 AI';
    retry.addEventListener('click', retryWorldTurn);
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'btn ghost small';
    reset.textContent = '重置本回合';
    reset.addEventListener('click', discardWorldTurnPending);
    actions.append(retry, reset);
    qa.appendChild(actions);
    return;"""
new = """    syncWorldTurnErrorNotice(`本回合未提交${phase}：${currentWorldTurnFailureMessage()}`);
    const actions = document.createElement('div');
    actions.className = 'world-turn-actions';
    // 草稿只在本次会话的内存里：退出重进后 pending 已丢，这时「重试 AI」没有草稿可发，
    // 给了也是死按钮。所以按能力显示：有草稿才给重试，否则只留「重置本回合」。
    if (worldTurnPendingActive()) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn gold small';
      retry.textContent = '重试 AI';
      retry.addEventListener('click', retryWorldTurn);
      actions.append(retry);
    }
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'btn ghost small';
    reset.textContent = '重置本回合';
    reset.addEventListener('click', () => {
      clearWorldTurnFailure();
      discardWorldTurnPending();
      renderMessages();
    });
    actions.append(reset);
    qa.appendChild(actions);
    return;"""
assert s.count(old) == 1, '错误操作区锚点不符'
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8').write(s)
print('app-ui.js OK')
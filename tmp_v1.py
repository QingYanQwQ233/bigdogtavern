import io

# ══ 开场候选：识别「预算全被思考吃光」并给出可执行指引 ══
p = 'frontend/rpg-world.js'
s = io.open(p, encoding='utf-8').read()

old = """    let reply;
    if (payload.body.stream) reply = (await callAPIStream(payload)).content;
    else reply = (await callAPI(payload))?.choices?.[0]?.message?.content;
    const processed = processAIOutput(reply || '');
    if (!processed.content || !processed.options || processed.options.length !== 4) throw new Error('AI 未返回合规的开场正文与 4 个选项');"""
assert s.count(old) == 1, 'A'
new = """    let reply;
    let replyCot = '';
    if (payload.body.stream) {
      const streamResult = await callAPIStream(payload);
      reply = streamResult.content;
      replyCot = String(streamResult.cot || '');
    } else {
      const message = (await callAPI(payload))?.choices?.[0]?.message;
      reply = message?.content;
      replyCot = String(message?.reasoning_content || '');
    }
    const processed = processAIOutput(reply || '');
    if (!processed.content || !processed.options || processed.options.length !== 4) {
      // 思考型模型（如 deepseek-flash）可能把整个输出预算都用在推理上，
      // 正文一个字都写不出来。这时报「未返回合规」会让人以为是协议问题，
      // 实际是预算不够 —— 明确点出来。
      if (!String(reply || '').trim() && replyCot.trim()) {
        throw new Error('模型把输出预算全用在「思考」上了（正文为空、推理约 ' + replyCot.length + ' 字）。请到「设置 → 连接」把「回复 Token 上限」调大（建议 8000 以上）后重试。');
      }
      throw new Error('AI 未返回合规的开场正文与 4 个选项');
    }"""
s = s.replace(old, new, 1)
io.open(p, 'w', encoding='utf-8').write(s)
print('rpg-world.js OK（开场预算指引）')
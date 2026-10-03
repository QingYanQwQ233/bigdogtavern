import json, io, hashlib

DOC = 'docs/demo-galgame-visual-novel.tavern-world.json'
d = json.load(io.open(DOC, encoding='utf-8'))
ext = d['content']['world']['ui']['extension']
js = ext['js']

# 修掉被转义吃掉的引号实体：原来落成 '"':'"'（合法但转义不完整）
bad = """'">':'">'"""
good = "'\\u0022':'"'"
if bad in js:
    js = js.replace(bad, good, 1)
    print('fixed: escapeHtml quote entity')
else:
    # 退化处理：直接重写整个 escapeHtml 函数体
    import re
    js = re.sub(
        r"function escapeHtml\(s\)\{[^\n]*\}",
        "function escapeHtml(s){return String(s).replace(/[&<>\\\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"
        "'\\u0022':'"'}[c]));}",
        js, count=1)
    print('rewrote: escapeHtml')

ext['js'] = js


def canonical_json(v):
    if isinstance(v, list):
        return '[' + ','.join(canonical_json(x) for x in v) + ']'
    if isinstance(v, dict):
        return '{' + ','.join(json.dumps(k) + ':' + canonical_json(v[k]) for k in sorted(v.keys())) + '}'
    return json.dumps(v, ensure_ascii=False)


d['manifest']['contentHash'] = 'sha256:' + hashlib.sha256(
    canonical_json({'content': d['content'], 'assets': d['assets']}).encode('utf-8')).hexdigest()

io.open(DOC, 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=1))
io.open('/tmp/vn_check.js', 'w', encoding='utf-8').write(js)
print('new hash:', d['manifest']['contentHash'][:30])
print('escapeHtml line:')
for l in js.split('\n'):
    if 'escapeHtml(s)' in l:
        print('   ', l[:150])
        break
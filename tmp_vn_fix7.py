import json, io, hashlib

DOC = 'docs/demo-galgame-visual-novel.tavern-world.json'
d = json.load(io.open(DOC, encoding='utf-8'))
ext = d['content']['world']['ui']['extension']
js = ext['js']

# ── 1) 还原上一次的错误改动 ──
bad_head = "(()=>{\nfunction boot(){\nconst root=document.getElementById('vn-root');if(!root)return;"
good_head = "(()=>{\nconst root=document.getElementById('vn-root');if(!root)return;"
assert bad_head in js, '待还原的头部未找到'
js = js.replace(bad_head, good_head, 1)

bad_tail = ("}\n"
            "if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',boot);}\n"
            "else{boot();}\n"
            "})();")
assert js.endswith(bad_tail), '待还原的尾部未找到'
js = js[:-len(bad_tail)] + "boot();\n})();"

# ── 2) 正确的修复：整段逻辑包成 start()，DOM 就绪后调用 ──
assert js.startswith("(()=>{\nconst root="), 'IIFE 起点不符'
js = js.replace("(()=>{\nconst root=", "(()=>{const start=function(){\nconst root=", 1)

assert js.endswith("boot();\n})();"), 'IIFE 终点不符'
js = js[:-len("boot();\n})();")] + (
    "}\n"
    "if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',start);}\n"
    "else{start();}\n"
    "})();"
)

# ── 3) 结构自检 ──
assert js.count('const start=function(){') == 1, 'start 定义数不对'
assert js.count('document.getElementById(\'vn-root\')') == 1, 'root 取值数不对'
assert 'function boot(){' in js, '原有 boot 定义丢失'
# start 必须包住原有的 boot 定义与调用
i_start = js.index('const start=function(){')
i_boot_def = js.index('function boot(){')
i_boot_call = js.rindex('boot();')
i_start_end = js.index("}\nif(document.readyState")
assert i_start < i_boot_def < i_boot_call < i_start_end, '嵌套顺序不对'

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
io.open('/tmp/vn_final.js', 'w', encoding='utf-8').write(js)
print('patched; js lines', len(js.split('\n')))
print('head:', js[:60].replace('\n', ' | '))
print('tail:', js[-150:].replace('\n', ' | '))
print('hash:', d['manifest']['contentHash'][:32])

# 顺便重建预览页（这次把 % 转义修正）
page_src = io.open('public/vn-preview.html', encoding='utf-8').read() if io.path.exists('public/vn-preview.html') else None
print('preview exists:', bool(page_src))
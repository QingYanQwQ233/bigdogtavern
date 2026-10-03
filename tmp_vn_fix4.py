import json, io, hashlib

DOC = 'docs/demo-galgame-visual-novel.tavern-world.json'
d = json.load(io.open(DOC, encoding='utf-8'))
ext = d['content']['world']['ui']['extension']
js = ext['js']

opening = "(()=>{\nconst root=document.getElementById('vn-root');if(!root)return;"
assert opening in js, 'IIFE 头未匹配'
js = js.replace(opening, "(()=>{\nfunction boot(){\nconst root=document.getElementById('vn-root');if(!root)return;", 1)

tail = "boot();\n})();"
assert tail in js, 'IIFE 尾未匹配'
js = js.replace(tail,
                "boot();\n}\n"
                "if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);\n"
                "else boot();\n})();", 1)

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
io.open('/tmp/vn_check3.js', 'w', encoding='utf-8').write(js)
print('patched; js len', len(js))
print('hash:', d['manifest']['contentHash'][:32])
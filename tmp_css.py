import io

p = 'public/styles.css'
s = io.open(p, encoding='utf-8').read()
old = 'env(safe-area-inset-bottom)'
new = 'var(--safe-bottom, env(safe-area-inset-bottom))'
n = s.count(old)
assert n >= 6, 'bottom env 命中数异常：%d' % n
s = s.replace(old, new)
assert 'env(safe-area-inset-top)' in s and 'var(--safe-top' not in s, '顶部不应改动'
io.open(p, 'w', encoding='utf-8').write(s)
print('styles.css OK：%d 处 bottom 改为变量' % n)
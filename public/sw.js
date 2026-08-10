/* Tavern service worker：network-first（在线永远取最新，离线兜底缓存壳文件）
 * 与 server 的 no-cache 策略配合：在线时每次拿最新代码，断网/壳内离线时用缓存。
 */
const CACHE = 'tavern-v1';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/mapgen.js', '/vendor/marked.min.js', '/vendor/purify.min.js', '/vendor/mapgen2.bundle.js', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 只接管同源 GET 请求（API 动态请求一律走网络，不缓存）
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/images/')) return;
  // network-first：先网络，失败回退缓存
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('/')))
  );
});

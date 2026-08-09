/**
 * Tavern · AI RP 框架演示 —— 本地服务器
 *
 * 零依赖（Node 18+，自带 fetch），同时提供：
 *   1. 静态文件服务（public/）
 *   2. POST /api/chat 代理：把 OpenAI 兼容的 Chat Completions 请求转发到
 *      用户自定义的任意 API，并注入 Authorization 头，绕开浏览器 CORS 限制。
 *
 * 安全提醒：仅供本地开发 / 演示使用。代理不做鉴权与 SSRF 防护，
 * 请勿直接部署到公网。
 *
 * 运行：node server.js  →  http://localhost:3000
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(PUBLIC_DIR, 'data');
// --api-only：只暴露 /api/*（无网页），供公网纯 API 场景
const API_ONLY = process.argv.includes('--api-only');

const DATA_TYPES = ['characters', 'presets', 'lorebooks', 'settings', 'user'];
const DEFAULTS_PATH = path.join(DATA_DIR, '_defaults.json');

/* 默认模板：从 public/data/_defaults.json 读取（唯一数据源，代码不写死内容） */
function loadDefaults() {
  try {
    const raw = fs.readFileSync(DEFAULTS_PATH, 'utf-8');
    const d = JSON.parse(raw);
    return {
      characters: Array.isArray(d.characters) ? d.characters : [],
      presets: (d.presets && typeof d.presets === 'object') ? d.presets : {},
      user: (d.user && typeof d.user === 'object') ? d.user : { presets: {}, memories: [] },
      lorebooks: (d.lorebooks && typeof d.lorebooks === 'object') ? d.lorebooks : { default: { name: '默认世界书', entries: [] } },
      settings: (d.settings && typeof d.settings === 'object') ? d.settings : {},
      prefs: (d.prefs && typeof d.prefs === 'object') ? d.prefs : {},
      format: (d.format && typeof d.format === 'object') ? d.format : {},
      providers: Array.isArray(d.providers) ? d.providers : [],
      ui: (d.ui && typeof d.ui === 'object') ? d.ui : {},
      gen: (d.gen && typeof d.gen === 'object') ? d.gen : {},
    };
  } catch (e) {
    console.warn('[data] 读取 _defaults.json 失败（用空结构兜底）:', e.message);
    return { characters: [], presets: {}, lorebooks: { default: { name: '默认世界书', entries: [] } }, settings: {}, prefs: {}, format: {}, providers: [], ui: {} };
  }
}

/* 确保数据目录与初始 JSON 文件存在 */
async function ensureDataFiles() {
  const defaults = loadDefaults();
  try { await fs.promises.mkdir(DATA_DIR, { recursive: true }); } catch {}
  for (const type of DATA_TYPES) {
    const fp = path.join(DATA_DIR, type + '.json');
    try { await fs.promises.access(fp); }
    catch {
      // 文件不存在 → 从 _defaults.json 对应段初始化
      const initial = defaults[type] ?? {};
      await fs.promises.writeFile(fp, JSON.stringify(initial, null, 2), 'utf-8');
      console.log(`  [data] 初始化 ${type}.json`);
    }
  }
}

/** GET /api/data/:type → 返回 JSON 文件内容 */
async function handleDataGet(req, res, type) {
  if (!DATA_TYPES.includes(type)) return send(res, 400, '未知数据类型');
  const fp = path.join(DATA_DIR, type + '.json');
  try {
    const data = await fs.promises.readFile(fp, 'utf-8');
    send(res, 200, data, 'application/json; charset=utf-8');
  } catch (err) {
    console.error('[data] 读取失败:', type, err.message);
    send(res, 500, JSON.stringify({ error: '读取失败: ' + err.message }), 'application/json');
  }
}

/** PUT /api/data/:type → 覆盖写入 JSON 文件 */
async function handleDataPut(req, res, type) {
  if (!DATA_TYPES.includes(type)) return send(res, 400, '未知数据类型');
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf-8');
  try {
    JSON.parse(raw); // 校验是合法 JSON
  } catch {
    return send(res, 400, JSON.stringify({ error: '无效的 JSON' }), 'application/json');
  }
  const fp = path.join(DATA_DIR, type + '.json');
  try {
    await fs.promises.writeFile(fp, raw, 'utf-8');
    send(res, 200, JSON.stringify({ ok: true }), 'application/json');
  } catch (err) {
    console.error('[data] 写入失败:', type, err.message);
    send(res, 500, JSON.stringify({ error: '写入失败: ' + err.message }), 'application/json');
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const IMAGES_DIR = path.join(PUBLIC_DIR, 'images');

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

async function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden');
  try {
    const data = await fs.promises.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    // 强制不缓存：本地开发频繁改代码，避免浏览器用旧版 app.js 导致“改了没生效”
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.end(data);
  } catch (err) {
    if (err.code === 'ENOENT') send(res, 404, 'Not Found');
    else { console.error('[static]', err.message); send(res, 500, 'Internal Error'); }
  }
}

/**
 * 代理：前端把 { baseUrl, apiKey, extraHeaders?, body } 发来，
 * 这里拼出 <baseUrl>/chat/completions 原样转发（含流式 SSE）。
 * body 由前端完全控制（model / messages / temperature / stream 等）。
 */
async function handleChat(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf-8');
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return send(res, 400, 'Bad JSON');
  }

  const { baseUrl, apiKey, body } = payload || {};
  if (!baseUrl || !body) return send(res, 400, '缺少 baseUrl 或 body');

  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
  if (payload.extraHeaders && typeof payload.extraHeaders === 'object') {
    Object.assign(headers, payload.extraHeaders); // 例如 OpenRouter 的 X-Title
  }

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
    });
    // 流式管道转发（SSE 逐块透传，也兼容非流式）
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    console.error('[proxy] 请求失败:', err.message);
    send(res, 502, JSON.stringify({ error: { message: '代理请求失败: ' + err.message } }), 'application/json');
  }
}

/** 模型列表代理：GET /api/models（前端带 X-Base-Url / X-Api-Key 头） */
async function handleModels(req, res) {
  const baseUrl = req.headers['x-base-url'];
  const apiKey = req.headers['x-api-key'] || '';
  if (!baseUrl) return send(res, 400, '缺少 X-Base-Url 头');
  const headers = {};
  if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
  try {
    const upstream = await fetch(baseUrl.replace(/\/+$/, '') + '/models', { headers });
    const text = await upstream.text();
    res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
    res.end(text);
  } catch (err) {
    console.error('[proxy] 获取模型失败:', err.message);
    send(res, 502, JSON.stringify({ error: { message: '获取模型失败: ' + err.message } }), 'application/json');
  }
}

/**
 * 文生图代理：POST /api/image
 * 前端发 { baseUrl, apiKey, kind: 'openai' | 'sd', body }：
 *   - kind='openai' → POST <baseUrl>/images/generations（OpenAI 兼容）
 *   - kind='sd'     → POST <baseUrl>/sdapi/v1/txt2img（Stable Diffusion WebUI）
 * 原样转发上游 JSON（含 base64 大图），注入 Authorization 头，绕开 CORS。
 */
async function handleImage(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf-8');
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return send(res, 400, 'Bad JSON');
  }
  const { baseUrl, apiKey, kind, body } = payload || {};
  if (!baseUrl || !body) return send(res, 400, '缺少 baseUrl 或 body');
  // kind=sd → img2img；openai 兼容：body 含 images（参考图）→ /images/edits，否则 /images/generations
  const pathname = kind === 'sd' ? '/sdapi/v1/txt2img'
    : (Array.isArray(body.images) && body.images.length ? '/images/edits' : '/images/generations');
  const url = baseUrl.replace(/\/+$/, '') + pathname;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
  try {
    const upstream = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await upstream.text();
    res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' });
    res.end(text);
  } catch (err) {
    console.error('[proxy] 文生图失败:', err.message);
    send(res, 502, JSON.stringify({ error: { message: '文生图代理请求失败: ' + err.message } }), 'application/json');
  }
}

/**
 * 文生图图片持久化：POST /api/image-save
 * 前端发 { b64: 'data:image/png;base64,...' } 或 { url: 'https://...' }，
 * server 存到 public/images/ 并返回可访问的相对路径（刷新页面图片不丢）。
 */
async function handleImageSave(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf-8');
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return send(res, 400, 'Bad JSON');
  }
  const { b64, url } = payload || {};
  let buf = null;
  try {
    if (b64) {
      const m = String(b64).match(/^data:image\/(\w+);base64,(.+)$/s);
      buf = m ? Buffer.from(m[2], 'base64') : Buffer.from(String(b64), 'base64');
    } else if (url) {
      const r = await fetch(String(url));
      if (!r.ok) return send(res, 502, JSON.stringify({ error: '下载图片失败: HTTP ' + r.status }), 'application/json');
      buf = Buffer.from(await r.arrayBuffer());
    }
  } catch (err) {
    return send(res, 502, JSON.stringify({ error: '保存图片失败: ' + err.message }), 'application/json');
  }
  if (!buf || !buf.length) return send(res, 400, JSON.stringify({ error: '缺少图片数据（b64 或 url）' }), 'application/json');
  try {
    await fs.promises.mkdir(IMAGES_DIR, { recursive: true });
    const name = Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + '.png';
    await fs.promises.writeFile(path.join(IMAGES_DIR, name), buf);
    send(res, 200, JSON.stringify({ path: '/images/' + name }), 'application/json');
  } catch (err) {
    console.error('[image] 写入失败:', err.message);
    send(res, 500, JSON.stringify({ error: '写入失败: ' + err.message }), 'application/json');
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'POST' && url.pathname === '/api/chat') return handleChat(req, res);
  if (req.method === 'POST' && url.pathname === '/api/image') return handleImage(req, res);
  if (req.method === 'POST' && url.pathname === '/api/image-save') return handleImageSave(req, res);
  if (req.method === 'GET' && url.pathname === '/api/models') return handleModels(req, res);
  // 数据读写：/api/data/:type
  const dataMatch = url.pathname.match(/^\/api\/data\/(\w+)$/);
  if (dataMatch) {
    if (req.method === 'GET' && dataMatch[1] === 'seed') {
      // 返回默认模板（示例数据 + 格式指令 + 服务预设 + 偏好），深拷贝避免引用污染
      return send(res, 200, JSON.stringify(JSON.parse(JSON.stringify(loadDefaults()))));
    }
    if (req.method === 'GET') return handleDataGet(req, res, dataMatch[1]);
    if (req.method === 'PUT') return handleDataPut(req, res, dataMatch[1]);
  }
  if (API_ONLY) {
    // 纯 API 模式：静态网页 / 图片一律不提供
    if (req.method === 'GET' || req.method === 'HEAD') return send(res, 404, 'Not Found (API only)');
  }
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url.pathname);
  send(res, 405, 'Method Not Allowed');
});

server.listen(PORT, async () => {
  await ensureDataFiles();
  console.log('──────────────────────────────────────────');
  console.log('  Tavern · AI RP 框架演示');
  console.log(`  打开: http://localhost:${PORT}`);
  console.log(`  静态目录: ${PUBLIC_DIR}`);
  console.log(`  数据目录: ${DATA_DIR}`);
  console.log('──────────────────────────────────────────');
});

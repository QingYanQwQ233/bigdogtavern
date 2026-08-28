/* ─────────── 掷骰（D&D 风格：d20+5 / 2d6-1 自动掷骰） ─────────── */
const DICE_RE = /(\d*)d(\d+)([+-]\d+)?/gi;
const MAX_DICE_BONUS = 1000;
function rollDiceIn(text) {
  const results = [];
  String(text || '').replace(DICE_RE, (m, cnt, die, mod) => {
    const n = Math.min(parseInt(cnt, 10) || 1, 100);
    const d = parseInt(die, 10) || 1;
    if (!Number.isInteger(n) || n < 1 || !Number.isInteger(d) || d < 1 || d > 1000000) return m;
    const bonus = mod ? parseInt(mod, 10) : 0;
    if (!Number.isInteger(bonus) || Math.abs(bonus) > MAX_DICE_BONUS) return m;
    const rolls = [];
    for (let i = 0; i < n; i++) rolls.push(1 + Math.floor(Math.random() * d));
    const sum = rolls.reduce((a, b) => a + b, 0);
    results.push({ expr: m, rolls, bonus, total: sum + bonus });
    return m;
  });
  return results;
}
function rollWorldDice(text) {
  const expressions = [];
  String(text || '').replace(DICE_RE, match => { if (!expressions.includes(match)) expressions.push(match); return match; });
  if (!expressions.length) return [];
  return rollDiceIn(expressions.join(' '));
}

/* ─────────── Markdown 渲染（marked + DOMPurify 消毒） ───────────
 * 参考 Open WebUI：解析后必须消毒（AI / 用户内容不可信）
 * 返回 { html, md }：md=true 表示已渲染，气泡加 .md 类取消 pre-wrap */
function normalizeTavernHtmlBlocks(content) {
  const source = String(content ?? '');
  const hasLayoutHtml = (value) => /<(?:html|body|main|section|article|header|footer|aside|nav|div|span|table|details|style|h[1-6]|p)\b/i.test(value)
    && /<\/[A-Za-z][\w:-]*\s*>/i.test(value);
  const htmlLine = /^\s*(?:<!--|<\/?[A-Za-z][\w:-]*(?:\s+[^<>]*|\/?\s*>))/i;

  // ST/JS-Slash-Runner 卡片常把正则替换结果标成 ```text```，但内容本身是完整 HTML。
  // 只在检测到完整布局时展开；最终仍交给 DOMPurify，脚本另经授权后进入隔离 iframe。
  let normalized = source.replace(/(^|\n)[ \t]*```(?:html?|xhtml|text|plaintext|markdown)?\s*\r?\n([\s\S]*?)\r?\n[ \t]*```/gi, (full, prefix, body) => (
    hasLayoutHtml(body) ? `${prefix}${body}` : full
  ));

  // Markdown 会把 4 个以上的前导空格当作代码块；卡片常把 HTML 子节点缩进，
  // 因此只在检测到完整 HTML 布局时去掉标签行缩进，保留普通文本与非 HTML 代码块。
  const chunks = normalized.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g);
  normalized = chunks.map((chunk, index) => {
    if (index % 2 || !hasLayoutHtml(chunk)) return chunk;
    return chunk.split(/\r?\n/).map(line => htmlLine.test(line) ? line.replace(/^[ \t]+/, '') : line).join('\n');
  }).join('');
  return normalized;
}

function expandDisplayMacros(content) {
  const userName = String(currentUserPreset()?.name || '玩家').replace(/[\r\n]+/g, ' ');
  return String(content ?? '').replace(/\{\{\s*user\s*\}\}/gi, userName);
}

/* DOMPurify 会移除 style 元素；卡片的声明式 HTML/CSS 需要保留样式，
 * 但不能把 CSS 变成主页面的任意脚本/外链入口。样式规则统一限定在当前消息容器。 */
const TAVERN_RENDER_SCOPE = '[data-tavern-rendered]';
function sanitizeTavernCss(css, scope = true) {
  let safe = String(css || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@(?:import|charset|namespace)[^;{}]*;?/gi, '')
    .replace(/url\s*\([^)]*\)/gi, '')
    .replace(/\b(?:expression|behavior|-moz-binding)\s*\([^)]*\)/gi, '')
    .replace(/(?:javascript|vbscript|data):/gi, '')
    .replace(/<\/?style/gi, '');
  if (!scope) return safe;
  return safe.replace(/(^|[{}])\s*([^{}@][^{]*)\{/g, (full, open, selectors) => {
    const scoped = selectors.split(',').map(selector => selector.trim())
      .filter(Boolean)
      .map(selector => {
        // 卡片常用 body/html/:root 作为整页背景选择器；消息气泡没有这些节点，
        // 将根选择器映射到当前消息容器，不能简单删掉（否则会留下裸 CSS 声明）。
        const rest = selector.replace(/^(?:(?:html\s+)?body|html|:root)\b/i, '').trim();
        if (!rest) return TAVERN_RENDER_SCOPE;
        return `${TAVERN_RENDER_SCOPE}${/^(?::|[>+~])/.test(rest) ? '' : ' '}${rest}`;
      }).join(', ');
    return scoped ? `${open}${scoped}{` : open;
  });
}

function extractTavernStyles(source, scope = true) {
  const styles = [];
  const chunks = String(source || '').split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g);
  const markup = chunks.map((chunk, index) => {
    if (index % 2) return chunk; // 代码块内的示例只能按文本显示
    return chunk.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (full, css) => {
      const safe = sanitizeTavernCss(css, scope);
      if (safe.trim()) styles.push(`<style data-tavern-card-style>${safe}</style>`);
      return '';
    });
  }).join('');
  return { markup, styles: styles.join('') };
}

/* 卡片脚本只在显式授权的完整兼容 iframe 中运行；代码块里的脚本仍是普通文本。 */
function extractTavernScripts(source) {
  const scripts = [];
  const chunks = String(source || '').split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g);
  const markup = chunks.map((chunk, index) => {
    if (index % 2) return chunk;
    return chunk.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (full, attrs, code) => {
      const src = String(attrs || '').match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] || '';
      scripts.push({ src: String(src).trim(), code: String(code || '') });
      return '';
    });
  }).join('');
  return { markup, scripts };
}

const TAVERN_CARD_EVENT_ATTRS = ['onclick', 'ondblclick', 'onchange', 'oninput', 'onsubmit', 'onload', 'onerror', 'onkeydown', 'onkeyup', 'onfocus', 'onblur'];

function safeTavernCardScriptUrl(value) {
  try {
    const parsed = new URL(String(value || ''), window.location.href);
    // ST 角色卡允许声明外部脚本；仍拒绝 javascript/data/file 等可执行协议。
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.href;
  } catch { return ''; }
}

function cardScriptInventory(char = currentChar()) {
  const entries = [];
  const seen = new Set();
  const visit = node => {
    if (typeof node === 'string') {
      if (!/<script\b/i.test(node)) return;
      // 角色卡正则常把完整 HTML（含脚本）放在 ```text``` 围栏里；
      // 与实际渲染保持同一解围栏规则，避免授权清单误判为未知脚本。
      for (const entry of extractTavernScripts(normalizeTavernHtmlBlocks(node)).scripts) entries.push(entry);
      return;
    }
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { node.forEach(visit); return; }
    Object.values(node).forEach(visit);
  };
  visit(char?.firstMes || '');
  visit(char?.cardData);
  visit(char?.cardExtensions);
  const unique = new Map(entries.map(entry => [`${entry.src}\n${entry.code}`, entry]));
  return [...unique.values()];
}

function approveCharacterCardScripts(scripts) {
  const character = currentChar();
  if (!character || !Array.isArray(scripts) || !scripts.length) return false;
  // 展示渲染会先展开 {{user}} 宏，再提取脚本；授权比对必须使用同一份规范化源码。
  const inventory = cardScriptInventory(character).map(entry => ({
    ...entry,
    code: expandDisplayMacros(entry.code),
  }));
  const inventoryKeys = new Set(inventory.map(entry => `${entry.src}\n${entry.code}`));
  if (scripts.some(entry => !inventoryKeys.has(`${entry.src}\n${entry.code}`))) return false;
  const supportedExternal = scripts.filter(entry => entry.src).map(entry => safeTavernCardScriptUrl(entry.src));
  if (supportedExternal.some(src => !src)) return false;
  const key = `${character.id || 'character'}:${lorebookHash(JSON.stringify(inventory))}`;
  const approvals = prefs.cardScriptApprovals && typeof prefs.cardScriptApprovals === 'object' ? prefs.cardScriptApprovals : {};
  if (approvals[key] === true) return true;
  if (cardScriptDeniedApprovals.has(key)) return false;
  const inlineCount = scripts.filter(entry => !entry.src).length;
  const externalCount = scripts.filter(entry => entry.src).length;
  const approved = typeof window !== 'undefined' && typeof window.confirm === 'function'
    ? window.confirm(`当前角色卡包含 ${inlineCount} 个内联脚本${externalCount ? `和 ${externalCount} 个外部依赖` : ''}。\n确认后将在同源完整兼容 iframe 中运行，不启用 sandbox/CSP 隔离；卡片脚本可访问宿主 DOM、localStorage、外部脚本和网络请求。\n已提供 ST Lite 的 SillyTavern/getContext/eventSource/substituteParams、triggerSlash('/send …|/trigger')、copyToTavernDialog()、TavernCard.send/copy，以及当前会话变量读写和角色卡世界书读取。\n仅导入你信任的角色卡；是否启用本卡脚本？`)
    : false;
  if (approved) {
    prefs.cardScriptApprovals = { ...approvals, [key]: true };
    saveJSON(LS_PREFS, prefs);
  } else {
    cardScriptDeniedApprovals.add(key);
  }
  return approved;
}

// ST 角色卡脚本需要同步读取聊天/角色书；注入当前卡片作用域快照，变量写入单独经过宿主桥持久化。
function tavernCardCompatibilitySnapshot() {
  const char = currentChar();
  const session = curSession();
  const sourceMessages = curMessages();
  // ponytail: cap the injected snapshot at 200 messages; raise only for cards that need deeper history.
  const messages = (Array.isArray(sourceMessages) ? sourceMessages : []).slice(-200).map((message, index) => {
    // ST's getChatMessages() returns the pre-display message. Keep that
    // channel when available so card-side loaders can still see structured
    // tags that a display regex intentionally removes from `content`.
    const content = String(message?.rawContent ?? message?.content ?? '');
    const isUser = message?.role === 'user';
    const isSystem = message?.role === 'system' || message?.meta === true;
    return {
      message_id: index,
      message: content,
      mes: content,
      content,
      name: isUser ? String(currentUserPreset()?.name || '玩家') : (isSystem ? '系统' : String(char?.name || '角色')),
      is_user: isUser,
      is_system: isSystem,
      role: String(message?.role || 'assistant'),
      send_date: message?.ts ? new Date(message.ts).toISOString() : '',
    };
  });
  const books = {};
  const names = { primary: '', additional: [] };
  const addBook = (bookId, fallbackName = '') => {
    const book = bookId && lorebooks && lorebooks[bookId];
    if (!book) return '';
    const name = String(book.name || fallbackName || bookId);
    books[name] = (Array.isArray(book.entries) ? book.entries : Object.values(book.entries || {})).map((entry, index) => {
      const serialized = serializeSTWorldInfoEntry(entry, index);
      return { ...serialized, name: serialized.comment };
    });
    return name;
  };
  const primaryName = addBook(char?.characterBookLoreId) || addBook(char?.loreId) || '';
  if (primaryName) names.primary = primaryName;
  const activeName = addBook(prefs?.activeLoreId);
  if (activeName && activeName !== primaryName) names.additional.push(activeName);
  const inlineBook = characterBookForChar(char);
  if (inlineBook && !primaryName) {
    const name = String(inlineBook.name || `${char?.name || '角色'} · 角色卡世界书`);
    books[name] = normalizeCharacterBookEntries(inlineBook).map((entry, index) => {
      const serialized = serializeSTWorldInfoEntry(entry, index);
      return { ...serialized, name: serialized.comment };
    });
    names.primary = name;
  }
  const userName = String(currentUserPreset()?.name || '玩家').slice(0, 120);
  const character = char ? {
    id: String(char.id || currentCharId || ''),
    name: String(char.name || '').slice(0, 240),
    description: String(char.description || '').slice(0, 20000),
    personality: String(char.personality || '').slice(0, 6000),
    scenario: String(char.scenario || '').slice(0, 6000),
    firstMessage: String(char.firstMes || '').slice(0, 20000),
    alternateGreetings: Array.isArray(char.alternateGreetings)
      ? char.alternateGreetings.map(value => String(value || '').slice(0, 20000)).slice(0, 32)
      : [],
  } : null;
  const variables = session?.stVariables && typeof session.stVariables === 'object' && !Array.isArray(session.stVariables)
    ? JSON.parse(JSON.stringify(session.stVariables)) : {};
  const context = {
    mode: 'tavern',
    chatId: String(currentSessionId || ''),
    currentChatId: String(currentSessionId || ''),
    user: { name: userName },
    character,
    char: character,
  };
  return { messages, worldbooks: { names, books }, currentChatId: String(currentSessionId || ''), user: { name: userName }, character, char: character, variables, context };
}

function sanitizeTavernMarkup(source, parser, allowEvents = false) {
  const raw = parser ? parser.parse(source, {
    gfm: true,
    breaks: true,
    headerIds: false,
    mangle: false,
    smartypants: false,
  }) : source;
  const div = document.createElement('div');
  div.innerHTML = window.DOMPurify.sanitize(raw, {
    DATA_URI_TAGS: ['img'],
    ADD_ATTR: ['target', 'rel', ...(allowEvents ? TAVERN_CARD_EVENT_ATTRS : [])],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
  });
  div.querySelectorAll('[style]').forEach(node => {
    const safe = sanitizeTavernCss(node.getAttribute('style'), false).trim();
    if (safe) node.setAttribute('style', safe);
    else node.removeAttribute('style');
  });
  div.querySelectorAll('a').forEach(link => {
    if (/^https?:\/\//i.test(link.getAttribute('href') || '')) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer nofollow';
    }
  });
  return div.innerHTML;
}

function tavernCardFrameBridgeSource(nonce, compatibility = {}) {
  const token = JSON.stringify(String(nonce || ''));
  const snapshot = JSON.stringify(compatibility).replace(/</g, '\\u003c');
  return `(function(global){
  if (global.__tavernCardBridge) { global.__tavernCardBridge.install(); return; }
  const nonce = ${token};
  const compatibility = ${snapshot};
  const pending = new Map();
  const eventListeners = new Map();
  let installed = false;
  let sequence = 0;
  const event_types = Object.freeze({
    CHAT_CHANGED: 'CHAT_CHANGED',
    MESSAGE_SENT: 'MESSAGE_SENT',
    MESSAGE_RECEIVED: 'MESSAGE_RECEIVED',
    CHARACTER_MESSAGE_RENDERED: 'CHARACTER_MESSAGE_RENDERED',
    USER_MESSAGE_RENDERED: 'USER_MESSAGE_RENDERED',
    GENERATION_STARTED: 'GENERATION_STARTED',
    GENERATION_ENDED: 'GENERATION_ENDED',
    WORLDINFO_ENTRIES_LOADED: 'WORLDINFO_ENTRIES_LOADED',
  });
  // ST 卡片常用 $(selector).load(url) 把远程 HTML 挂入卡片。
  // 这里只提供这个兼容面；普通消息仍不会执行脚本，完整卡片脚本仍需用户授权。
  function installLegacyQuery() {
    if (typeof global.$ === 'function') return;
    const query = selector => {
      const queryText = String(selector || '').trim();
      const root = document.getElementById('tavern-card-frame-root');
      const nodes = /^body$/i.test(queryText) && root
        ? [root]
        : (queryText ? [...document.querySelectorAll(queryText)] : []);
      const api = {
        length: nodes.length,
        0: nodes[0],
        html(value) {
          if (value === undefined) return nodes[0]?.innerHTML || '';
          nodes.forEach(node => { node.innerHTML = String(value); });
          return api;
        },
        text(value) {
          if (value === undefined) return nodes[0]?.textContent || '';
          nodes.forEach(node => { node.textContent = String(value); });
          return api;
        },
        append(value) {
          nodes.forEach(node => node.insertAdjacentHTML('beforeend', String(value ?? '')));
          return api;
        },
        on(name, listener) {
          if (typeof listener === 'function') nodes.forEach(node => node.addEventListener(String(name), listener));
          return api;
        },
        load(url, data, complete) {
          if (typeof data === 'function') complete = data;
          let target;
          try {
            target = new URL(String(url || ''), document.baseURI);
            if (!['http:', 'https:'].includes(target.protocol)) throw new Error('仅允许 http(s) 外部链接');
          } catch (error) {
            return Promise.reject(error);
          }
          const frame = document.createElement('iframe');
          frame.src = target.href;
          frame.title = '外部角色卡界面';
          frame.referrerPolicy = 'no-referrer';
          frame.style.cssText = 'display:block;width:100%;height:720px;max-width:100%;border:0;background:transparent';
          if (!nodes.length) return Promise.resolve(api);
          nodes.forEach(node => node.replaceChildren(frame));
          return new Promise((resolve, reject) => {
            frame.addEventListener('load', () => {
              if (typeof complete === 'function') complete.call(nodes[0], '', 'success', frame);
              resolve(api);
            }, { once: true });
            frame.addEventListener('error', error => {
              if (typeof complete === 'function') complete.call(nodes[0], '', 'error', error);
              reject(new Error('外部页面加载失败'));
            }, { once: true });
          });
        },
      };
      return api;
    };
    global.$ = query;
  }
  function eventName(name) { return String(name || '').trim(); }
  const eventSource = {
    on(name, listener) {
      const key = eventName(name);
      if (!key || typeof listener !== 'function') return () => {};
      const bucket = eventListeners.get(key) || new Set();
      bucket.add(listener);
      eventListeners.set(key, bucket);
      return () => this.off(key, listener);
    },
    addListener(name, listener) { return this.on(name, listener); },
    once(name, listener) {
      let dispose = () => {};
      dispose = this.on(name, detail => { dispose(); listener(detail); });
      return dispose;
    },
    off(name, listener) {
      const bucket = eventListeners.get(eventName(name));
      if (!bucket) return;
      bucket.delete(listener);
      if (!bucket.size) eventListeners.delete(eventName(name));
    },
    removeListener(name, listener) { return this.off(name, listener); },
    emit(name, detail) {
      const key = eventName(name);
      (eventListeners.get(key) || []).forEach(listener => {
        try { listener(detail); } catch (error) { setTimeout(() => { throw error; }, 0); }
      });
      try { global.dispatchEvent(new CustomEvent('tavern-st-event', { detail: { name: key, payload: detail } })); } catch (_) {}
      return true;
    },
  };
  function clone(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
  }
  function getContext() {
    const base = clone(compatibility.context || {
      mode: 'tavern',
      chatId: String(compatibility.currentChatId || ''),
      currentChatId: String(compatibility.currentChatId || ''),
      user: compatibility.user || { name: '玩家' },
      character: compatibility.character || null,
      char: compatibility.char || compatibility.character || null,
      worldbooks: compatibility.worldbooks || { names: { primary: '', additional: [] }, books: {} },
      variables: compatibility.variables || {},
    });
    if (!Array.isArray(base.chat)) base.chat = clone(compatibility.messages || []);
    if (!Array.isArray(base.messages)) base.messages = base.chat;
    if (!base.worldbooks) base.worldbooks = clone(compatibility.worldbooks || { names: { primary: '', additional: [] }, books: {} });
    if (!base.variables) base.variables = clone(compatibility.variables || {});
    return base;
  }
  function substituteParams(value) {
    const context = getContext();
    const userName = text(context.user?.name || context.user || '玩家');
    const charName = text(context.character?.name || context.char?.name || '角色');
    const last = Array.isArray(context.messages) && context.messages.length ? context.messages[context.messages.length - 1] : null;
    return text(value).replace(/\\{\\{\\s*(user(?:\\.name)?|char(?:\\.name)?|lastMessage|chatId)\\s*\\}\\}/gi, (_, key) => {
      const name = String(key || '').toLowerCase();
      if (name === 'user' || name === 'user.name') return userName;
      if (name === 'char' || name === 'char.name') return charName;
      if (name === 'lastmessage') return text(last?.content || last?.mes || '');
      return text(context.chatId || '');
    });
  }
  function request(action, payload) {
    return new Promise(resolve => {
      const requestId = 'card-' + (++sequence);
      pending.set(requestId, resolve);
      try {
        parent.postMessage({ channel: 'tavern.card.frame', type: 'action', nonce, action, requestId, payload }, '*');
      } catch (_) {
        pending.delete(requestId);
        resolve({ ok: false, error: '宿主桥不可用' });
        return;
      }
      setTimeout(() => {
        if (!pending.has(requestId)) return;
        pending.delete(requestId);
        resolve({ ok: false, error: '宿主响应超时' });
      }, 5000);
    });
  }
  function text(value) { return String(value == null ? '' : value); }
  function copy(value) { return request('copy', { text: text(value) }); }
  function send(value) {
    const body = text(value);
    return request('send', { text: body }).then(result => {
      eventSource.emit(event_types.MESSAGE_SENT, { text: body, result });
      return result;
    });
  }
  function notice(value) { return request('notice', { text: text(value).slice(0, 4000) }); }
  function triggerSlash(command) {
    const value = text(command).trim();
    if (!/^\\/send(?:\\s|$)/i.test(value)) {
      console.warn('[Tavern] 角色卡仅兼容 /send 命令');
      return Promise.resolve({ ok: false, error: '仅支持 /send 命令' });
    }
    const body = value.replace(/^\\/send\\s*/i, '').replace(/\\s*\\|\\/trigger\\s*$/i, '').trim();
    return body ? send(body) : Promise.resolve({ ok: false, error: '发送内容为空' });
  }
  function chatRange(range) {
    const list = Array.isArray(compatibility.messages) ? compatibility.messages : [];
    if (range == null || range === '') return list.slice().map(clone);
    const value = String(range).trim();
    let start = 0;
    let end = list.length - 1;
    const match = value.match(/^(-?\\d+)\\s*-\\s*(-?\\d+)$/);
    if (match) {
      start = Number(match[1]);
      end = Number(match[2]);
    } else if (/^-?\\d+$/.test(value)) {
      start = Number(value);
      end = start;
    }
    if (start < 0) start = Math.max(0, list.length + start);
    if (end < 0) end = Math.max(0, list.length + end);
    if (end < start) return [];
    return list.slice(Math.max(0, start), Math.min(list.length, end + 1)).map(clone);
  }
  function getLastMessageId() { return Math.max(-1, (compatibility.messages || []).length - 1); }
  function getCurrentMessageId() { return getLastMessageId(); }
  function getChatMessages(range) { return chatRange(range); }
  function getAllChatMessages() { return chatRange(); }
  function getCharWorldbookNames() { return clone(compatibility.worldbooks?.names || { primary: '', additional: [] }); }
  function getWorldbook(name) { return clone(compatibility.worldbooks?.books?.[String(name || '')] || []); }
  function getCurrentChatId() { return String(compatibility.currentChatId || ''); }
  function getVariables() { return clone(compatibility.variables || {}); }
  function getVariable(name, fallback) {
    const key = text(name).trim();
    const values = getVariables();
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
  }
  function setVariable(name, value) {
    const key = text(name).trim();
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)) return Promise.reject(new Error('变量名无效'));
    return request('variables.set', { values: { [key]: value } }).then(result => {
      if (result?.variables) compatibility.variables = clone(result.variables);
      return result;
    });
  }
  function updateVariables(values) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) return Promise.reject(new Error('变量对象无效'));
    return request('variables.set', { values }).then(result => {
      if (result?.variables) compatibility.variables = clone(result.variables);
      return result;
    });
  }
  function memoryStorage() {
    const values = Object.create(null);
    return {
      get length() { return Object.keys(values).length; },
      key(index) { return Object.keys(values)[Number(index)] ?? null; },
      getItem(key) { const name = String(key); return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : null; },
      setItem(key, value) { values[String(key)] = String(value); },
      removeItem(key) { delete values[String(key)]; },
      clear() { Object.keys(values).forEach(key => delete values[key]); },
    };
  }
  function installStorage() {
    ['localStorage', 'sessionStorage'].forEach(name => {
      let available = false;
      try { available = !!global[name]; } catch (_) {}
      if (available) return;
      try { Object.defineProperty(global, name, { configurable: true, enumerable: true, value: memoryStorage() }); } catch (_) {}
    });
  }
  function jsonResponse(value) {
    const body = JSON.stringify(value);
    if (typeof global.Response === 'function') return Promise.resolve(new global.Response(body, { status: 200, headers: { 'content-type': 'application/json' } }));
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(value), text: () => Promise.resolve(body) });
  }
  function installFixtureFetch() {
    if (global.__tavernCardFetchInstalled) return;
    try {
      const nativeFetch = typeof global.fetch === 'function' ? global.fetch.bind(global) : null;
      Object.defineProperty(global, 'fetch', {
        configurable: true,
        writable: true,
        value(input, init) {
          const raw = typeof input === 'string' ? input : input?.url;
          const path = String(raw || '').split(/[?#]/, 1)[0];
          if (/(?:^|\\/)(?:testMessage_data|testWorldBooks)\\.json$/i.test(path)) {
            if (/testWorldBooks/i.test(path)) {
              const books = compatibility.worldbooks?.books || {};
              const firstBook = Object.keys(books)[0];
              return jsonResponse(firstBook ? books[firstBook] : []);
            }
            return jsonResponse(Array.isArray(compatibility.messages) ? compatibility.messages : []);
          }
          return nativeFetch ? nativeFetch(input, init) : Promise.reject(new TypeError('角色卡运行环境没有 fetch'));
        },
      });
      global.__tavernCardFetchInstalled = true;
    } catch (_) {}
  }
  function worldbookContent(fragment) {
    const books = compatibility.worldbooks?.books || {};
    for (const entries of Object.values(books)) {
      for (const entry of Array.isArray(entries) ? entries : []) {
        if (String(entry?.name || '').includes(fragment) && String(entry?.content || '').trim()) return String(entry.content);
      }
    }
    return '[]';
  }
  function installSTDataGlobals() {
    const values = {
      POV_Style: worldbookContent('视角标签数据源'),
      worldview_list_data: worldbookContent('世界观标签数据源'),
      character_list_data: worldbookContent('角色标签数据源'),
      rule_list_data: worldbookContent('规则标签数据源'),
      writing_new_style_list_data: worldbookContent('文风标签数据源'),
    };
    Object.entries(values).forEach(([name, value]) => {
      try {
        if (typeof global[name] === 'undefined') global[name] = value;
      } catch (_) {}
    });
  }
  function install() {
    if (installed) return;
    installed = true;
    installLegacyQuery();
    installStorage();
    installFixtureFetch();
    installSTDataGlobals();
    const extension_settings = global.extension_settings && typeof global.extension_settings === 'object'
      ? global.extension_settings : {};
    global.extension_settings = extension_settings;
    global.saveSettingsDebounced = global.saveSettingsDebounced || (() => Promise.resolve());
    global.SillyTavern = Object.assign(global.SillyTavern || {}, { getContext, eventSource, event_types, extension_settings });
    global.TavernHelper = Object.assign(global.TavernHelper || {}, { getContext, eventSource, event_types, substituteParams, getVariables, getVariable, setVariable, updateVariables, getChatMessages, getWorldbook, triggerSlash });
    global.eventSource = eventSource;
    global.event_types = event_types;
    global.getContext = getContext;
    global.substituteParams = substituteParams;
    global.getVariables = getVariables;
    global.getVariable = getVariable;
    global.setVariable = setVariable;
    global.updateVariables = updateVariables;
    global.TavernCard = { send, copy, setInput: copy, getContext, requestContext: () => request('context'), eventSource, event_types, getVariables, getVariable, setVariable, updateVariables };
    global.triggerSlash = triggerSlash;
    global.copyToTavernDialog = copy;
    global.getLastMessageId = getLastMessageId;
    global.getCurrentMessageId = getCurrentMessageId;
    global.getChatMessages = getChatMessages;
    global.getAllChatMessages = getAllChatMessages;
    global.getCharWorldbookNames = getCharWorldbookNames;
    global.getWorldbook = getWorldbook;
    global.getCurrentChatId = getCurrentChatId;
    if (typeof global.simpleLog !== 'function') global.simpleLog = (...args) => console.debug('[Tavern card]', ...args);
    if (typeof global.writeLog !== 'function') global.writeLog = (...args) => console.debug('[Tavern card]', ...args);
    global.__TAVERN_ST_LITE__ = { version: 1, mode: 'tavern', features: ['events', 'context', 'macros', 'variables', 'worldbooks', 'card-actions'] };
    setTimeout(() => {
      const context = getContext();
      eventSource.emit(event_types.CHAT_CHANGED, context);
      eventSource.emit(event_types.MESSAGE_RECEIVED, context);
    }, 0);
  }
  global.addEventListener('message', event => {
    const data = event.data;
    if (!data || data.channel !== 'tavern.card.frame' || data.nonce !== nonce || data.type !== 'response') return;
    const resolve = pending.get(data.requestId);
    if (!resolve) return;
    pending.delete(data.requestId);
    resolve(data.ok ? { ok: true, result: data.result } : { ok: false, error: data.error || '宿主桥请求失败' });
  });
  global.__tavernCardBridge = { install };
  install();
})(window);`;
}

function tavernCardScriptFrame(css, markup, scripts, compatibility = {}, scrollMode = 'auto') {
  const nonce = uid() + '-' + uid();
  const normalizedScrollMode = ['host', 'card', 'auto'].includes(String(scrollMode)) ? String(scrollMode) : 'auto';
  const frameOverflow = normalizedScrollMode === 'host' ? 'hidden' : 'auto';
  const frameScrolling = normalizedScrollMode === 'host' ? ' scrolling="no"' : '';
  const scriptMarkup = scripts.map(entry => {
    if (entry.src) {
      const src = safeTavernCardScriptUrl(entry.src);
      return src ? `<script src="${esc(src)}"></script>` : '';
    }
    const code = String(entry.code || '').replace(/<\/script/gi, '<\\/script');
    return `<script>(function(){\n${code}\n}).call(window);</script>`;
  }).join('');
  // `extractTavernStyles()` returns style wrappers for the host renderer; the
  // iframe owns the wrapper, so keep only the sanitized declarations here.
  const safeCss = String(css || '')
    .replace(/<\/?style\b[^>]*>/gi, '')
    .replace(/<\/style/gi, '<\\/style');
  const bridge = tavernCardFrameBridgeSource(nonce, compatibility).replace(/<\/script/gi, '<\\/script');
  const srcdoc = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;min-height:0;overflow:${frameOverflow}}#tavern-card-frame-root{width:100%;min-height:0;box-sizing:border-box}${safeCss}</style></head><body><main id="tavern-card-frame-root">${markup}</main><script>${webview83CompatSource()}</script><script>(function(){const nonce=${JSON.stringify(nonce)};function report(){try{const root=document.getElementById('tavern-card-frame-root');const rect=root?.getBoundingClientRect();const height=Math.ceil(Math.max(root?.scrollHeight||0,rect?.height||0));parent.postMessage({channel:'tavern.card.frame',type:'resize',nonce,height},'*')}catch(_){}}addEventListener('load',report);setTimeout(report,0);const root=document.getElementById('tavern-card-frame-root');if(typeof ResizeObserver==='function'&&root)new ResizeObserver(report).observe(root);})();</script><script>${bridge}</script>${scriptMarkup}<script>${bridge}</script></body></html>`;
  return `<div class="tavern-card-script-shell" data-tavern-card-script data-tavern-card-mode="full" data-tavern-card-scroll="${normalizedScrollMode}"><iframe class="tavern-card-script-frame" title="角色卡完整兼容运行区" data-tavern-card-nonce="${esc(nonce)}" referrerpolicy="no-referrer"${frameScrolling} srcdoc="${esc(srcdoc)}"></iframe></div>`;
}

function tavernCardScrollMode(char = currentChar()) {
  const tavern = char?.cardExtensions?.tavern;
  const ui = tavern?.ui && typeof tavern.ui === 'object' ? tavern.ui : {};
  const value = ui.scrollMode ?? ui.scroll;
  return ['host', 'card', 'auto'].includes(String(value)) ? String(value) : 'auto';
}

let tavernCardFrameBridgeReady = false;
function setTavernCardDialogInput(value) {
  const input = $('input');
  if (!input) throw new Error('当前页面没有 Tavern 输入框');
  input.value = String(value || '').trim();
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
  setApiStatus('角色卡内容已填入当前对话框');
  return { textLength: input.value.length };
}

function tavernCardSessionVariables(session = curSession()) {
  if (!session || session.kind !== 'tavern') return {};
  if (!session.stVariables || typeof session.stVariables !== 'object' || Array.isArray(session.stVariables)) session.stVariables = {};
  return session.stVariables;
}

function saveTavernCardVariables(values) {
  if (mode !== 'tavern') throw new Error('ST Lite 变量只在 Tavern 模式可写');
  const session = curSession();
  if (!session) throw new Error('当前没有 Tavern 会话');
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('变量对象无效');
  const entries = Object.entries(values);
  if (entries.length > 32) throw new Error('单次变量更新不能超过 32 项');
  const current = tavernCardSessionVariables(session);
  for (const [key, value] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(String(key))) throw new Error(`变量名无效：${key}`);
    if (value === undefined || JSON.stringify(value).length > 12000) throw new Error(`变量值无效：${key}`);
    current[key] = cloneValue(value);
  }
  saveSessions(session);
  return { variables: cloneValue(current) };
}

function tavernCardActionText(data) {
  const value = data?.payload && typeof data.payload === 'object' ? data.payload.text : data?.text;
  const text = String(value == null ? '' : value).trim();
  if (!text) throw new Error('角色卡发送内容为空');
  if (text.length > 40000) throw new Error('角色卡发送内容超过 40000 字符限制');
  return text;
}

function initTavernCardFrameBridge() {
  if (tavernCardFrameBridgeReady || typeof window === 'undefined') return;
  tavernCardFrameBridgeReady = true;
  window.addEventListener('message', event => {
    if (event.data?.channel !== 'tavern.card.frame') return;
    const frame = [...document.querySelectorAll('[data-tavern-card-script] iframe')]
      .find(item => item.contentWindow === event.source && item.dataset.tavernCardNonce === String(event.data.nonce || ''));
    if (!frame) return;
    const data = event.data;
    if (data.type === 'resize') {
      const height = Math.max(1, Math.min(2400, Number(data.height) || 1));
      frame.style.height = `${height}px`;
      return;
    }
    if (data.type !== 'action' || !data.requestId) return;
    const respond = (ok, result, error) => event.source.postMessage({
      channel: 'tavern.card.frame', type: 'response', nonce: frame.dataset.tavernCardNonce,
      requestId: data.requestId, ok, ...(ok ? { result } : { error: String(error || '角色卡桥请求失败') }),
    }, '*');
    try {
      if (data.action === 'context') {
        respond(true, tavernCardCompatibilitySnapshot());
        return;
      }
      if (data.action === 'variables.get') {
        respond(true, { variables: cloneValue(tavernCardSessionVariables()) });
        return;
      }
      if (data.action === 'variables.set') {
        respond(true, saveTavernCardVariables(data.payload?.values));
        return;
      }
      const text = tavernCardActionText(data);
      if (data.action === 'notice') {
        setApiStatus(`角色卡：${text.slice(0, 4000)}`);
        respond(true, { shown: true });
        return;
      }
      if (data.action === 'copy') {
        respond(true, setTavernCardDialogInput(text));
        return;
      }
      if (data.action === 'send') {
        if (mode === 'rpg') throw new Error('角色卡桥只能在 Tavern 模式发送');
        if (sending || worldTurnPreparing || worldTurnPending) throw new Error('当前对话正在生成，请稍后再试');
        setTavernCardDialogInput(applyRegexStage(text, 'slash_command'));
        void sendMessage().catch(error => setApiStatus(`角色卡发送失败：${error.message}`, true));
        respond(true, { sent: true, textLength: text.length });
        return;
      }
      throw new Error('角色卡桥 action 不受支持');
    } catch (error) {
      respond(false, null, error.message);
    }
  });
}

function renderBubble(content, options = {}) {
  const source = expandDisplayMacros(content);
  const hasSanitizer = typeof window !== 'undefined' && window.DOMPurify && typeof document !== 'undefined' && typeof document.createElement === 'function';
  if (hasSanitizer) {
    try {
      const parser = window.marked && typeof window.marked.parse === 'function' ? window.marked : null;
      // marked 不可用时仍把卡片生成的 HTML 交给 DOMPurify，避免安全库缺少时只能把标签当纯文本显示。
      // 先解开 HTML 代码块，再提取 style；否则 ```text 内的 CSS 会继续被当作代码显示。
      const normalizedSource = normalizeTavernHtmlBlocks(source);
      const extracted = extractTavernStyles(normalizedSource);
      const renderSource = extractTavernScripts(extracted.markup);
      const runCardScripts = options.allowCardScripts === true
        && approveCharacterCardScripts(renderSource.scripts);
      if (runCardScripts) {
        const frameStyles = extractTavernStyles(normalizedSource, false);
        const frameSource = extractTavernScripts(frameStyles.markup);
        const frameMarkup = sanitizeTavernMarkup(frameSource.markup, parser, true);
        return { html: tavernCardScriptFrame(frameStyles.styles, frameMarkup, frameSource.scripts, tavernCardCompatibilitySnapshot(), tavernCardScrollMode()), md: false, scripted: true };
      }
      return { html: extracted.styles + sanitizeTavernMarkup(renderSource.markup, parser), md: !!parser };
    } catch { /* 解析失败则回退纯文本 */ }
  }
  return { html: esc(source), md: false };
}

/* 拆分旁白 / 对白：使用括号范围区分角色发言与叙述引用。
 * “对白” 在括号外进入气泡；（旁白“引用”旁白）整体保留为旁白。 */
function splitNarration(text) {
  const OPEN = { '“': '”' };
  const PAREN_OPEN = { '（': '）', '(': ')' };
  const segs = [];
  let cur = '';
  const stack = []; // 引号栈（期望的闭符）
  let parenDepth = 0;
  let inlineCode = false;
  let fence = '';
  const flush = (type) => {
    if (cur.trim()) segs.push({ type, text: cur });
    cur = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '`' || ch === '~') {
      let run = 1;
      while (text[i + run] === ch) run++;
      if (run >= 3 && !inlineCode) {
        if (!fence) fence = ch.repeat(3);
        else if (fence[0] === ch) fence = '';
        cur += ch.repeat(run);
        i += run - 1;
        continue;
      }
      if (ch === '`' && !fence && run === 1) inlineCode = !inlineCode;
      cur += ch.repeat(run);
      i += run - 1;
      continue;
    }
    // Markdown 代码跨度/围栏内的引号只是代码，不得触发 Tavern 对白拆分。
    if (fence || inlineCode) {
      cur += ch;
      continue;
    }
    if (stack.length) {
      // 引号内：继续累积，匹配到闭符出栈
      cur += ch;
      if (ch === stack[stack.length - 1]) stack.pop();
      if (!stack.length) flush('dialogue');
    } else if (PAREN_OPEN[ch] !== undefined) {
      parenDepth++;
      cur += ch;
    } else if ((ch === '）' || ch === ')') && parenDepth > 0) {
      parenDepth--;
      cur += ch;
    } else if (OPEN[ch] !== undefined && parenDepth === 0) {
      // 引号只在括号外开启对白；括号内的同类引号属于旁白引用
      flush('narration');
      stack.push(OPEN[ch]);
      cur += ch;
    } else {
      cur += ch;
    }
  }
  // 未闭合的引号内容追加到旁白（LLM 输出不成对时保持可读、不产生碎段）
  if (stack.length) {
    if (segs.length && segs[segs.length - 1].type === 'narration') segs[segs.length - 1].text += cur;
    else if (cur.trim()) segs.push({ type: 'narration', text: cur });
  } else if (cur.trim()) {
    // 对白结束后的尾部正文仍属于旁白，不能丢失
    if (segs.length && segs[segs.length - 1].type === 'narration') segs[segs.length - 1].text += cur;
    else segs.push({ type: 'narration', text: cur });
  }
  if (!segs.length) segs.push({ type: 'narration', text });
  return segs;
}

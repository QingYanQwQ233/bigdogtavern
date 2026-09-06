'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('public/app.js', 'utf8').replace(/\ninit\(\);\s*$/, '');
const context = vm.createContext({
  console,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  window: {}, document: {}, Date, Math, JSON, Set, Map, WeakMap, Intl,
});
vm.runInContext(source, context);

vm.runInContext(`
  settings = { ...DEFAULT_SETTINGS, promptCache: { cacheKey: 'rp-v1', includeUsage: true } };
  const first = { model: 'deepseek-chat', stream: true, messages: [
    { role: 'system', content: '固定世界设定'.repeat(800) },
    { role: 'user', content: '第一轮' },
  ] };
  applyPromptCacheHints(first);
  globalThis.firstHints = first;
  globalThis.firstInfo = buildPromptCacheInfo({ baseUrl: 'https://api.deepseek.com/v1', body: first, presetName: 'RP' });
  const second = { model: 'deepseek-chat', stream: true, messages: [
    { role: 'system', content: '固定世界设定'.repeat(800) },
    { role: 'user', content: '第二轮' },
  ] };
  applyPromptCacheHints(second);
  globalThis.secondInfo = buildPromptCacheInfo({ baseUrl: 'https://api.deepseek.com/v1', body: second, presetName: 'RP' });
  const testBody = { model: 'deepseek-chat', stream: false };
  applyPromptCacheHints(testBody, { test: true });
  globalThis.testHints = testBody;
  resetProviderUsage();
  recordProviderUsage({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 60 } });
  recordProviderUsage({ input_tokens: 50, output_tokens: 5, usage_metadata: { cached_content_token_count: 20 } });
  globalThis.usage = providerUsageSnapshot();
  globalThis.diagnostics = formatPromptCacheDiagnostics({ cacheInfo: secondInfo, providerUsage: usage });
`, context);

assert.strictEqual(context.firstHints.prompt_cache_key, 'rp-v1');
assert.strictEqual(context.firstHints.stream_options.include_usage, true);
assert.strictEqual(context.firstInfo.comparison, 'no_previous_same_scope');
assert.strictEqual(context.secondInfo.comparison, 'previous_same_scope');
assert.strictEqual(context.secondInfo.commonPrefixMessages, 1);
assert.ok(context.secondInfo.commonPrefixTokensEstimate > 1000, 'large stable prefix should be visible in the estimate');
assert.ok(!Object.prototype.hasOwnProperty.call(context.testHints, 'prompt_cache_key'));
assert.ok(!Object.prototype.hasOwnProperty.call(context.testHints, 'stream_options'));
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.usage)), {
  requests: 2,
  inputTokens: 150,
  outputTokens: 25,
  totalTokens: 120,
  cachedTokens: 80,
  cacheWriteTokens: null,
  cacheMissTokens: null,
});
assert.match(context.diagnostics, /缓存读取：80/);
assert.match(context.diagnostics, /共同前缀估算/);
console.log('prompt cache checks passed');

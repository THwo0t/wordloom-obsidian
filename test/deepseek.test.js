'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  collectCambridgeUrls,
  extractJson,
  resolveAnthropicMessagesUrl,
  resolveChatUrl,
  selectCambridgeSourceUrl,
  sanitizeEnrichment,
  sanitizeSearchDictionary
} = require('../src/services/deepseek');

test('resolves OpenAI-compatible chat endpoint', () => {
  assert.equal(resolveChatUrl('https://api.deepseek.com/'), 'https://api.deepseek.com/chat/completions');
  assert.equal(resolveChatUrl('http://localhost:11434/v1/chat/completions'), 'http://localhost:11434/v1/chat/completions');
  assert.throws(() => resolveChatUrl('file:///tmp/key'), /HTTP/);
});

test('accepts plain and fenced JSON responses', () => {
  assert.deepEqual(extractJson('{"summaryZh":"核心"}'), { summaryZh: '核心' });
  assert.deepEqual(extractJson('```json\n{"summaryZh":"核心"}\n```'), { summaryZh: '核心' });
});

test('sanitizes and limits AI enrichment', () => {
  const value = sanitizeEnrichment({ summaryZh: '  核心  ', collocations: Array.from({ length: 12 }, (_, i) => `item ${i}`) });
  assert.equal(value.summaryZh, '核心');
  assert.equal(value.collocations.length, 8);
  assert.deepEqual(value.distinctions, []);
  assert.equal(sanitizeEnrichment({ memoryHook: '词根 mit- 源于拉丁语' }).memoryHook, '');
  assert.equal(sanitizeEnrichment({ memoryHook: 'anthro（人类）+ genic（产生）' }).memoryHook, '');
  assert.deepEqual(sanitizeEnrichment({ collocations: ['mitigate risk — 降低风险', 'mitigate against — 错误搭配'] }).collocations, ['mitigate risk — 降低风险']);
});

test('restricts native web search to the official DeepSeek endpoint', () => {
  assert.equal(resolveAnthropicMessagesUrl('https://api.deepseek.com/v1'), 'https://api.deepseek.com/anthropic/v1/messages');
  assert.throws(() => resolveAnthropicMessagesUrl('https://proxy.example.com/v1'), /官方 Endpoint/);
});

test('requires Cambridge evidence and sanitizes searched dictionary data', () => {
  const urls = [...collectCambridgeUrls({ content: [
    { url: 'https://dictionary.cambridge.org/dictionary/english/mitigate' },
    { url: 'https://dictionary.cambridge.org/dictionary/english-chinese-simplified/mitigate' }
  ] })];
  assert.deepEqual(urls, [
    'https://dictionary.cambridge.org/dictionary/english/mitigate',
    'https://dictionary.cambridge.org/dictionary/english-chinese-simplified/mitigate'
  ]);
  assert.equal(selectCambridgeSourceUrl(urls, 'mitigate'), 'https://dictionary.cambridge.org/dictionary/english-chinese-simplified/mitigate');
  assert.equal(selectCambridgeSourceUrl([
    'https://dictionary.cambridge.org/dictionary/english-chinese-simplified/mitigation',
    'https://dictionary.cambridge.org/dictionary/english-chinese-simplified/mitigate?q=mitigate'
  ], 'mitigate'), 'https://dictionary.cambridge.org/dictionary/english-chinese-simplified/mitigate?q=mitigate');
  assert.equal(selectCambridgeSourceUrl(urls, 'mitigation'), '');
  assert.equal(selectCambridgeSourceUrl([
    'https://dictionary.cambridge.org/dictionary/english/anthropic'
  ], 'anthropic'), 'https://dictionary.cambridge.org/dictionary/english/anthropic');
  const result = sanitizeSearchDictionary({
    query: 'mitigate',
    entries: [{
      partOfSpeech: 'verb',
      phonetics: { uk: '/\u02c8m\u026at.\u026a.\u0261e\u026at/' },
      senses: [{ level: 'C2', english: 'to make something less harmful', chinese: '\u51cf\u8f7b', examples: [] }]
    }]
  }, 'mitigate', urls[0]);
  assert.equal(result.levels[0], 'C2');
  assert.equal(result.source.access, 'deepseek-web-search');
  assert.throws(() => sanitizeSearchDictionary({ query: 'another', entries: [] }, 'mitigate', urls[0]), /\u4e0d\u4e00\u81f4/);
});

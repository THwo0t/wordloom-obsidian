'use strict';

class AiServiceError extends Error {
  constructor(message, code, cause) {
    super(message, { cause });
    this.name = 'AiServiceError';
    this.code = code;
  }
}

const CAMBRIDGE_HOST = 'dictionary.cambridge.org';
const CAMBRIDGE_SIMPLIFIED_PATH = '/dictionary/english-chinese-simplified/';
const CAMBRIDGE_ENGLISH_PATH = '/dictionary/english/';
const CEFR_LEVELS = new Set(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);

function resolveChatUrl(endpoint) {
  let parsed;
  try {
    parsed = new URL(String(endpoint || '').trim());
  } catch {
    throw new AiServiceError('API Endpoint 不是有效的网址。', 'INVALID_ENDPOINT');
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new AiServiceError('API Endpoint 仅支持 HTTP 或 HTTPS。', 'INVALID_ENDPOINT');
  }
  const base = parsed.toString().replace(/\/+$/, '');
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

function extractJson(value) {
  const text = String(value || '').trim();
  if (!text) throw new AiServiceError('AI 返回了空内容。', 'EMPTY_RESPONSE');
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        // Fall through to the object slice below.
      }
    }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // Throw the stable user-facing error below.
      }
    }
    throw new AiServiceError('AI 返回的内容不是有效 JSON，请重试。', 'INVALID_JSON');
  }
}

function resolveAnthropicMessagesUrl(endpoint) {
  let parsed;
  try {
    parsed = new URL(String(endpoint || '').trim());
  } catch {
    throw new AiServiceError('API Endpoint 不是有效的网址。', 'INVALID_ENDPOINT');
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.deepseek.com') {
    throw new AiServiceError('Cambridge 搜索后备仅支持 DeepSeek 官方 Endpoint。', 'WEB_SEARCH_UNAVAILABLE');
  }
  return 'https://api.deepseek.com/anthropic/v1/messages';
}

function stringList(value, limit = 8) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, limit);
}

function sanitizeEnrichment(value) {
  const object = value && typeof value === 'object' ? value : {};
  const memoryHook = String(object.memoryHook || '').trim();
  return {
    summaryZh: String(object.summaryZh || '').trim(),
    collocations: stringList(object.collocations).filter((item) => !/\bmitigat(?:e|es|ed|ing)\s+against\b/i.test(item)),
    ieltsUsage: String(object.ieltsUsage || '').trim(),
    memoryHook: /\b(?:Latin|Greek|etymolog|root|prefix|suffix)\b|词源|词根|前缀|后缀|拉丁|希腊|源于|[a-z-]+\s*[（(][^）)]*[）)]\s*\+\s*[a-z-]+/i.test(memoryHook) ? '' : memoryHook,
    distinctions: stringList(object.distinctions, 5)
  };
}

function limitedText(value, maxLength = 800) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function validCambridgeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:'
      && url.hostname === CAMBRIDGE_HOST
      && (url.pathname.startsWith(CAMBRIDGE_SIMPLIFIED_PATH) || url.pathname.startsWith(CAMBRIDGE_ENGLISH_PATH))
      ? url.toString()
      : '';
  } catch {
    return '';
  }
}

function collectCambridgeUrls(value, urls = new Set()) {
  if (typeof value === 'string') {
    const matches = value.match(/https:\/\/dictionary\.cambridge\.org\/[^\s"'<>\\)\]]+/gi) || [];
    for (const match of matches) {
      const url = validCambridgeUrl(match.replace(/[.,;:!?]+$/, ''));
      if (url) urls.add(url);
    }
    return urls;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectCambridgeUrls(item, urls);
    return urls;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectCambridgeUrls(item, urls);
  }
  return urls;
}

function selectCambridgeSourceUrl(urls, requestedWord) {
  const expected = limitedText(requestedWord, 80).toLocaleLowerCase('en-US').replace(/\s+/g, '-');
  const matches = (Array.isArray(urls) ? urls : [...urls]).filter((value) => {
    const safe = validCambridgeUrl(value);
    if (!safe) return false;
    try {
      const pathHeadword = decodeURIComponent(new URL(safe).pathname.split('/').filter(Boolean).at(-1) || '')
        .toLocaleLowerCase('en-US');
      return pathHeadword === expected;
    } catch {
      return false;
    }
  });
  return matches.find((value) => new URL(value).pathname.startsWith(CAMBRIDGE_SIMPLIFIED_PATH)) || matches[0] || '';
}

function sanitizeSearchDictionary(value, requestedWord, sourceUrl) {
  const object = value && typeof value === 'object' ? value : {};
  const query = limitedText(object.query || requestedWord, 80);
  const requested = limitedText(requestedWord, 80).toLocaleLowerCase('en-US');
  if (!query || query.toLocaleLowerCase('en-US') !== requested) {
    throw new AiServiceError('网页搜索返回的词头与查询词不一致，已拒绝使用。', 'UNVERIFIED_SEARCH_RESULT');
  }

  const entries = (Array.isArray(object.entries) ? object.entries : []).slice(0, 5).map((entry) => {
    const partOfSpeech = limitedText(entry?.partOfSpeech, 80);
    const senses = (Array.isArray(entry?.senses) ? entry.senses : []).slice(0, 8).map((sense) => {
      const english = limitedText(sense?.english, 1200);
      if (!english) return null;
      const rawLevel = limitedText(sense?.level, 2).toUpperCase();
      const examples = (Array.isArray(sense?.examples) ? sense.examples : []).slice(0, 3).map((example) => ({
        english: limitedText(example?.english, 800),
        chinese: limitedText(example?.chinese, 800)
      })).filter((example) => example.english);
      return {
        level: CEFR_LEVELS.has(rawLevel) ? rawLevel : null,
        guideword: limitedText(sense?.guideword, 120),
        english,
        chinese: limitedText(sense?.chinese, 1200),
        examples
      };
    }).filter(Boolean);
    if (!senses.length) return null;
    const entryLevels = [...new Set(senses.map((sense) => sense.level).filter(Boolean))];
    return {
      headword: query,
      partOfSpeech,
      phonetics: {
        uk: limitedText(entry?.phonetics?.uk, 100).replace(/^\/+|\/+$/g, ''),
        us: limitedText(entry?.phonetics?.us, 100).replace(/^\/+|\/+$/g, '')
      },
      levels: entryLevels,
      senses
    };
  }).filter(Boolean);

  if (!entries.length) {
    throw new AiServiceError('DeepSeek 没有从 Cambridge 搜索结果中提取到可验证的释义。', 'UNVERIFIED_SEARCH_RESULT');
  }
  const levels = [...new Set(entries.flatMap((entry) => entry.levels))];
  return {
    query,
    levels,
    phonetics: {
      uk: entries.find((entry) => entry.phonetics.uk)?.phonetics.uk || '',
      us: entries.find((entry) => entry.phonetics.us)?.phonetics.us || ''
    },
    entries,
    source: {
      name: 'Cambridge Dictionary · DeepSeek Web Search',
      url: sourceUrl,
      fetchedAt: new Date().toISOString(),
      access: 'deepseek-web-search'
    }
  };
}

async function fetchCambridgeViaWebSearch(word, settings, apiKey, { signal, fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) throw new AiServiceError('请先在设置中填写 API Key。', 'MISSING_KEY');
  const endpoint = resolveAnthropicMessagesUrl(settings.endpoint);
  const model = String(settings.model || '').trim();
  if (!model) throw new AiServiceError('请先填写模型名称。', 'MISSING_MODEL');
  const requestedWord = limitedText(word, 80);
  const targetSlug = encodeURIComponent(requestedWord.toLocaleLowerCase('en-US').replace(/\s+/g, '-'));
  const targetUrl = `https://${CAMBRIDGE_HOST}${CAMBRIDGE_SIMPLIFIED_PATH}${targetSlug}`;

  let response;
  try {
    const timeoutSignal = AbortSignal.timeout(70_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    response = await fetchImpl(endpoint, {
      method: 'POST',
      signal: requestSignal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 5000,
        temperature: 0.1,
        tools: [{
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 3,
          allowed_domains: [
            `${CAMBRIDGE_HOST}${CAMBRIDGE_SIMPLIFIED_PATH.replace(/\/$/, '')}`,
            `${CAMBRIDGE_HOST}${CAMBRIDGE_ENGLISH_PATH.replace(/\/$/, '')}`
          ]
        }],
        system: [
          'You extract dictionary facts only after using the provided web_search tool.',
          'Use only Cambridge English or English-Chinese Simplified dictionary pages. Do not answer from memory.',
          'If Cambridge says the exact query is not in the dictionary yet, return status "not_found", no entries, and Cambridge-listed suggestions. Never invent a definition.',
          'Return one JSON object and no Markdown. Preserve Cambridge wording accurately.',
          'For a found entry, also create concise IELTS study enrichment using only the extracted facts. Do not claim unsupported etymology.',
          'Schema: {"status":"found|not_found","query":"exact requested query","suggestions":["related Cambridge entry"],"entries":[{"partOfSpeech":"","phonetics":{"uk":"","us":""},"senses":[{"level":"A1|A2|B1|B2|C1|C2 or empty","guideword":"","english":"","chinese":"","examples":[{"english":"","chinese":""}]}]}],"enrichment":{"summaryZh":"","collocations":["English — 中文"],"ieltsUsage":"","memoryHook":"","distinctions":[""]}}.'
        ].join('\n'),
        messages: [{
          role: 'user',
          content: `Search Cambridge for the exact query ${JSON.stringify(requestedWord)}. First try ${targetUrl}, then the exact English entry if the bilingual entry does not exist. Do not substitute a derived word or related entry. Extract English definitions, Simplified Chinese translations, CEFR levels, UK/US IPA and examples. If Cambridge explicitly says this exact query is not in its dictionary, return status "not_found" and suggestions such as exact Cambridge phrases shown near it. You must search before answering, and evidence must include an exact-query Cambridge URL. Set query exactly to ${JSON.stringify(requestedWord)}.`
        }]
      })
    });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw new AiServiceError('DeepSeek Cambridge 网页搜索超时。', 'TIMEOUT', error);
    }
    throw new AiServiceError('无法连接 DeepSeek Cambridge 网页搜索。', 'NETWORK_ERROR', error);
  }

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.error?.message || body?.message || '';
    } catch {
      detail = '';
    }
    const safeDetail = limitedText(detail, 180);
    throw new AiServiceError(`DeepSeek 网页搜索失败（HTTP ${response.status}）${safeDetail ? `：${safeDetail}` : ''}`, 'WEB_SEARCH_HTTP_ERROR');
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new AiServiceError('DeepSeek 网页搜索返回了无效 JSON。', 'INVALID_RESPONSE', error);
  }
  const blocks = Array.isArray(body?.content) ? body.content : [];
  const searched = blocks.some((block) => block?.type === 'server_tool_use')
    && blocks.some((block) => block?.type === 'web_search_tool_result');
  const sourceUrl = selectCambridgeSourceUrl(collectCambridgeUrls(body), requestedWord);
  if (!searched || !sourceUrl) {
    throw new AiServiceError('DeepSeek 未提供可核验的 Cambridge 搜索记录，已拒绝使用。', 'UNVERIFIED_SEARCH_RESULT');
  }
  const text = blocks.filter((block) => block?.type === 'text').map((block) => block.text).join('\n');
  const extracted = extractJson(text);
  if (String(extracted?.status || '').toLocaleLowerCase('en-US') === 'not_found') {
    const suggestions = stringList(extracted.suggestions, 3);
    throw new AiServiceError(
      `Cambridge 尚未收录“${requestedWord}”的词典释义。${suggestions.length ? `可尝试：${suggestions.join('、')}。` : ''}`,
      'NOT_FOUND'
    );
  }
  const dictionary = sanitizeSearchDictionary(extracted, requestedWord, sourceUrl);
  dictionary.enrichment = sanitizeEnrichment(extracted.enrichment);
  return dictionary;
}

function compactDictionaryData(dictionary) {
  return {
    word: dictionary.query,
    levels: dictionary.levels,
    entries: dictionary.entries.slice(0, 4).map((entry) => ({
      partOfSpeech: entry.partOfSpeech,
      senses: entry.senses.slice(0, 6).map((sense) => ({
        level: sense.level,
        english: sense.english,
        chinese: sense.chinese,
        examples: sense.examples.slice(0, 2)
      }))
    }))
  };
}

async function enrichWithAi(dictionary, settings, apiKey, { signal, fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) throw new AiServiceError('请先在设置中填写 API Key。', 'MISSING_KEY');
  const endpoint = resolveChatUrl(settings.endpoint);
  const model = String(settings.model || '').trim();
  if (!model) throw new AiServiceError('请先填写模型名称。', 'MISSING_MODEL');

  const systemPrompt = [
    '你是严谨的 IELTS 词汇编辑。根据用户给出的 Cambridge Dictionary 结构化资料生成补充学习信息。',
    'Cambridge 字段是唯一事实来源；不要篡改词性、CEFR、英文释义、中文释义和例句，也不要杜撰来源。',
    '不得声称资料中没有提供的词源、词根或历史联系；记忆提示只能是明确的语义联想。搭配必须自然、确定，不确定就留空。',
    '只输出一个 JSON 对象，不要 Markdown。必须包含：',
    '{"summaryZh":"一句话核心辨析","collocations":["英文搭配 — 中文"],"ieltsUsage":"雅思写作或口语使用建议","memoryHook":"简短记忆提示","distinctions":["易混词辨析"]}',
    '如果资料不足，对应字段使用空字符串或空数组。表达简洁、自然、可直接写入中文学习笔记。'
  ].join('\n');

  let response;
  try {
    const timeoutSignal = AbortSignal.timeout(45_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    response = await fetchImpl(endpoint, {
      method: 'POST',
      signal: requestSignal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `请根据以下资料输出 JSON：\n${JSON.stringify(compactDictionaryData(dictionary))}` }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 1600,
        stream: false
      })
    });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw new AiServiceError('AI 整理超时；Cambridge 结果仍可直接使用。', 'TIMEOUT', error);
    }
    throw new AiServiceError('无法连接 AI Endpoint；Cambridge 结果仍可直接使用。', 'NETWORK_ERROR', error);
  }

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.error?.message || body?.message || '';
    } catch {
      detail = '';
    }
    const safeDetail = String(detail).replace(/[\r\n]+/g, ' ').slice(0, 180);
    throw new AiServiceError(`AI 请求失败（HTTP ${response.status}）${safeDetail ? `：${safeDetail}` : ''}`, 'HTTP_ERROR');
  }

  const body = await response.json();
  const content = body?.choices?.[0]?.message?.content;
  return sanitizeEnrichment(extractJson(content));
}

async function testAiConnection(settings, apiKey, { fetchImpl = globalThis.fetch } = {}) {
  const probe = {
    query: 'vocabulary',
    levels: ['B2'],
    entries: [{
      partOfSpeech: 'noun',
      senses: [{ english: 'all the words known and used by a particular person', chinese: '词汇量', level: 'B2', examples: [] }]
    }]
  };
  await enrichWithAi(probe, settings, apiKey, { fetchImpl });
  return { ok: true, model: settings.model };
}

module.exports = {
  AiServiceError,
  collectCambridgeUrls,
  enrichWithAi,
  extractJson,
  fetchCambridgeViaWebSearch,
  resolveChatUrl,
  resolveAnthropicMessagesUrl,
  selectCambridgeSourceUrl,
  sanitizeSearchDictionary,
  sanitizeEnrichment,
  testAiConnection
};

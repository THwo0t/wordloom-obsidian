'use strict';

const cheerio = require('cheerio');

const CAMBRIDGE_BASE = 'https://dictionary.cambridge.org/dictionary/english-chinese-simplified';
const CEFR_LEVELS = new Set(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);

class CambridgeError extends Error {
  constructor(message, code, cause, status) {
    super(message, { cause });
    this.name = 'CambridgeError';
    this.code = code;
    this.status = status;
  }
}

function normalizeQuery(value) {
  const word = String(value || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!word) throw new CambridgeError('请输入要查询的英文单词或短语。', 'INVALID_QUERY');
  if (word.length > 80) throw new CambridgeError('查询内容过长，请控制在 80 个字符以内。', 'INVALID_QUERY');
  if (!/[a-z]/i.test(word)) throw new CambridgeError('查询内容至少需要包含一个英文字母。', 'INVALID_QUERY');
  return word;
}

function wordToSlug(word) {
  return encodeURIComponent(normalizeQuery(word).toLocaleLowerCase('en-US').replace(/\s+/g, '-'));
}

function cleanText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function cefrFrom(value) {
  const match = cleanText(value).toUpperCase().match(/\b(A1|A2|B1|B2|C1|C2)\b/);
  return match && CEFR_LEVELS.has(match[1]) ? match[1] : null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function firstText($root, selectors) {
  for (const selector of selectors) {
    const value = cleanText($root.find(selector).first().text());
    if (value) return value;
  }
  return '';
}

function parseCambridgeHtml(html, sourceUrl = CAMBRIDGE_BASE) {
  const $ = cheerio.load(String(html || ''));
  const parsedEntries = [];

  $('.entry-body__el').each((_, element) => {
    const $entry = $(element);
    const headword = firstText($entry, ['.headword .hw', '.di-title .hw', '.hw.dhw']);
    if (!headword) return;

    const partOfSpeech = firstText($entry, ['.pos.dpos', '.pos']);
    const ukPhonetic = firstText($entry, ['.uk.dpron-i .ipa', '.uk .ipa']);
    const usPhonetic = firstText($entry, ['.us.dpron-i .ipa', '.us .ipa']);
    const entryLevel = cefrFrom(firstText($entry, ['.dpos-h .epp-xref', '.pos-header .epp-xref']));
    const senses = [];

    $entry.find('.def-block').each((__, block) => {
      const $block = $(block);
      const english = firstText($block, ['.def.ddef_d', '.def']);
      if (!english) return;

      const chinese = firstText($block, ['.trans.dtrans.dtrans-se', '.trans.dtrans', '.trans']);
      const level = cefrFrom(firstText($block, ['.epp-xref.dxref', '.epp-xref'])) || entryLevel;
      const guideword = firstText($block.closest('.pr.dsense'), ['.guideword .dsense_gw', '.guideword']);
      const examples = [];

      $block.find('.examp.dexamp, .examp').slice(0, 3).each((___, example) => {
        const $example = $(example);
        const englishExample = firstText($example, ['.eg.deg', '.eg']) || cleanText($example.clone().find('.trans').remove().end().text());
        const chineseExample = firstText($example, ['.trans.dtrans.dtrans-se', '.trans.dtrans', '.trans']);
        if (englishExample) examples.push({ english: englishExample, chinese: chineseExample });
      });

      senses.push({
        level,
        guideword,
        english,
        chinese,
        examples
      });
    });

    if (senses.length) {
      parsedEntries.push({
        headword,
        partOfSpeech,
        phonetics: { uk: ukPhonetic, us: usPhonetic },
        levels: unique(senses.map((sense) => sense.level).concat(entryLevel)),
        senses: senses.slice(0, 8)
      });
    }
  });

  if (!parsedEntries.length) {
    const pageTitle = cleanText($('title').text());
    const suggestion = firstText($.root(), ['.didyoumean', '.spellcheck', '.lbt.lp-20']);
    throw new CambridgeError(
      suggestion ? `Cambridge 未找到该词条。${suggestion}` : `Cambridge 未返回可识别的词条${pageTitle ? `（${pageTitle}）` : ''}。`,
      'NOT_FOUND'
    );
  }

  const levels = unique(parsedEntries.flatMap((entry) => entry.levels));
  return {
    query: parsedEntries[0].headword,
    levels,
    phonetics: {
      uk: parsedEntries.find((entry) => entry.phonetics.uk)?.phonetics.uk || '',
      us: parsedEntries.find((entry) => entry.phonetics.us)?.phonetics.us || ''
    },
    entries: parsedEntries.slice(0, 5),
    source: {
      name: 'Cambridge Dictionary',
      url: sourceUrl,
      fetchedAt: new Date().toISOString()
    }
  };
}

function parseCambridgeApiXml(xml, metadata = {}) {
  const $ = cheerio.load(String(xml || ''), { xml: true });
  const entries = [];
  const rootHeadword = cleanText($('di > header > f').first().text()) || cleanText($('header > f').first().text());

  const blocks = $('pos-block').length ? $('pos-block').toArray() : $('di').toArray();
  for (const block of blocks) {
    const $block = $(block);
    const headword = cleanText($block.children('header').children('f').first().text()) || rootHeadword || cleanText(metadata.entryLabel);
    const partOfSpeech = cleanText($block.children('header').find('pos').first().text()) || cleanText($block.find('pos').first().text());
    const ipaValues = unique($block.closest('di').children('header').find('ipa').toArray().map((node) => cleanText($(node).text())));
    const senses = [];

    $block.find('def-block').each((_, definitionBlock) => {
      const $definition = $(definitionBlock);
      const english = cleanText($definition.children('definition').children('def').first().text()) || cleanText($definition.find('definition def').first().text());
      if (!english) return;
      const chinese = cleanText($definition.children('definition').children('trans').first().text()) || cleanText($definition.find('definition trans').first().text());
      const $sense = $definition.closest('sense-block');
      const level = cefrFrom(cleanText($sense.children('header').find('lvl').first().text()))
        || cefrFrom(cleanText($block.children('header').find('lvl').first().text()))
        || cefrFrom(cleanText($block.closest('di').children('header').find('lvl').first().text()));
      const guideword = cleanText($sense.children('header').find('gw').first().text());
      const examples = [];
      $definition.children('examp').slice(0, 3).each((__, example) => {
        const $example = $(example);
        const englishExample = cleanText($example.children('eg').first().text());
        const chineseExample = cleanText($example.children('trans').first().text());
        if (englishExample) examples.push({ english: englishExample, chinese: chineseExample });
      });
      senses.push({ level, guideword, english, chinese, examples });
    });

    if (headword && senses.length) {
      entries.push({
        headword,
        partOfSpeech,
        phonetics: { uk: ipaValues[0] || '', us: ipaValues[1] || '' },
        levels: unique(senses.map((sense) => sense.level)),
        senses: senses.slice(0, 8)
      });
    }
  }

  if (!entries.length) throw new CambridgeError('Cambridge 官方 API 返回了无法识别的词条格式。', 'INVALID_API_RESPONSE');
  return {
    query: entries[0].headword,
    levels: unique(entries.flatMap((entry) => entry.levels)),
    phonetics: {
      uk: entries.find((entry) => entry.phonetics.uk)?.phonetics.uk || '',
      us: entries.find((entry) => entry.phonetics.us)?.phonetics.us || ''
    },
    entries: entries.slice(0, 5),
    source: {
      name: 'Cambridge Dictionary API',
      url: safeCambridgeUrl(metadata.entryUrl) || `${CAMBRIDGE_BASE}/${wordToSlug(entries[0].headword)}`,
      fetchedAt: new Date().toISOString()
    }
  };
}

function safeCambridgeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && (url.hostname === 'dictionary.cambridge.org' || url.hostname.endsWith('.cambridge.org'))
      ? url.toString()
      : '';
  } catch {
    return '';
  }
}

async function apiRequest(url, accessKey, { signal, fetchImpl = globalThis.fetch } = {}) {
  let response;
  try {
    const timeoutSignal = AbortSignal.timeout(18_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    response = await fetchImpl(url, {
      signal: requestSignal,
      headers: { accept: 'application/json', accessKey }
    });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw new CambridgeError('Cambridge 官方 API 查询超时。', 'TIMEOUT', error);
    }
    throw new CambridgeError('无法连接 Cambridge 官方 API。', 'NETWORK_ERROR', error);
  }
  if (!response.ok) {
    const message = response.status === 403
      ? 'Cambridge Dictionary API Access Key 无效或无权访问该词典。'
      : `Cambridge 官方 API 返回了 HTTP ${response.status}。`;
    throw new CambridgeError(message, 'API_HTTP_ERROR', undefined, response.status);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new CambridgeError('Cambridge 官方 API 返回了无效 JSON。', 'INVALID_API_RESPONSE', error);
  }
}

let cachedSimplifiedDictionaryCode = '';

async function fetchCambridgeApi(word, accessKey, options = {}) {
  const normalized = normalizeQuery(word);
  const key = String(accessKey || '').trim();
  if (!key) throw new CambridgeError('缺少 Cambridge Dictionary API Access Key。', 'MISSING_API_KEY');

  if (!cachedSimplifiedDictionaryCode) {
    const dictionaries = await apiRequest('https://dictionary.cambridge.org/api/v1/dictionaries', key, options);
    const list = Array.isArray(dictionaries) ? dictionaries : dictionaries?.dictionaries || [];
    const selected = list.find((item) => /simplified chinese/i.test(item.dictionaryName || '') && /advanced|learner/i.test(item.dictionaryName || ''))
      || list.find((item) => /english-chinese-simplified/i.test(item.dictionaryUrl || ''))
      || list.find((item) => /simplified chinese/i.test(item.dictionaryName || ''));
    if (!selected?.dictionaryCode) {
      throw new CambridgeError('这个 Cambridge API Key 没有英汉简体词典权限。', 'DICTIONARY_UNAVAILABLE');
    }
    cachedSimplifiedDictionaryCode = selected.dictionaryCode;
  }

  const url = new URL(`https://dictionary.cambridge.org/api/v1/dictionaries/${encodeURIComponent(cachedSimplifiedDictionaryCode)}/search/first`);
  url.searchParams.set('format', 'xml');
  url.searchParams.set('q', normalized);
  const body = await apiRequest(url.toString(), key, options);
  const entry = Array.isArray(body) ? body[0] : body?.entry || body;
  if (!entry?.entryContent) throw new CambridgeError(`Cambridge 官方 API 中没有找到“${normalized}”。`, 'NOT_FOUND');
  return parseCambridgeApiXml(entry.entryContent, entry);
}

async function fetchCambridge(word, { signal, fetchImpl = globalThis.fetch } = {}) {
  const normalized = normalizeQuery(word);
  const url = `${CAMBRIDGE_BASE}/${wordToSlug(normalized)}`;
  let response;

  try {
    const timeoutSignal = AbortSignal.timeout(18_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    response = await fetchImpl(url, {
      signal: requestSignal,
      redirect: 'follow',
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'user-agent': 'Mozilla/5.0 WordLoom/0.1 (+personal vocabulary companion)'
      }
    });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw new CambridgeError('Cambridge 查询超时，请检查网络后重试。', 'TIMEOUT', error);
    }
    throw new CambridgeError('暂时无法连接 Cambridge Dictionary。', 'NETWORK_ERROR', error);
  }

  if (response.status === 404) throw new CambridgeError(`Cambridge 中没有找到“${normalized}”。`, 'NOT_FOUND');
  if (!response.ok) throw new CambridgeError(`Cambridge 返回了 HTTP ${response.status}。`, 'HTTP_ERROR', undefined, response.status);

  const html = await response.text();
  const finalUrl = response.url && response.url.startsWith('https://dictionary.cambridge.org/') ? response.url : url;
  return parseCambridgeHtml(html, finalUrl);
}

module.exports = {
  CAMBRIDGE_BASE,
  CambridgeError,
  fetchCambridgeApi,
  fetchCambridge,
  normalizeQuery,
  parseCambridgeApiXml,
  parseCambridgeHtml,
  wordToSlug
};

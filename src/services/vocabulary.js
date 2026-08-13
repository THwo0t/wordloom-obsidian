'use strict';

const MASTER_TABLE_HEADING = '## 单词总表';
const MASTER_TABLE_START = '<!-- wordloom-master-table:start -->';
const MASTER_TABLE_END = '<!-- wordloom-master-table:end -->';
const DETAILS_HEADING = '## Wordloom 新增词汇';

function cleanInline(value) {
  return String(value || '')
    .replace(/\\\|/g, '|')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripPartOfSpeech(value) {
  return cleanInline(value).replace(/\s*\([A-Za-z./\s]+\)\s*$/u, '').trim();
}

function normalizeEnglishAnswer(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/[.!?。！？]+$/u, '')
    .trim();
}

function answerVariantsFromWord(value) {
  const withoutPos = stripPartOfSpeech(value);
  return [...new Set(withoutPos
    .split(/\s+\/\s+/u)
    .map(normalizeEnglishAnswer)
    .filter(Boolean))];
}

function vocabularyKey(value) {
  return answerVariantsFromWord(value)[0] || normalizeEnglishAnswer(stripPartOfSpeech(value));
}

function isStrictEnglishAnswer(answer, word) {
  const normalized = normalizeEnglishAnswer(answer);
  return Boolean(normalized) && answerVariantsFromWord(word).includes(normalized);
}

function splitMarkdownRow(line) {
  const value = String(line || '').trim();
  if (!value.startsWith('|') || !value.endsWith('|')) return [];
  const cells = [];
  let cell = '';
  let escaped = false;
  for (const character of value.slice(1, -1)) {
    if (escaped) {
      cell += character === '|' ? '|' : `\\${character}`;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  if (escaped) cell += '\\';
  cells.push(cell.trim());
  return cells;
}

function isSeparatorCell(value) {
  return /^:?-{3,}:?$/u.test(String(value || '').trim());
}

function normalizeEntry(entry) {
  const word = stripPartOfSpeech(entry?.word);
  const meaning = cleanInline(entry?.meaning).replace(/^—\s*/u, '');
  if (!word || !meaning) return null;
  return { word, meaning };
}

function mergeEntries(entries) {
  const merged = [];
  const positions = new Map();
  for (const raw of entries || []) {
    const entry = normalizeEntry(raw);
    if (!entry) continue;
    const key = vocabularyKey(entry.word);
    if (!key || /^(?:word|word \/ phrase|单词)$/iu.test(key)) continue;
    if (positions.has(key)) {
      const existing = merged[positions.get(key)];
      if (entry.meaning.includes(existing.meaning)) existing.meaning = entry.meaning;
      else if (!existing.meaning.includes(entry.meaning)) existing.meaning = `${existing.meaning}；${entry.meaning}`;
      continue;
    }
    positions.set(key, merged.length);
    merged.push(entry);
  }
  return merged;
}

function masterTableRange(text) {
  const start = String(text || '').indexOf(MASTER_TABLE_START);
  if (start === -1) return null;
  const endMarker = String(text || '').indexOf(MASTER_TABLE_END, start + MASTER_TABLE_START.length);
  if (endMarker === -1) return null;
  return { start, end: endMarker + MASTER_TABLE_END.length };
}

function parseTableRows(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/u)) {
    const cells = splitMarkdownRow(line);
    if (cells.length < 2 || cells.some(isSeparatorCell)) continue;
    if (cells[0] === '#' && /^(?:word|word \/ phrase|单词)$/iu.test(cleanInline(cells[1]))) continue;
    const offset = /^\d+$/u.test(cells[0]) ? 1 : 0;
    if (cells.length < offset + 2) continue;
    const word = cells[offset];
    const meaning = cells[offset + 1];
    if (/^(?:word|word \/ phrase|单词)$/iu.test(cleanInline(word))) continue;
    rows.push({ word, meaning });
  }
  return mergeEntries(rows);
}

function parseMasterTable(text) {
  const range = masterTableRange(text);
  if (!range) return [];
  return parseTableRows(String(text || '').slice(range.start, range.end));
}

function parseChecklistRows(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/u)) {
    const match = line.match(/^\s*-\s*(?:\[[ xX]\]\s*)?(.+?)\s+—\s+(.+)$/u);
    if (match) rows.push({ word: match[1], meaning: match[2] });
  }
  return mergeEntries(rows);
}

function parseWordloomBlocks(text) {
  const rows = [];
  const pattern = /<!-- wordloom:[^>\s]+ -->\n([\s\S]*?)\n<!-- \/wordloom:[^>\s]+ -->/gu;
  for (const match of String(text || '').matchAll(pattern)) {
    const title = match[1].match(/^> \[!abstract\]- \*\*(.+?)\*\*.*?(?:\s+—\s+(.+))?$/mu);
    if (!title) continue;
    const fallback = match[1].match(/^> \d+\. \*\*(.+?)\*\*/mu)?.[1] || '';
    rows.push({ word: title[1], meaning: title[2] || fallback });
  }
  return mergeEntries(rows);
}

function extractVocabularyEntries(text, { includeLegacy = true } = {}) {
  const source = String(text || '');
  const master = parseMasterTable(source);
  if (!includeLegacy && master.length) return master;
  const detailIndex = source.indexOf(DETAILS_HEADING);
  const listArea = detailIndex === -1 ? source : source.slice(0, detailIndex);
  const legacy = master.length ? [] : [...parseTableRows(listArea), ...parseChecklistRows(listArea)];
  return mergeEntries([...master, ...legacy, ...parseWordloomBlocks(source)]);
}

function escapeTableCell(value) {
  return cleanInline(value).replace(/\|/g, '\\|');
}

function renderMasterTable(entries) {
  const normalized = mergeEntries(entries);
  const rows = normalized.map((entry, index) => `| ${index + 1} | ${escapeTableCell(entry.word)} | ${escapeTableCell(entry.meaning)} |`);
  return [
    MASTER_TABLE_START,
    MASTER_TABLE_HEADING,
    '',
    '| # | Word / Phrase | Meaning |',
    '| ---: | --- | --- |',
    ...rows,
    MASTER_TABLE_END
  ].join('\n');
}

function briefMeaningFromResult(result) {
  for (const entry of result?.entries || []) {
    for (const sense of entry?.senses || []) {
      const meaning = cleanInline(sense?.chinese || sense?.english);
      if (meaning) return meaning.length > 88 ? `${meaning.slice(0, 87)}…` : meaning;
    }
  }
  return '待补充释义';
}

function updateMasterTable(text, entry) {
  const source = String(text || '');
  const normalized = normalizeEntry(entry);
  if (!normalized) throw new Error('无法为单词总表生成有效词条。');
  const range = masterTableRange(source);
  const current = range ? parseMasterTable(source) : [];
  const entries = mergeEntries([...current, normalized]);
  const existed = current.some((item) => vocabularyKey(item.word) === vocabularyKey(normalized.word));
  const table = renderMasterTable(entries);

  if (range) {
    return {
      text: `${source.slice(0, range.start)}${table}${source.slice(range.end)}`,
      entries,
      existed,
      before: source.slice(0, range.start),
      after: source.slice(range.end),
      replacedExistingTable: true
    };
  }

  const detailIndex = source.indexOf(DETAILS_HEADING);
  const insertAt = detailIndex === -1 ? source.length : detailIndex;
  const before = source.slice(0, insertAt);
  const after = source.slice(insertAt);
  const leading = before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const trailing = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  return {
    text: `${before}${leading}${table}${trailing}${after}`,
    entries,
    existed,
    before,
    after,
    replacedExistingTable: false
  };
}

function extractSection(text, heading) {
  const source = String(text || '');
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^${escaped}$`, 'mu').exec(source);
  if (!match) return '';
  const bodyStart = match.index + match[0].length;
  const nextHeading = /^##\s+/gmu;
  nextHeading.lastIndex = bodyStart;
  const next = nextHeading.exec(source);
  return source.slice(match.index, next ? next.index : source.length).trim();
}

function documentPreamble(text) {
  const source = String(text || '');
  const heading = source.match(/^#\s+[^#].*$/mu);
  if (!heading) return '# IELTS Words';
  return source.slice(0, heading.index + heading[0].length).trimEnd();
}

function buildUnifiedVocabularyDocument(text) {
  const source = String(text || '');
  const entries = extractVocabularyEntries(source);
  const detailsIndex = source.indexOf(DETAILS_HEADING);
  const details = detailsIndex === -1 ? '' : source.slice(detailsIndex);
  const preservedSections = ['## 待整理记录区', '## 相关笔记']
    .map((heading) => extractSection(detailsIndex === -1 ? source : source.slice(0, detailsIndex), heading))
    .filter(Boolean);
  const head = [documentPreamble(source), renderMasterTable(entries), ...preservedSections].join('\n\n');
  return {
    text: details ? `${head}\n\n${details}` : `${head}\n`,
    entries,
    details,
    hadMasterTable: Boolean(masterTableRange(source))
  };
}

function publicQuizEntries(text) {
  return parseMasterTable(text).map((entry, offset) => ({
    id: String(offset + 1),
    index: offset + 1,
    word: entry.word,
    meaning: entry.meaning,
    answers: answerVariantsFromWord(entry.word)
  }));
}

module.exports = {
  DETAILS_HEADING,
  MASTER_TABLE_END,
  MASTER_TABLE_HEADING,
  MASTER_TABLE_START,
  answerVariantsFromWord,
  briefMeaningFromResult,
  buildUnifiedVocabularyDocument,
  extractVocabularyEntries,
  isStrictEnglishAnswer,
  masterTableRange,
  mergeEntries,
  normalizeEnglishAnswer,
  parseMasterTable,
  parseWordloomBlocks,
  publicQuizEntries,
  renderMasterTable,
  updateMasterTable,
  vocabularyKey
};

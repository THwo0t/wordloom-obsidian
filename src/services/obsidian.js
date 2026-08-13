'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  DETAILS_HEADING,
  MASTER_TABLE_END,
  MASTER_TABLE_START,
  briefMeaningFromResult,
  buildUnifiedVocabularyDocument,
  masterTableRange,
  parseMasterTable,
  publicQuizEntries,
  updateMasterTable,
  vocabularyKey
} = require('./vocabulary');

const PROTECTED_SECTION_HEADING = DETAILS_HEADING;
const MAX_NOTE_BYTES = 20 * 1024 * 1024;
const MAX_BLOCK_BYTES = 64 * 1024;

class NoteProtectionError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'NoteProtectionError';
    this.code = code;
    this.details = details;
  }
}

const LEGACY_EXPANDED_TEMPLATE = `<!-- wordloom:{{id}} -->
### {{word}} {{badges}}

> [!abstract] 发音与来源
> {{pronunciation}} · [Cambridge Dictionary ↗]({{sourceUrl}})

{{summary}}

#### 核心释义

{{meanings}}

{{collocations}}

{{ieltsTip}}

{{memoryHook}}

<small>收录于 {{date}}</small>
<!-- /wordloom:{{id}} -->`;

const DEFAULT_TEMPLATE = `<!-- wordloom:{{id}} -->
> [!abstract]- {{compactTitle}}
{{details}}
<!-- /wordloom:{{id}} -->`;

function escapeMarkdownInline(value) {
  return String(value || '').replace(/([\\`*_[\]<>])/g, '\\$1').replace(/[\r\n]+/g, ' ').trim();
}

function escapeCodeSpan(value) {
  return String(value || '').replace(/`/g, "'").replace(/[\r\n]+/g, ' ').trim();
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function markerId(word) {
  return String(word || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9'-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'word';
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function countMatches(text, pattern) {
  return (String(text || '').match(pattern) || []).length;
}

function normalizeCandidate(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[*_`]/g, '')
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderMeaningBlocks(result) {
  let index = 0;
  const lines = [];
  for (const entry of result.entries || []) {
    for (const sense of entry.senses || []) {
      index += 1;
      const pos = escapeCodeSpan(entry.partOfSpeech || 'word');
      const level = escapeCodeSpan(sense.level || '—');
      const chinese = escapeMarkdownInline(sense.chinese || '暂无 Cambridge 中文释义');
      const english = escapeMarkdownInline(sense.english);
      lines.push(`${index}. **${chinese}**  \`${pos}\` \`${level}\``);
      if (english) lines.push(`   - ${english}`);
      for (const example of (sense.examples || []).slice(0, 2)) {
        const exampleEn = escapeMarkdownInline(example.english);
        const exampleZh = escapeMarkdownInline(example.chinese);
        if (exampleEn) lines.push(`   - *${exampleEn}*${exampleZh ? ` — ${exampleZh}` : ''}`);
      }
    }
  }
  return lines.length ? lines.join('\n') : '- 暂无可用释义';
}

function renderOptionalSection(title, content, type = 'list') {
  if (Array.isArray(content)) {
    const items = content.map(escapeMarkdownInline).filter(Boolean);
    if (!items.length) return '';
    return `#### ${title}\n\n${items.map((item) => `- ${item}`).join('\n')}`;
  }
  const text = escapeMarkdownInline(content);
  if (!text) return '';
  if (type === 'callout') return `> [!tip] ${title}\n> ${text}`;
  return `#### ${title}\n\n${text}`;
}

function quoteCalloutBody(value) {
  return String(value || '').split('\n').map((line) => line ? `> ${line}` : '>').join('\n');
}

function firstMeaning(result) {
  for (const entry of result.entries || []) {
    for (const sense of entry.senses || []) {
      const value = escapeMarkdownInline(sense.chinese || sense.english);
      if (!value) continue;
      return value.length > 42 ? `${value.slice(0, 41)}…` : value;
    }
  }
  return '';
}

function templateValues(result, date = new Date()) {
  const word = escapeMarkdownInline(result.query);
  const levels = [...new Set(result.levels || [])].map(escapeCodeSpan).filter(Boolean);
  const parts = [...new Set((result.entries || []).map((entry) => escapeCodeSpan(entry.partOfSpeech)).filter(Boolean))];
  const badges = [...levels, ...parts].map((value) => `\`${value}\``).join(' ');
  const uk = escapeMarkdownInline(result.phonetics?.uk);
  const us = escapeMarkdownInline(result.phonetics?.us);
  const pronunciation = [uk && `**UK** /${uk.replace(/^\/+|\/+$/g, '')}/`, us && `**US** /${us.replace(/^\/+|\/+$/g, '')}/`]
    .filter(Boolean)
    .join(' · ') || '暂无音标';
  const enrichment = result.enrichment || {};
  const briefMeaning = firstMeaning(result);
  const summaryText = escapeMarkdownInline(enrichment.summaryZh);
  const details = [
    `**发音与来源**\n\n${pronunciation} · [Cambridge Dictionary ↗](${safeUrl(result.source?.url)})`,
    summaryText ? `*${summaryText}*` : '',
    `#### 核心释义\n\n${renderMeaningBlocks(result)}`,
    renderOptionalSection('常用搭配', enrichment.collocations),
    renderOptionalSection('IELTS 使用提示', enrichment.ieltsUsage),
    renderOptionalSection('记忆与辨析', [enrichment.memoryHook, ...(enrichment.distinctions || [])].filter(Boolean)),
    `<small>收录于 ${date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Singapore' })}</small>`
  ].filter(Boolean).join('\n\n');
  const compactTitle = [`**${word}**`, badges, briefMeaning ? `— ${briefMeaning}` : ''].filter(Boolean).join(' ');

  return {
    id: markerId(result.query),
    word,
    badges,
    pronunciation,
    sourceUrl: safeUrl(result.source?.url),
    summary: enrichment.summaryZh ? `> ${escapeMarkdownInline(enrichment.summaryZh)}` : '',
    meanings: renderMeaningBlocks(result),
    collocations: renderOptionalSection('常用搭配', enrichment.collocations),
    ieltsTip: renderOptionalSection('IELTS 使用提示', enrichment.ieltsUsage, 'callout'),
    memoryHook: renderOptionalSection('记忆与辨析', [enrichment.memoryHook, ...(enrichment.distinctions || [])].filter(Boolean)),
    date: date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Singapore' }),
    compactTitle,
    details: quoteCalloutBody(details)
  };
}

function renderTemplate(result, template = DEFAULT_TEMPLATE, date = new Date()) {
  const values = templateValues(result, date);
  return String(template || DEFAULT_TEMPLATE)
    .replace(/\{\{([a-zA-Z]+)\}\}/g, (_, key) => Object.hasOwn(values, key) ? values[key] : `{{${key}}}`)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function containsWord(note, word) {
  const id = markerId(word);
  if (note.toLocaleLowerCase('en-US').includes(`<!-- wordloom:${id} -->`)) return true;
  const target = normalizeCandidate(word);
  if (!target) return false;

  for (const line of String(note || '').split(/\r?\n/)) {
    const table = line.match(/^\|\s*([^|]+?)\s*\|/);
    if (table) {
      const alternatives = table[1].split(/\s+\/\s+/).map(normalizeCandidate);
      if (alternatives.includes(target)) return true;
    }

    const checklist = line.match(/^\s*-\s*(?:\[[ xX]\]\s*)?(.+?)(?:\s+—\s+|\s+\|\s+|$)/);
    if (checklist && normalizeCandidate(checklist[1]) === target) return true;

    const heading = line.match(/^#{2,6}\s+(.+)$/);
    if (heading && normalizeCandidate(heading[1]) === target) return true;
  }
  return false;
}

function validateNotePath(notePath) {
  const resolved = path.resolve(String(notePath || '').trim());
  if (!String(notePath || '').trim()) throw new Error('请先选择 Obsidian 的 IELTS words.md 笔记。');
  if (path.extname(resolved).toLocaleLowerCase('en-US') !== '.md') throw new Error('Obsidian 笔记路径必须以 .md 结尾。');
  return resolved;
}

function validateExistingNote(buffer, resolved) {
  if (!Buffer.isBuffer(buffer)) throw new NoteProtectionError('内部保护检查未收到有效笔记数据。', 'INVALID_BUFFER');
  if (buffer.byteLength > MAX_NOTE_BYTES) {
    throw new NoteProtectionError('笔记超过 20 MB，Wordloom 为安全起见拒绝自动写入。', 'NOTE_TOO_LARGE');
  }
  const text = buffer.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(buffer)) {
    throw new NoteProtectionError('笔记不是有效 UTF-8，已停止写入以避免损坏编码。', 'INVALID_ENCODING');
  }
  if (text.includes('\u0000')) throw new NoteProtectionError('笔记含有空字节，已停止写入。', 'INVALID_CONTENT');

  if (text.startsWith('---')) {
    const frontmatterEnd = text.indexOf('\n---', 3);
    if (frontmatterEnd === -1) {
      throw new NoteProtectionError('笔记的 YAML frontmatter 没有正常闭合，已停止写入。', 'INVALID_FRONTMATTER');
    }
  }

  const opens = countMatches(text, /<!-- wordloom:[^>]+ -->/g);
  const closes = countMatches(text, /<!-- \/wordloom:[^>]+ -->/g);
  if (opens !== closes) {
    throw new NoteProtectionError('已有 Wordloom 区块边界不完整，已停止写入，请先检查笔记。', 'UNBALANCED_MARKERS', { opens, closes });
  }
  const masterStarts = countMatches(text, new RegExp(MASTER_TABLE_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
  const masterEnds = countMatches(text, new RegExp(MASTER_TABLE_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
  if (masterStarts !== masterEnds || masterStarts > 1) {
    throw new NoteProtectionError('单词总表保护边界不完整或重复，已停止写入。', 'UNBALANCED_MASTER_TABLE', {
      starts: masterStarts,
      ends: masterEnds
    });
  }

  return {
    path: resolved,
    bytes: buffer.byteLength,
    hash: sha256(buffer),
    markersBalanced: true,
    blockCount: opens
  };
}

function validateRenderedBlock(block, result) {
  const id = markerId(result.query);
  const open = `<!-- wordloom:${id} -->`;
  const close = `<!-- /wordloom:${id} -->`;
  const bytes = Buffer.byteLength(block, 'utf8');
  if (bytes > MAX_BLOCK_BYTES) {
    throw new NoteProtectionError('生成词条超过 64 KB，已拒绝写入。', 'BLOCK_TOO_LARGE', { bytes });
  }
  if (!block.startsWith(open) || !block.endsWith(close)) {
    throw new NoteProtectionError('写入模板必须保留 Wordloom 的开头和结尾保护标记。', 'INVALID_TEMPLATE_MARKERS');
  }
  if (countMatches(block, /<!-- wordloom:[^>]+ -->/g) !== 1 || countMatches(block, /<!-- \/wordloom:[^>]+ -->/g) !== 1) {
    throw new NoteProtectionError('生成词条包含异常的重复边界，已拒绝写入。', 'DUPLICATE_TEMPLATE_MARKERS');
  }
  if (/\{\{[a-zA-Z]+\}\}/.test(block)) {
    throw new NoteProtectionError('模板仍含未替换变量，已拒绝写入。', 'UNRESOLVED_TEMPLATE');
  }
  if (block.includes('\u0000')) throw new NoteProtectionError('生成词条含有非法字符，已拒绝写入。', 'INVALID_BLOCK');
  return { id, bytes, hash: sha256(block) };
}

function backupDirectoryFor(resolved) {
  return path.join(path.dirname(resolved), '.wordloom-backups', path.basename(resolved, path.extname(resolved)));
}

function backupTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, (value) => value.replace('.', '-'));
}

async function createBackup(resolved, currentBuffer, mode, beforeHash) {
  const directory = backupDirectoryFor(resolved);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = `${path.basename(resolved, path.extname(resolved))}.${backupTimestamp()}.${beforeHash.slice(0, 12)}.md`;
  const backupPath = path.join(directory, filename);
  await fs.writeFile(backupPath, currentBuffer, { flag: 'wx', mode: mode & 0o777 });
  return backupPath;
}

async function atomicReplace(resolved, buffer, mode) {
  const tempPath = `${resolved}.wordloom-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.tmp`;
  let handle;
  try {
    handle = await fs.open(tempPath, 'wx', mode & 0o777);
    await handle.writeFile(buffer);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(tempPath, resolved);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(tempPath).catch((error) => {
      if (error.code !== 'ENOENT') console.warn('Could not clean Wordloom temp file:', error.message);
    });
  }
}

function buildAppendage(currentText, block) {
  const separator = currentText.endsWith('\n\n') ? '' : currentText.endsWith('\n') ? '\n' : '\n\n';
  const needsHeading = !new RegExp(`^${PROTECTED_SECTION_HEADING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'mu').test(currentText);
  return `${separator}${needsHeading ? `${PROTECTED_SECTION_HEADING}\n\n` : ''}${block}\n`;
}

function validateTransition(currentText, nextText, tableUpdate, appendage, blockInfo, result) {
  const expected = `${tableUpdate.text}${appendage}`;
  if (nextText !== expected) {
    throw new NoteProtectionError('双写内容与预期不一致，已停止替换原笔记。', 'TRANSITION_MISMATCH');
  }
  if (!nextText.endsWith(appendage) || !appendage.includes(`<!-- wordloom:${blockInfo.id} -->`)) {
    throw new NoteProtectionError('新增详解区块校验失败，已停止写入。', 'APPEND_CHECK_FAILED');
  }

  const beforeRange = masterTableRange(currentText);
  const afterRange = masterTableRange(tableUpdate.text);
  if (!afterRange) throw new NoteProtectionError('单词总表边界缺失，已停止写入。', 'MASTER_TABLE_MISSING');
  if (beforeRange) {
    const beforeOutside = `${currentText.slice(0, beforeRange.start)}${currentText.slice(beforeRange.end)}`;
    const afterOutside = `${tableUpdate.text.slice(0, afterRange.start)}${tableUpdate.text.slice(afterRange.end)}`;
    if (beforeOutside !== afterOutside) {
      throw new NoteProtectionError('单词总表之外的原文发生变化，已停止写入。', 'OUTSIDE_TABLE_CHANGED');
    }
  } else if (!tableUpdate.text.startsWith(tableUpdate.before) || !tableUpdate.text.endsWith(tableUpdate.after)) {
    throw new NoteProtectionError('创建单词总表时未完整保留原文，已停止写入。', 'ORIGINAL_CONTENT_CHANGED');
  }

  const key = vocabularyKey(result.query);
  if (!parseMasterTable(tableUpdate.text).some((entry) => vocabularyKey(entry.word) === key)) {
    throw new NoteProtectionError('新增词没有写入单词总表，已停止写入。', 'TABLE_ENTRY_MISSING');
  }
  for (const block of currentText.match(WORDLOOM_BLOCK_PATTERN) || []) {
    if (!tableUpdate.text.includes(block)) {
      throw new NoteProtectionError('已有 Wordloom 详解发生变化，已停止写入。', 'EXISTING_BLOCK_CHANGED');
    }
  }
  return true;
}

async function writeReceipt(backupPath, receipt) {
  const receiptPath = `${backupPath}.receipt.json`;
  await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return receiptPath;
}

const WORDLOOM_BLOCK_PATTERN = /<!-- wordloom:([^>\s]+) -->\n([\s\S]*?)\n<!-- \/wordloom:\1 -->/g;

function wordloomSkeleton(value) {
  return String(value || '').replace(WORDLOOM_BLOCK_PATTERN, (_block, id) => `<!-- wordloom:${id} -->\n<!-- /wordloom:${id} -->`);
}

function normalizeCodeSpanEscapes(value) {
  return String(value || '').replace(/`([^`\n]*)`/g, (_span, content) => `\`${content.replace(/\\([\[\]])/g, '$1')}\``);
}

function collapseWordloomBlocks(value) {
  let changed = 0;
  const text = String(value || '').replace(WORDLOOM_BLOCK_PATTERN, (block, id, rawContent) => {
    const content = rawContent.trim();
    if (/^> \[!abstract\]- /m.test(content)) {
      const normalized = normalizeCodeSpanEscapes(block);
      if (normalized !== block) changed += 1;
      return normalized;
    }
    const lines = content.split('\n');
    const headingMatch = lines[0]?.match(/^###\s+(.+)$/);
    if (!headingMatch) return block;

    const heading = headingMatch[1].trim();
    const badgeIndex = heading.indexOf('`');
    const word = (badgeIndex === -1 ? heading : heading.slice(0, badgeIndex)).trim();
    const badges = badgeIndex === -1 ? '' : heading.slice(badgeIndex).trim();
    let body = lines.slice(1).join('\n').trim();
    const meaning = body.match(/^\d+\.\s+\*\*(.+?)\*\*/m)?.[1] || '';

    body = body
      .replace(/^> \[!abstract\] 发音与来源\s*\n> (.+)$/m, '**发音与来源**\n\n$1')
      .replace(/^> \[!tip\] IELTS 使用提示\s*\n> (.+)$/m, '#### IELTS 使用提示\n\n$1')
      .replace(/^> (?!\[!)(.+)$/gm, '*$1*');

    const compactTitle = [`**${word}**`, badges, meaning ? `— ${meaning}` : ''].filter(Boolean).join(' ');
    changed += 1;
    return `<!-- wordloom:${id} -->\n> [!abstract]- ${compactTitle}\n${quoteCalloutBody(body)}\n<!-- /wordloom:${id} -->`;
  });
  return { text, changed };
}

let writeQueue = Promise.resolve();

function collapseWordloomEntries(notePath) {
  const operation = async () => {
    const resolved = validateNotePath(notePath);
    const [currentBuffer, noteStat] = await Promise.all([fs.readFile(resolved), fs.stat(resolved)]);
    const before = validateExistingNote(currentBuffer, resolved);
    const current = currentBuffer.toString('utf8');
    const collapsed = collapseWordloomBlocks(current);
    if (!collapsed.changed) {
      return { status: 'unchanged', path: resolved, collapsed: 0, checks: { originalHash: before.hash, markersBalanced: true } };
    }
    if (wordloomSkeleton(current) !== wordloomSkeleton(collapsed.text)) {
      throw new NoteProtectionError('折叠转换影响了词条以外的内容，已停止写入。', 'MIGRATION_SCOPE_CHECK_FAILED');
    }

    const nextBuffer = Buffer.from(collapsed.text, 'utf8');
    const next = validateExistingNote(nextBuffer, resolved);
    const latestBuffer = await fs.readFile(resolved);
    if (!latestBuffer.equals(currentBuffer)) {
      throw new NoteProtectionError('Obsidian 在转换前修改了笔记。本次操作已取消，请重试。', 'CONCURRENT_EDIT');
    }

    const backupPath = await createBackup(resolved, currentBuffer, noteStat.mode, before.hash);
    await atomicReplace(resolved, nextBuffer, noteStat.mode);
    const writtenBuffer = await fs.readFile(resolved);
    if (!writtenBuffer.equals(nextBuffer)) {
      throw new NoteProtectionError('折叠转换写后内容不一致；原始备份已保留。', 'POST_WRITE_MISMATCH', { backupPath });
    }
    const after = validateExistingNote(writtenBuffer, resolved);
    if (wordloomSkeleton(current) !== wordloomSkeleton(writtenBuffer.toString('utf8'))) {
      await atomicReplace(resolved, currentBuffer, noteStat.mode);
      throw new NoteProtectionError('折叠转换写后范围校验失败，已自动恢复原笔记。', 'POST_WRITE_CHECK_FAILED', { backupPath });
    }

    const checks = {
      backupCreated: true,
      originalHash: before.hash,
      resultHash: after.hash,
      markersBalanced: after.markersBalanced,
      blocksCollapsed: collapsed.changed,
      outsideBlocksUntouched: true
    };
    const receiptPath = await writeReceipt(backupPath, {
      version: 1,
      operation: 'collapse-wordloom-entries',
      writtenAt: new Date().toISOString(),
      notePath: resolved,
      backupPath,
      checks
    }).catch(() => '');
    return { status: 'collapsed', path: resolved, collapsed: collapsed.changed, backupPath, receiptPath, checks };
  };

  const queued = writeQueue.then(operation, operation);
  writeQueue = queued.catch(() => {});
  return queued;
}

function appendToNote(notePath, result, { template = DEFAULT_TEMPLATE, force = false } = {}) {
  const operation = async () => {
    const resolved = validateNotePath(notePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });

    let currentBuffer;
    let existed = true;
    let noteStat;
    try {
      [currentBuffer, noteStat] = await Promise.all([fs.readFile(resolved), fs.stat(resolved)]);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      existed = false;
      currentBuffer = Buffer.from('---\ntags:\n  - IELTS\n  - vocabulary\ncssclasses:\n  - ielts-words\n---\n\n# IELTS words\n', 'utf8');
      noteStat = { mode: 0o600 };
    }

    const before = validateExistingNote(currentBuffer, resolved);
    const current = currentBuffer.toString('utf8');

    const detailedMarker = `<!-- wordloom:${markerId(result.query)} -->`;
    if (current.toLocaleLowerCase('en-US').includes(detailedMarker)) {
      return {
        status: 'duplicate',
        path: resolved,
        word: result.query,
        checks: { originalHash: before.hash, existingContentPreserved: true, markersBalanced: true }
      };
    }

    const block = renderTemplate(result, template);
    const blockInfo = validateRenderedBlock(block, result);
    const tableUpdate = updateMasterTable(current, { word: result.query, meaning: briefMeaningFromResult(result) });
    const appendage = buildAppendage(tableUpdate.text, block);
    const nextText = `${tableUpdate.text}${appendage}`;
    const nextBuffer = Buffer.from(nextText, 'utf8');
    validateTransition(current, nextText, tableUpdate, appendage, blockInfo, result);
    validateExistingNote(nextBuffer, resolved);

    if (existed) {
      const latestBuffer = await fs.readFile(resolved);
      if (!latestBuffer.equals(currentBuffer)) {
        throw new NoteProtectionError('Obsidian 在写入前修改了笔记。本次操作已取消，请重新点击添加。', 'CONCURRENT_EDIT');
      }
    }

    const backupPath = existed
      ? await createBackup(resolved, currentBuffer, noteStat.mode, before.hash)
      : '';

    await atomicReplace(resolved, nextBuffer, noteStat.mode);
    const writtenBuffer = await fs.readFile(resolved);
    const after = validateExistingNote(writtenBuffer, resolved);
    if (!writtenBuffer.equals(nextBuffer)) {
      throw new NoteProtectionError('写后内容与预期不一致；原始备份已保留，请停止继续写入。', 'POST_WRITE_MISMATCH', { backupPath });
    }
    validateTransition(current, writtenBuffer.toString('utf8'), tableUpdate, appendage, blockInfo, result);

    const checks = {
      backupCreated: Boolean(backupPath),
      existingContentPreserved: true,
      masterTableUpdated: true,
      detailedBlockAppended: true,
      originalHash: before.hash,
      resultHash: after.hash,
      blockHash: blockInfo.hash,
      markersBalanced: after.markersBalanced,
      bytesAdded: writtenBuffer.byteLength - currentBuffer.byteLength
    };
    if (!checks.existingContentPreserved || !checks.markersBalanced) {
      if (writtenBuffer.equals(nextBuffer)) await atomicReplace(resolved, currentBuffer, noteStat.mode);
      throw new NoteProtectionError('写后保护检查失败，已自动恢复原笔记。', 'POST_WRITE_CHECK_FAILED', { backupPath });
    }

    let receiptPath = '';
    if (backupPath) {
      receiptPath = await writeReceipt(backupPath, {
        version: 1,
        writtenAt: new Date().toISOString(),
        notePath: resolved,
        word: result.query,
        backupPath,
        checks
      }).catch(() => '');
    }

    return { status: 'added', path: resolved, word: result.query, backupPath, receiptPath, checks };
  };

  const queued = writeQueue.then(operation, operation);
  writeQueue = queued.catch(() => {});
  return queued;
}

function unifyVocabularyNote(notePath, { sourceText = '' } = {}) {
  const operation = async () => {
    const resolved = validateNotePath(notePath);
    const [currentBuffer, noteStat] = await Promise.all([fs.readFile(resolved), fs.stat(resolved)]);
    const before = validateExistingNote(currentBuffer, resolved);
    const current = currentBuffer.toString('utf8');
    const migrationSource = sourceText ? String(sourceText) : current;
    const unified = buildUnifiedVocabularyDocument(migrationSource);
    if (sourceText) {
      const currentDetailsIndex = current.indexOf(PROTECTED_SECTION_HEADING);
      const currentDetails = currentDetailsIndex === -1 ? '' : current.slice(currentDetailsIndex);
      if (currentDetails !== unified.details) {
        throw new NoteProtectionError('重建来源与当前笔记的 Wordloom 详解不同，已停止写入。', 'SOURCE_DETAILS_MISMATCH');
      }
    }
    if (unified.text === current) {
      return {
        status: 'unchanged',
        path: resolved,
        wordCount: unified.entries.length,
        checks: { originalHash: before.hash, markersBalanced: true }
      };
    }
    if (!unified.entries.length) {
      throw new NoteProtectionError('没有从现有笔记提取到词条，已停止迁移。', 'NO_VOCABULARY_FOUND');
    }
    if (unified.details && !unified.text.endsWith(unified.details)) {
      throw new NoteProtectionError('迁移结果没有完整保留 Wordloom 详解，已停止写入。', 'DETAILS_SCOPE_CHECK_FAILED');
    }
    const nextBuffer = Buffer.from(unified.text, 'utf8');
    const next = validateExistingNote(nextBuffer, resolved);
    const parsed = publicQuizEntries(unified.text);
    if (parsed.length !== unified.entries.length) {
      throw new NoteProtectionError('迁移后的单词总表计数不一致，已停止写入。', 'TABLE_COUNT_MISMATCH', {
        expected: unified.entries.length,
        actual: parsed.length
      });
    }

    const latestBuffer = await fs.readFile(resolved);
    if (!latestBuffer.equals(currentBuffer)) {
      throw new NoteProtectionError('Obsidian 在迁移前修改了笔记。本次操作已取消，请重试。', 'CONCURRENT_EDIT');
    }
    const backupPath = await createBackup(resolved, currentBuffer, noteStat.mode, before.hash);
    await atomicReplace(resolved, nextBuffer, noteStat.mode);
    const writtenBuffer = await fs.readFile(resolved);
    if (!writtenBuffer.equals(nextBuffer)) {
      await atomicReplace(resolved, currentBuffer, noteStat.mode);
      throw new NoteProtectionError('迁移写后内容不一致，已自动恢复原笔记。', 'POST_WRITE_MISMATCH', { backupPath });
    }
    const after = validateExistingNote(writtenBuffer, resolved);
    const written = writtenBuffer.toString('utf8');
    if ((unified.details && !written.endsWith(unified.details)) || publicQuizEntries(written).length !== unified.entries.length) {
      await atomicReplace(resolved, currentBuffer, noteStat.mode);
      throw new NoteProtectionError('迁移写后检查失败，已自动恢复原笔记。', 'POST_WRITE_CHECK_FAILED', { backupPath });
    }

    const checks = {
      backupCreated: true,
      detailsByteExact: Boolean(unified.details),
      masterTableCreated: true,
      wordCount: unified.entries.length,
      originalHash: before.hash,
      resultHash: after.hash,
      markersBalanced: after.markersBalanced
    };
    const receiptPath = await writeReceipt(backupPath, {
      version: 1,
      operation: 'unify-vocabulary-table',
      writtenAt: new Date().toISOString(),
      notePath: resolved,
      backupPath,
      checks
    }).catch(() => '');
    return { status: 'unified', path: resolved, wordCount: unified.entries.length, backupPath, receiptPath, checks };
  };

  const queued = writeQueue.then(operation, operation);
  writeQueue = queued.catch(() => {});
  return queued;
}

async function readVocabularyEntries(notePath) {
  const resolved = validateNotePath(notePath);
  const buffer = await fs.readFile(resolved);
  validateExistingNote(buffer, resolved);
  const entries = publicQuizEntries(buffer.toString('utf8'));
  if (!entries.length) throw new Error('单词总表为空；请先执行统一词表迁移。');
  return entries;
}

async function readNoteSummary(notePath) {
  const resolved = validateNotePath(notePath);
  try {
    const buffer = await fs.readFile(resolved);
    const integrity = validateExistingNote(buffer, resolved);
    const content = buffer.toString('utf8');
    const lines = content.split(/\r?\n/);
    let backups = [];
    try {
      backups = (await fs.readdir(backupDirectoryFor(resolved)))
        .filter((name) => name.endsWith('.md'))
        .sort()
        .reverse();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return {
      exists: true,
      path: resolved,
      lineCount: lines.length,
      wordCount: publicQuizEntries(content).length || (content.match(/<!-- wordloom:/g) || []).length,
      tail: lines.slice(-80).join('\n').slice(-10_000),
      integrity: {
        ok: true,
        hash: integrity.hash,
        bytes: integrity.bytes,
        markersBalanced: integrity.markersBalanced,
        backupCount: backups.length,
        latestBackup: backups[0] ? path.join(backupDirectoryFor(resolved), backups[0]) : ''
      }
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, path: resolved, lineCount: 0, wordCount: 0, tail: '' };
    throw error;
  }
}

module.exports = {
  DEFAULT_TEMPLATE,
  LEGACY_EXPANDED_TEMPLATE,
  NoteProtectionError,
  PROTECTED_SECTION_HEADING,
  appendToNote,
  backupDirectoryFor,
  collapseWordloomBlocks,
  collapseWordloomEntries,
  containsWord,
  markerId,
  readNoteSummary,
  readVocabularyEntries,
  renderTemplate,
  sha256,
  templateValues,
  validateExistingNote,
  validateRenderedBlock,
  validateNotePath,
  unifyVocabularyNote
};

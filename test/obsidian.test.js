'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { appendManualToNote, appendToNote, backupDirectoryFor, collapseWordloomBlocks, collapseWordloomEntries, containsWord, renderTemplate, replaceMasterTableEntries, unifyVocabularyNote } = require('../src/services/obsidian');
const {
  buildUnifiedVocabularyDocument,
  isStrictEnglishAnswer,
  parseMasterTable,
  publicQuizEntries,
  quizPromptFromMeaning,
  renderMasterTable
} = require('../src/services/vocabulary');

const result = {
  query: 'mitigate',
  levels: ['C2'],
  phonetics: { uk: '/ˈmɪt.ɪ.ɡeɪt/', us: '' },
  entries: [{
    partOfSpeech: 'verb',
    senses: [{ level: 'C2', english: 'to make something less harmful', chinese: '减轻，缓和', examples: [{ english: 'Mitigate the risks.', chinese: '降低风险。' }] }]
  }],
  enrichment: { summaryZh: '强调减轻负面影响。', collocations: ['mitigate risk — 降低风险'], ieltsUsage: '适合正式写作。', memoryHook: '', distinctions: [] },
  source: { url: 'https://dictionary.cambridge.org/dictionary/english/mitigate' }
};

test('renders stable Wordloom markers and study content', () => {
  const markdown = renderTemplate(result, undefined, new Date('2026-08-12T08:00:00Z'));
  assert.match(markdown, /<!-- wordloom:mitigate -->/);
  assert.match(markdown, /减轻，缓和/);
  assert.match(markdown, /mitigate risk/);
  assert.match(markdown, /> \[!abstract\]- \*\*mitigate\*\* `C2` `verb` — 减轻，缓和/);
  assert.doesNotMatch(markdown, /^### mitigate/m);
  assert.equal(containsWord(markdown, 'Mitigate'), true);
});

test('converts expanded Wordloom blocks into collapsed Obsidian callouts', async (context) => {
  const expanded = `# IELTS Words\n\n<!-- wordloom:mitigate -->\n### mitigate \`C2\` \`verb\`\n\n> [!abstract] 发音与来源\n> **UK** /test/ · [Cambridge Dictionary ↗](https://dictionary.cambridge.org/)\n\n> 强调减轻影响。\n\n#### 核心释义\n\n1. **减轻，缓和**  \`verb\` \`C2\`\n   - to make less harmful\n\n> [!tip] IELTS 使用提示\n> 适合正式写作。\n\n<!-- /wordloom:mitigate -->\n`;
  const converted = collapseWordloomBlocks(expanded);
  assert.equal(converted.changed, 1);
  assert.match(converted.text, /> \[!abstract\]- \*\*mitigate\*\* `C2` `verb` — 减轻，缓和/);
  assert.match(converted.text, /> #### 核心释义/);
  assert.match(converted.text, /> #### IELTS 使用提示/);

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wordloom-collapse-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const notePath = path.join(directory, 'IELTS Words.md');
  await fs.writeFile(notePath, expanded);
  const response = await collapseWordloomEntries(notePath);
  const written = await fs.readFile(notePath, 'utf8');
  const backup = await fs.readFile(response.backupPath, 'utf8');
  assert.equal(response.status, 'collapsed');
  assert.equal(response.collapsed, 1);
  assert.equal(backup, expanded);
  assert.match(written, /> \[!abstract\]-/);
  assert.ok(response.receiptPath);
});

test('does not leave Markdown bracket escapes inside code badges', () => {
  const architecture = {
    ...result,
    query: 'architecture',
    entries: [{ ...result.entries[0], partOfSpeech: 'noun [U]' }]
  };
  const markdown = renderTemplate(architecture);
  assert.match(markdown, /`noun \[U\]`/);
  assert.doesNotMatch(markdown, /`noun \\\[U\\\]`/);

  const oldCollapsed = '<!-- wordloom:architecture -->\n> [!abstract]- **architecture** `noun \\[U\\]` — 建筑学\n<!-- /wordloom:architecture -->';
  const normalized = collapseWordloomBlocks(oldCollapsed);
  assert.equal(normalized.changed, 1);
  assert.match(normalized.text, /`noun \[U\]`/);
});

test('creates a note and prevents duplicate entries', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wordloom-test-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const notePath = path.join(directory, 'IELTS words.md');
  const first = await appendToNote(notePath, result);
  const second = await appendToNote(notePath, result);
  assert.equal(first.status, 'added');
  assert.equal(second.status, 'duplicate');
  const note = await fs.readFile(notePath, 'utf8');
  assert.equal((note.match(/<!-- wordloom:mitigate -->/g) || []).length, 1);
  assert.match(note, /## 单词总表/);
  assert.match(note, /\| 1 \| mitigate \| 减轻，缓和 \|/);
});

test('recognizes words already present in tables and review lists', () => {
  const original = `| Word | Meaning |\n| --- | --- |\n| publicity | 宣传 |\n- [ ] statistical — 统计的\n| mould / mold (n./v.) | 模具 |`;
  assert.equal(containsWord(original, 'publicity'), true);
  assert.equal(containsWord(original, 'statistical'), true);
  assert.equal(containsWord(original, 'mold'), true);
  assert.equal(containsWord(original, 'mitigate'), false);
});

test('backs up an existing note and preserves existing content while double-writing the word', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wordloom-protection-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const notePath = path.join(directory, 'IELTS Words.md');
  const original = Buffer.from('---\ntags: [IELTS]\n---\n\n# IELTS Words\n\n| Word | Meaning |\n| --- | --- |\n| publicity | 宣传 |\n');
  await fs.writeFile(notePath, original);

  const response = await appendToNote(notePath, result);
  const written = await fs.readFile(notePath);
  const backup = await fs.readFile(response.backupPath);

  assert.equal(response.status, 'added');
  assert.equal(response.checks.backupCreated, true);
  assert.equal(response.checks.existingContentPreserved, true);
  assert.equal(response.checks.masterTableUpdated, true);
  assert.equal(response.checks.detailedBlockAppended, true);
  assert.equal(response.checks.markersBalanced, true);
  assert.equal(written.subarray(0, original.length).equals(original), true);
  assert.equal(backup.equals(original), true);
  assert.match(written.toString('utf8'), /## Wordloom 新增词汇/);
  assert.equal(path.dirname(response.backupPath), backupDirectoryFor(notePath));
  assert.ok(response.receiptPath);
});

test('builds one deduplicated master table and preserves detailed blocks byte-for-byte', () => {
  const details = `## Wordloom 新增词汇\n\n<!-- wordloom:mitigate -->\n> [!abstract]- **mitigate** \`C2\` \`verb\` — 减轻；缓和\n> full explanation\n<!-- /wordloom:mitigate -->\n`;
  const original = `---\ntags: [IELTS]\n---\n\n# IELTS Words\n\n### 分类一\n\n| Word | Meaning |\n| --- | --- |\n| mould / mold (n./v.) | 模具；塑造 |\n| publicity | 宣传 |\n\n### 复习\n\n- [ ] publicity — 宣传；曝光\n- [ ] statistical — 统计的\n\n${details}`;
  const unified = buildUnifiedVocabularyDocument(original);
  assert.equal(unified.text.endsWith(details), true);
  assert.deepEqual(parseMasterTable(unified.text).map((entry) => entry.word), ['mould / mold', 'publicity', 'statistical', 'mitigate']);
  assert.doesNotMatch(unified.text.slice(0, unified.text.indexOf(details)), /### 分类一|### 复习/);
});

test('merges different meanings of the same headword without duplicating contained text', () => {
  const original = `# IELTS Words\n\n| Word | Meaning |\n| --- | --- |\n| spell (n.) | 一段时间；一阵 |\n| spell (v.) | 拼写 |\n| publicity | 宣传 |\n- [ ] publicity — 宣传；曝光\n`;
  const entries = buildUnifiedVocabularyDocument(original).entries;
  assert.deepEqual(entries, [
    { word: 'spell', meaning: '一段时间；一阵；拼写' },
    { word: 'publicity', meaning: '宣传；曝光' }
  ]);
});

test('migrates a real note transactionally with a complete backup', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wordloom-unify-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const notePath = path.join(directory, 'IELTS Words.md');
  const details = `## Wordloom 新增词汇\n\n<!-- wordloom:mitigate -->\n> [!abstract]- **mitigate** \`verb\` — 减轻\n> detail\n<!-- /wordloom:mitigate -->\n`;
  const original = `# IELTS Words\n\n### 分类\n\n| Word | Meaning |\n| --- | --- |\n| publicity | 宣传 |\n\n${details}`;
  await fs.writeFile(notePath, original);
  const response = await unifyVocabularyNote(notePath);
  const written = await fs.readFile(notePath, 'utf8');
  assert.equal(response.status, 'unified');
  assert.equal(response.wordCount, 2);
  assert.equal(written.endsWith(details), true);
  assert.equal(await fs.readFile(response.backupPath, 'utf8'), original);
  assert.ok(response.receiptPath);
});

test('strict Chinese-to-English matching accepts listed spellings only', () => {
  assert.equal(isStrictEnglishAnswer('mould', 'mould / mold (n./v.)'), true);
  assert.equal(isStrictEnglishAnswer('MOLD.', 'mould / mold (n./v.)'), true);
  assert.equal(isStrictEnglishAnswer('time honoured', 'time-honoured / time-honored'), true);
  assert.equal(isStrictEnglishAnswer('feel obliged to do something', 'feel obliged to do sth.'), true);
  assert.equal(isStrictEnglishAnswer('refer to someone as something', 'refer to sb. as sth.'), true);
  assert.equal(isStrictEnglishAnswer('vent my feelings', 'vent one’s feelings'), true);
  assert.equal(isStrictEnglishAnswer('molds', 'mould / mold (n./v.)'), false);
  assert.equal(isStrictEnglishAnswer('mitigate the risk', 'mitigate'), false);
});

test('builds quiz prompts without leaking English study notes', () => {
  assert.equal(quizPromptFromMeaning('国际的（domestic 的反义词）'), '国际的');
  assert.equal(quizPromptFromMeaning('包含；吸收；incorporate A into B 将 A 纳入 B'), '包含；吸收');
  assert.equal(quizPromptFromMeaning('把 A 纳入 B'), '把 A 纳入 B');
  const note = renderMasterTable([
    { word: 'international', meaning: '国际的（domestic 的反义词）' },
    { word: 'placeholder', meaning: 'English only' }
  ]);
  const entries = publicQuizEntries(note);
  assert.equal(entries[0].prompt, '国际的');
  assert.equal(entries[0].zhEnReady, true);
  assert.equal(entries[1].zhEnReady, false);
});

test('reorganizes only the protected table and preserves all surrounding bytes', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wordloom-reorganize-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const notePath = path.join(directory, 'IELTS Words.md');
  const details = `\n\n## Wordloom 新增词汇\n\n<!-- wordloom:mitigate -->\n> [!abstract]- **mitigate** — 减轻\n> byte-exact detail\n<!-- /wordloom:mitigate -->\n`;
  const original = `# IELTS Words\n\n${renderMasterTable([{ word: 'aggregate', meaning: '总数；总数' }])}${details}`;
  await fs.writeFile(notePath, original);

  const response = await replaceMasterTableEntries(notePath, [
    { word: 'aggregate', meaning: '总数' },
    { word: 'mitigate', meaning: '减轻' }
  ]);
  const written = await fs.readFile(notePath, 'utf8');
  assert.equal(response.status, 'reorganized');
  assert.equal(response.wordCount, 2);
  assert.equal(written.endsWith(details), true);
  assert.equal(await fs.readFile(response.backupPath, 'utf8'), original);
  assert.equal(response.checks.outsideTableByteExact, true);
});

test('adds manual vocabulary only to the protected master table and preserves details', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wordloom-manual-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const notePath = path.join(directory, 'IELTS Words.md');
  const details = `## Wordloom 新增词汇\n\n<!-- wordloom:mitigate -->\n> [!abstract]- **mitigate** \`verb\` — 减轻\n> complete details\n<!-- /wordloom:mitigate -->\n`;
  const original = buildUnifiedVocabularyDocument(`# IELTS Words\n\n| Word | Meaning |\n| --- | --- |\n| publicity | 宣传 |\n\n${details}`).text;
  await fs.writeFile(notePath, original);

  const first = await appendManualToNote(notePath, { word: 'sustainable', meaning: '可持续的' });
  const updated = await appendManualToNote(notePath, { word: 'sustainable', meaning: '不会耗尽资源的' });
  const duplicate = await appendManualToNote(notePath, { word: 'sustainable', meaning: '不会耗尽资源的' });
  const written = await fs.readFile(notePath, 'utf8');
  const entries = parseMasterTable(written);

  assert.equal(first.status, 'added');
  assert.equal(updated.status, 'updated');
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(written.endsWith(details), true);
  assert.equal((written.match(/<!-- wordloom:/g) || []).length, 1);
  assert.deepEqual(entries.find((entry) => entry.word === 'sustainable'), {
    word: 'sustainable',
    meaning: '可持续的；不会耗尽资源的'
  });
  assert.equal(await fs.readFile(first.backupPath, 'utf8'), original);
  assert.equal(first.checks.detailedBlocksUntouched, true);
});

test('rejects unsafe templates before touching an existing note', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wordloom-template-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const notePath = path.join(directory, 'IELTS Words.md');
  const original = '# IELTS Words\n';
  await fs.writeFile(notePath, original);

  await assert.rejects(
    appendToNote(notePath, result, { template: '### {{word}}\n{{meanings}}' }),
    (error) => error.code === 'INVALID_TEMPLATE_MARKERS'
  );
  assert.equal(await fs.readFile(notePath, 'utf8'), original);
  await assert.rejects(fs.access(backupDirectoryFor(notePath)));
});

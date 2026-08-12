'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { appendToNote, backupDirectoryFor, collapseWordloomBlocks, collapseWordloomEntries, containsWord, renderTemplate } = require('../src/services/obsidian');

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
});

test('recognizes words already present in tables and review lists', () => {
  const original = `| Word | Meaning |\n| --- | --- |\n| publicity | 宣传 |\n- [ ] statistical — 统计的\n| mould / mold (n./v.) | 模具 |`;
  assert.equal(containsWord(original, 'publicity'), true);
  assert.equal(containsWord(original, 'statistical'), true);
  assert.equal(containsWord(original, 'mold'), true);
  assert.equal(containsWord(original, 'mitigate'), false);
});

test('backs up an existing note and proves its original bytes are unchanged', async (context) => {
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
  assert.equal(response.checks.originalUntouched, true);
  assert.equal(response.checks.markersBalanced, true);
  assert.equal(written.subarray(0, original.length).equals(original), true);
  assert.equal(backup.equals(original), true);
  assert.match(written.toString('utf8'), /## Wordloom 新增词汇/);
  assert.equal(path.dirname(response.backupPath), backupDirectoryFor(notePath));
  assert.ok(response.receiptPath);
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

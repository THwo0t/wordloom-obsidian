#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { replaceMasterTableEntries } = require('../src/services/obsidian');
const { parseMasterTable } = require('../src/services/vocabulary');

const notePath = process.argv[2] ? path.resolve(process.argv[2]) : '';
const shouldApply = process.argv.includes('--apply');

const meaningCorrections = new Map([
  ['statistical', '统计的；统计学的'],
  ['international', '国际的'],
  ['vent one’s feelings', '发泄情绪'],
  ['incorporate', '包含；吸收；把……纳入'],
  ['aggregate', '总数；总计；合计'],
  ['steaming', '热气腾腾的；酷热的'],
  ['retail', '零售；零卖'],
  ['bleak', '（地方）荒凉的；凄凉的'],
  ['redundant', '（尤指词、短语等）多余的；不需要的；累赘的；啰唆的'],
  ['fissure', '（岩石或土地的）裂缝；裂隙'],
  ['germinate', '（使）种子发芽；萌芽'],
  ['cereal', '谷物；麦片'],
  ['deviation', '偏离；偏差']
]);

function tidyEntries(entries) {
  const output = [];
  const changes = [];
  for (const entry of entries) {
    if (entry.word === 'discriminate against sb. / discriminate between A and B') {
      output.push(
        { word: 'discriminate against sb.', meaning: '歧视某人' },
        { word: 'discriminate between A and B', meaning: '区分 A 和 B' }
      );
      changes.push({ word: entry.word, action: 'split', into: output.slice(-2) });
      continue;
    }
    const meaning = meaningCorrections.get(entry.word) || entry.meaning;
    output.push({ word: entry.word, meaning });
    if (meaning !== entry.meaning) changes.push({ word: entry.word, from: entry.meaning, to: meaning });
  }
  return { entries: output, changes };
}

async function main() {
  if (!notePath) throw new Error('用法：node scripts/tidy-note-for-dictation.js <IELTS Words.md> [--apply]');
  const source = await fs.readFile(notePath, 'utf8');
  const before = parseMasterTable(source);
  const result = tidyEntries(before);
  const summary = { mode: shouldApply ? 'apply' : 'dry-run', path: notePath, before: before.length, after: result.entries.length, changes: result.changes };
  if (shouldApply) summary.write = await replaceMasterTableEntries(notePath, result.entries, { operation: 'tidy-dictation-vocabulary' });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

#!/usr/bin/env node
'use strict';

const { unifyVocabularyNote } = require('../src/services/obsidian');
const fs = require('node:fs/promises');

const notePath = String(process.argv[2] || '').trim();
const sourceIndex = process.argv.indexOf('--source');
const sourcePath = sourceIndex === -1 ? '' : String(process.argv[sourceIndex + 1] || '').trim();

if (!notePath) {
  process.stderr.write('用法：npm run unify:note -- /path/to/IELTS-Words.md\n');
  process.exit(2);
}

Promise.resolve(sourcePath ? fs.readFile(sourcePath, 'utf8') : '')
  .then((sourceText) => unifyVocabularyNote(notePath, { sourceText }))
  .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });

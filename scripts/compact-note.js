#!/usr/bin/env node
'use strict';

const { collapseWordloomEntries } = require('../src/services/obsidian');

const notePath = String(process.argv[2] || '').trim();

if (!notePath) {
  process.stderr.write('用法：npm run compact:note -- /path/to/IELTS-Words.md\n');
  process.exit(2);
}

collapseWordloomEntries(notePath)
  .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });

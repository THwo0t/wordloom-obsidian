#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

const appRoot = path.resolve(__dirname, '..');
let electronPath;

try {
  electronPath = require('electron');
} catch {
  process.stderr.write('Wordloom 尚未安装依赖，请先在项目目录运行 npm install。\n');
  process.exit(1);
}

const word = process.argv.slice(2).join(' ').trim();
const args = [appRoot, '--quick'];
if (word) args.push('--word', word);

const child = spawn(electronPath, args, {
  cwd: appRoot,
  detached: true,
  stdio: 'ignore'
});

child.once('error', (error) => {
  process.stderr.write(`无法启动 Wordloom：${error.message}\n`);
  process.exitCode = 1;
});
child.unref();

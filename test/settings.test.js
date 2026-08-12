'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT_SETTINGS, SettingsStore } = require('../src/services/settings');
const { DEFAULT_TEMPLATE, LEGACY_EXPANDED_TEMPLATE } = require('../src/services/obsidian');

const noEncryption = { isEncryptionAvailable: () => false };

test('uses short shortcuts and asks new users to choose an IELTS note', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wordloom-settings-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new SettingsStore(directory, noEncryption);
  const settings = await store.load();
  assert.equal(settings.quickShortcut, 'Alt+V');
  assert.equal(settings.addShortcut, 'Alt+Enter');
  assert.equal(settings.notePath, '');
});

test('migrates the expanded default template to collapsed callouts', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wordloom-template-migration-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'settings.json'), JSON.stringify({ template: LEGACY_EXPANDED_TEMPLATE }));
  const store = new SettingsStore(directory, noEncryption);
  const settings = await store.load();
  assert.equal(settings.template, DEFAULT_TEMPLATE);
  assert.match(settings.template, /> \[!abstract\]-/);
});

test('migrates the old long shortcuts without changing unrelated settings', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wordloom-migration-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'settings.json'), JSON.stringify({
    endpoint: 'https://example.test',
    notePath: '',
    quickShortcut: 'CommandOrControl+Alt+Space',
    addShortcut: 'CommandOrControl+Shift+Enter'
  }));
  const store = new SettingsStore(directory, noEncryption);
  const settings = await store.load();
  assert.equal(settings.quickShortcut, DEFAULT_SETTINGS.quickShortcut);
  assert.equal(settings.addShortcut, DEFAULT_SETTINGS.addShortcut);
  assert.equal(settings.notePath, '');
  assert.equal(settings.endpoint, 'https://example.test');
});

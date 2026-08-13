'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf8');
const quickHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'quick.html'), 'utf8');
const quickApp = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'quick.js'), 'utf8');

test('manual entry fields have the requested native Tab order', () => {
  const word = html.indexOf('id="manual-word"');
  const meaning = html.indexOf('id="manual-meaning"');
  const submit = html.indexOf('id="manual-review-button"');
  assert.ok(word > 0);
  assert.ok(word < meaning);
  assert.ok(meaning < submit);
  assert.doesNotMatch(html.slice(word, meaning), /tabindex=/u);
});

test('dictionary lookup and manual entry are simultaneously visible in order', () => {
  const dictionary = html.indexOf('id="dictionary-panel"');
  const manual = html.indexOf('id="manual-panel"');
  assert.ok(dictionary > 0 && dictionary < manual);
  assert.doesNotMatch(html.match(/<div class="search-panel manual-panel"[^>]*>/u)?.[0] || '', /hidden/u);
  assert.doesNotMatch(html, /data-entry-mode=/u);
});

test('manual entry exposes correction confirmation and shortcut handling', () => {
  assert.match(html, /id="manual-shortcut"/u);
  assert.match(app, /onManualShortcut/u);
  assert.match(app, /manual-use-suggestion/u);
  assert.match(app, /manual-keep-original/u);
});

test('quick window keeps lookup and manual entry visible together', () => {
  const dictionary = quickHtml.indexOf('id="quick-form"');
  const word = quickHtml.indexOf('id="quick-manual-word"');
  const meaning = quickHtml.indexOf('id="quick-manual-meaning"');
  const submit = quickHtml.indexOf('id="quick-manual-submit"');
  assert.ok(dictionary > 0 && dictionary < word);
  assert.ok(word < meaning && meaning < submit);
  assert.doesNotMatch(quickHtml.match(/<form id="quick-manual-form"[^>]*>/u)?.[0] || '', /hidden/u);
  assert.doesNotMatch(quickHtml.slice(word, meaning), /tabindex=/u);
});

test('quick window can review, confirm, and safely add a manual entry', () => {
  assert.match(quickApp, /reviewManualEntry/u);
  assert.match(quickApp, /window\.wordloom\.reviewManual/u);
  assert.match(quickApp, /window\.wordloom\.addManual/u);
  assert.match(quickApp, /quick-manual-keep/u);
  assert.match(quickApp, /quick-manual-use/u);
  assert.match(quickApp, /onManualShortcut/u);
});

test('renderer document does not contain duplicate element ids', () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/gu)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test('quick renderer document does not contain duplicate element ids', () => {
  const ids = [...quickHtml.matchAll(/\sid="([^"]+)"/gu)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});

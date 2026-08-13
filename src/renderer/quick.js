'use strict';

const $ = (selector) => document.querySelector(selector);
const state = { resultId: '', settings: null, busy: false, requestId: '' };

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function toast(message, type = '') {
  const node = document.createElement('div');
  node.className = `toast ${type}`.trim();
  node.textContent = message;
  $('#toasts').append(node);
  setTimeout(() => node.remove(), 3000);
}

function setBusy(busy) {
  state.busy = busy;
  $('#quick-input').disabled = busy;
  const button = $('#quick-form button');
  button.disabled = busy;
  button.innerHTML = busy ? '<span class="spinner"></span>' : '查询';
}

async function lookup() {
  const word = $('#quick-input').value.trim();
  if (!word) return;
  if (state.busy && state.requestId) window.wordloom.cancelLookup(state.requestId);
  const requestId = crypto.randomUUID();
  state.requestId = requestId;
  state.resultId = '';
  setBusy(true);
  $('#quick-result').classList.add('hidden');
  $('#quick-state').classList.remove('hidden');
  $('#quick-state').innerHTML = `<div><span class="spinner" style="border-color:rgba(23,91,67,.18);border-top-color:#175b43;width:30px;height:30px"></span><h1 style="margin-top:15px">正在查询 ${escapeHtml(word)}</h1><p>DeepSeek 正在搜索 Cambridge 并整理词卡</p></div>`;
  const response = await window.wordloom.lookup(word, requestId);
  if (state.requestId !== requestId) return;
  state.requestId = '';
  setBusy(false);
  if (!response.ok) {
    $('#quick-state').innerHTML = `<div><div class="quick-orb">?</div><h1>没有找到</h1><p class="quick-error">${escapeHtml(response.error.message)}</p></div>`;
    $('#quick-input').disabled = false;
    $('#quick-input').select();
    return;
  }
  state.resultId = response.resultId;
  renderResult(response.result, response.aiWarning);
}

function renderResult(result, warning) {
  const firstEntry = result.entries[0];
  const firstSense = firstEntry?.senses?.[0];
  const phonetic = result.phonetics?.uk || result.phonetics?.us || '';
  const levels = result.levels.map((level) => `<span class="chip level">${escapeHtml(level)}</span>`).join('');
  const summary = result.enrichment?.summaryZh || warning || '';
  $('#quick-result').innerHTML = `
    <div class="quick-result-head"><div><h2 class="quick-word">${escapeHtml(result.query)}</h2><div class="quick-phonetic">${phonetic ? `/${escapeHtml(phonetic.replace(/^\/+|\/+$/g, ''))}/` : '暂无音标'} · ${escapeHtml(firstEntry?.partOfSpeech || '')}</div><div class="quick-levels">${levels}</div></div></div>
    <div class="quick-meaning"><strong>${escapeHtml(firstSense?.chinese || '暂无中文释义')}</strong><p>${escapeHtml(firstSense?.english || '')}</p></div>
    ${summary ? `<div class="quick-summary">${escapeHtml(summary)}</div>` : ''}
    <div class="quick-actions"><button class="primary" id="quick-add">加入 IELTS words</button><button class="ghost" id="quick-source">Cambridge ↗</button></div>`;
  $('#quick-state').classList.add('hidden');
  $('#quick-result').classList.remove('hidden');
  $('#quick-add').addEventListener('click', addToNote);
  $('#quick-source').addEventListener('click', () => window.wordloom.openExternal(result.source.url));
}

async function addToNote() {
  if (!state.resultId) return toast('请先查询。', 'error');
  if (!state.settings.notePath) {
    toast('请先在主应用设置 Obsidian 笔记。', 'error');
    return;
  }
  const button = $('#quick-add');
  button.disabled = true;
  button.textContent = '写入中…';
  const response = await window.wordloom.addToNote(state.resultId);
  button.disabled = false;
  if (!response.ok) {
    button.textContent = '加入 IELTS words';
    return toast(response.error.message, 'error');
  }
  button.textContent = response.status === 'duplicate' ? '已存在' : '已加入 ✓';
  toast(response.status === 'duplicate'
    ? '笔记中已有这个词。'
    : response.checks?.existingContentPreserved ? '已加入；备份与写后校验通过。' : '已加入笔记。', 'success');
}

async function init() {
  window.wordloom.onQuickLookup((word) => {
    $('#quick-input').value = String(word || '');
    lookup();
  });
  const bootstrap = await window.wordloom.bootstrap();
  state.settings = bootstrap.settings;
  $('[data-window="close"]').addEventListener('click', () => window.wordloom.windowAction('close'));
  $('#open-main').addEventListener('click', () => window.wordloom.openMain());
  $('#quick-form').addEventListener('submit', (event) => { event.preventDefault(); lookup(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') window.wordloom.windowAction('close');
    if (event.altKey && event.key === 'Enter') { event.preventDefault(); addToNote(); }
  });
  window.wordloom.onAddShortcut(() => addToNote());
  window.wordloom.onFocusSearch(() => $('#quick-input').focus());
  $('#quick-input').focus();
  if (bootstrap.quickWord) {
    $('#quick-input').value = bootstrap.quickWord;
    lookup();
  }
}

init();

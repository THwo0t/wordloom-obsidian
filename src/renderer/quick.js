'use strict';

const $ = (selector) => document.querySelector(selector);
const state = {
  resultId: '',
  settings: null,
  busy: false,
  requestId: '',
  manualBusy: false,
  manualReviewId: '',
  manualReview: null
};

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

function setManualBusy(busy) {
  state.manualBusy = busy;
  $('#quick-manual-word').disabled = busy;
  $('#quick-manual-meaning').disabled = busy;
  const button = $('#quick-manual-submit');
  button.disabled = busy;
  button.innerHTML = busy ? '<span class="spinner"></span>检查中' : 'AI 检查';
}

function showDictionaryOutput() {
  $('#quick-manual-result').classList.add('hidden');
  if (state.resultId) {
    $('#quick-state').classList.add('hidden');
    $('#quick-result').classList.remove('hidden');
  } else {
    $('#quick-result').classList.add('hidden');
    $('#quick-state').classList.remove('hidden');
  }
}

function showManualOutput() {
  $('#quick-state').classList.add('hidden');
  $('#quick-result').classList.add('hidden');
  $('#quick-manual-result').classList.remove('hidden');
}

async function lookup() {
  const word = $('#quick-input').value.trim();
  if (!word) return;
  if (state.busy && state.requestId) window.wordloom.cancelLookup(state.requestId);
  const requestId = crypto.randomUUID();
  state.requestId = requestId;
  state.resultId = '';
  setBusy(true);
  $('#quick-manual-result').classList.add('hidden');
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
  $('#quick-manual-result').classList.add('hidden');
  $('#quick-result').classList.remove('hidden');
  $('#quick-add').addEventListener('click', addToNote);
  $('#quick-source').addEventListener('click', () => window.wordloom.openExternal(result.source.url));
}

function renderManualReview(review) {
  state.manualReview = review;
  const changed = review.status === 'needs_correction';
  const card = $('#quick-manual-result');
  card.innerHTML = changed ? `
    <div class="quick-review-status"><h2>DeepSeek 建议纠正</h2><span>写入前确认</span></div>
    <div class="quick-review-versions">
      <div class="quick-review-version"><small>你的输入</small><strong>${escapeHtml(review.original.word)}</strong><p>${escapeHtml(review.original.meaning)}</p></div>
      <div class="quick-review-version recommended"><small>建议版本</small><strong>${escapeHtml(review.suggested.word)}</strong><p>${escapeHtml(review.suggested.meaning)}</p></div>
    </div>
    <p class="quick-review-reason">${escapeHtml(review.reason)}</p>
    <div class="quick-review-actions"><button class="ghost" id="quick-manual-keep">保留原文加入</button><button class="primary" id="quick-manual-use">采用纠正并加入</button></div>` : `
    <div class="quick-review-status"><h2>检查通过</h2><span>含义匹配</span></div>
    <div class="quick-review-versions">
      <div class="quick-review-version recommended"><small>将写入单词总表</small><strong>${escapeHtml(review.original.word)}</strong><p>${escapeHtml(review.original.meaning)}</p></div>
    </div>
    <p class="quick-review-reason">${escapeHtml(review.reason)}</p>
    <div class="quick-review-actions"><button class="ghost" id="quick-manual-edit">返回修改</button><button class="primary" id="quick-manual-add">确认加入</button></div>`;
  showManualOutput();
  $('#quick-manual-keep')?.addEventListener('click', () => addManualEntry('original'));
  $('#quick-manual-use')?.addEventListener('click', () => addManualEntry('suggested'));
  $('#quick-manual-add')?.addEventListener('click', () => addManualEntry('original'));
  $('#quick-manual-edit')?.addEventListener('click', () => resetManualResult());
}

function resetManualResult({ clear = false } = {}) {
  state.manualReviewId = '';
  state.manualReview = null;
  $('#quick-manual-result').classList.add('hidden');
  $('#quick-manual-result').innerHTML = '';
  if (clear) {
    $('#quick-manual-word').value = '';
    $('#quick-manual-meaning').value = '';
  }
  showDictionaryOutput();
  setTimeout(() => $('#quick-manual-word').focus(), 0);
}

async function reviewManualEntry() {
  if (state.manualBusy) return;
  const word = $('#quick-manual-word').value.trim();
  const meaning = $('#quick-manual-meaning').value.trim();
  if (!word) return toast('先输入英文原词。', 'error');
  if (!meaning) return toast('再填写中文释义。', 'error');
  if (!state.settings.notePath) return toast('请先在主应用设置 IELTS Words 笔记。', 'error');
  setManualBusy(true);
  const response = await window.wordloom.reviewManual(word, meaning);
  setManualBusy(false);
  if (!response.ok) return toast(response.error.message, 'error');
  state.manualReviewId = response.reviewId;
  state.manualReview = response.review;
  if (response.review.status === 'correct') return addManualEntry('original');
  renderManualReview(response.review);
  toast('DeepSeek 发现需要确认的纠正。');
}

async function addManualEntry(choice) {
  if (!state.manualReviewId) return toast('请先让 DeepSeek 检查。', 'error');
  const pendingReview = state.manualReview;
  $('#quick-manual-result').innerHTML = '<div class="quick-manual-success"><span class="spinner" style="border-color:rgba(23,91,67,.18);border-top-color:#175b43"></span><h2>正在安全写入总表</h2><p>会先备份，并检查已有详解没有变化。</p></div>';
  showManualOutput();
  const response = await window.wordloom.addManual(state.manualReviewId, choice);
  if (!response.ok) {
    renderManualReview(pendingReview);
    return toast(response.error.message, 'error');
  }
  state.manualReviewId = '';
  state.manualReview = { saved: true };
  const duplicate = response.status === 'duplicate';
  $('#quick-manual-result').innerHTML = `
    <div class="quick-manual-success">
      <h2>${escapeHtml(response.word)} ${duplicate ? '已在总表中' : '已加入'}</h2>
      <p>${escapeHtml(response.meaning)}</p>
      <button class="primary" id="quick-manual-another">继续收词</button>
    </div>`;
  $('#quick-manual-another').addEventListener('click', () => resetManualResult({ clear: true }));
  toast(duplicate
    ? '总表中已有相同词义，没有重复写入。'
    : response.status === 'updated'
      ? '已把新释义合并到原词条。'
      : '已加入单词总表；完整详解没有变化。', 'success');
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
  $('#quick-manual-form').addEventListener('submit', (event) => { event.preventDefault(); reviewManualEntry(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') window.wordloom.windowAction('close');
    if (event.altKey && event.key === 'Enter') { event.preventDefault(); addToNote(); }
    if (event.altKey && event.key.toLocaleLowerCase('en-US') === 'm') {
      event.preventDefault();
      $('#quick-manual-word').focus();
    }
  });
  window.wordloom.onAddShortcut(() => addToNote());
  window.wordloom.onManualShortcut(() => $('#quick-manual-word').focus());
  window.wordloom.onFocusSearch(() => $('#quick-input').focus());
  $('#quick-input').focus();
  if (bootstrap.quickWord) {
    $('#quick-input').value = bootstrap.quickWord;
    lookup();
  }
}

init();

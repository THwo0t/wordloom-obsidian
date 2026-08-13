'use strict';

const state = {
  settings: null,
  currentResult: null,
  currentResultId: '',
  activeRequestId: '',
  busy: false,
  launchCommand: '',
  manualReviewId: '',
  manualReview: null,
  quiz: {
    library: [],
    questions: [],
    position: 0,
    direction: 'zh-en',
    submitted: false,
    attempts: new Map(),
    sessionId: '',
    loaded: false,
    loading: false
  }
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function toast(message, type = '') {
  const node = document.createElement('div');
  node.className = `toast ${type}`.trim();
  node.textContent = message;
  $('#toasts').append(node);
  setTimeout(() => node.remove(), 3600);
}

function showView(name) {
  $$('.rail-button[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === `view-${name}`));
  if (name === 'lookup') setTimeout(() => $('#word-input').focus(), 0);
  if (name === 'dictation' && !state.quiz.loaded && !state.quiz.loading) loadQuizLibrary();
}

function showDictionaryOutput() {
  $('#manual-result').classList.add('hidden');
  if (state.currentResult) {
    $('#lookup-state').classList.add('hidden');
    $('#result-card').classList.remove('hidden');
  } else {
    $('#result-card').classList.add('hidden');
    $('#lookup-state').classList.remove('hidden');
  }
}

function showManualOutput() {
  $('#lookup-state').classList.add('hidden');
  $('#result-card').classList.add('hidden');
  $('#manual-result').classList.remove('hidden');
}

function setBusy(busy) {
  state.busy = busy;
  const button = $('#lookup-button');
  button.disabled = busy;
  button.innerHTML = busy ? '<span class="spinner"></span>查询中' : '查询';
  $('#word-input').disabled = busy;
}

function renderLoading(word) {
  $('#manual-result').classList.add('hidden');
  $('#result-card').classList.add('hidden');
  const panel = $('#lookup-state');
  panel.classList.remove('hidden');
  panel.innerHTML = `<div><span class="spinner" style="border-color:rgba(23,91,67,.18);border-top-color:#175b43;width:34px;height:34px"></span><h3 style="margin-top:18px">正在查找 ${escapeHtml(word)}</h3><p>DeepSeek 正在搜索 Cambridge，并整理成你的学习卡片…</p></div>`;
}

function renderError(message) {
  $('#manual-result').classList.add('hidden');
  $('#result-card').classList.add('hidden');
  const panel = $('#lookup-state');
  panel.classList.remove('hidden');
  panel.innerHTML = `<div><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="24" cy="24" r="17"/><path d="M17 29c4-3 10-3 14 0M19 19h.01M29 19h.01"/></svg><h3>这次没有织进去</h3><p>${escapeHtml(message)}</p><button class="ghost" id="retry-button">重试</button></div>`;
  $('#retry-button').addEventListener('click', () => lookup($('#word-input').value));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function renderResult(result, aiWarning = '') {
  $('#manual-result').classList.add('hidden');
  const parts = unique(result.entries.map((entry) => entry.partOfSpeech));
  const levelChips = result.levels.map((level) => `<span class="chip level">${escapeHtml(level)}</span>`).join('');
  const partChips = parts.map((part) => `<span class="chip">${escapeHtml(part)}</span>`).join('');
  const phonetics = [
    result.phonetics?.uk && `<span><strong>UK</strong> /${escapeHtml(result.phonetics.uk.replace(/^\/+|\/+$/g, ''))}/</span>`,
    result.phonetics?.us && `<span><strong>US</strong> /${escapeHtml(result.phonetics.us.replace(/^\/+|\/+$/g, ''))}/</span>`
  ].filter(Boolean).join(' &nbsp;·&nbsp; ') || '暂无音标';

  let senseIndex = 0;
  const meanings = result.entries.map((entry) => {
    const senses = entry.senses.map((sense) => {
      senseIndex += 1;
      const examples = sense.examples.map((example) => `<div class="example">${escapeHtml(example.english)}${example.chinese ? `<br><span>${escapeHtml(example.chinese)}</span>` : ''}</div>`).join('');
      return `<div class="sense"><div class="sense-number">${senseIndex}</div><div><div class="sense-zh">${escapeHtml(sense.chinese || '暂无中文释义')}${sense.level ? `<span class="inline-level">${escapeHtml(sense.level)}</span>` : ''}</div><div class="sense-en">${escapeHtml(sense.english)}</div>${examples}</div></div>`;
    }).join('');
    return `<section class="pos-block"><div class="pos-title">${escapeHtml(entry.partOfSpeech || 'word')}</div>${senses}</section>`;
  }).join('');

  const enrichment = result.enrichment || {};
  const collocations = (enrichment.collocations || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const distinctions = (enrichment.distinctions || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const hasInsights = enrichment.summaryZh || collocations || enrichment.ieltsUsage || enrichment.memoryHook || distinctions;
  const insights = hasInsights ? `
    ${enrichment.summaryZh ? `<section class="insight"><h3>一句话掌握</h3><p>${escapeHtml(enrichment.summaryZh)}</p></section>` : ''}
    ${collocations ? `<section class="insight"><h3>常用搭配</h3><ul>${collocations}</ul></section>` : ''}
    ${enrichment.ieltsUsage ? `<section class="insight"><h3>IELTS 使用提示</h3><p>${escapeHtml(enrichment.ieltsUsage)}</p></section>` : ''}
    ${(enrichment.memoryHook || distinctions) ? `<section class="insight"><h3>记忆与辨析</h3>${enrichment.memoryHook ? `<p>${escapeHtml(enrichment.memoryHook)}</p>` : ''}${distinctions ? `<ul>${distinctions}</ul>` : ''}</section>` : ''}
  ` : '<section class="insight"><h3>AI 补充未启用</h3><p>Cambridge 的核心词义仍然可以直接写入笔记。你可以在设置中配置 DeepSeek。</p></section>';

  const card = $('#result-card');
  card.innerHTML = `
    <header class="result-head">
      <div>
        <h2 class="result-word">${escapeHtml(result.query)}</h2>
        <div class="chips">${levelChips}${partChips}</div>
        <div class="phonetics">${phonetics}</div>
      </div>
      <div class="result-actions">
        <button class="ghost" id="copy-markdown" title="复制 Markdown">复制</button>
        <button class="primary" id="add-note">加入笔记</button>
      </div>
    </header>
    <div class="result-body">
      <div class="meaning-column"><div class="section-label">Cambridge core meanings</div>${meanings}</div>
      <aside class="insight-column"><div class="section-label">AI learning notes</div>${insights}<button class="source-link" id="source-link">查看 Cambridge 原始词条 ↗</button>${aiWarning ? `<div class="notice">${escapeHtml(aiWarning)}</div>` : ''}</aside>
    </div>`;
  $('#lookup-state').classList.add('hidden');
  card.classList.remove('hidden');
  $('#add-note').addEventListener('click', () => addCurrentToNote());
  $('#copy-markdown').addEventListener('click', copyMarkdown);
  $('#source-link').addEventListener('click', () => window.wordloom.openExternal(result.source.url));
}

async function lookup(rawWord) {
  const word = String(rawWord || '').trim();
  if (!word) {
    toast('先输入一个英文单词或短语。', 'error');
    $('#word-input').focus();
    return;
  }
  if (state.busy && state.activeRequestId) window.wordloom.cancelLookup(state.activeRequestId);
  const requestId = crypto.randomUUID();
  state.activeRequestId = requestId;
  state.currentResult = null;
  state.currentResultId = '';
  setBusy(true);
  renderLoading(word);
  const response = await window.wordloom.lookup(word, requestId);
  if (state.activeRequestId !== requestId) return;
  setBusy(false);
  state.activeRequestId = '';
  if (!response.ok) {
    renderError(response.error.message);
    return;
  }
  state.currentResult = response.result;
  state.currentResultId = response.resultId;
  renderResult(response.result, response.aiWarning);
}

async function addCurrentToNote(force = false) {
  if (!state.currentResultId) {
    toast('请先查询一个单词。', 'error');
    return;
  }
  if (!state.settings.notePath) {
    toast('请先在设置中选择 IELTS words.md。', 'error');
    showView('settings');
    return;
  }
  const button = $('#add-note');
  if (button) { button.disabled = true; button.textContent = '写入中…'; }
  const response = await window.wordloom.addToNote(state.currentResultId, force);
  if (button) { button.disabled = false; button.textContent = '加入笔记'; }
  if (!response.ok) {
    toast(response.error.message, 'error');
    return;
  }
  if (response.status === 'duplicate') {
    toast(`“${response.word}” 已在笔记中，没有重复写入。`);
    return;
  }
  const protectedMessage = response.checks?.existingContentPreserved && response.checks?.masterTableUpdated && response.checks?.markersBalanced
    ? `已加入 “${response.word}”；单词总表和折叠详解均已更新${response.backupPath ? '，原笔记已备份' : ''}。`
    : `已把 “${response.word}” 加入 IELTS words。`;
  toast(protectedMessage, 'success');
  if (button) button.textContent = '已加入 ✓';
}

async function copyMarkdown() {
  if (!state.currentResultId) return;
  const response = await window.wordloom.previewMarkdown(state.currentResultId, state.settings.template);
  if (!response.ok) return toast(response.error.message, 'error');
  await window.wordloom.copyText(response.markdown);
  toast('Markdown 已复制。', 'success');
}

function collectSettings() {
  return {
    endpoint: $('#endpoint').value.trim(),
    model: $('#model').value.trim(),
    notePath: $('#note-path').value.trim(),
    template: $('#template').value,
    useAi: $('#use-ai').checked,
    quickShortcut: $('#quick-shortcut').value.trim(),
    addShortcut: $('#add-shortcut').value.trim(),
    manualShortcut: $('#manual-shortcut').value.trim(),
    ...($('#api-key').value.trim() ? { apiKey: $('#api-key').value.trim() } : {}),
    ...($('#cambridge-api-key').value.trim() ? { cambridgeApiKey: $('#cambridge-api-key').value.trim() } : {})
  };
}

function hydrateSettings(settings) {
  state.settings = settings;
  $('#endpoint').value = settings.endpoint || '';
  $('#model').value = settings.model || '';
  $('#note-path').value = settings.notePath || '';
  $('#template').value = settings.template || '';
  $('#use-ai').checked = Boolean(settings.useAi);
  $('#quick-shortcut').value = settings.quickShortcut || '';
  $('#add-shortcut').value = settings.addShortcut || '';
  $('#manual-shortcut').value = settings.manualShortcut || '';
  $('#manual-shortcut-label').textContent = (settings.manualShortcut || 'Alt+M').replace(/\+/g, ' + ');
  $('#api-key').value = '';
  $('#cambridge-api-key').value = '';
  $('#key-hint').textContent = settings.hasApiKey ? '已保存一个 Key；留空表示继续使用。' : '尚未保存 Key；Key 不会回显。';
  $('#cambridge-key-hint').textContent = settings.hasCambridgeKey
    ? '已保存一个 Cambridge Access Key；查询时优先使用官方 API。'
    : '未配置时使用网页查询；Key 不会交给页面或 DeepSeek。';
  $('#ai-status').innerHTML = settings.useAi && settings.hasApiKey
    ? '<i class="status-dot ok"></i>DeepSeek 已配置'
    : settings.useAi ? '<i class="status-dot warn"></i>等待设置 API' : '<i class="status-dot"></i>AI 已关闭';
  $('#note-status').textContent = settings.notePath ? `写入 ${settings.notePath.split(/[\\/]/).pop()}` : '尚未选择笔记';
  const secure = settings.keyStorageSecure;
  $('#security-note').textContent = secure
    ? `API Key 使用系统凭据加密存储（${settings.keyStorageBackend}）。`
    : settings.keyStorageBackend === 'memory-only'
      ? '当前系统没有可用的安全凭据存储，Key 仅在本次运行的内存中保留。'
      : `当前凭据后端为 ${settings.keyStorageBackend}，可能不提供强加密；请只在可信设备上使用。`;
}

async function saveSettings() {
  const button = $('#save-settings');
  button.disabled = true;
  button.textContent = '保存中…';
  const response = await window.wordloom.saveSettings(collectSettings());
  button.disabled = false;
  button.textContent = '保存设置';
  if (!response.ok) return toast(response.error.message, 'error');
  hydrateSettings(response.settings);
  if (response.shortcuts && (!response.shortcuts.quick || !response.shortcuts.add || !response.shortcuts.manual)) {
    toast('设置已保存，但有快捷键被系统占用，请换一组组合键。');
  } else {
    toast('设置已保存。', 'success');
  }
}

function setManualBusy(busy) {
  $('#manual-word').disabled = busy;
  $('#manual-meaning').disabled = busy;
  const button = $('#manual-review-button');
  button.disabled = busy;
  button.innerHTML = busy ? '<span class="spinner"></span>检查中' : 'AI 检查并加入';
}

function renderManualReview(review) {
  state.manualReview = review;
  const changed = review.status === 'needs_correction';
  const card = $('#manual-result');
  card.innerHTML = changed ? `
    <header class="manual-result-head"><h2>DeepSeek 建议纠正</h2><span class="result-pill pending">写入前确认</span></header>
    <div class="manual-review-body">
      <div class="manual-comparison">
        <div class="manual-version"><span>你的输入</span><strong>${escapeHtml(review.original.word)}</strong><p>${escapeHtml(review.original.meaning)}</p></div>
        <div class="manual-version recommended"><span>建议版本</span><strong>${escapeHtml(review.suggested.word)}</strong><p>${escapeHtml(review.suggested.meaning)}</p></div>
      </div>
      <p class="manual-reason">${escapeHtml(review.reason)}</p>
      <div class="manual-actions"><button class="ghost" id="manual-keep-original">保留原文加入</button><button class="primary" id="manual-use-suggestion">采用纠正并加入</button></div>
    </div>` : `
    <header class="manual-result-head"><h2>检查通过</h2><span class="result-pill correct">含义匹配</span></header>
    <div class="manual-review-body">
      <div class="manual-version recommended"><span>将写入单词总表</span><strong>${escapeHtml(review.original.word)}</strong><p>${escapeHtml(review.original.meaning)}</p></div>
      <p class="manual-reason">${escapeHtml(review.reason)}</p>
      <div class="manual-actions"><button class="ghost" id="manual-edit">返回修改</button><button class="primary" id="manual-add-original">确认加入</button></div>
    </div>`;
  showManualOutput();
  $('#manual-keep-original')?.addEventListener('click', () => addManualEntry('original'));
  $('#manual-use-suggestion')?.addEventListener('click', () => addManualEntry('suggested'));
  $('#manual-add-original')?.addEventListener('click', () => addManualEntry('original'));
  $('#manual-edit')?.addEventListener('click', resetManualResult);
}

function resetManualResult({ clear = false } = {}) {
  state.manualReviewId = '';
  state.manualReview = null;
  $('#manual-result').classList.add('hidden');
  $('#manual-result').innerHTML = '';
  if (clear) {
    $('#manual-word').value = '';
    $('#manual-meaning').value = '';
  }
  showDictionaryOutput();
  setTimeout(() => $('#manual-word').focus(), 0);
}

async function reviewManualEntry() {
  const word = $('#manual-word').value.trim();
  const meaning = $('#manual-meaning').value.trim();
  if (!word) return toast('先输入英文原词。', 'error');
  if (!meaning) return toast('再填写中文释义。', 'error');
  if (!state.settings.notePath) {
    toast('请先在设置中选择 IELTS Words 笔记。', 'error');
    return showView('settings');
  }
  setManualBusy(true);
  const response = await window.wordloom.reviewManual(word, meaning);
  setManualBusy(false);
  if (!response.ok) return toast(response.error.message, 'error');
  state.manualReviewId = response.reviewId;
  if (response.review.status === 'correct') {
    state.manualReview = response.review;
    return addManualEntry('original');
  }
  renderManualReview(response.review);
  toast('DeepSeek 发现需要确认的纠正。');
}

async function addManualEntry(choice) {
  if (!state.manualReviewId) return toast('请先让 DeepSeek 检查。', 'error');
  const pendingReview = state.manualReview;
  const buttons = $$('.manual-actions button');
  buttons.forEach((button) => { button.disabled = true; });
  $('#manual-result').innerHTML = '<div class="manual-success"><span class="spinner" style="border-color:rgba(23,91,67,.18);border-top-color:#175b43"></span><h2 style="margin-top:16px">正在安全写入总表</h2><p>会先备份并检查已有详解没有变化。</p></div>';
  showManualOutput();
  const response = await window.wordloom.addManual(state.manualReviewId, choice);
  if (!response.ok) {
    renderManualReview(pendingReview);
    toast(response.error.message, 'error');
    return;
  }
  state.manualReviewId = '';
  state.manualReview = { saved: true };
  const duplicate = response.status === 'duplicate';
  $('#manual-result').innerHTML = `<div class="manual-success"><h2>${escapeHtml(response.word)} ${duplicate ? '已在总表中' : '已加入'}</h2><p>${escapeHtml(response.meaning)}</p><button class="primary" id="manual-add-another">继续收词</button></div>`;
  $('#manual-add-another').addEventListener('click', () => resetManualResult({ clear: true }));
  toast(duplicate ? '总表中已有相同词义，没有重复写入。' : response.status === 'updated' ? '已把新释义合并到原词条。' : '已加入单词总表；下方详解没有变化。', 'success');
  state.quiz.loaded = false;
}

async function testApi() {
  const button = $('#test-api');
  button.disabled = true;
  button.textContent = '测试中…';
  const response = await window.wordloom.testApi(collectSettings());
  button.disabled = false;
  button.textContent = '测试连接';
  toast(response.ok ? `连接成功：${response.model}` : response.error.message, response.ok ? 'success' : 'error');
}

async function chooseNote() {
  const response = await window.wordloom.chooseNote();
  if (response.ok && response.path) $('#note-path').value = response.path;
}

async function inspectNote() {
  const path = $('#note-path').value.trim();
  if (!path) return toast('请先选择笔记路径。', 'error');
  const response = await window.wordloom.inspectNote(path);
  if (!response.ok) return toast(response.error.message, 'error');
  const note = response.note;
  $('#note-inspection').textContent = note.exists
    ? `保护检查通过：${note.lineCount} 行，SHA-256 ${note.integrity.hash.slice(0, 12)}…，边界完整，已有 ${note.integrity.backupCount} 份写前备份。新增时只更新受保护的单词总表并追加详解。`
    : '文件尚不存在；首次添加单词时会创建它。';
  toast(note.exists ? '已读取现有笔记。' : '将创建一篇新笔记。', 'success');
}

async function unifyNote() {
  const notePath = $('#note-path').value.trim();
  if (!notePath) return toast('请先选择笔记路径。', 'error');
  const button = $('#unify-note');
  button.disabled = true;
  button.textContent = '整理中…';
  const response = await window.wordloom.unifyNote(notePath);
  button.disabled = false;
  button.textContent = '整理为统一词表';
  if (!response.ok) return toast(response.error.message, 'error');
  state.quiz.loaded = false;
  const message = response.status === 'unchanged'
    ? `单词总表已经是最新状态，共 ${response.wordCount} 条。`
    : `已整理 ${response.wordCount} 条词汇；后方详解保持不变，原笔记已备份。`;
  $('#note-inspection').textContent = message;
  toast(message, 'success');
}

function normalizedEnglish(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/[.!?。！？]+$/u, '')
    .trim();
}

function updateQuizRangeHint() {
  const total = state.quiz.library.length;
  if (!total) {
    $('#quiz-range-hint').textContent = '请先读取词表。';
    return;
  }
  const start = Math.max(1, Math.min(total, Number($('#quiz-range-start').value) || 1));
  const end = Math.max(start, Math.min(total, Number($('#quiz-range-end').value) || total));
  $('#quiz-range-hint').textContent = `将测试词表第 ${start}–${end} 条，共 ${end - start + 1} 题。`;
}

async function loadQuizLibrary() {
  state.quiz.loading = true;
  $('#quiz-library-status').textContent = '正在读取 Obsidian 单词总表…';
  $('#quiz-start').disabled = true;
  const response = await window.wordloom.loadQuiz();
  state.quiz.loading = false;
  if (!response.ok) {
    state.quiz.loaded = false;
    state.quiz.library = [];
    $('#quiz-library-status').textContent = response.error.message;
    $('#quiz-range-hint').textContent = '可前往设置页执行“整理为统一词表”。';
    return;
  }
  state.quiz.library = response.entries;
  state.quiz.loaded = true;
  const total = response.entries.length;
  $('#quiz-range-start').max = String(total);
  $('#quiz-range-end').max = String(total);
  $('#quiz-range-start').value = '1';
  $('#quiz-range-end').value = String(total);
  $('#quiz-library-status').textContent = `已读取 ${total} 条词汇；编号与 Obsidian 单词总表一致。`;
  $('#quiz-start').disabled = false;
  updateQuizRangeHint();
}

function shuffled(entries) {
  const copy = [...entries];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function currentQuizEntry() {
  return state.quiz.questions[state.quiz.position];
}

function quizCounts() {
  const values = [...state.quiz.attempts.values()];
  return {
    correct: values.filter((attempt) => attempt.status === 'correct').length,
    wrong: values.filter((attempt) => attempt.status === 'wrong').length,
    pending: values.filter((attempt) => attempt.status === 'pending').length,
    unavailable: values.filter((attempt) => attempt.status === 'unavailable').length
  };
}

function renderQuizCounters() {
  const counts = quizCounts();
  $('#quiz-correct').textContent = String(counts.correct);
  $('#quiz-wrong').textContent = String(counts.wrong);
  $('#quiz-pending').textContent = String(counts.pending);
  if (!$('#quiz-finish').classList.contains('hidden')) {
    $('#quiz-finish-summary').textContent = `正确 ${counts.correct} 题，错误 ${counts.wrong} 题${counts.pending ? `，${counts.pending} 题仍在后台判分` : ''}${counts.unavailable ? `，${counts.unavailable} 题因 AI 不可用未计分` : ''}。`;
  }
}

function setQuizPill(status, text) {
  const pill = $('#quiz-result-pill');
  pill.className = `result-pill ${status}`;
  pill.textContent = text;
}

function renderQuizQuestion() {
  const entry = currentQuizEntry();
  if (!entry) return finishQuiz();
  state.quiz.submitted = false;
  $('#quiz-card').classList.remove('hidden');
  $('#quiz-finish').classList.add('hidden');
  $('#quiz-progress-text').textContent = `${state.quiz.position + 1} / ${state.quiz.questions.length}`;
  $('#quiz-progress-bar').style.width = `${((state.quiz.position + 1) / state.quiz.questions.length) * 100}%`;
  $('#quiz-mode-label').textContent = state.quiz.direction === 'zh-en' ? '中译英 · 严格' : '英译中 · AI';
  $('#quiz-source-index').textContent = `词表 #${entry.index}`;
  $('#quiz-prompt-label').textContent = state.quiz.direction === 'zh-en' ? '根据中文写出英文' : '写出这个词的中文含义';
  $('#quiz-prompt').textContent = state.quiz.direction === 'zh-en' ? entry.meaning : entry.word;
  $('#quiz-answer').value = '';
  $('#quiz-answer').disabled = false;
  $('#quiz-submit').disabled = false;
  $('#quiz-submit').textContent = '提交答案';
  $('#quiz-reveal').classList.add('hidden');
  $('#quiz-next-row').classList.add('hidden');
  setQuizPill('neutral', '待作答');
  setTimeout(() => $('#quiz-answer').focus(), 0);
  renderQuizCounters();
}

function startQuiz() {
  const total = state.quiz.library.length;
  if (!total) return toast('单词总表还没有可用词条。', 'error');
  const start = Math.max(1, Math.min(total, Number($('#quiz-range-start').value) || 1));
  const end = Math.max(start, Math.min(total, Number($('#quiz-range-end').value) || total));
  let questions = state.quiz.library.filter((entry) => entry.index >= start && entry.index <= end);
  if ($('#quiz-order').value === 'random') questions = shuffled(questions);
  state.quiz.questions = questions;
  state.quiz.position = 0;
  state.quiz.direction = $('#quiz-direction').value;
  state.quiz.attempts = new Map();
  state.quiz.sessionId = crypto.randomUUID();
  $('#quiz-setup').classList.add('hidden');
  $('#quiz-session').classList.remove('hidden');
  renderQuizQuestion();
}

function showQuizAnswer(entry, feedback) {
  $('#quiz-standard-answer').textContent = state.quiz.direction === 'zh-en' ? entry.word : entry.meaning;
  $('#quiz-feedback').textContent = feedback;
  $('#quiz-reveal').classList.remove('hidden');
  $('#quiz-next-row').classList.remove('hidden');
  $('#quiz-answer').disabled = true;
  $('#quiz-submit').disabled = true;
}

async function resolveChineseJudgement(entry, answer, sessionId) {
  const response = await window.wordloom.judgeChinese(entry.id, answer);
  if (state.quiz.sessionId !== sessionId) return;
  const attempt = state.quiz.attempts.get(entry.id);
  if (!attempt || attempt.status !== 'pending') return;
  attempt.status = response.ok ? (response.correct ? 'correct' : 'wrong') : 'unavailable';
  attempt.feedback = response.ok ? response.feedback : response.error.message;
  renderQuizCounters();
  if (currentQuizEntry()?.id === entry.id && state.quiz.submitted) {
    setQuizPill(response.ok ? (response.correct ? 'correct' : 'wrong') : 'neutral', response.ok ? (response.correct ? '正确' : '错误') : '未计分');
    $('#quiz-feedback').textContent = attempt.feedback;
  }
}

function submitQuizAnswer() {
  if (state.quiz.submitted) return nextQuizQuestion();
  const entry = currentQuizEntry();
  const answer = $('#quiz-answer').value.trim();
  if (!answer) return toast('先写下你的答案。', 'error');
  state.quiz.submitted = true;
  if (state.quiz.direction === 'zh-en') {
    const correct = (entry.answers || []).includes(normalizedEnglish(answer));
    state.quiz.attempts.set(entry.id, { status: correct ? 'correct' : 'wrong', answer });
    setQuizPill(correct ? 'correct' : 'wrong', correct ? '正确' : '错误');
    showQuizAnswer(entry, correct ? '严格匹配通过。' : '答案未与词表中的英文严格匹配。');
  } else {
    state.quiz.attempts.set(entry.id, { status: 'pending', answer });
    setQuizPill('pending', 'AI 判分中');
    showQuizAnswer(entry, '标准答案已显示；AI 正在后台判断，你现在就可以进入下一题。');
    resolveChineseJudgement(entry, answer, state.quiz.sessionId);
  }
  renderQuizCounters();
  setTimeout(() => $('#quiz-next').focus(), 0);
}

function nextQuizQuestion() {
  if (!state.quiz.submitted) return;
  state.quiz.position += 1;
  renderQuizQuestion();
}

function finishQuiz() {
  $('#quiz-card').classList.add('hidden');
  $('#quiz-finish').classList.remove('hidden');
  $('#quiz-progress-text').textContent = `${state.quiz.questions.length} / ${state.quiz.questions.length}`;
  $('#quiz-progress-bar').style.width = '100%';
  renderQuizCounters();
}

function exitQuiz() {
  state.quiz.sessionId = '';
  $('#quiz-session').classList.add('hidden');
  $('#quiz-setup').classList.remove('hidden');
  updateQuizRangeHint();
}

function wireEvents() {
  $$('.rail-button[data-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
  $$('[data-window]').forEach((button) => button.addEventListener('click', () => window.wordloom.windowAction(button.dataset.window)));
  $('#search-form').addEventListener('submit', (event) => { event.preventDefault(); lookup($('#word-input').value); });
  $('#save-settings').addEventListener('click', saveSettings);
  $('#test-api').addEventListener('click', testApi);
  $('#choose-note').addEventListener('click', chooseNote);
  $('#inspect-note').addEventListener('click', inspectNote);
  $('#manual-form').addEventListener('submit', (event) => { event.preventDefault(); reviewManualEntry(); });
  $('#unify-note').addEventListener('click', unifyNote);
  $('#quiz-reload').addEventListener('click', loadQuizLibrary);
  $('#quiz-start').addEventListener('click', startQuiz);
  $('#quiz-exit').addEventListener('click', exitQuiz);
  $('#quiz-again').addEventListener('click', exitQuiz);
  $('#quiz-next').addEventListener('click', nextQuizQuestion);
  $('#quiz-answer-form').addEventListener('submit', (event) => { event.preventDefault(); submitQuizAnswer(); });
  $('#quiz-range-start').addEventListener('input', updateQuizRangeHint);
  $('#quiz-range-end').addEventListener('input', updateQuizRangeHint);
  $('#clear-key').addEventListener('click', async () => {
    const response = await window.wordloom.clearApiKey();
    if (!response.ok) return toast(response.error.message, 'error');
    hydrateSettings(response.settings);
    toast('API Key 已清除。', 'success');
  });
  $('#clear-cambridge-key').addEventListener('click', async () => {
    const response = await window.wordloom.clearCambridgeKey();
    if (!response.ok) return toast(response.error.message, 'error');
    hydrateSettings(response.settings);
    toast('Cambridge Access Key 已清除。', 'success');
  });
  $('#apply-cambridge').addEventListener('click', () => window.wordloom.openExternal('https://dictionary-api.cambridge.org/api/'));
  $('#open-cambridge').addEventListener('click', () => window.wordloom.openExternal('https://dictionary.cambridge.org/'));
  $('#copy-command').addEventListener('click', async () => {
    await window.wordloom.copyText(state.launchCommand);
    toast('启动命令已复制。', 'success');
  });
  document.addEventListener('keydown', (event) => {
    if (event.altKey && event.key === 'Enter') {
      event.preventDefault();
      addCurrentToNote();
    }
    if (event.altKey && event.key.toLocaleLowerCase('en-US') === 'm') {
      event.preventDefault();
      showView('lookup');
      setTimeout(() => $('#manual-word').focus(), 0);
    }
    if (event.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
      event.preventDefault();
      showView('lookup');
    }
  });
  window.wordloom.onAddShortcut(() => addCurrentToNote());
  window.wordloom.onManualShortcut(() => { showView('lookup'); setTimeout(() => $('#manual-word').focus(), 0); });
  window.wordloom.onFocusSearch(() => { showView('lookup'); $('#word-input').focus(); });
}

async function init() {
  wireEvents();
  const response = await window.wordloom.bootstrap();
  if (!response.ok) return toast('应用初始化失败。', 'error');
  state.launchCommand = response.quickLaunchCommand;
  hydrateSettings(response.settings);
  $('#launch-command').textContent = response.quickLaunchCommand;
  $('#app-version').textContent = response.version;
  if (!response.shortcuts?.quick || !response.shortcuts?.add || !response.shortcuts?.manual) {
    toast('有快捷键被系统占用，请在设置中换一个按键。');
  }
}

init();

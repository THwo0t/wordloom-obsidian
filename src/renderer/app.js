'use strict';

const state = {
  settings: null,
  currentResult: null,
  currentResultId: '',
  activeRequestId: '',
  busy: false,
  launchCommand: ''
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
}

function setBusy(busy) {
  state.busy = busy;
  const button = $('#lookup-button');
  button.disabled = busy;
  button.innerHTML = busy ? '<span class="spinner"></span>查询中' : '查询';
  $('#word-input').disabled = busy;
}

function renderLoading(word) {
  $('#result-card').classList.add('hidden');
  const panel = $('#lookup-state');
  panel.classList.remove('hidden');
  panel.innerHTML = `<div><span class="spinner" style="border-color:rgba(23,91,67,.18);border-top-color:#175b43;width:34px;height:34px"></span><h3 style="margin-top:18px">正在查找 ${escapeHtml(word)}</h3><p>DeepSeek 正在搜索 Cambridge，并整理成你的学习卡片…</p></div>`;
}

function renderError(message) {
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
  const protectedMessage = response.checks?.originalUntouched && response.checks?.markersBalanced
    ? `已加入 “${response.word}”；原文未改动，写后校验通过${response.backupPath ? '，备份已保存' : ''}。`
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
  if (response.shortcuts && (!response.shortcuts.quick || !response.shortcuts.add)) {
    toast('设置已保存，但有快捷键被系统占用，请换一组组合键。');
  } else {
    toast('设置已保存。', 'success');
  }
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
    ? `保护检查通过：${note.lineCount} 行，SHA-256 ${note.integrity.hash.slice(0, 12)}…，边界完整，已有 ${note.integrity.backupCount} 份写前备份。Wordloom 只会追加，不会改写这些原文。`
    : '文件尚不存在；首次添加单词时会创建它。';
  toast(note.exists ? '已读取现有笔记。' : '将创建一篇新笔记。', 'success');
}

function wireEvents() {
  $$('.rail-button[data-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
  $$('[data-window]').forEach((button) => button.addEventListener('click', () => window.wordloom.windowAction(button.dataset.window)));
  $('#search-form').addEventListener('submit', (event) => { event.preventDefault(); lookup($('#word-input').value); });
  $('#save-settings').addEventListener('click', saveSettings);
  $('#test-api').addEventListener('click', testApi);
  $('#choose-note').addEventListener('click', chooseNote);
  $('#inspect-note').addEventListener('click', inspectNote);
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
    if (event.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
      event.preventDefault();
      showView('lookup');
    }
  });
  window.wordloom.onAddShortcut(() => addCurrentToNote());
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
  if (!response.shortcuts?.quick || !response.shortcuts?.add) {
    toast('有快捷键被系统占用，请在设置中换一个按键。');
  }
}

init();

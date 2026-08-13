'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  safeStorage,
  shell
} = require('electron');
const {
  fetchCambridgeApi,
} = require('./services/cambridge');
const { enrichWithAi, fetchCambridgeViaWebSearch, judgeChineseAnswer, reviewManualVocabulary, testAiConnection } = require('./services/deepseek');
const { appendManualToNote, appendToNote, readNoteSummary, readVocabularyEntries, renderTemplate, unifyVocabularyNote } = require('./services/obsidian');
const { SettingsStore } = require('./services/settings');

const isQuickLaunch = process.argv.includes('--quick');
const isAutomatedTest = process.env.WORDLOOM_E2E === '1';

function wordFromArgv(argv) {
  const index = argv.indexOf('--word');
  return index !== -1 ? String(argv[index + 1] || '').trim().slice(0, 80) : '';
}

const initialQuickWord = wordFromArgv(process.argv);
const gotInstanceLock = app.requestSingleInstanceLock({ quick: isQuickLaunch, word: initialQuickWord });

if (!gotInstanceLock) app.quit();

let mainWindow = null;
let quickWindow = null;
let quickOnlySession = isQuickLaunch;
let pendingQuickWord = initialQuickWord;
let settingsStore = null;
let shortcutRegistration = { quick: false, add: false, manual: false };
const lookupControllers = new Map();
const resultCache = new Map();
const quizEntryCache = new Map();
const manualReviewCache = new Map();

function userError(error) {
  if (error?.name === 'AbortError') return { message: '查询已取消。', code: 'CANCELLED' };
  return {
    message: String(error?.message || '发生了未知错误。').replace(/[\r\n]+/g, ' ').slice(0, 500),
    code: error?.code || 'UNKNOWN'
  };
}

function secureWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 650,
    show: false,
    frame: false,
    backgroundColor: '#f3f1eb',
    title: 'Wordloom · IELTS 词库',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  secureWindow(mainWindow);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    if (!isAutomatedTest) mainWindow?.show();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (!quickWindow) app.quit();
  });
  return mainWindow;
}

function createQuickWindow(word = '') {
  if (quickWindow && !quickWindow.isDestroyed()) {
    quickWindow.show();
    quickWindow.focus();
    if (word) quickWindow.webContents.send('quick:lookup', word);
    else quickWindow.webContents.send('shortcut:focus-search');
    return quickWindow;
  }

  pendingQuickWord = word;

  quickWindow = new BrowserWindow({
    width: 620,
    height: 520,
    minWidth: 520,
    minHeight: 360,
    show: false,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    backgroundColor: '#f8f6f0',
    title: 'Wordloom 快速查词',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  secureWindow(quickWindow);
  quickWindow.loadFile(path.join(__dirname, 'renderer', 'quick.html'));
  quickWindow.once('ready-to-show', () => {
    if (!isAutomatedTest) quickWindow?.show();
  });
  quickWindow.on('closed', () => {
    quickWindow = null;
    // A process launched with --quick has no reason to remain after its only window closes.
    if (quickOnlySession && !mainWindow) app.quit();
  });
  return quickWindow;
}

function quickLaunchCommand() {
  return 'wl';
}

function sendAddShortcut() {
  const focused = BrowserWindow.getFocusedWindow();
  const target = focused === quickWindow || focused === mainWindow ? focused : quickWindow || mainWindow;
  target?.webContents.send('shortcut:add');
}

function sendManualShortcut() {
  quickOnlySession = false;
  const target = createMainWindow();
  const send = () => {
    if (!target || target.isDestroyed()) return;
    target.show();
    target.focus();
    target.webContents.send('shortcut:manual');
  };
  if (target.webContents.isLoadingMainFrame()) target.webContents.once('did-finish-load', send);
  else send();
}

function registerShortcuts(settings) {
  globalShortcut.unregisterAll();
  const state = { quick: false, add: false, manual: false };
  try {
    if (settings.quickShortcut) state.quick = globalShortcut.register(settings.quickShortcut, createQuickWindow);
  } catch {
    state.quick = false;
  }
  try {
    if (settings.addShortcut) state.add = globalShortcut.register(settings.addShortcut, sendAddShortcut);
  } catch {
    state.add = false;
  }
  try {
    if (settings.manualShortcut) state.manual = globalShortcut.register(settings.manualShortcut, sendManualShortcut);
  } catch {
    state.manual = false;
  }
  shortcutRegistration = state;
  return state;
}

function cacheResult(result) {
  const id = crypto.randomUUID();
  resultCache.set(id, result);
  while (resultCache.size > 40) resultCache.delete(resultCache.keys().next().value);
  return id;
}

function registerIpc() {
  ipcMain.handle('app:bootstrap', (event) => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender);
    const quickWord = sourceWindow === quickWindow ? pendingQuickWord : '';
    if (quickWord) pendingQuickWord = '';
    return {
      ok: true,
      settings: settingsStore.publicSettings(),
      version: app.getVersion(),
      platform: process.platform,
      quickOnly: quickOnlySession,
      quickWord,
      shortcuts: shortcutRegistration,
      quickLaunchCommand: quickLaunchCommand()
    };
  });

  ipcMain.handle('settings:get', () => ({ ok: true, settings: settingsStore.publicSettings() }));
  ipcMain.handle('settings:save', async (_event, patch) => {
    try {
      const settings = await settingsStore.save(patch);
      const shortcuts = registerShortcuts(settings);
      return { ok: true, settings, shortcuts };
    } catch (error) {
      return { ok: false, error: userError(error) };
    }
  });
  ipcMain.handle('settings:clear-key', async () => {
    try {
      return { ok: true, settings: await settingsStore.clearApiKey() };
    } catch (error) {
      return { ok: false, error: userError(error) };
    }
  });
  ipcMain.handle('settings:clear-cambridge-key', async () => {
    try {
      return { ok: true, settings: await settingsStore.clearCambridgeKey() };
    } catch (error) {
      return { ok: false, error: userError(error) };
    }
  });

  ipcMain.handle('dialog:choose-note', async () => {
    const owner = BrowserWindow.getFocusedWindow() || mainWindow;
    const options = {
      title: '选择或创建 IELTS words.md',
      buttonLabel: '使用这篇笔记',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      properties: ['openFile', 'createDirectory']
    };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    return result.canceled ? { ok: true, path: '' } : { ok: true, path: result.filePaths[0] };
  });

  ipcMain.handle('lookup:word', async (_event, payload = {}) => {
    const requestId = String(payload.requestId || crypto.randomUUID());
    const controller = new AbortController();
    lookupControllers.set(requestId, controller);
    try {
      const cambridgeKey = settingsStore.getCambridgeKey();
      const settings = settingsStore.publicSettings();
      let dictionary;
      if (cambridgeKey) {
        dictionary = await fetchCambridgeApi(payload.word, cambridgeKey, { signal: controller.signal });
      } else {
        dictionary = await fetchCambridgeViaWebSearch(payload.word, settings, settingsStore.getApiKey(), { signal: controller.signal });
      }
      const hasSearchEnrichment = Object.hasOwn(dictionary, 'enrichment');
      const searchEnrichment = hasSearchEnrichment ? dictionary.enrichment : null;
      if (hasSearchEnrichment) {
        const { enrichment: _discarded, ...dictionaryFacts } = dictionary;
        dictionary = dictionaryFacts;
      }
      let enrichment = {};
      let aiWarning = '';
      if (settings.useAi && hasSearchEnrichment) {
        enrichment = searchEnrichment;
      } else if (settings.useAi && settingsStore.getApiKey()) {
        try {
          enrichment = await enrichWithAi(dictionary, settings, settingsStore.getApiKey(), { signal: controller.signal });
        } catch (error) {
          if (controller.signal.aborted) throw error;
          aiWarning = userError(error).message;
        }
      } else if (settings.useAi) {
        aiWarning = '尚未配置 API Key，已显示 Cambridge 原始结果。';
      }
      const result = { ...dictionary, enrichment };
      const resultId = cacheResult(result);
      return { ok: true, result, resultId, aiWarning };
    } catch (error) {
      return { ok: false, error: userError(error) };
    } finally {
      lookupControllers.delete(requestId);
    }
  });

  ipcMain.on('lookup:cancel', (_event, requestId) => lookupControllers.get(String(requestId))?.abort());

  ipcMain.handle('note:add', async (_event, { resultId, force } = {}) => {
    try {
      const result = resultCache.get(String(resultId || ''));
      if (!result) throw new Error('查询结果已过期，请重新查询后再添加。');
      const settings = settingsStore.publicSettings();
      const saved = await appendToNote(settings.notePath, result, { template: settings.template, force: Boolean(force) });
      return { ok: true, ...saved };
    } catch (error) {
      return { ok: false, error: userError(error) };
    }
  });

  ipcMain.handle('manual:review', async (_event, payload = {}) => {
    try {
      const settings = settingsStore.publicSettings();
      const review = await reviewManualVocabulary(
        payload.word,
        payload.meaning,
        settings,
        settingsStore.getApiKey()
      );
      const reviewId = crypto.randomUUID();
      manualReviewCache.set(reviewId, review);
      while (manualReviewCache.size > 30) manualReviewCache.delete(manualReviewCache.keys().next().value);
      return { ok: true, reviewId, review };
    } catch (error) {
      return { ok: false, error: userError(error) };
    }
  });

  ipcMain.handle('manual:add', async (_event, payload = {}) => {
    try {
      const reviewId = String(payload.reviewId || '');
      const review = manualReviewCache.get(reviewId);
      if (!review) throw new Error('校对结果已过期，请重新检查。');
      const choice = String(payload.choice || '');
      if (!['original', 'suggested'].includes(choice)) throw new Error('请选择要写入的版本。');
      const entry = choice === 'suggested' ? review.suggested : review.original;
      const settings = settingsStore.publicSettings();
      const saved = await appendManualToNote(settings.notePath, entry);
      manualReviewCache.delete(reviewId);
      return { ok: true, choice, ...saved };
    } catch (error) {
      return { ok: false, error: userError(error) };
    }
  });

  ipcMain.handle('note:preview', (_event, { resultId, template } = {}) => {
    try {
      const result = resultCache.get(String(resultId || ''));
      if (!result) throw new Error('请先查询一个单词。');
      return { ok: true, markdown: renderTemplate(result, template) };
    } catch (error) {
      return { ok: false, error: userError(error) };
    }
  });

  ipcMain.handle('note:inspect', async (_event, notePath) => {
    try {
      return { ok: true, note: await readNoteSummary(notePath) };
    } catch (error) {
      return { ok: false, error: userError(error) };
    }
  });

  ipcMain.handle('note:unify', async (_event, notePath) => {
    try {
      const settings = settingsStore.publicSettings();
      return { ok: true, ...(await unifyVocabularyNote(notePath || settings.notePath)) };
    } catch (error) {
      return { ok: false, error: userError(error) };
    }
  });

  ipcMain.handle('quiz:load', async () => {
    try {
      const settings = settingsStore.publicSettings();
      const entries = await readVocabularyEntries(settings.notePath);
      quizEntryCache.clear();
      const publicEntries = entries.map((entry) => {
        const id = crypto.randomUUID();
        quizEntryCache.set(id, entry);
        return { ...entry, id };
      });
      return { ok: true, entries: publicEntries };
    } catch (error) {
      return { ok: false, error: userError(error) };
    }
  });

  ipcMain.handle('quiz:judge-chinese', async (_event, payload = {}) => {
    try {
      const entry = quizEntryCache.get(String(payload.entryId || ''));
      if (!entry) throw new Error('这道题已过期，请重新开始默写。');
      const settings = settingsStore.publicSettings();
      const result = await judgeChineseAnswer(entry, payload.answer, settings, settingsStore.getApiKey());
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: userError(error) };
    }
  });

  ipcMain.handle('api:test', async (_event, patch = {}) => {
    try {
      const settings = { ...settingsStore.publicSettings(), ...patch };
      const key = String(patch.apiKey || '').trim() || settingsStore.getApiKey();
      const result = await testAiConnection(settings, key);
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: userError(error) };
    }
  });

  ipcMain.handle('shell:open-external', async (_event, value) => {
    try {
      const url = new URL(String(value || ''));
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('只允许打开 HTTP(S) 链接。');
      await shell.openExternal(url.toString());
      return { ok: true };
    } catch (error) {
      return { ok: false, error: userError(error) };
    }
  });

  ipcMain.handle('clipboard:write', (_event, text) => {
    clipboard.writeText(String(text || ''));
    return { ok: true };
  });

  ipcMain.on('window:action', (event, action) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (action === 'minimize') window.minimize();
    if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    if (action === 'close') window.close();
  });

  ipcMain.on('window:open-main', () => {
    quickOnlySession = false;
    createMainWindow();
  });
}

if (gotInstanceLock) {
  app.on('second-instance', (_event, argv, _workingDirectory, additionalData = {}) => {
    if (argv.includes('--quick') || additionalData.quick) createQuickWindow(wordFromArgv(argv) || additionalData.word || '');
    else createMainWindow();
  });

  app.whenReady().then(async () => {
    settingsStore = new SettingsStore(app.getPath('userData'), safeStorage, {
      legacyUserDataPaths: [path.join(app.getPath('appData'), 'wordloom-obsidian')]
    });
    await settingsStore.load();
    registerIpc();
    registerShortcuts(settingsStore.publicSettings());
    if (isQuickLaunch) createQuickWindow(initialQuickWord);
    else createMainWindow();
  });

  app.on('activate', () => {
    if (!mainWindow && !quickOnlySession) createMainWindow();
  });

  app.on('will-quit', () => {
    for (const controller of lookupControllers.values()) controller.abort();
    lookupControllers.clear();
    globalShortcut.unregisterAll();
  });
}

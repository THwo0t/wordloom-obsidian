'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function on(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('wordloom', {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  lookup: (word, requestId) => ipcRenderer.invoke('lookup:word', { word, requestId }),
  cancelLookup: (requestId) => ipcRenderer.send('lookup:cancel', requestId),
  addToNote: (resultId, force = false) => ipcRenderer.invoke('note:add', { resultId, force }),
  previewMarkdown: (resultId, template) => ipcRenderer.invoke('note:preview', { resultId, template }),
  inspectNote: (notePath) => ipcRenderer.invoke('note:inspect', notePath),
  unifyNote: (notePath) => ipcRenderer.invoke('note:unify', notePath),
  loadQuiz: () => ipcRenderer.invoke('quiz:load'),
  judgeChinese: (entryId, answer) => ipcRenderer.invoke('quiz:judge-chinese', { entryId, answer }),
  chooseNote: () => ipcRenderer.invoke('dialog:choose-note'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  clearApiKey: () => ipcRenderer.invoke('settings:clear-key'),
  clearCambridgeKey: () => ipcRenderer.invoke('settings:clear-cambridge-key'),
  testApi: (settings) => ipcRenderer.invoke('api:test', settings),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  windowAction: (action) => ipcRenderer.send('window:action', action),
  openMain: () => ipcRenderer.send('window:open-main'),
  onAddShortcut: (callback) => on('shortcut:add', callback),
  onFocusSearch: (callback) => on('shortcut:focus-search', callback),
  onQuickLookup: (callback) => on('quick:lookup', callback)
});

'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { DEFAULT_TEMPLATE, LEGACY_EXPANDED_TEMPLATE } = require('./obsidian');

const DEFAULT_SETTINGS = Object.freeze({
  endpoint: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  notePath: '',
  template: DEFAULT_TEMPLATE,
  useAi: true,
  quickShortcut: 'Alt+V',
  addShortcut: 'Alt+Enter'
});

const LEGACY_SHORTCUTS = Object.freeze({
  quickShortcut: 'CommandOrControl+Alt+Space',
  addShortcut: 'CommandOrControl+Shift+Enter'
});

const EDITABLE_KEYS = new Set([
  'endpoint',
  'model',
  'notePath',
  'template',
  'useAi',
  'quickShortcut',
  'addShortcut'
]);

class SettingsStore {
  constructor(userDataPath, safeStorage, { legacyUserDataPaths = [] } = {}) {
    this.filePath = path.join(userDataPath, 'settings.json');
    this.legacyFilePaths = legacyUserDataPaths
      .map((value) => path.join(value, 'settings.json'))
      .filter((value) => value !== this.filePath);
    this.safeStorage = safeStorage;
    this.data = { ...DEFAULT_SETTINGS };
    this.volatileApiKey = '';
    this.volatileCambridgeKey = '';
  }

  async load() {
    let currentExists = true;
    try {
      const saved = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      this.data = { ...DEFAULT_SETTINGS, ...saved };
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Could not load settings:', error.message);
      currentExists = false;
      this.data = { ...DEFAULT_SETTINGS };
    }

    let migrated = false;
    for (const legacyFilePath of this.legacyFilePaths) {
      let legacy;
      try {
        legacy = JSON.parse(await fs.readFile(legacyFilePath, 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') console.warn('Could not load legacy settings:', error.message);
        continue;
      }
      if (!currentExists) {
        this.data = { ...DEFAULT_SETTINGS, ...legacy };
        currentExists = true;
        migrated = true;
      } else {
        for (const secret of ['apiKeyEncrypted', 'cambridgeKeyEncrypted']) {
          if (!this.canDecryptSecret(this.data[secret]) && this.canDecryptSecret(legacy[secret])) {
            this.data[secret] = legacy[secret];
            migrated = true;
          }
        }
        if (!this.data.notePath && legacy.notePath) {
          this.data.notePath = legacy.notePath;
          migrated = true;
        }
      }
      break;
    }
    for (const key of ['quickShortcut', 'addShortcut']) {
      if (this.data[key] === LEGACY_SHORTCUTS[key]) {
        this.data[key] = DEFAULT_SETTINGS[key];
        migrated = true;
      }
    }
    if (String(this.data.template || '').trim() === LEGACY_EXPANDED_TEMPLATE.trim()) {
      this.data.template = DEFAULT_TEMPLATE;
      migrated = true;
    }
    if (migrated) await this.persist();
    return this.publicSettings();
  }

  canDecryptSecret(value) {
    if (!value || !this.encryptionAvailable()) return false;
    try {
      return Boolean(this.safeStorage.decryptString(Buffer.from(value, 'base64')));
    } catch {
      return false;
    }
  }

  encryptionAvailable() {
    try {
      return Boolean(this.safeStorage?.isEncryptionAvailable());
    } catch {
      return false;
    }
  }

  storageBackend() {
    try {
      return process.platform === 'linux' && this.encryptionAvailable()
        ? this.safeStorage.getSelectedStorageBackend()
        : this.encryptionAvailable() ? 'os-keychain' : 'memory-only';
    } catch {
      return 'unknown';
    }
  }

  canPersistSecret() {
    const backend = this.storageBackend();
    return this.encryptionAvailable() && !['basic_text', 'memory-only', 'unknown'].includes(backend);
  }

  getApiKey() {
    if (this.volatileApiKey) return this.volatileApiKey;
    if (!this.data.apiKeyEncrypted || !this.encryptionAvailable()) return '';
    try {
      return this.safeStorage.decryptString(Buffer.from(this.data.apiKeyEncrypted, 'base64'));
    } catch {
      return '';
    }
  }

  getCambridgeKey() {
    if (this.volatileCambridgeKey) return this.volatileCambridgeKey;
    if (!this.data.cambridgeKeyEncrypted || !this.encryptionAvailable()) return '';
    try {
      return this.safeStorage.decryptString(Buffer.from(this.data.cambridgeKeyEncrypted, 'base64'));
    } catch {
      return '';
    }
  }

  publicSettings() {
    const { apiKeyEncrypted, cambridgeKeyEncrypted, ...settings } = this.data;
    const backend = this.storageBackend();
    return {
      ...settings,
      hasApiKey: Boolean(this.getApiKey()),
      hasCambridgeKey: Boolean(this.getCambridgeKey()),
      keyStorageBackend: backend,
      keyStorageSecure: !['basic_text', 'memory-only', 'unknown'].includes(backend)
    };
  }

  async save(patch = {}) {
    const next = { ...this.data };
    for (const [key, value] of Object.entries(patch)) {
      if (!EDITABLE_KEYS.has(key)) continue;
      if (key === 'useAi') next[key] = Boolean(value);
      else next[key] = String(value ?? '').trimEnd();
    }

    if (Object.hasOwn(patch, 'apiKey')) {
      const key = String(patch.apiKey || '').trim();
      if (key && this.canPersistSecret()) {
        next.apiKeyEncrypted = this.safeStorage.encryptString(key).toString('base64');
        this.volatileApiKey = '';
      } else if (key) {
        delete next.apiKeyEncrypted;
        this.volatileApiKey = key;
      }
    }

    if (Object.hasOwn(patch, 'cambridgeApiKey')) {
      const key = String(patch.cambridgeApiKey || '').trim();
      if (key && this.canPersistSecret()) {
        next.cambridgeKeyEncrypted = this.safeStorage.encryptString(key).toString('base64');
        this.volatileCambridgeKey = '';
      } else if (key) {
        delete next.cambridgeKeyEncrypted;
        this.volatileCambridgeKey = key;
      }
    }

    this.data = next;
    await this.persist();
    return this.publicSettings();
  }

  async clearApiKey() {
    delete this.data.apiKeyEncrypted;
    this.volatileApiKey = '';
    await this.persist();
    return this.publicSettings();
  }

  async clearCambridgeKey() {
    delete this.data.cambridgeKeyEncrypted;
    this.volatileCambridgeKey = '';
    await this.persist();
    return this.publicSettings();
  }

  async persist() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const serializable = { ...this.data };
    await fs.writeFile(this.filePath, `${JSON.stringify(serializable, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  }
}

module.exports = { DEFAULT_SETTINGS, SettingsStore };

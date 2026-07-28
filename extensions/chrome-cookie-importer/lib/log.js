/**
 * Logger estruturado para a extensão (carregado como script clássico).
 *
 * Funciona em todos os contextos (popup, service worker, content script):
 *   - Popup: <script src="lib/log.js"> antes do popup.js
 *   - Service worker: importScripts('lib/log.js') (MV3 suporta)
 *   - Content script: "js": ["lib/log.js", "content/auth-sync.js"] no manifest
 *
 * Saída em JSON no console (mesmo padrão do worker) com prefixo [extensão]
 * para facilitar filtragem em chrome://extensions/ → service worker → Inspect.
 *
 * Níveis: debug, info, warn, error. Debug fica DESLIGADO por padrão — liga
 * via popup (toggle "Logs de debug") ou
 * `chrome.storage.local.set({ authDebugEnabled: true })`.
 *
 * Uso: globalThis.extLog.info('event.name', { foo: 'bar' })
 */

(function () {
  'use strict';

  const SERVICE = 'chrome-cookie-importer';
  const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

  let cachedThreshold = LEVELS.info;
  let configLoaded = false;

  function readConfig() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      cachedThreshold = LEVELS.info;
      configLoaded = true;
      return;
    }
    try {
      // Callback API — funciona em service workers, popup e content scripts
      // sem depender de Promise.then (que tem timing diferente por contexto).
      chrome.storage.local.get(['authDebugEnabled', 'authLogLevel'], (saved) => {
        const enabled = saved && saved.authDebugEnabled === true;
        const configured = saved && saved.authLogLevel;
        cachedThreshold = LEVELS[configured] ?? (enabled ? LEVELS.debug : LEVELS.info);
        configLoaded = true;
      });
    } catch {
      cachedThreshold = LEVELS.info;
      configLoaded = true;
    }
  }

  readConfig();

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.authDebugEnabled || changes.authLogLevel) readConfig();
    });
  }

  function emit(level, event, data) {
    if (LEVELS[level] < cachedThreshold) return;
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service: SERVICE,
      event,
      ...(data && typeof data === 'object' ? { data } : {}),
    };
    const line = `[extensão] ${JSON.stringify(entry)}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }

  const api = {
    debug: (event, data) => emit('debug', event, data),
    info: (event, data) => emit('info', event, data),
    warn: (event, data) => emit('warn', event, data),
    error: (event, data) => emit('error', event, data),
    isEnabled: () => cachedThreshold <= LEVELS.debug,
  };

  // Expõe como globalThis.extLog — funciona em SW (self), popup (window)
  // e content script (window).
  (typeof globalThis !== 'undefined' ? globalThis : self).extLog = api;
})();

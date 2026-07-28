/**
 * Sink que envia logs ao backend.
 *
 * Buffer em memória + persistência em chrome.storage.local para sobreviver
 * a restart do service worker. Flush quando:
 *   - buffer passa de MAX_BUFFER (20 entries)
 *   - timer periódico a cada FLUSH_INTERVAL_MS (10s)
 *   - shutdown do SW (chrome.runtime.onSuspend)
 *
 * Erros de rede → descarta batch + log local. NUNCA bloqueia a extensão.
 *
 * API key vem de globalThis.__EXT_LOGS_API_KEY__ (injetada por
 * lib/log-sink.config.js, gerado por scripts/build-extension-config.ts).
 * Se vazia, sink fica inerte — fail-safe.
 *
 * Envio é padrão — não precisa opt-in. Para desativar, basta rodar o
 * build com EXTENSION_LOGS_API_KEY vazia.
 */

(function () {
  'use strict';

  const STORAGE_KEYS = {
    sessionId: 'logsUploadSessionId',
    buffer: 'logsUploadBuffer',
    lastSentAt: 'logsUploadLastSentAt',
    lastError: 'logsUploadLastError',
    lastBatchSize: 'logsUploadLastBatchSize',
  };

  const FLUSH_INTERVAL_MS = 10_000;
  const MAX_BUFFER = 20;
  const MAX_PERSISTED = 200; // limite em chrome.storage.local
  const ENDPOINT_DEFAULT = 'https://dev.omestreafiliado.com.br/api/extension/logs';
  // Lê do manifest em runtime — sempre bate com a versão real.
  const EXTENSION_VERSION =
    typeof chrome !== 'undefined' && chrome.runtime
      ? chrome.runtime.getManifest().version
      : 'unknown';

  const log = globalThis.extLog;
  // API key injetada pelo build via lib/log-sink.config.js (carregado antes).
  const API_KEY = globalThis.__EXT_LOGS_API_KEY__ || '';
  if (!API_KEY) {
    log.warn('logs-sink.no-api-key', {
      message: 'EXTENSION_LOGS_API_KEY não configurada. Rode `bun run build:extension` para gerar.',
    });
  }

  let state = {
    apiUrl: '',
    sessionId: '',
    userEmail: null,
  };
  let timer = null;

  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  async function loadState() {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        [
          STORAGE_KEYS.sessionId,
          'apiUrl', // URL da API configurada em options.html (compartilhada)
          'logsUploadUserEmail',
        ],
        (saved) => {
          state = {
            apiUrl: saved.apiUrl || '',
            sessionId: saved[STORAGE_KEYS.sessionId] || '',
            userEmail: saved.logsUploadUserEmail || null,
          };
          resolve();
        },
      );
    });
  }

  async function ensureSessionId() {
    if (state.sessionId) return;
    state.sessionId = uuid();
    await chrome.storage.local.set({ [STORAGE_KEYS.sessionId]: state.sessionId });
  }

  async function loadBuffer() {
    return new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEYS.buffer, (saved) => {
        resolve(Array.isArray(saved[STORAGE_KEYS.buffer]) ? saved[STORAGE_KEYS.buffer] : []);
      });
    });
  }

  async function saveBuffer(buffer) {
    const trimmed = buffer.slice(-MAX_PERSISTED);
    await chrome.storage.local.set({ [STORAGE_KEYS.buffer]: trimmed });
  }

  function buildEntry(level, event, data) {
    return {
      sessionId: state.sessionId,
      userEmail: state.userEmail,
      level,
      event,
      data: data && typeof data === 'object' ? data : null,
      extensionVersion: EXTENSION_VERSION,
      chromeVersion:
        typeof chrome !== 'undefined' && chrome.runtime
          ? chrome.runtime.getManifest().version || null
          : null,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    };
  }

  async function flush() {
    if (!API_KEY) return;
    const buffer = await loadBuffer();
    if (buffer.length === 0) return;

    const endpoint = (state.apiUrl || ENDPOINT_DEFAULT).replace(/\/+$/, '') + '/api/extension/logs';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Extension-Logs-Key': API_KEY,
        },
        body: JSON.stringify(buffer),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        log.warn('logs-sink.flush.failed', { status: res.status, body: errBody.slice(0, 200) });
        await chrome.storage.local.set({
          [STORAGE_KEYS.lastError]: `HTTP ${res.status}`,
        });
        return;
      }
      await chrome.storage.local.set({
        [STORAGE_KEYS.buffer]: [],
        [STORAGE_KEYS.lastSentAt]: new Date().toISOString(),
        [STORAGE_KEYS.lastError]: null,
        [STORAGE_KEYS.lastBatchSize]: buffer.length,
      });
      log.info('logs-sink.flush.ok', { count: buffer.length });
    } catch (err) {
      log.warn('logs-sink.flush.network-error', { error: String(err) });
      await chrome.storage.local.set({
        [STORAGE_KEYS.lastError]: String(err).slice(0, 200),
      });
    }
  }

  function startTimer() {
    if (timer) clearInterval(timer);
    timer = setInterval(flush, FLUSH_INTERVAL_MS);
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  /**
   * Hook chamado pelo lib/log.js para cada log emitido.
   * Chamada leve — só adiciona ao buffer (operação assíncrona leve).
   */
  async function sink(level, event, data) {
    if (!API_KEY) return;

    try {
      await ensureSessionId();
      const entry = buildEntry(level, event, data);
      const buffer = await loadBuffer();
      buffer.push(entry);
      const trimmed = buffer.length > MAX_PERSISTED ? buffer.slice(-MAX_PERSISTED) : buffer;
      await saveBuffer(trimmed);

      if (trimmed.length >= MAX_BUFFER) {
        flush().catch(() => {});
      }
    } catch (err) {
      try {
        log.warn('logs-sink.append.failed', { error: String(err) });
      } catch {
        /* swallow */
      }
    }
  }

  /** Flush imediato (botão "Enviar agora" do popup). */
  async function flushNow() {
    return flush();
  }

  async function init() {
    await loadState();
    if (API_KEY) {
      startTimer();
      log.info('logs-sink.started', { sessionId: state.sessionId });
      // Flush imediato do que sobrou do último restart
      flush().catch(() => {});
    }
  }

  // Observa mudanças em apiUrl e userEmail (únicas configs dinâmicas).
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area !== 'local') return;
      const interesting = ['apiUrl', 'logsUploadUserEmail'];
      if (!interesting.some((k) => k in changes)) return;
      await loadState();
    });
  }

  // Tenta flushar antes do SW ser desligado.
  if (typeof chrome !== 'undefined' && chrome.runtime?.onSuspend) {
    chrome.runtime.onSuspend.addListener(() => {
      flush().catch(() => {});
    });
  }

  // Expõe API global
  globalThis.extLogSink = {
    init,
    sink,
    flushNow,
  };
})();

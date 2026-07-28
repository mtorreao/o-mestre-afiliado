/**
 * Sink opcional para enviar logs ao backend.
 *
 * Buffer em memória + persistência em chrome.storage.local para sobreviver
 * a restart do service worker. Flush quando:
 *   - buffer passa de MAX_BUFFER (20 entries)
 *   - timer periódico a cada FLUSH_INTERVAL_MS (10s)
 *   - shutdown do SW (chrome.runtime.onSuspend)
 *
 * Erros de rede → descarta batch + log local. NUNCA bloqueia a extensão.
 *
 * API key vem de chrome.storage.local:logsUploadApiKey (configurável
 * em options.html). Se vazia, sink fica inerte mas não dá erro.
 *
 * Toggle on/off: chrome.storage.local:logsUploadEnabled (default false).
 */

(function () {
  'use strict';

  const STORAGE_KEYS = {
    enabled: 'logsUploadEnabled',
    apiKey: 'logsUploadApiKey',
    sessionId: 'logsUploadSessionId',
    buffer: 'logsUploadBuffer',
    lastSentAt: 'logsUploadLastSentAt',
    lastError: 'logsUploadLastError',
    lastBatchSize: 'logsUploadLastBatchSize',
  };

  const FLUSH_INTERVAL_MS = 10_000;
  const MAX_BUFFER = 20;
  const MAX_PERSISTED = 200; // limite em chrome.storage.local
  const MAX_BODY_BYTES = 200_000; // < 256KB limite do servidor
  const ENDPOINT_DEFAULT = 'https://dev.omestreafiliado.com.br/api/extension/logs';
  const EXTENSION_VERSION = '1.6.0';

  const log = globalThis.extLog;
  let state = {
    enabled: false,
    apiKey: '',
    apiUrl: '',
    sessionId: '',
    userEmail: null,
  };
  let timer = null;

  function uuid() {
    // UUID v4 simples
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
          STORAGE_KEYS.enabled,
          STORAGE_KEYS.apiKey,
          STORAGE_KEYS.sessionId,
          'apiUrl', // URL da API configurada em options.html (compartilhada)
          'logsUploadUserEmail',
        ],
        (saved) => {
          state = {
            enabled: saved[STORAGE_KEYS.enabled] === true,
            apiKey: saved[STORAGE_KEYS.apiKey] || '',
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
    // Mantém só as últimas MAX_PERSISTED entries (memória finita do storage).
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
          ? chrome.runtime.getManifest().version_name || null
          : null,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    };
  }

  async function flush() {
    if (!state.enabled || !state.apiKey) return;
    const buffer = await loadBuffer();
    if (buffer.length === 0) return;

    const endpoint = (state.apiUrl || ENDPOINT_DEFAULT).replace(/\/+$/, '') + '/api/extension/logs';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Extension-Logs-Key': state.apiKey,
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
      // Sucesso: limpa buffer + atualiza status
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
    if (!state.enabled) return;

    try {
      await ensureSessionId();
      const entry = buildEntry(level, event, data);
      const buffer = await loadBuffer();
      buffer.push(entry);
      // Limite duro: descarta oldest se passar muito de MAX_PERSISTED
      const trimmed = buffer.length > MAX_PERSISTED ? buffer.slice(-MAX_PERSISTED) : buffer;
      await saveBuffer(trimmed);

      // Flush imediato se passou do threshold
      if (trimmed.length >= MAX_BUFFER) {
        // Não await — fire-and-forget pra não bloquear o caller
        flush().catch(() => {});
      }
    } catch (err) {
      // NUNCA propaga erro — sink é best-effort
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
    if (state.enabled) {
      startTimer();
      log.info('logs-sink.started', { sessionId: state.sessionId });
      // Flush imediato do que sobrou do último restart
      flush().catch(() => {});
    }
  }

  // Observa mudanças nas configs (toggle, API key, apiUrl, email).
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area !== 'local') return;
      const interesting = [
        'logsUploadEnabled',
        'logsUploadApiKey',
        'apiUrl',
        'logsUploadUserEmail',
      ];
      if (!interesting.some((k) => k in changes)) return;
      const wasEnabled = state.enabled;
      await loadState();
      if (state.enabled && !wasEnabled) {
        startTimer();
        log.info('logs-sink.started');
        flush().catch(() => {});
      } else if (!state.enabled && wasEnabled) {
        stopTimer();
        log.info('logs-sink.stopped');
      } else if (state.enabled) {
        // Mudou config enquanto rodando — restart timer
        startTimer();
      }
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

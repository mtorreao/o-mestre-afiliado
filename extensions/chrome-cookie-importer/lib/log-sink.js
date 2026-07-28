/**
 * Sink que envia logs ao backend.
 *
 * Buffer em memória + persistência em chrome.storage.local para sobreviver
 * a restart do service worker. Flush quando:
 *   - buffer passa de MAX_BUFFER (20 entries)
 *   - timer periódico a cada FLUSH_INTERVAL_MS (10s)
 *   - shutdown do SW (chrome.runtime.onSuspend)
 *
 * Erros de rede → mantém buffer e tenta de novo após backoff
 * exponencial. NUNCA bloqueia a extensão.
 *
 * Anti-loop: warns do próprio sink NÃO voltam pra fila (ver
 * lib/log-sink-pure.js → shouldDropEvent). Flush também envia em
 * chunks de MAX_BATCH_SIZE pra respeitar o limite do servidor.
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

  // Logica pura (testavel sem chrome.* / fetch). Carregada via
  // importScripts antes deste arquivo no service worker, ou
  // <script> no content script / popup.
  // Acesso defensivo — em testes (sem chrome) ainda funciona.
  const pure = globalThis.extLogSinkPure;
  if (!pure) {
    // Falha de carregamento — sink fica inerte mas nao quebra a extensao.
    globalThis.extLog?.error?.('logs-sink.pure.missing');
    globalThis.extLogSink = {
      init: async () => {},
      sink: async () => {},
      flushNow: async () => {},
    };
    return;
  }
  const {
    MAX_BATCH_SIZE,
    MAX_BUFFER,
    MAX_PERSISTED,
    BACKOFF_MIN_MS,
    BACKOFF_MAX_MS,
    chunkBatch,
    sanitizeBuffer,
    shouldAllowFlush,
    classifyFlushResponse,
    shouldDropEvent,
  } = pure;

  const STORAGE_KEYS = {
    sessionId: 'logsUploadSessionId',
    buffer: 'logsUploadBuffer',
    lastSentAt: 'logsUploadLastSentAt',
    lastError: 'logsUploadLastError',
    lastBatchSize: 'logsUploadLastBatchSize',
    lastFailedAt: 'logsUploadLastFailedAt',
    flushAttempt: 'logsUploadFlushAttempt',
  };

  const FLUSH_INTERVAL_MS = 10_000;
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
  // Mutex: garante apenas 1 flush em vôo. Sem isso, múltiplas
  // origens (timer + sink + onSuspend + onMessage) competem pelo
  // mesmo buffer no chrome.storage.local e corrompem o estado.
  let flushRunning = false;
  let flushQueued = false;

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
    const sanitized = sanitizeBuffer(buffer, MAX_PERSISTED);
    await chrome.storage.local.set({ [STORAGE_KEYS.buffer]: sanitized });
    return sanitized;
  }

  /** Carrega estado de backoff (lastFailedAt, attempt). */
  async function loadBackoffState() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEYS.lastFailedAt, STORAGE_KEYS.flushAttempt], (saved) => {
        resolve({
          lastFailedAt:
            typeof saved[STORAGE_KEYS.lastFailedAt] === 'number'
              ? saved[STORAGE_KEYS.lastFailedAt]
              : null,
          attempt:
            typeof saved[STORAGE_KEYS.flushAttempt] === 'number'
              ? saved[STORAGE_KEYS.flushAttempt]
              : 0,
        });
      });
    });
  }

  async function clearBackoffState() {
    await chrome.storage.local.set({
      [STORAGE_KEYS.lastFailedAt]: null,
      [STORAGE_KEYS.flushAttempt]: 0,
    });
  }

  async function recordFlushFailure(attempt) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.lastFailedAt]: Date.now(),
      [STORAGE_KEYS.flushAttempt]: attempt,
    });
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

  /**
   * Envia um único chunk ao servidor. Retorna classificação do resultado.
   * Nunca lança — todos os erros são convertidos em { ok: false }.
   */
  async function flushChunk(endpoint, chunk) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Extension-Logs-Key': API_KEY,
        },
        body: JSON.stringify(chunk),
      });
      if (res.ok) {
        return { ok: true, drained: true, retryable: false, status: res.status };
      }
      const errBody = await res.text().catch(() => '');
      return { ...classifyFlushResponse(res.status, errBody), status: res.status, body: errBody };
    } catch (err) {
      return { ok: false, drained: false, retryable: true, error: String(err) };
    }
  }

  /** Envelopa flush() com mutex. Se já há flush em vôo, agenda 1 retry. */
  async function flushGuarded() {
    if (flushRunning) {
      flushQueued = true;
      return;
    }
    flushRunning = true;
    try {
      await flush();
    } finally {
      flushRunning = false;
      if (flushQueued) {
        flushQueued = false;
        // Dispara o retry sem esperar o próximo tick.
        flushGuarded().catch(() => {});
      }
    }
  }

  async function flush() {
    if (!API_KEY) return;
    const rawBuffer = await loadBuffer();
    if (rawBuffer.length === 0) return;

    // Aplica dedup + trim antes de tudo (defesa contra entradas
    // logs-sink.* que possam ter vazado).
    const buffer = sanitizeBuffer(rawBuffer, MAX_PERSISTED);
    if (buffer.length !== rawBuffer.length) {
      await chrome.storage.local.set({ [STORAGE_KEYS.buffer]: buffer });
    }
    if (buffer.length === 0) return;

    // Backoff — se ultima flush falhou, respeita o intervalo.
    const backoffState = await loadBackoffState();
    const decision = shouldAllowFlush({
      lastFailedAt: backoffState.lastFailedAt,
      attempt: backoffState.attempt,
    });
    if (!decision.allowed) {
      // Ainda em cooldown. Timer periódico vai tentar de novo depois.
      return;
    }

    const endpoint = (state.apiUrl || ENDPOINT_DEFAULT).replace(/\/+$/, '') + '/api/extension/logs';

    // CHUNKING — servidor rejeita batches > MAX_BATCH_SIZE.
    const chunks = chunkBatch(buffer, MAX_BATCH_SIZE);
    let totalSent = 0;
    let attempt = backoffState.attempt || 0;
    let allOk = true;

    for (let i = 0; i < chunks.length; i++) {
      const result = await flushChunk(endpoint, chunks[i]);
      if (result.ok) {
        totalSent += chunks[i].length;
        // Limpa state de backoff no primeiro sucesso.
        if (attempt > 0) await clearBackoffState();
        attempt = 0;
        continue;
      }
      allOk = false;
      // Erro de estrutura (4xx não-rate-limit): drena o chunk pra
      // evitar retry infinito. O caller vai manter o que sobrou.
      const drained = result.drained ? chunks[i].length : 0;
      totalSent += drained;
      // Rate limit / 5xx → para e tenta de novo no próximo tick.
      if (!result.drained) break;
      if (result.rateLimited) break;
    }

    // Re-salva buffer removendo o que foi consumido com sucesso.
    if (totalSent > 0) {
      const remaining = buffer.slice(totalSent);
      await chrome.storage.local.set({ [STORAGE_KEYS.buffer]: remaining });
    }

    if (allOk) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.lastSentAt]: new Date().toISOString(),
        [STORAGE_KEYS.lastError]: null,
        [STORAGE_KEYS.lastBatchSize]: totalSent,
      });
      // console.info direto (NÃO extLog — esses logs NAO voltam pro
      // sink, por isso não há risco de loop).
      console.info('[extensão] logs-sink.flush.ok', { count: totalSent });
      return;
    }

    // Falhou em algum chunk — incrementa attempt e grava estado.
    attempt += 1;
    await recordFlushFailure(attempt);
    await chrome.storage.local.set({
      [STORAGE_KEYS.lastError]: 'HTTP ou network (ver logs-sink)',
    });
    // console.warn direto (mesma razão: NAO volta pro sink).
    console.warn('[extensão] logs-sink.flush.failed', {
      attempt,
      nextRetryIn: 'ver computeBackoffMs',
    });
  }

  function startTimer() {
    if (timer) clearInterval(timer);
    timer = setInterval(flushGuarded, FLUSH_INTERVAL_MS);
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

    // Anti-loop: NUNCA persistir eventos do proprio sink.
    if (shouldDropEvent(event)) return;

    try {
      await ensureSessionId();
      const entry = buildEntry(level, event, data);
      const buffer = await loadBuffer();
      buffer.push(entry);
      const trimmed = buffer.length > MAX_PERSISTED ? buffer.slice(-MAX_PERSISTED) : buffer;
      await saveBuffer(trimmed);

      if (trimmed.length >= MAX_BUFFER) {
        flushGuarded().catch(() => {});
      }
    } catch (err) {
      // console.error direto — NAO volta pro sink.
      console.error('[extensão] logs-sink.append.failed', String(err));
    }
  }

  /** Flush imediato (botão "Enviar agora" do popup). */
  async function flushNow() {
    return flushGuarded();
  }

  async function init() {
    await loadState();
    if (API_KEY) {
      // Limpa buffer legado de versoes bugadas (1.6.21 e anteriores)
      // que podiam persistir 200 entradas stuck. Aplica o sanitize
      // ANTES de qualquer flush.
      const raw = await loadBuffer();
      const clean = sanitizeBuffer(raw, MAX_PERSISTED);
      if (clean.length !== raw.length || clean.length > MAX_BATCH_SIZE) {
        // Se sobrou buffer grande OU tinha entradas logs-sink.*,
        // força reset e deixa o servidor receber um batch novo
        // (chunks respeitam MAX_BATCH_SIZE).
        await chrome.storage.local.set({ [STORAGE_KEYS.buffer]: clean });
      }
      startTimer();
      log.info('logs-sink.started', { sessionId: state.sessionId });
      // Flush imediato do que sobrou do último restart
      flushGuarded().catch(() => {});
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
      flushGuarded().catch(() => {});
    });
  }

  // Expõe API global
  globalThis.extLogSink = {
    init,
    sink,
    flushNow,
  };
})();

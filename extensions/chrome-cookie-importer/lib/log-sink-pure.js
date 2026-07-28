/**
 * Lógica pura do log-sink — testável sem chrome.* / fetch / storage.
 *
 * CARREGADO COMO CLASSIC SCRIPT (não ESM):
 *   - Service worker: importScripts('lib/log-sink-pure.js')
 *   - Content script: <script src="lib/log-sink-pure.js">
 *   - Popup:          <script src="lib/log-sink-pure.js">
 *
 * Por isso NÃO usa `export`/`import` (sintaxe ESM quebraria o
 * parser classic e o SW não subiria). Tudo é publicado no
 * globalThis.extLogSinkPure.
 *
 * Para testes bun, o arquivo é carregado via `eval` num contexto
 * classic — ver tests/load-classic.js.
 *
 * Três problemas resolvidos aqui (causas do loop infinito observado
 * em produção em 2026-07-28):
 *
 *   1. CHUNKING — servidor rejeita batches > MAX_BATCH_SIZE (100).
 *      Cliente persistia até MAX_PERSISTED (200) e mandava o buffer
 *      inteiro em um único POST. Corta em chunks e drena sequencialmente.
 *
 *   2. BACKOFF — quando o servidor falha, não tenta de novo a cada
 *      log.info() subsequente. Espera exponential backoff antes do
 *      próximo flush.
 *
 *   3. DEDUP DO LOOP — warns do próprio sink (`logs-sink.flush.failed`)
 *      voltam pro sink → buffer cresce → flush falha → mais warn →
 *      loop. Solução: erros de flush NÃO são enviados ao sink
 *      (apenas emito um console.warn único). E qualquer entrada de
 *      log cujo `event` começa com `logs-sink.` é descartada no
 *      momento de persistir (defesa em profundidade).
 */

(function () {
  'use strict';

  /** Limite do servidor — single source of truth para o chunk size. */
  const MAX_BATCH_SIZE = 100;

  /** Tamanho máximo persistido em chrome.storage.local. */
  const MAX_PERSISTED = 200;

  /** Limite que dispara flush automático (tamanho do buffer). */
  const MAX_BUFFER = 20;

  /** Backoff mínimo/máximo entre tentativas após falha. */
  const BACKOFF_MIN_MS = 30_000; // 30s
  const BACKOFF_MAX_MS = 5 * 60_000; // 5min

  /** Eventos internos do sink que NUNCA devem ir pro buffer. */
  const INTERNAL_EVENT_PREFIX = 'logs-sink.';

  /**
   * Decide se um evento deve ser descartado (loop breaker).
   * Qualquer coisa do próprio sink não volta pro sink.
   */
  function shouldDropEvent(event) {
    if (typeof event !== 'string' || event.length === 0) return true;
    return event.startsWith(INTERNAL_EVENT_PREFIX);
  }

  /**
   * Fatia `buffer` em chunks de no máximo `size` elementos (default 100).
   * Útil pra chamar `flushChunk(chunk)` em sequência.
   */
  function chunkBatch(buffer, size) {
    if (size === undefined) size = MAX_BATCH_SIZE;
    if (!Array.isArray(buffer) || buffer.length === 0) return [];
    const out = [];
    for (let i = 0; i < buffer.length; i += size) {
      out.push(buffer.slice(i, i + size));
    }
    return out;
  }

  /**
   * Aplica dedup + trim do buffer.
   * - Remove eventos internos (logs-sink.*)
   * - Mantém só os últimos MAX_PERSISTED
   *
   * Mutates-free — retorna novo array.
   */
  function sanitizeBuffer(buffer, maxPersisted) {
    if (maxPersisted === undefined) maxPersisted = MAX_PERSISTED;
    if (!Array.isArray(buffer)) return [];
    const filtered = buffer.filter(function (entry) {
      return !shouldDropEvent(entry && entry.event);
    });
    if (filtered.length <= maxPersisted) return filtered;
    return filtered.slice(-maxPersisted);
  }

  /**
   * Calcula próximo delay de backoff exponencial.
   * `attempt` é 1-indexed (1ª falha, 2ª falha, ...).
   * Cresce: 30s, 60s, 120s, 240s, 300s (cap em BACKOFF_MAX_MS).
   */
  function computeBackoffMs(attempt, minMs, maxMs) {
    if (minMs === undefined) minMs = BACKOFF_MIN_MS;
    if (maxMs === undefined) maxMs = BACKOFF_MAX_MS;
    if (!Number.isFinite(attempt) || attempt < 1) return minMs;
    // 2^(attempt-1) com cap
    const factor = Math.min(attempt - 1, 10); // evita overflow
    const raw = minMs * Math.pow(2, factor);
    return Math.min(raw, maxMs);
  }

  /**
   * Decide se um flush deve ser permitido agora, considerando o último
   * timestamp de falha e o backoff. Retorna { allowed, waitMs }.
   */
  function shouldAllowFlush(opts) {
    const lastFailedAt = opts && opts.lastFailedAt;
    const attempt = opts && opts.attempt;
    const now = (opts && opts.now) || Date.now();
    if (!lastFailedAt) return { allowed: true, waitMs: 0 };
    const wait = computeBackoffMs(attempt);
    const elapsed = now - lastFailedAt;
    if (elapsed >= wait) return { allowed: true, waitMs: 0 };
    return { allowed: false, waitMs: wait - elapsed };
  }

  /**
   * Resultado do flush — usado pelo caller pra atualizar o state.
   *  - ok: true se status 2xx
   *  - drained: entries consumidas do buffer (true em sucesso; em 4xx
   *    estrutural também pra evitar retry eterno)
   *  - retryable: false em 4xx de validação (não adianta re-tentar
   *    o mesmo payload); true em 5xx/network
   */
  function classifyFlushResponse(status, body) {
    if (status >= 200 && status < 300) {
      return { ok: true, drained: true, retryable: false };
    }
    // Erros estruturais do servidor — não adianta re-tentar
    if (status === 400 || status === 401 || status === 403 || status === 413) {
      return { ok: false, drained: true, retryable: false };
    }
    // Rate limit — drenar e esperar mais (caller decide)
    if (status === 429) {
      return { ok: false, drained: true, retryable: true, rateLimited: true };
    }
    // 5xx / network — manter buffer e tentar de novo
    return { ok: false, drained: false, retryable: true };
  }

  // Publica no globalThis pra funcionar em <script>, importScripts
  // e qualquer outro contexto classic.
  // (extensão MV3 não suporta ESM em content scripts / service worker).
  const _ns = {
    MAX_BATCH_SIZE: MAX_BATCH_SIZE,
    MAX_BUFFER: MAX_BUFFER,
    MAX_PERSISTED: MAX_PERSISTED,
    BACKOFF_MIN_MS: BACKOFF_MIN_MS,
    BACKOFF_MAX_MS: BACKOFF_MAX_MS,
    chunkBatch: chunkBatch,
    sanitizeBuffer: sanitizeBuffer,
    shouldDropEvent: shouldDropEvent,
    computeBackoffMs: computeBackoffMs,
    shouldAllowFlush: shouldAllowFlush,
    classifyFlushResponse: classifyFlushResponse,
  };
  if (typeof globalThis !== 'undefined') {
    globalThis.extLogSinkPure = _ns;
  }
})();

/**
 * Helper puro para validação e rate limit de logs da extensão.
 *
 * Sem I/O — testável sem mock. Usado pela rota POST /api/extension/logs.
 */

import { ALLOWED_LOG_LEVELS } from '@omestre/shared';
import type { ExtensionLogEntry, ExtensionLogLevel } from '@omestre/shared';

export { ALLOWED_LOG_LEVELS };
export type { ExtensionLogEntry, ExtensionLogLevel };

export const MAX_BATCH_SIZE = 100;
export const MAX_TOTAL_BODY_BYTES = 256_000; // 256KB total do body
export const MAX_DATA_KEYS = 50;
export const MAX_DATA_VALUE_LENGTH = 1_000;
export const RATE_LIMIT_MAX = 5; // max requests
export const RATE_LIMIT_WINDOW_MS = 10_000; // 10s

/** Erro de validação estruturado. */
export class LogValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'LogValidationError';
  }
}

/**
 * Valida uma entrada individual do log.
 * Lança LogValidationError se inválida.
 */
export function validateLogEntry(raw: unknown): ExtensionLogEntry {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new LogValidationError('entry-not-object', 'Entry deve ser um objeto');
  }
  const e = raw as Record<string, unknown>;

  const sessionId = e.sessionId;
  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 100) {
    throw new LogValidationError('sessionId-invalid', 'sessionId deve ser string 1-100 chars');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    throw new LogValidationError('sessionId-charset', 'sessionId só permite [a-zA-Z0-9_-]');
  }

  const level = e.level;
  if (typeof level !== 'string' || !ALLOWED_LOG_LEVELS.includes(level as ExtensionLogLevel)) {
    throw new LogValidationError(
      'level-invalid',
      `level deve ser um de: ${ALLOWED_LOG_LEVELS.join(', ')}`,
    );
  }

  const event = e.event;
  if (typeof event !== 'string' || event.length === 0 || event.length > 200) {
    throw new LogValidationError('event-invalid', 'event deve ser string 1-200 chars');
  }

  const extensionVersion = e.extensionVersion;
  if (
    typeof extensionVersion !== 'string' ||
    extensionVersion.length === 0 ||
    extensionVersion.length > 20
  ) {
    throw new LogValidationError(
      'extensionVersion-invalid',
      'extensionVersion deve ser string 1-20 chars',
    );
  }

  const userEmail =
    typeof e.userEmail === 'string' && e.userEmail.length > 0 ? e.userEmail.slice(0, 320) : null;

  const chromeVersion =
    typeof e.chromeVersion === 'string' && e.chromeVersion.length > 0
      ? e.chromeVersion.slice(0, 50)
      : null;

  const userAgent =
    typeof e.userAgent === 'string' && e.userAgent.length > 0 ? e.userAgent.slice(0, 500) : null;

  const data = validateData(e.data);

  return {
    sessionId,
    userEmail,
    level: level as ExtensionLogLevel,
    event,
    data,
    extensionVersion,
    chromeVersion,
    userAgent,
  };
}

function validateData(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new LogValidationError('data-not-object', 'data deve ser objeto, null ou undefined');
  }
  const data = raw as Record<string, unknown>;
  const keys = Object.keys(data);
  if (keys.length > MAX_DATA_KEYS) {
    throw new LogValidationError('data-too-many-keys', `data tem mais de ${MAX_DATA_KEYS} chaves`);
  }
  for (const k of keys) {
    if (k.length > 100) {
      throw new LogValidationError('data-key-too-long', `chave '${k.slice(0, 20)}...' > 100 chars`);
    }
    const v = data[k];
    if (typeof v === 'string' && v.length > MAX_DATA_VALUE_LENGTH) {
      throw new LogValidationError(
        'data-value-too-long',
        `valor de '${k}' > ${MAX_DATA_VALUE_LENGTH} chars`,
      );
    }
  }
  return data;
}

/**
 * Valida um batch inteiro. Retorna array de entries válidas ou lança.
 */
export function validateLogBatch(raw: unknown): ExtensionLogEntry[] {
  if (!Array.isArray(raw)) {
    throw new LogValidationError('batch-not-array', 'Body deve ser um array de entries');
  }
  if (raw.length === 0) {
    throw new LogValidationError('batch-empty', 'Batch não pode ser vazio');
  }
  if (raw.length > MAX_BATCH_SIZE) {
    throw new LogValidationError(
      'batch-too-large',
      `Batch tem ${raw.length} entries, máximo ${MAX_BATCH_SIZE}`,
    );
  }
  // Verifica tamanho total aproximado (evita payload gigante)
  const totalBytes = JSON.stringify(raw).length;
  if (totalBytes > MAX_TOTAL_BODY_BYTES) {
    throw new LogValidationError(
      'body-too-large',
      `Body tem ${totalBytes} bytes, máximo ${MAX_TOTAL_BODY_BYTES}`,
    );
  }
  return raw.map(validateLogEntry);
}

/** Estado de rate limit por sessionId. */
export class RateLimiter {
  readonly hits = new Map<string, number[]>();

  constructor(
    private readonly maxRequests = RATE_LIMIT_MAX,
    private readonly windowMs = RATE_LIMIT_WINDOW_MS,
  ) {}

  /** Verifica se a request é permitida. Retorna true se pode, false se excedeu. */
  check(sessionId: string, now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(sessionId) || []).filter((t) => t > cutoff);
    if (recent.length >= this.maxRequests) {
      this.hits.set(sessionId, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(sessionId, recent);
    return true;
  }

  /** Limpa entradas antigas (evita unbounded growth). */
  prune(now: number = Date.now()): void {
    const cutoff = now - this.windowMs;
    for (const [k, times] of this.hits) {
      const recent = times.filter((t) => t > cutoff);
      if (recent.length === 0) this.hits.delete(k);
      else this.hits.set(k, recent);
    }
  }
}

import { describe, expect, test } from 'bun:test';
import {
  buildAuthHeaders,
  cookieMetadata,
  deduplicateCookies,
  isMercadoLivreUrl,
  normalizeApiUrl,
  redactSensitiveText,
  serializeCookies,
} from '../lib/pure.js';
import {
  BACKOFF_MAX_MS,
  BACKOFF_MIN_MS,
  MAX_BATCH_SIZE,
  MAX_BUFFER,
  MAX_PERSISTED,
  chunkBatch,
  classifyFlushResponse,
  computeBackoffMs,
  sanitizeBuffer,
  shouldAllowFlush,
  shouldDropEvent,
} from './load-pure.cjs';

describe('extension pure helpers', () => {
  test('normalizes a valid API URL and rejects credentials/query data', () => {
    expect(normalizeApiUrl(' https://example.com/// ')).toBe('https://example.com');
    expect(normalizeApiUrl('https://user:pass@example.com')).toBe('');
    expect(normalizeApiUrl('https://example.com?token=secret')).toBe('');
    expect(normalizeApiUrl('not-a-url')).toBe('');
  });

  test('detects supported Mercado Livre domains without substring false positives', () => {
    expect(isMercadoLivreUrl('https://www.mercadolivre.com.br/MLB-123')).toBe(true);
    expect(isMercadoLivreUrl('https://produto.mercadolibre.com/MLA-123')).toBe(true);
    expect(isMercadoLivreUrl('https://notmercadolivre.com.br/')).toBe(false);
    expect(isMercadoLivreUrl('not-a-url')).toBe(false);
  });

  test('deduplicates cookies by name and path', () => {
    const cookies = deduplicateCookies([
      { name: 'sid', value: 'old', path: '/', domain: '.mercadolivre.com.br' },
      { name: 'sid', value: 'new', path: '/', domain: '.mercadolivre.com.br' },
      { name: 'sid', value: 'nested', path: '/afiliados', domain: '.mercadolivre.com.br' },
    ]);
    expect(cookies).toHaveLength(2);
    expect(cookies[0].value).toBe('new');
  });

  test('serializes cookies while metadata contains no cookie values', () => {
    const cookies = [
      { name: 'sid', value: 'secret-session', path: '/', domain: '.mercadolivre.com.br' },
    ];
    expect(serializeCookies(cookies)).toBe('sid=secret-session');
    const metadata = cookieMetadata(cookies);
    expect(metadata).toEqual({ count: 1, domains: ['.mercadolivre.com.br'] });
    expect(JSON.stringify(metadata)).not.toContain('secret-session');
  });

  test('redacts sensitive values from diagnostic text', () => {
    const redacted = redactSensitiveText(
      'sessionCookies=secret-session token=long-secret-token-value',
    );
    expect(redacted).not.toContain('secret-session');
    expect(redacted).not.toContain('long-secret-token-value');
    expect(redacted).toContain('[redacted]');
  });

  test('buildAuthHeaders includes Bearer token when present', () => {
    const headers = buildAuthHeaders('jwt-token-value');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Authorization']).toBe('Bearer jwt-token-value');
  });

  test('buildAuthHeaders omits Authorization when token is empty', () => {
    expect(buildAuthHeaders('')['Authorization']).toBeUndefined();
    expect(buildAuthHeaders(null)['Authorization']).toBeUndefined();
    expect(buildAuthHeaders(undefined)['Authorization']).toBeUndefined();
  });
});

describe('log-sink-pure: anti-loop guards', () => {
  test('exposes sane defaults', () => {
    expect(MAX_BATCH_SIZE).toBe(100);
    expect(MAX_BUFFER).toBe(20);
    expect(MAX_PERSISTED).toBe(200);
    expect(BACKOFF_MIN_MS).toBe(30_000);
    expect(BACKOFF_MAX_MS).toBe(300_000);
  });

  test('shouldDropEvent blocks all internal logs-sink.* events', () => {
    expect(shouldDropEvent('logs-sink.flush.failed')).toBe(true);
    expect(shouldDropEvent('logs-sink.flush.ok')).toBe(true);
    expect(shouldDropEvent('logs-sink.append.failed')).toBe(true);
    expect(shouldDropEvent('logs-sink.pure.missing')).toBe(true);
    expect(shouldDropEvent('auth-sync.token.found')).toBe(false);
    expect(shouldDropEvent('service-worker.boot')).toBe(false);
  });

  test('shouldDropEvent handles garbage defensively', () => {
    expect(shouldDropEvent(undefined)).toBe(true);
    expect(shouldDropEvent(null)).toBe(true);
    expect(shouldDropEvent(42)).toBe(true);
    expect(shouldDropEvent('')).toBe(true);
  });

  test('chunkBatch slices buffer into MAX_BATCH_SIZE chunks', () => {
    const buf = Array.from({ length: 250 }, (_, i) => ({ event: `e${i}` }));
    const chunks = chunkBatch(buf, 100);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(100);
    expect(chunks[1]).toHaveLength(100);
    expect(chunks[2]).toHaveLength(50);
    // garante que nenhum chunk excede o limite do servidor
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
  });

  test('chunkBatch handles empty/garbage input', () => {
    expect(chunkBatch([])).toEqual([]);
    expect(chunkBatch(null)).toEqual([]);
    expect(chunkBatch(undefined)).toEqual([]);
  });

  test('sanitizeBuffer drops internal events and trims to maxPersisted', () => {
    const buf = [
      { event: 'auth-sync.token.found' },
      { event: 'logs-sink.flush.failed' }, // deve sumir
      { event: 'verify-auth.success' },
      { event: 'logs-sink.flush.ok' }, // deve sumir
      { event: 'service-worker.boot' },
    ];
    const cleaned = sanitizeBuffer(buf, MAX_PERSISTED);
    expect(cleaned.map((e) => e.event)).toEqual([
      'auth-sync.token.found',
      'verify-auth.success',
      'service-worker.boot',
    ]);
  });

  test('sanitizeBuffer trims to last N when over the cap', () => {
    const buf = Array.from({ length: 250 }, (_, i) => ({ event: `e${i}` }));
    const cleaned = sanitizeBuffer(buf, 200);
    expect(cleaned).toHaveLength(200);
    expect(cleaned[0].event).toBe('e50');
    expect(cleaned[cleaned.length - 1].event).toBe('e249');
  });

  test('sanitizeBuffer tolerates non-array input', () => {
    expect(sanitizeBuffer(null)).toEqual([]);
    expect(sanitizeBuffer(undefined)).toEqual([]);
  });
});

describe('log-sink-pure: backoff', () => {
  test('computeBackoffMs grows exponentially from the minimum', () => {
    expect(computeBackoffMs(1)).toBe(BACKOFF_MIN_MS); // 30s
    expect(computeBackoffMs(2)).toBe(BACKOFF_MIN_MS * 2); // 60s
    expect(computeBackoffMs(3)).toBe(BACKOFF_MIN_MS * 4); // 120s
    expect(computeBackoffMs(4)).toBe(BACKOFF_MIN_MS * 8); // 240s
  });

  test('computeBackoffMs caps at BACKOFF_MAX_MS', () => {
    expect(computeBackoffMs(5)).toBe(BACKOFF_MAX_MS); // 300s (cap)
    expect(computeBackoffMs(20)).toBe(BACKOFF_MAX_MS);
  });

  test('computeBackoffMs returns minMs for invalid input', () => {
    expect(computeBackoffMs(0)).toBe(BACKOFF_MIN_MS);
    expect(computeBackoffMs(-1)).toBe(BACKOFF_MIN_MS);
    expect(computeBackoffMs(NaN)).toBe(BACKOFF_MIN_MS);
  });

  test('shouldAllowFlush allows immediately when no prior failure', () => {
    const d = shouldAllowFlush({ lastFailedAt: null, attempt: 0 });
    expect(d.allowed).toBe(true);
    expect(d.waitMs).toBe(0);
  });

  test('shouldAllowFlush blocks until backoff window elapses', () => {
    const lastFailedAt = 1000;
    const now = lastFailedAt + 5_000; // 5s depois
    const d = shouldAllowFlush({ lastFailedAt, attempt: 1, now });
    // attempt 1 -> 30s, faltam 25s
    expect(d.allowed).toBe(false);
    expect(d.waitMs).toBe(BACKOFF_MIN_MS - 5_000);
  });

  test('shouldAllowFlush unblocks after the window', () => {
    const lastFailedAt = 1000;
    const now = lastFailedAt + BACKOFF_MIN_MS + 1;
    const d = shouldAllowFlush({ lastFailedAt, attempt: 1, now });
    expect(d.allowed).toBe(true);
  });
});

describe('log-sink-pure: classifyFlushResponse', () => {
  test('2xx is success', () => {
    expect(classifyFlushResponse(200)).toEqual({
      ok: true,
      drained: true,
      retryable: false,
    });
    expect(classifyFlushResponse(204)).toEqual({
      ok: true,
      drained: true,
      retryable: false,
    });
  });

  test('400/401/403/413 drain to avoid retry loop on bad payload', () => {
    for (const status of [400, 401, 403, 413]) {
      const r = classifyFlushResponse(status, 'batch too large');
      expect(r.ok).toBe(false);
      expect(r.drained).toBe(true);
      expect(r.retryable).toBe(false);
    }
  });

  test('429 drains and marks rate-limited (caller backs off longer)', () => {
    const r = classifyFlushResponse(429, 'slow down');
    expect(r.ok).toBe(false);
    expect(r.drained).toBe(true);
    expect(r.retryable).toBe(true);
    expect(r.rateLimited).toBe(true);
  });

  test('5xx keeps the buffer (drained=false) so caller can retry', () => {
    const r = classifyFlushResponse(503, 'server down');
    expect(r.ok).toBe(false);
    expect(r.drained).toBe(false);
    expect(r.retryable).toBe(true);
    expect(r.rateLimited).toBeUndefined();
  });
});

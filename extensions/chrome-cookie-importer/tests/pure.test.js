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

/**
 * Testes das funções PURAS de parsing de query / resposta HTTP do
 * servidor de métricas (metrics-server-pure.ts).
 *
 * Cobre promLabelKey, parseQueryInt, parseDlqListQuery,
 * parseRequiredQueryParam e buildInfoEndpoints — sem Bun.serve.
 */
import { describe, expect, it } from 'bun:test';
import {
  buildInfoEndpoints,
  parseDlqListQuery,
  parseQueryInt,
  parseRequiredQueryParam,
  promLabelKey,
} from './metrics-server-pure.ts';

describe('promLabelKey', () => {
  it('junta valores por vírgula', () => {
    expect(promLabelKey({ instance: 'a', status: 'ok' })).toBe('a,ok');
  });

  it('vazio sem labels', () => {
    expect(promLabelKey({})).toBe('');
  });
});

describe('parseQueryInt', () => {
  it('usa fallback quando null', () => {
    expect(parseQueryInt(null, 20)).toBe(20);
  });

  it('parseia valor válido', () => {
    expect(parseQueryInt('42', 20)).toBe(42);
  });

  it('usa fallback quando NaN', () => {
    expect(parseQueryInt('abc', 20)).toBe(20);
  });

  it('zero é válido (não confundido com fallback)', () => {
    expect(parseQueryInt('0', 20)).toBe(0);
  });
});

describe('parseDlqListQuery', () => {
  it('defaults (offset=0, limit=20)', () => {
    const sp = new URLSearchParams('');
    expect(parseDlqListQuery(sp)).toEqual({ offset: 0, limit: 20 });
  });

  it('lê offset e limit', () => {
    const sp = new URLSearchParams('offset=5&limit=50');
    expect(parseDlqListQuery(sp)).toEqual({ offset: 5, limit: 50 });
  });

  it('inválidos caem no default', () => {
    const sp = new URLSearchParams('offset=abc&limit=xyz');
    expect(parseDlqListQuery(sp)).toEqual({ offset: 0, limit: 20 });
  });
});

describe('parseRequiredQueryParam', () => {
  it('retorna valor presente', () => {
    const sp = new URLSearchParams('id=abc');
    expect(parseRequiredQueryParam(sp, 'id')).toBe('abc');
  });

  it('null quando ausente', () => {
    const sp = new URLSearchParams('');
    expect(parseRequiredQueryParam(sp, 'id')).toBeNull();
  });

  it('null quando vazio', () => {
    const sp = new URLSearchParams('id=');
    expect(parseRequiredQueryParam(sp, 'id')).toBeNull();
  });
});

describe('buildInfoEndpoints', () => {
  it('lista os endpoints expostos', () => {
    const eps = buildInfoEndpoints('ingestor');
    expect(eps).toContain('/metrics');
    expect(eps).toContain('/health');
    expect(eps).toContain('/status');
    expect(eps).toContain('/dlq');
    expect(eps).toContain('/dlq/count');
    expect(eps).toContain('/dlq/requeue?id=...');
    expect(eps).toContain('/dlq/remove?id=...');
    expect(eps).toContain('/dlq/purge');
  });

  it('não depende do serviceName (lista fixa)', () => {
    expect(buildInfoEndpoints('x')).toEqual(buildInfoEndpoints('y'));
  });
});

/**
 * Testes das funções PURAS de verificação de link de afiliado.
 *
 * Cobrem 100% da lógica de decisão (comparação de parâmetros) sem
 * precisar de DB/Redis/repositórios — a camada de I/O vive em
 * `link-verifier.ts`, e estas funções recebem os dados já resolvidos.
 *
 * As funções testadas:
 *   - extractAffiliateParams
 *   - verifyMlParams
 *   - verifyAmazonTag
 *   - extractUserIdFromInstanceId
 */
import { describe, it, expect } from 'bun:test';
import type { AmazonTrackingId } from '@omestre/db';
import {
  extractAffiliateParams,
  verifyMlParams,
  verifyAmazonTag,
  extractUserIdFromInstanceId,
  extractMagaluStoreSlug,
  verifyMagaluStoreSlug,
} from '../link-verifier-pure.ts';

// ─── extractAffiliateParams ──────────────────────────────────────────

describe('extractAffiliateParams', () => {
  it('extrai meliid, melitat e matt_word de URL ML', () => {
    const p = extractAffiliateParams(
      'https://produto.mercadolivre.com.br/MLB-123?meliid=abc&melitat=mtag&matt_word=mtag',
    );
    expect(p).toEqual({
      meliid: 'abc',
      melitat: 'mtag',
      mattWord: 'mtag',
      tag: null,
    });
  });

  it('extrai tag de URL Amazon', () => {
    const p = extractAffiliateParams('https://amzn.to/x?tag=meusite-20');
    expect(p.tag).toBe('meusite-20');
    expect(p.meliid).toBeNull();
  });

  it('retorna tudo null quando não há parâmetros de afiliação', () => {
    const p = extractAffiliateParams('https://example.com/p/123');
    expect(p).toEqual({
      meliid: null,
      melitat: null,
      mattWord: null,
      tag: null,
    });
  });

  it('lança erro para URL inválida', () => {
    expect(() => extractAffiliateParams('não é url')).toThrow();
  });
});

// ─── verifyMlParams ───────────────────────────────────────────────────

describe('verifyMlParams', () => {
  const affiliate = { meliid: 'abc', melitat: 'mtag' };

  it('é válido quando nenhum parâmetro ML está presente na URL', () => {
    const extracted = { meliid: null, melitat: null, mattWord: null, tag: null };
    expect(verifyMlParams(extracted, affiliate)).toEqual({ valid: true });
  });

  it('é válido quando todos os parâmetros conferem', () => {
    const extracted = { meliid: 'abc', melitat: 'mtag', mattWord: 'mtag', tag: null };
    expect(verifyMlParams(extracted, affiliate)).toEqual({ valid: true });
  });

  it('é válido quando só meliid confere (melitat ausente na URL)', () => {
    const extracted = { meliid: 'abc', melitat: null, mattWord: null, tag: null };
    expect(verifyMlParams(extracted, affiliate)).toEqual({ valid: true });
  });

  it('é inválido quando melitat diverge', () => {
    const extracted = { meliid: null, melitat: 'OUTRO', mattWord: null, tag: null };
    const r = verifyMlParams(extracted, affiliate);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('melitat não corresponde');
    expect(r.reason).toContain('esperado mtag');
    expect(r.reason).toContain('recebido OUTRO');
  });

  it('é inválido quando matt_word diverge do melitat do afiliado', () => {
    const extracted = { meliid: null, melitat: null, mattWord: 'OUTRO', tag: null };
    const r = verifyMlParams(extracted, affiliate);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('matt_word não corresponde');
  });

  it('é inválido quando meliid diverge', () => {
    const extracted = { meliid: 'XYZ', melitat: null, mattWord: null, tag: null };
    const r = verifyMlParams(extracted, affiliate);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('meliid não corresponde');
  });

  it('é inválido quando melitat presente na URL mas afiliado não tem melitat', () => {
    const extracted = { meliid: null, melitat: 'mtag', mattWord: null, tag: null };
    const r = verifyMlParams(extracted, { meliid: 'abc', melitat: null });
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('afiliado não possui melitat configurado');
  });

  it('é inválido quando matt_word presente na URL mas afiliado não tem melitat', () => {
    const extracted = { meliid: null, melitat: null, mattWord: 'mtag', tag: null };
    const r = verifyMlParams(extracted, { meliid: 'abc', melitat: null });
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('matt_word presente na URL mas afiliado não possui melitat');
  });

  it('é inválido quando meliid presente na URL mas afiliado não tem meliid', () => {
    const extracted = { meliid: 'abc', melitat: null, mattWord: null, tag: null };
    const r = verifyMlParams(extracted, { meliid: null, melitat: 'mtag' });
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('meliid presente na URL mas afiliado não possui meliid');
  });

  it('é válido quando matt_word confere com melitat do afiliado (URL sem meliid)', () => {
    const extracted = { meliid: null, melitat: null, mattWord: 'mtag', tag: null };
    expect(verifyMlParams(extracted, affiliate)).toEqual({ valid: true });
  });

  it('trata afiliado totalmente vazio (nulos) — URL sem params é válido', () => {
    const extracted = { meliid: null, melitat: null, mattWord: null, tag: null };
    expect(verifyMlParams(extracted, { meliid: null, melitat: null })).toEqual({
      valid: true,
    });
  });
});

// ─── verifyAmazonTag ──────────────────────────────────────────────────

function makeTrackingIds(tags: Array<[string, boolean]>): AmazonTrackingId[] {
  return tags.map(([tag, active], i) => ({
    tag,
    region: 'BR',
    active,
    isDefault: i === 0,
    createdAt: '2024-01-01T00:00:00.000Z',
  }));
}

describe('verifyAmazonTag', () => {
  it('é válido quando não há tag na URL', () => {
    expect(verifyAmazonTag(null, makeTrackingIds([['meusite-20', true]]))).toEqual({
      valid: true,
    });
  });

  it('é válido quando tag está entre os ativos', () => {
    const ids = makeTrackingIds([
      ['meusite-20', true],
      ['meusite-tg-20', true],
    ]);
    expect(verifyAmazonTag('meusite-tg-20', ids)).toEqual({ valid: true });
  });

  it('é inválido quando tag não está nos ativos', () => {
    const ids = makeTrackingIds([['meusite-20', true]]);
    const r = verifyAmazonTag('outra-20', ids);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('Amazon tag não corresponde');
    expect(r.reason).toContain('meusite-20');
  });

  it('rejeita tag que só existe em tracking ID inativo (active=false)', () => {
    // Afiliado TEM tracking IDs cadastrados, mas a tag solicitada está
    // apenas num ID inativo → deve ser inválido (não é fail-open).
    const ids = makeTrackingIds([['meusite-20', false]]);
    const r = verifyAmazonTag('meusite-20', ids);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('Amazon tag não corresponde');
  });

  it('é válido (fail-open) quando afiliado não tem tracking IDs', () => {
    expect(verifyAmazonTag('qualquer-20', [])).toEqual({ valid: true });
  });

  it('é válido (fail-open) quando trackingIds é undefined', () => {
    expect(verifyAmazonTag('qualquer-20', undefined as unknown as AmazonTrackingId[])).toEqual({
      valid: true,
    });
  });

  it('confere tag mesmo com múltiplos tracking IDs misturados', () => {
    const ids = makeTrackingIds([
      ['a-20', false],
      ['b-20', true],
      ['c-20', true],
    ]);
    expect(verifyAmazonTag('c-20', ids)).toEqual({ valid: true });
    expect(verifyAmazonTag('a-20', ids).valid).toBe(false);
  });
});

// ─── extractUserIdFromInstanceId ──────────────────────────────────────

describe('extractUserIdFromInstanceId', () => {
  it('extrai userId de user-{id}', () => {
    expect(extractUserIdFromInstanceId('user-42')).toBe(42);
  });

  it('retorna null para instância sem formato user-', () => {
    expect(extractUserIdFromInstanceId('instancia-x')).toBeNull();
  });

  it('retorna null para valor vazio', () => {
    expect(extractUserIdFromInstanceId('')).toBeNull();
  });

  it('retorna null para undefined', () => {
    expect(extractUserIdFromInstanceId(undefined)).toBeNull();
  });

  it('retorna null para null', () => {
    expect(extractUserIdFromInstanceId(null)).toBeNull();
  });

  it('retorna null quando userId não é numérico', () => {
    expect(extractUserIdFromInstanceId('user-abc')).toBeNull();
  });
});

// ─── verifyMagaluStoreSlug / extractMagaluStoreSlug ───────────────────

describe('verifyMagaluStoreSlug', () => {
  const affiliate = { storeSlug: 'magazinetorre' };

  it('é válido quando não há slug na URL', () => {
    expect(verifyMagaluStoreSlug(null, affiliate)).toEqual({ valid: true });
  });

  it('é válido quando o slug confere com o afiliado', () => {
    expect(verifyMagaluStoreSlug('magazinetorre', affiliate)).toEqual({ valid: true });
  });

  it('é inválido quando o slug diverge', () => {
    const r = verifyMagaluStoreSlug('outraloja', affiliate);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('Magalu store_slug não corresponde');
    expect(r.reason).toContain('esperado magazinetorre');
    expect(r.reason).toContain('recebido outraloja');
  });

  it('é inválido quando o slug difere apenas por caixa (case-sensitive)', () => {
    expect(verifyMagaluStoreSlug('MagazineTorre', affiliate).valid).toBe(false);
  });
});

describe('extractMagaluStoreSlug', () => {
  it('extrai o slug de URL magazinevoce.com.br/{slug}/...', () => {
    expect(
      extractMagaluStoreSlug(
        'https://www.magazinevoce.com.br/magazinetorre/eliptico-x/p/eadk91754h/es/elet/',
      ),
    ).toBe('magazinetorre');
  });

  it('extrai o slug de URL sem sub-path ({slug} no final)', () => {
    expect(extractMagaluStoreSlug('https://www.magazinevoce.com.br/magazinetorre')).toBe(
      'magazinetorre',
    );
  });

  it('retorna null para URL sem primeiro segmento', () => {
    expect(extractMagaluStoreSlug('https://www.magazineluiza.com.br/p/eadk91754h')).toBeNull();
  });

  it('retorna null para URL inválida', () => {
    expect(extractMagaluStoreSlug('não é url')).toBeNull();
  });

  it('retorna null para URL vazia', () => {
    expect(extractMagaluStoreSlug('')).toBeNull();
  });
});

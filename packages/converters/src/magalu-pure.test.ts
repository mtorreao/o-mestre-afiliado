/**
 * Testes da lógica PURA do conversor Magalu.
 *
 * Cobre:
 *   - Detecção: isMagaluShortlinkPure, isMagazinevoceProductUrlPure,
 *     isMagazineluizaProductUrlPure, isMagaluProductUrlPure
 *   - Extração: extractMagaluProductIdPure, extractMagazinevoceStoreSlugPure,
 *     extractMagaluShortlinkIdPure
 *   - Validação: validateMagaluStoreSlugPure (regras de slug)
 *   - Construção: buildMagaluAffiliateLinkPure (todos os formatos de URL)
 *
 * Sem I/O — 100% das funções puras cobertas.
 */
import { describe, expect, it } from 'bun:test';
import {
  buildMagaluAffiliateLinkPure,
  buildMagaluAffiliateLinkPureSafe,
  extractMagaluProductIdPure,
  extractMagaluShortlinkIdPure,
  extractMagazinevoceStoreSlugPure,
  extractPromozoneMagaluIdPure,
  isMagaluOnelinkUrlPure,
  isMagaluProductUrlPure,
  isMagaluShortlinkPure,
  isMagazineluizaProductUrlPure,
  isMagazinevoceProductUrlPure,
  isPromozoneMagaluUrlPure,
  validateMagaluStoreSlugPure,
} from './magalu-pure.ts';

// ─── Detecção ────────────────────────────────────────────────────────

describe('isMagaluShortlinkPure', () => {
  it('detecta maga.lu/<id>', () => {
    expect(isMagaluShortlinkPure('https://maga.lu/abc123')).toBe(true);
    expect(isMagaluShortlinkPure('http://maga.lu/xyz')).toBe(true);
  });

  it('aceita short IDs com hífen e underscore', () => {
    expect(isMagaluShortlinkPure('https://maga.lu/abc-123_xyz')).toBe(true);
  });

  it('rejeita URLs que não são shortlinks', () => {
    expect(isMagaluShortlinkPure('https://www.magazineluiza.com.br/p/123')).toBe(false);
    expect(isMagaluShortlinkPure('https://www.magazinevoce.com.br/loja/p/123')).toBe(false);
    expect(isMagaluShortlinkPure('https://amazon.com.br/dp/B08N5WRWNW')).toBe(false);
    expect(isMagaluShortlinkPure('')).toBe(false);
  });
});

describe('isMagazinevoceProductUrlPure', () => {
  it('detecta URL completa de produto no Magazine Você', () => {
    expect(
      isMagazinevoceProductUrlPure(
        'https://www.magazinevoce.com.br/magazineloja/celular-x/p/12345/in/te/',
      ),
    ).toBe(true);
  });

  it('detecta formato /oferta/ no Magazine Você', () => {
    expect(
      isMagazinevoceProductUrlPure('https://www.magazinevoce.com.br/loja/oferta/abc123/in/te/'),
    ).toBe(true);
  });

  it('rejeita URL só da home (sem /p/ ou /oferta/)', () => {
    expect(isMagazinevoceProductUrlPure('https://www.magazinevoce.com.br/loja/')).toBe(false);
  });

  it('rejeita magazineluiza.com.br', () => {
    expect(isMagazineluizaProductUrlPure('https://www.magazineluiza.com.br/p/123')).toBe(true);
    expect(isMagazinevoceProductUrlPure('https://www.magazineluiza.com.br/p/123')).toBe(false);
  });
});

describe('isMagazineluizaProductUrlPure', () => {
  it('detecta /p/<ID>/', () => {
    expect(
      isMagazineluizaProductUrlPure('https://www.magazineluiza.com.br/celular-x/p/12345/'),
    ).toBe(true);
  });

  it('detecta /oferta/<ID>/', () => {
    expect(
      isMagazineluizaProductUrlPure(
        'https://www.magazineluiza.com.br/divulgador/oferta/241149600/te/gs26/',
      ),
    ).toBe(true);
  });

  it('rejeita URL sem /p/ ou /oferta/', () => {
    expect(isMagazineluizaProductUrlPure('https://www.magazineluiza.com.br/')).toBe(false);
  });
});

describe('isMagaluProductUrlPure', () => {
  it('detecta tanto Magazine Você quanto Magazine Luiza', () => {
    expect(isMagaluProductUrlPure('https://www.magazinevoce.com.br/loja/prod/p/123/in/te/')).toBe(
      true,
    );
    expect(isMagaluProductUrlPure('https://www.magazineluiza.com.br/prod/p/123/')).toBe(true);
  });

  it('rejeita shortlinks maga.lu (precisam ser resolvidos primeiro)', () => {
    expect(isMagaluProductUrlPure('https://maga.lu/abc')).toBe(false);
  });

  it('rejeita outros marketplaces', () => {
    expect(isMagaluProductUrlPure('https://amazon.com.br/dp/B08N5WRWNW')).toBe(false);
    expect(isMagaluProductUrlPure('https://shopee.com.br/product/123')).toBe(false);
  });
});

// ─── Extração ────────────────────────────────────────────────────────

describe('extractMagaluProductIdPure', () => {
  it('extrai ID de URL magazinevoce.com.br/{slug}/.../p/<ID>/', () => {
    expect(
      extractMagaluProductIdPure(
        'https://www.magazinevoce.com.br/loja/celular-x/p/eadk91754h/in/te/',
      ),
    ).toBe('eadk91754h');
  });

  it('extrai ID de URL magazinevoce.com.br/{slug}/.../oferta/<ID>/', () => {
    expect(
      extractMagaluProductIdPure('https://www.magazinevoce.com.br/loja/oferta/abc123/in/te/'),
    ).toBe('abc123');
  });

  it('extrai ID de URL magazineluiza.com.br/.../p/<ID>/', () => {
    expect(extractMagaluProductIdPure('https://www.magazineluiza.com.br/celular-x/p/12345/')).toBe(
      '12345',
    );
  });

  it('extrai ID de URL magazineluiza.com.br/.../oferta/<ID>/ (formato antigo divulgador)', () => {
    expect(
      extractMagaluProductIdPure(
        'https://www.magazineluiza.com.br/samsung-galaxy-s26/divulgador/oferta/241149600/te/gs26/',
      ),
    ).toBe('241149600');
  });

  it('extrai ID mesmo com query string', () => {
    expect(
      extractMagaluProductIdPure('https://www.magazineluiza.com.br/p/12345/?partner_id=99'),
    ).toBe('12345');
  });

  it('retorna null para URL fora do padrão', () => {
    expect(extractMagaluProductIdPure('https://www.magazineluiza.com.br/')).toBeNull();
    expect(extractMagaluProductIdPure('https://amazon.com.br/dp/B08N5WRWNW')).toBeNull();
    expect(extractMagaluProductIdPure('')).toBeNull();
  });
});

describe('extractMagazinevoceStoreSlugPure', () => {
  it('extrai slug de URL Magazine Você', () => {
    expect(
      extractMagazinevoceStoreSlugPure(
        'https://www.magazinevoce.com.br/magazineloja/prod/p/123/in/te/',
      ),
    ).toBe('magazineloja');
  });

  it('extrai slug com hífens', () => {
    expect(
      extractMagazinevoceStoreSlugPure('https://www.magazinevoce.com.br/loja-do-ze/p/123/'),
    ).toBe('loja-do-ze');
  });

  it('retorna null para URLs fora do Magazine Você', () => {
    expect(extractMagazinevoceStoreSlugPure('https://www.magazineluiza.com.br/p/123')).toBeNull();
    expect(extractMagazinevoceStoreSlugPure('https://amazon.com.br/dp/B08N5WRWNW')).toBeNull();
    expect(extractMagazinevoceStoreSlugPure('')).toBeNull();
  });
});

describe('extractMagaluShortlinkIdPure', () => {
  it('extrai short ID de maga.lu', () => {
    expect(extractMagaluShortlinkIdPure('https://maga.lu/abc123')).toBe('abc123');
    expect(extractMagaluShortlinkIdPure('http://maga.lu/xyz')).toBe('xyz');
  });

  it('retorna null para URLs fora do shortlink', () => {
    expect(extractMagaluShortlinkIdPure('https://www.magazineluiza.com.br/p/123')).toBeNull();
    expect(extractMagaluShortlinkIdPure('')).toBeNull();
  });
});

// ─── Validação de slug ──────────────────────────────────────────────

describe('validateMagaluStoreSlugPure', () => {
  it('aceita slug válido', () => {
    expect(validateMagaluStoreSlugPure('magazineloja')).toEqual({ valid: true });
    expect(validateMagaluStoreSlugPure('loja-do-ze')).toEqual({ valid: true });
    expect(validateMagaluStoreSlugPure('abc123')).toEqual({ valid: true });
    expect(validateMagaluStoreSlugPure('a1b')).toEqual({ valid: true }); // mínimo 3
    expect(validateMagaluStoreSlugPure('a'.repeat(40))).toEqual({ valid: true }); // máximo 40
  });

  it('rejeita slug vazio / null / undefined', () => {
    expect(validateMagaluStoreSlugPure('').valid).toBe(false);
    expect(validateMagaluStoreSlugPure(null).valid).toBe(false);
    expect(validateMagaluStoreSlugPure(undefined).valid).toBe(false);
  });

  it('rejeita slug muito curto (< 3 chars)', () => {
    const result = validateMagaluStoreSlugPure('ab');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('mínimo 3');
  });

  it('rejeita slug muito longo (> 40 chars)', () => {
    const result = validateMagaluStoreSlugPure('a'.repeat(41));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('máximo 40');
  });

  it('rejeita slug com caracteres inválidos (maiúscula, espaço, especial)', () => {
    expect(validateMagaluStoreSlugPure('LojaComMaiuscula').valid).toBe(false);
    expect(validateMagaluStoreSlugPure('loja com espaco').valid).toBe(false);
    expect(validateMagaluStoreSlugPure('loja_underscore').valid).toBe(false);
    expect(validateMagaluStoreSlugPure('loja.com.ponto').valid).toBe(false);
  });

  it('rejeita slug começando ou terminando com hífen', () => {
    expect(validateMagaluStoreSlugPure('-loja').valid).toBe(false);
    expect(validateMagaluStoreSlugPure('loja-').valid).toBe(false);
  });

  it('rejeita slug com hífens duplos', () => {
    const result = validateMagaluStoreSlugPure('loja--do--ze');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('hífens duplos');
  });
});

// ─── Construção de link ─────────────────────────────────────────────

describe('buildMagaluAffiliateLinkPure', () => {
  it('constrói link a partir de URL magazineluiza.com.br/<slug>/p/<ID>/ preservando slug', () => {
    const result = buildMagaluAffiliateLinkPure({
      productUrl: 'https://www.magazineluiza.com.br/celular-x/p/12345/',
      storeSlug: 'magazinetorre',
    });
    expect(result).toBe('https://www.magazinevoce.com.br/magazinetorre/celular-x/p/12345/');
  });

  it('constrói link a partir de URL magazinevoce.com.br trocando o slug', () => {
    const result = buildMagaluAffiliateLinkPure({
      productUrl: 'https://www.magazinevoce.com.br/outraloja/celular-x/p/eadk91754h/in/te/',
      storeSlug: 'magazinetorre',
    });
    // slug da loja é trocado, demais segmentos preservados
    expect(result).toBe(
      'https://www.magazinevoce.com.br/magazinetorre/celular-x/p/eadk91754h/in/te/',
    );
  });

  it('preserva segmentos opcionais quando vêm de Magazine Você', () => {
    const result = buildMagaluAffiliateLinkPure({
      productUrl:
        'https://www.magazinevoce.com.br/magazinemoniquespg/eliptico-x/p/eadk91754h/es/elet/',
      storeSlug: 'magazinetorre',
    });
    expect(result).toBe(
      'https://www.magazinevoce.com.br/magazinetorre/eliptico-x/p/eadk91754h/es/elet/',
    );
  });

  it('constrói link a partir de URL /oferta/<ID>/ preservando slug de divulgador', () => {
    const result = buildMagaluAffiliateLinkPure({
      productUrl: 'https://www.magazineluiza.com.br/samsung-x/divulgador/oferta/241149600/te/gs26/',
      storeSlug: 'magazinetorre',
    });
    expect(result).toBe(
      'https://www.magazinevoce.com.br/magazinetorre/samsung-x/divulgador/oferta/241149600/te/gs26/',
    );
  });

  it('preserva slugProduto quando URL é magazineluiza.com.br/<slug>/p/<ID>/', () => {
    const result = buildMagaluAffiliateLinkPure({
      productUrl: 'https://www.magazineluiza.com.br/celular-x/p/12345/',
      storeSlug: 'magazinetorre',
    });
    expect(result).toBe('https://www.magazinevoce.com.br/magazinetorre/celular-x/p/12345/');
  });

  it('usa placeholder determinístico para URL curta magazineluiza.com.br/p/<ID>', () => {
    const result = buildMagaluAffiliateLinkPure({
      productUrl: 'https://www.magazineluiza.com.br/p/12345',
      storeSlug: 'magazinetorre',
    });
    expect(result).toBe(
      'https://www.magazinevoce.com.br/magazinetorre/produto-12345/p/12345/in/te/',
    );
  });

  it('lança Error para storeSlug inválido', () => {
    expect(() =>
      buildMagaluAffiliateLinkPure({
        productUrl: 'https://www.magazineluiza.com.br/p/123/',
        storeSlug: '',
      }),
    ).toThrow(/storeSlug inválido/);

    expect(() =>
      buildMagaluAffiliateLinkPure({
        productUrl: 'https://www.magazineluiza.com.br/p/123/',
        storeSlug: 'AB',
      }),
    ).toThrow(/storeSlug inválido/);
  });

  it('lança Error quando não consegue extrair ID do produto', () => {
    expect(() =>
      buildMagaluAffiliateLinkPure({
        productUrl: 'https://www.magazineluiza.com.br/',
        storeSlug: 'magazinetorre',
      }),
    ).toThrow(/ID do produto Magalu/);
  });
});

describe('buildMagaluAffiliateLinkPureSafe', () => {
  it('retorna string válida no happy path', () => {
    expect(
      buildMagaluAffiliateLinkPureSafe({
        productUrl: 'https://www.magazineluiza.com.br/p/123/',
        storeSlug: 'magazinetorre',
      }),
    ).toBe('https://www.magazinevoce.com.br/magazinetorre/produto-123/p/123/in/te/');
  });

  it('retorna null em vez de throw para entrada inválida', () => {
    expect(
      buildMagaluAffiliateLinkPureSafe({
        productUrl: 'invalid',
        storeSlug: 'magazinetorre',
      }),
    ).toBeNull();

    expect(
      buildMagaluAffiliateLinkPureSafe({
        productUrl: 'https://www.magazineluiza.com.br/p/123/',
        storeSlug: '',
      }),
    ).toBeNull();
  });
});

// ─── Promozone (go.promozone.ai/magalu/<id>) ──────────────────────────

describe('isPromozoneMagaluUrlPure', () => {
  it('detecta go.promozone.ai/magalu/<id>', () => {
    expect(isPromozoneMagaluUrlPure('https://go.promozone.ai/magalu/6NMKvC')).toBe(true);
    expect(isPromozoneMagaluUrlPure('http://go.promozone.ai/magalu/abc-123')).toBe(true);
  });

  it('rejeita outros caminhos', () => {
    expect(isPromozoneMagaluUrlPure('https://go.promozone.ai/amazon/B07PXGQCK5')).toBe(false);
    expect(isPromozoneMagaluUrlPure('https://go.promozone.ai/ml/abc')).toBe(false);
    expect(isPromozoneMagaluUrlPure('https://go.promozone.ai/')).toBe(false);
  });
});

describe('extractPromozoneMagaluIdPure', () => {
  it('extrai ID do shortlink', () => {
    expect(extractPromozoneMagaluIdPure('https://go.promozone.ai/magalu/6NMKvC')).toBe('6NMKvC');
    expect(extractPromozoneMagaluIdPure('https://go.promozone.ai/magalu/abc-123_xyz')).toBe(
      'abc-123_xyz',
    );
  });

  it('retorna null para URL fora do padrão', () => {
    expect(extractPromozoneMagaluIdPure('https://go.promozone.ai/amazon/B07PXGQCK5')).toBeNull();
    expect(extractPromozoneMagaluIdPure('https://magazineluiza.com.br/p/123')).toBeNull();
  });
});

describe('isMagaluProductUrlPure — reconhece Promozone', () => {
  it('detecta shortlinks do Promozone', () => {
    expect(isMagaluProductUrlPure('https://go.promozone.ai/magalu/6NMKvC')).toBe(true);
  });
});

describe('extractMagaluProductIdPure — reconhece Promozone', () => {
  it('extrai shortId do Promozone (placeholder até resolve HTTP)', () => {
    expect(extractMagaluProductIdPure('https://go.promozone.ai/magalu/6NMKvC')).toBe('6NMKvC');
  });
});

// ─── OneLink AppsFlyer (magazineluiza.onelink.me) ─────────────────────

describe('isMagaluOnelinkUrlPure', () => {
  it('detecta OneLink AppsFlyer da Magalu', () => {
    expect(isMagaluOnelinkUrlPure('https://magazineluiza.onelink.me/589508454/qmpki3x1')).toBe(
      true,
    );
    expect(isMagaluOnelinkUrlPure('http://magazineluiza.onelink.me/abc/123')).toBe(true);
  });

  it('rejeita outros OneLinks', () => {
    expect(isMagaluOnelinkUrlPure('https://onelink.me/abc')).toBe(false);
    expect(isMagaluOnelinkUrlPure('https://magazineluiza.com.br/p/123')).toBe(false);
  });
});

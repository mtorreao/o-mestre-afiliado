/**
 * Testes das funções PURAS adicionais de shopee-pure.ts (Rodada 3):
 *  - buildGenerateShortLinkMutation
 *  - parseGenerateShortLinkPayload
 *  - buildProductOfferV2ByIdMutation
 *  - buildProductOfferV2ByKeywordMutation (sanitização de keyword)
 *
 * Não altera headers — apenas exercita a montagem/parsing puro.
 */
import { describe, expect, it } from 'bun:test';
import {
  buildGenerateShortLinkMutation,
  buildProductOfferV2ByIdMutation,
  buildProductOfferV2ByKeywordMutation,
  parseGenerateShortLinkPayload,
} from './shopee-pure.ts';

describe('buildGenerateShortLinkMutation', () => {
  it('serializa a mutation com originUrl interpolada', () => {
    const body = buildGenerateShortLinkMutation('https://shopee.com.br/x-i.1.2');
    const parsed = JSON.parse(body);
    expect(parsed.query).toContain(
      'generateShortLink(input: { originUrl: "https://shopee.com.br/x-i.1.2" })',
    );
    expect(parsed.query).toContain('shortLink');
  });
});

describe('parseGenerateShortLinkPayload', () => {
  it('extrai shortLink quando presente', () => {
    const { shortLink, errors } = parseGenerateShortLinkPayload({
      data: { generateShortLink: { shortLink: 'https://shp.ee/abc' } },
    });
    expect(shortLink).toBe('https://shp.ee/abc');
    expect(errors).toBeUndefined();
  });

  it('extrai errors quando presente', () => {
    const { shortLink, errors } = parseGenerateShortLinkPayload({
      errors: [{ message: 'invalid app id', extensions: { code: 'AUTH' } }],
    });
    expect(shortLink).toBeUndefined();
    expect(errors?.[0]?.message).toBe('invalid app id');
    expect(errors?.[0]?.extensions?.code).toBe('AUTH');
  });

  it('retorna ambos undefined quando data nula', () => {
    expect(parseGenerateShortLinkPayload(null)).toEqual({});
    expect(parseGenerateShortLinkPayload(undefined)).toEqual({});
  });

  it('retorna shortLink undefined quando generateShortLink é null', () => {
    const { shortLink } = parseGenerateShortLinkPayload({ data: { generateShortLink: null } });
    expect(shortLink).toBeUndefined();
  });
});

describe('buildProductOfferV2ByIdMutation', () => {
  it('interpola itemId + shopId e pede os campos', () => {
    const body = buildProductOfferV2ByIdMutation(123, 456);
    const parsed = JSON.parse(body);
    expect(parsed.query).toContain('productOfferV2(itemId: 123, shopId: 456)');
    expect(parsed.query).toContain('offerLink');
    expect(parsed.query).toContain('commissionRate');
  });
});

describe('buildProductOfferV2ByKeywordMutation', () => {
  it('interpola keyword e defaults limit=5, sortType=1', () => {
    const body = buildProductOfferV2ByKeywordMutation('Capinha iPhone');
    const parsed = JSON.parse(body);
    expect(parsed.query).toContain('keyword: "Capinha iPhone", limit: 5, sortType: 1');
  });

  it('aceita limit/sortType customizados', () => {
    const body = buildProductOfferV2ByKeywordMutation('Capinha', 10, 2);
    const parsed = JSON.parse(body);
    expect(parsed.query).toContain('keyword: "Capinha", limit: 10, sortType: 2');
  });

  it('escapa aspas duplas na keyword', () => {
    const body = buildProductOfferV2ByKeywordMutation('Capinha "Pro"');
    const parsed = JSON.parse(body);
    expect(parsed.query).toContain('keyword: "Capinha \\"Pro\\""');
  });
});

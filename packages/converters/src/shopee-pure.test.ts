/**
 * Testes das funções PURAS do conversor de Shopee (shopee-pure.ts).
 *
 * Cobre 100% das funções puras:
 *  - buildShopeeAuthSignature / buildShopeeAuthHeaders (SHA256, determinismo,
 *    fórmula appId+ts+body+secret, prefixo SHA256 preservado)
 *  - extractShopeeItemIdFromUrl (formato -i., /product/, null)
 *  - extractShopeeShopIdFromUrl (-i. shopId, null)
 *  - extractShopeeSlug (-i., puro, /product/ ignorado, não-shopee, vazio)
 *  - normalizeShopeeKeyword (hífens/underscore → espaço, trim, cap 100)
 *  - extractFirstProductOffer (errors, nodes vazio, nodes[0], resposta nula)
 *
 * Não altera nenhum header — apenas exercita a lógica pura.
 */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  buildShopeeAuthHeaders,
  buildShopeeAuthSignature,
  extractFirstProductOffer,
  extractShopeeItemIdFromUrl,
  extractShopeeShopIdFromUrl,
  extractShopeeSlug,
  normalizeShopeeKeyword,
  type ProductOfferV2Response,
} from './shopee-pure.ts';

describe('buildShopeeAuthSignature / headers (SHA256)', () => {
  it('produz assinatura hex de 64 chars e payload = appId+ts+body+secret', () => {
    const { payload, signature } = buildShopeeAuthSignature('app123', 'sec456', 'body', 1700000000);
    expect(signature).toMatch(/^[a-f0-9]{64}$/);
    expect(payload).toBe('app1231700000000bodysec456');
  });

  it('combina exatamente com a fórmula documentada', () => {
    const body = 'corpo-de-teste';
    const ts = 1700000000;
    const { signature } = buildShopeeAuthSignature('app123', 'sec456', body, ts);
    const expected = createHash('sha256').update(`app123${ts}${body}sec456`).digest('hex');
    expect(signature).toBe(expected);
  });

  it('é determinístico: mesmo (appId, secret, body, ts) → mesma assinatura', () => {
    const a = buildShopeeAuthSignature('app123', 'sec456', 'body', 123);
    const b = buildShopeeAuthSignature('app123', 'sec456', 'body', 123);
    expect(a.signature).toBe(b.signature);
  });

  it('muda a assinatura quando o body muda', () => {
    const a = buildShopeeAuthSignature('app123', 'sec456', 'body-A', 1);
    const b = buildShopeeAuthSignature('app123', 'sec456', 'body-B', 1);
    expect(a.signature).not.toBe(b.signature);
  });

  it('buildShopeeAuthHeaders mantém prefixo SHA256 e Credential', () => {
    const headers = buildShopeeAuthHeaders('app123', 'sec456', 'body', 999);
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Authorization).toMatch(
      /^SHA256 Credential=app123, Timestamp=999, Signature=[a-f0-9]{64}$/,
    );
  });

  it('buildShopeeAuthHeaders inclui o appId correto no campo Credential', () => {
    const headers = buildShopeeAuthHeaders('meu-app-id', 'sec', 'body', 1);
    expect(headers.Authorization).toContain('Credential=meu-app-id,');
  });
});

describe('extractShopeeItemIdFromUrl', () => {
  it('extrai itemId do padrão -i.SHOPID.ITEMID', () => {
    expect(extractShopeeItemIdFromUrl('https://shopee.com.br/Capinha-i.123.456')).toBe(456);
  });

  it('extrai itemId com trailing slash', () => {
    expect(extractShopeeItemIdFromUrl('https://shopee.com.br/Prod-i.1.2/')).toBe(2);
  });

  it('extrai itemId de host não-shopee (regex não valida domínio)', () => {
    expect(extractShopeeItemIdFromUrl('https://exemplo.com/Prod-i.1.2')).toBe(2);
  });

  it('extrai itemId do formato /product/ mesmo com query string', () => {
    expect(extractShopeeItemIdFromUrl('https://shopee.com.br/product/10/20?x=1')).toBe(20);
  });

  it('retorna null para texto sem formato de produto', () => {
    expect(extractShopeeItemIdFromUrl('https://shopee.com.br/ofertas')).toBeNull();
  });

  it('retorna null para URL vazia', () => {
    expect(extractShopeeItemIdFromUrl('')).toBeNull();
  });

  it('extrai itemId grande (10+ dígitos)', () => {
    expect(extractShopeeItemIdFromUrl('https://shopee.com.br/x-i.111222333.1234567890123')).toBe(
      1234567890123,
    );
  });
});

describe('extractShopeeShopIdFromUrl', () => {
  it('extrai shopId (primeiro número) do padrão -i.SHOPID.ITEMID', () => {
    expect(extractShopeeShopIdFromUrl('https://shopee.com.br/Capinha-i.123.456')).toBe(123);
  });

  it('retorna null quando não há padrão -i.', () => {
    expect(extractShopeeShopIdFromUrl('https://shopee.com.br/ofertas')).toBeNull();
  });

  it('retorna null para URL vazia', () => {
    expect(extractShopeeShopIdFromUrl('')).toBeNull();
  });
});

describe('extractShopeeSlug', () => {
  it('extrai slug antes de -i.', () => {
    expect(extractShopeeSlug('https://shopee.com.br/Capinha-iPhone-i.123.456')).toBe(
      'Capinha-iPhone',
    );
  });

  it('extrai slug sem -i. quando não tem padrão', () => {
    expect(extractShopeeSlug('https://shopee.com.br/Capinha-iPhone')).toBe('Capinha-iPhone');
  });

  it('ignora path /product/', () => {
    expect(extractShopeeSlug('https://shopee.com.br/product/123/456')).toBe(null);
  });

  it('retorna null para host não-shopee', () => {
    expect(extractShopeeSlug('https://mercadolivre.com.br/Capinha-i.1.2')).toBeNull();
  });

  it('retorna slug mesmo com query string', () => {
    expect(extractShopeeSlug('https://shopee.com.br/Meu-Produto-i.1.2?sp_atk=x')).toBe(
      'Meu-Produto',
    );
  });

  it('retorna null para URL vazia', () => {
    expect(extractShopeeSlug('')).toBeNull();
  });
});

describe('normalizeShopeeKeyword', () => {
  it('converte hífens e underscores em espaços', () => {
    expect(normalizeShopeeKeyword('Capinha-iPhone_Pro')).toBe('Capinha iPhone Pro');
  });

  it('colapsa espaços múltiplos e faz trim', () => {
    expect(normalizeShopeeKeyword('  Capinha   iPhone  ')).toBe('Capinha iPhone');
  });

  it('limita a 100 caracteres', () => {
    const long = 'a'.repeat(250);
    expect(normalizeShopeeKeyword(long)).toHaveLength(100);
  });

  it('retorna vazio para entrada vazia', () => {
    expect(normalizeShopeeKeyword('')).toBe('');
  });
});

describe('extractFirstProductOffer', () => {
  it('retorna nodes[0] quando presente', () => {
    const resp: ProductOfferV2Response = {
      data: { productOfferV2: { nodes: [{ itemId: 1, shopId: 2, productName: 'X' }] } },
    };
    expect(extractFirstProductOffer(resp)).toEqual({ itemId: 1, shopId: 2, productName: 'X' });
  });

  it('retorna null quando há errors', () => {
    const resp: ProductOfferV2Response = {
      errors: [{ message: 'boom' }],
      data: { productOfferV2: { nodes: [{ itemId: 1, shopId: 2 }] } },
    };
    expect(extractFirstProductOffer(resp)).toBeNull();
  });

  it('retorna null quando nodes está vazio', () => {
    const resp: ProductOfferV2Response = { data: { productOfferV2: { nodes: [] } } };
    expect(extractFirstProductOffer(resp)).toBeNull();
  });

  it('retorna null quando nodes ausente', () => {
    const resp: ProductOfferV2Response = { data: { productOfferV2: {} } };
    expect(extractFirstProductOffer(resp)).toBeNull();
  });

  it('retorna null para resposta nula', () => {
    expect(extractFirstProductOffer(null)).toBeNull();
    expect(extractFirstProductOffer(undefined)).toBeNull();
  });
});

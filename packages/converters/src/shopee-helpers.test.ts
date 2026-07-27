/**
 * Testes complementares do conversor de Shopee — funções PURAS.
 *
 * Cobre a lógica de assinatura SHA-256 (geração de auth header) e casos
 * extras de extração de itemId/slug, SEM mexer nos headers existentes
 * (o prefixo 'SHA256' deve permanecer sincronizado — aqui apenas testamos
 * a lógica pura, não alteramos `generateAuthHeaders`).
 */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  _testGenerateAuthHeaders,
  _testExtractShopeeItemIdFromUrl,
  _testExtractShopeeSlug,
} from './shopee.ts';

describe('_testGenerateAuthHeaders (assinatura SHA-256)', () => {
  it('produz header Authorization com prefixo SHA256 e assinatura hex de 64 chars', () => {
    const body = JSON.stringify({ query: 'mutation { generateShortLink { shortLink } }' });
    const headers = _testGenerateAuthHeaders('app123', 'sec456', body);

    expect(headers['Content-Type']).toBe('application/json');
    const auth = headers.Authorization;
    expect(auth).toBeDefined();
    expect(auth).toMatch(/^SHA256 Credential=app123, Timestamp=\d+, Signature=[a-f0-9]{64}$/);
  });

  it('é determinístico: mesmo (appId, secret, body) → mesma assinatura', () => {
    const body = 'payload-fixo';
    const a = _testGenerateAuthHeaders('app123', 'sec456', body);
    const b = _testGenerateAuthHeaders('app123', 'sec456', body);
    expect(a.Authorization).toBe(b.Authorization);
  });

  it('muda a assinatura quando o body muda (mantém prefixo SHA256)', () => {
    const a = _testGenerateAuthHeaders('app123', 'sec456', 'body-A');
    const b = _testGenerateAuthHeaders('app123', 'sec456', 'body-B');
    expect(a.Authorization).not.toBe(b.Authorization);
    expect(a.Authorization).toMatch(/^SHA256 /);
    expect(b.Authorization).toMatch(/^SHA256 /);
  });

  it('combina exatamente com a fórmula documentada (appId+ts+body+secret)', () => {
    const body = 'corpo-de-teste';
    const headers = _testGenerateAuthHeaders('app123', 'sec456', body);
    const m = headers.Authorization.match(/Timestamp=(\d+), Signature=([a-f0-9]{64})/);
    expect(m).not.toBeNull();
    const timestamp = m![1]!;
    const payload = `app123${timestamp}${body}sec456`;
    const expected = createHash('sha256').update(payload).digest('hex');
    expect(m![2]).toBe(expected);
  });

  it('inclui o appId correto no campo Credential', () => {
    const headers = _testGenerateAuthHeaders('meu-app-id', 'sec', 'body');
    expect(headers.Authorization).toContain('Credential=meu-app-id,');
  });
});

describe('_testExtractShopeeItemIdFromUrl — casos extras', () => {
  it('extrai itemId de URL com trailing slash', () => {
    expect(_testExtractShopeeItemIdFromUrl('https://shopee.com.br/Prod-i.1.2/')).toBe(2);
  });

  it('extrai itemId do padrão -i. mesmo em host não-shopee (regex não valida domínio)', () => {
    expect(_testExtractShopeeItemIdFromUrl('https://exemplo.com/Prod-i.1.2')).toBe(2);
  });

  it('retorna null para texto sem formato de produto', () => {
    expect(_testExtractShopeeItemIdFromUrl('https://shopee.com.br/ofertas')).toBeNull();
  });

  it('extrai itemId do formato /product/ mesmo com query string', () => {
    expect(_testExtractShopeeItemIdFromUrl('https://shopee.com.br/product/10/20?x=1')).toBe(20);
  });
});

describe('_testExtractShopeeSlug — casos extras', () => {
  it('retorna null para host não-shopee', () => {
    expect(_testExtractShopeeSlug('https://mercadolivre.com.br/Capinha-i.1.2')).toBeNull();
  });

  it('retorna slug mesmo com query string', () => {
    expect(_testExtractShopeeSlug('https://shopee.com.br/Meu-Produto-i.1.2?sp_atk=x')).toBe(
      'Meu-Produto',
    );
  });

  it('retorna null para URL só com /product/', () => {
    expect(_testExtractShopeeSlug('https://shopee.com.br/product/1/2')).toBeNull();
  });
});

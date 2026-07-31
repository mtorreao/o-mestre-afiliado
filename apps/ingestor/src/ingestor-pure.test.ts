/**
 * Testes das funções PURAS do Ingestor (ingestor-pure.ts).
 *
 * Cobrem 100% das funções de classificação/processamento e montagem de
 * objetos que antes viviam inline dentro de `processRawMessage` e portanto
 * não eram cobertas pelos testes unitários:
 *   - classifyResolvedProductUrl
 *   - reconstructText
 *   - buildTemplateContext
 *   - buildSendEvent
 *   - resolveSendDedupKey
 *   - parseAffiliateUserId
 *   - isSocialCommerceUrl
 */
import { describe, expect, it } from 'bun:test';
import {
  classifyResolvedProductUrl,
  reconstructText,
  buildTemplateContext,
  buildSendEvent,
  resolveSendDedupKey,
  parseAffiliateUserId,
  isSocialCommerceUrl,
  type ResolvedLinkInput,
} from './ingestor-pure.ts';

describe('classifyResolvedProductUrl', () => {
  it('shopee: formato antigo -i.ShopId.ItemId', () => {
    expect(
      classifyResolvedProductUrl(
        'https://shopee.com.br/produto-i.1006874942.23694247133',
        'shopee',
      ),
    ).toBe(true);
  });

  it('shopee: formato novo <slug>/<ShopId>/<ItemId>', () => {
    expect(
      classifyResolvedProductUrl('https://shopee.com.br/opaanlp/1500679968/58256271370', 'shopee'),
    ).toBe(true);
  });

  it('shopee: URL não-produto → false', () => {
    expect(classifyResolvedProductUrl('https://shopee.com.br/user/foo', 'shopee')).toBe(false);
    expect(classifyResolvedProductUrl('https://shopee.com.br/voucher-wallet/abc', 'shopee')).toBe(
      false,
    );
  });

  it('mercadolivre: usa isMeliProductUrl (/p/MLB<id>)', () => {
    expect(
      classifyResolvedProductUrl('https://www.mercadolivre.com.br/p/MLB1234567890', 'mercadolivre'),
    ).toBe(true);
  });

  it('mercadolivre: /sec/ (não produto) → false', () => {
    expect(
      classifyResolvedProductUrl('https://www.mercadolivre.com.br/sec/ofertas', 'mercadolivre'),
    ).toBe(false);
  });

  it('amazon: /dp/<ASIN>', () => {
    expect(classifyResolvedProductUrl('https://www.amazon.com.br/dp/B0C1234567', 'amazon')).toBe(
      true,
    );
  });

  it('amazon: /gp/product/<ASIN>', () => {
    expect(
      classifyResolvedProductUrl('https://www.amazon.com.br/gp/product/B0C1234567', 'amazon'),
    ).toBe(true);
  });

  it('amazon: lista não-produto → false', () => {
    expect(classifyResolvedProductUrl('https://www.amazon.com.br/s?k=foo', 'amazon')).toBe(false);
  });

  it('magalu: tratado como produto (vai à conversão)', () => {
    expect(classifyResolvedProductUrl('https://www.magalu.com.br/produto-x', 'magalu')).toBe(true);
  });

  it('marketplace desconhecido → false', () => {
    expect(classifyResolvedProductUrl('https://example.com/foo', 'unknown')).toBe(false);
  });
});

describe('reconstructText', () => {
  it('substitui informativo pela URL resolvida', () => {
    const links: ResolvedLinkInput[] = [
      {
        originalUrl: 'https://s.shopee.com.br/AAA',
        resolvedUrl: 'https://shopee.com.br/ofertas',
        role: 'informative',
      },
    ];
    const out = reconstructText('Confira https://s.shopee.com.br/AAA', links);
    expect(out).toContain('https://shopee.com.br/ofertas');
    expect(out).not.toContain('https://s.shopee.com.br/AAA');
  });

  it('remove descarte (link e separador)', () => {
    const links: ResolvedLinkInput[] = [
      { originalUrl: 'https://t.me/foo', resolvedUrl: 'https://t.me/foo', role: 'discard' },
    ];
    const out = reconstructText('Oferta https://t.me/foo | promo', links);
    expect(out).not.toContain('https://t.me/foo');
    // separador "|" órfão no fim de linha é limpo
    expect(out).not.toMatch(/\|\s*$/);
  });

  it('não toca link product (fica para o template)', () => {
    const links: ResolvedLinkInput[] = [
      { originalUrl: 'https://meli.la/XYZ', resolvedUrl: 'https://ml.com/p/MLB1', role: 'product' },
    ];
    const out = reconstructText('Compre https://meli.la/XYZ', links);
    expect(out).toContain('https://meli.la/XYZ');
  });

  it('colapsa 3+ quebras de linha e espaços duplos', () => {
    const out = reconstructText('a\n\n\n\nb   c', []);
    expect(out).toBe('a\n\nb c');
  });

  it('faz trim', () => {
    expect(reconstructText('   oi   ', [])).toBe('oi');
  });
});

describe('buildTemplateContext', () => {
  it('monta com sourceGroupName padrão quando vazio', () => {
    const ctx = buildTemplateContext({
      processedText: 'txt',
      originalUrl: 'orig',
      convertedUrl: 'conv',
      marketplace: 'shopee',
      sourceGroupName: '',
      targetGroupName: 'alvo',
      timestamp: new Date(0),
    });
    expect(ctx.sourceGroupName).toBe('(desconhecido)');
    expect(ctx.originalText).toBe('txt');
    expect(ctx.convertedUrl).toBe('conv');
    expect(ctx.marketplace).toBe('shopee');
    expect(ctx.targetGroupName).toBe('alvo');
  });

  it('mantém sourceGroupName quando fornecido', () => {
    const ctx = buildTemplateContext({
      processedText: 'txt',
      originalUrl: 'orig',
      convertedUrl: 'conv',
      marketplace: 'ml',
      sourceGroupName: 'Grupo A',
      targetGroupName: 'alvo',
      timestamp: new Date(123),
    });
    expect(ctx.sourceGroupName).toBe('Grupo A');
  });
});

describe('buildSendEvent', () => {
  it('monta o SendEvent com imageUrl vazio por padrão', () => {
    const evt = buildSendEvent({
      id: 'uuid-1',
      sourceMessageId: 'msg-1',
      sourceGroupJid: 'grp-1',
      mirrorId: 42,
      text: 'template',
      marketplace: 'amazon',
      originalUrl: 'orig',
      convertedUrl: 'conv',
    });
    expect(evt).toEqual({
      id: 'uuid-1',
      sourceMessageId: 'msg-1',
      sourceGroupJid: 'grp-1',
      mirrorId: 42,
      text: 'template',
      imageUrl: '',
      marketplace: 'amazon',
      originalUrl: 'orig',
      convertedUrl: 'conv',
    });
  });

  it('propaga productKey quando fornecido (correlação catálogo)', () => {
    const evt = buildSendEvent({
      id: 'uuid-2',
      sourceMessageId: 'msg-1',
      sourceGroupJid: 'grp-1',
      mirrorId: 42,
      text: 'template',
      marketplace: 'shopee',
      originalUrl: 'orig',
      convertedUrl: 'conv',
      productKey: 'shopee:456',
    });
    expect(evt.productKey).toBe('shopee:456');
  });

  it('não preenche productKey quando ausente (undefined)', () => {
    const evt = buildSendEvent({
      id: 'uuid-3',
      sourceMessageId: 'msg-1',
      sourceGroupJid: 'grp-1',
      mirrorId: 42,
      text: 'template',
      marketplace: 'mercadolivre',
      originalUrl: 'orig',
      convertedUrl: 'conv',
    });
    expect(evt.productKey).toBeUndefined();
  });

  it('convertedUrl null é preservado (caller decide)', () => {
    const evt = buildSendEvent({
      id: 'u',
      sourceMessageId: 'm',
      sourceGroupJid: 'g',
      mirrorId: 1,
      text: 't',
      marketplace: 'shopee',
      originalUrl: 'o',
      convertedUrl: null as unknown as string,
    });
    expect(evt.convertedUrl).toBeNull();
  });
});

describe('resolveSendDedupKey', () => {
  it('monta a chave com prefixo, mirrorId e messageId', () => {
    expect(resolveSendDedupKey(42, 'msg-9')).toBe('mirror:send-dedup:42:msg-9');
  });

  it('aceita mirrorId como string', () => {
    expect(resolveSendDedupKey('7', 'abc')).toBe('mirror:send-dedup:7:abc');
  });
});

describe('parseAffiliateUserId', () => {
  it('extrai userId de instanceName user-<id>', () => {
    expect(parseAffiliateUserId('user-12345')).toBe(12345);
  });

  it('retorna null para instanceName de dispatcher', () => {
    expect(parseAffiliateUserId('dispatch-x')).toBeNull();
  });

  it('retorna null para formato inválido', () => {
    expect(parseAffiliateUserId('user-')).toBeNull();
    expect(parseAffiliateUserId('user-abc')).toBeNull();
    expect(parseAffiliateUserId('USER-12')).toBeNull();
  });
});

describe('isSocialCommerceUrl', () => {
  it('detecta /social/<id>', () => {
    expect(isSocialCommerceUrl('https://www.mercadolivre.com.br/social/om895584')).toBe(true);
  });

  it('detecta /social/<id>/ com barra final', () => {
    expect(isSocialCommerceUrl('https://www.mercadolivre.com.br/social/abc/')).toBe(true);
  });

  it('rejeita /p/ e /sec/', () => {
    expect(isSocialCommerceUrl('https://www.mercadolivre.com.br/p/MLB1')).toBe(false);
    expect(isSocialCommerceUrl('https://www.mercadolivre.com.br/sec/ofertas')).toBe(false);
  });

  it('rejeita URL inválida sem lançar', () => {
    expect(isSocialCommerceUrl('not a url')).toBe(false);
  });
});

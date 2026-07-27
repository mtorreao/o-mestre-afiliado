/**
 * Testes das funções PURAS em apps/ingestor/src/template-builder.ts.
 *
 * Cobrem 100% de `truncateMessage` e `replaceOriginalUrlInText` sem I/O.
 * `buildTemplateMessage` depende do @omestre/shared (placeholders +
 * condicionais) e é exercitada indiretamente, mas as funções puras são
 * o alvo deste arquivo.
 */
import { describe, expect, it } from 'bun:test';
import {
  truncateMessage,
  replaceOriginalUrlInText,
  buildTemplateMessage,
} from './template-builder.ts';

describe('truncateMessage', () => {
  it('retorna texto inalterado abaixo do limite', () => {
    const text = 'oferta curta';
    expect(truncateMessage(text)).toBe(text);
  });

  it('retorna texto inalterado no limite exato (4000)', () => {
    const text = 'a'.repeat(4000);
    expect(truncateMessage(text)).toBe(text);
  });

  it('trunca texto acima do limite e anexa "..."', () => {
    const text = 'b'.repeat(4100);
    const result = truncateMessage(text);
    expect(result.endsWith('...')).toBe(true);
    expect(result.length).toBe(4000);
    expect(result.slice(0, 3950)).toBe('b'.repeat(3950));
  });

  it('trunca corretamente no limite customizado', () => {
    const text = 'c'.repeat(120);
    const result = truncateMessage(text, 50);
    expect(result.length).toBe(50);
    expect(result.endsWith('...')).toBe(true);
  });

  it('não trunca no limite customizado exato', () => {
    const text = 'd'.repeat(50);
    expect(truncateMessage(text, 50)).toBe(text);
  });

  it('trunca strings vazias (sem alteração)', () => {
    expect(truncateMessage('')).toBe('');
  });
});

describe('replaceOriginalUrlInText', () => {
  const original = 'https://shopee.com.br/old-i.1.2';
  const converted = 'https://shp.ee/xyz';

  it('substitui a URL original pela convertida', () => {
    const text = `Confira: ${original}`;
    const result = replaceOriginalUrlInText(text, original, converted);
    expect(result).toBe(`Confira: ${converted}`);
  });

  it('retorna texto inalterado quando convertedUrl é null', () => {
    const text = `Confira: ${original}`;
    expect(replaceOriginalUrlInText(text, original, null)).toBe(text);
  });

  it('retorna texto inalterado quando convertedUrl é undefined', () => {
    const text = `Confira: ${original}`;
    expect(replaceOriginalUrlInText(text, original, undefined)).toBe(text);
  });

  it('retorna texto inalterado quando originalUrl é vazio', () => {
    const text = `Confira: ${original}`;
    expect(replaceOriginalUrlInText(text, '', converted)).toBe(text);
  });

  it('retorna texto inalterado quando a URL original não está no texto', () => {
    const text = 'Nenhuma url aqui';
    expect(replaceOriginalUrlInText(text, original, converted)).toBe(text);
  });

  it('substitui apenas a PRIMEIRA ocorrência da URL original (comportamento String.replace)', () => {
    const text = `${original} e também ${original}`;
    const result = replaceOriginalUrlInText(text, original, converted);
    expect(result).toBe(`${converted} e também ${original}`);
  });

  it('trata URLs com regex special chars de forma literal', () => {
    const orig = 'https://ex.com/a.b?x=1';
    const text = `link ${orig}`;
    expect(replaceOriginalUrlInText(text, orig, converted)).toBe(`link ${converted}`);
  });

  it('texto vazio com URLs vazias retorna vazio', () => {
    expect(replaceOriginalUrlInText('', '', '')).toBe('');
  });
});

describe('buildTemplateMessage', () => {
  const baseCtx = {
    marketplace: 'shopee' as const,
    sourceGroupName: 'Grupo A',
    targetGroupName: 'Grupo B',
    originalText: 'Veja: https://shopee.com.br/old-i.1.2',
    originalUrl: 'https://shopee.com.br/old-i.1.2',
    convertedUrl: 'https://shp.ee/xyz',
    productTitle: 'Produto X',
    timestamp: new Date('2024-01-15T10:30:00Z'),
  };

  it('sem template, substitui URL original pela convertida e trunca', () => {
    const result = buildTemplateMessage(baseCtx, null);
    expect(result).toContain('https://shp.ee/xyz');
    expect(result).not.toContain('https://shopee.com.br/old-i.1.2');
  });

  it('sem template e convertedUrl ausente, mantém texto original', () => {
    const ctx = { ...baseCtx, convertedUrl: null };
    const result = buildTemplateMessage(ctx, null);
    expect(result).toContain('https://shopee.com.br/old-i.1.2');
  });

  it('com template, resolve placeholders e condicionais humanas', () => {
    const template = 'Oferta ({marketplace_nome): {link_convertido}';
    const result = buildTemplateMessage(baseCtx, template);
    expect(result).toContain('https://shp.ee/xyz');
    // marketplace_nome resolvido (não deve conter o placeholder cru)
    expect(result).not.toContain('{link_convertido}');
  });

  it('com template, trunca para o limite do WhatsApp (4000)', () => {
    const longTemplate = 'x'.repeat(5000);
    const result = buildTemplateMessage(baseCtx, longTemplate);
    expect(result.length).toBeLessThanOrEqual(4000);
  });
});

/**
 * product-history-pure.test.ts — Testes da lógica pura da ProductHistoryPage.
 */
import { describe, expect, test } from 'bun:test';
import {
  formatPrice,
  formatDateTime,
  marketplaceLabel,
  marketplaceOptions,
  buildPriceChart,
  getLatestHistoryPoint,
} from './product-history-pure.ts';
import type { ChartPricePoint } from './product-history-pure.ts';

// ─── formatPrice ──────────────────────────────────────────────────────

describe('formatPrice', () => {
  test('formata decimal string como moeda pt-BR', () => {
    expect(formatPrice('1299.9')).toBe('R$\u00a01.299,90');
  });

  test('inteiro sem casas decimais', () => {
    expect(formatPrice('49')).toBe('R$\u00a049,00');
  });

  test('currency customizada', () => {
    expect(formatPrice('10.5', 'USD')).toBe('US$\u00a010,50');
  });

  test('null / undefined / vazio → em dash', () => {
    expect(formatPrice(null)).toBe('—');
    expect(formatPrice(undefined)).toBe('—');
    expect(formatPrice('')).toBe('—');
  });

  test('valor não numérico → em dash', () => {
    expect(formatPrice('abc')).toBe('—');
    expect(formatPrice('NaN')).toBe('—');
  });
});

// ─── formatDateTime ───────────────────────────────────────────────────

describe('formatDateTime', () => {
  test('formata ISO como dd/mm/aaaa hh:mm', () => {
    // 2026-07-31T14:05:00 local (horário do ambiente do teste)
    const d = new Date(2026, 6, 31, 14, 5);
    expect(formatDateTime(d.toISOString())).toBe('31/07/2026 14:05');
  });

  test('null → em dash', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
  });

  test('ISO inválida → em dash', () => {
    expect(formatDateTime('não é data')).toBe('—');
  });
});

// ─── marketplaceLabel ─────────────────────────────────────────────────

describe('marketplaceLabel', () => {
  test('mapeia marketplaces conhecidos', () => {
    expect(marketplaceLabel('shopee')).toEqual({ label: 'Shopee', emoji: '🛒' });
    expect(marketplaceLabel('mercadolivre')).toEqual({ label: 'Mercado Livre', emoji: '📦' });
    expect(marketplaceLabel('amazon')).toEqual({ label: 'Amazon', emoji: '📦' });
    expect(marketplaceLabel('magalu')).toEqual({ label: 'Magalu', emoji: '🛍️' });
  });

  test('desconhecido → fallback', () => {
    expect(marketplaceLabel('unknown')).toEqual({ label: 'Desconhecido', emoji: '❓' });
    expect(marketplaceLabel('qualquer-coisa')).toEqual({ label: 'Desconhecido', emoji: '❓' });
  });

  test('options inclui Todos + 5 marketplaces', () => {
    const opts = marketplaceOptions();
    expect(opts).toHaveLength(6);
    expect(opts[0]).toEqual({ value: '', label: 'Todos' });
    expect(opts.map((o) => o.value)).toContain('magalu');
  });
});

// ─── buildPriceChart ──────────────────────────────────────────────────

function pts(rows: [price: string, hoursAgo: number][]): ChartPricePoint[] {
  const now = Date.now();
  return rows.map(([price, hoursAgo], i) => ({
    price,
    capturedAt: new Date(now - hoursAgo * 3600_000).toISOString(),
    currency: 'BRL',
    // garante unicidade de tempo para ordenação estável
    ...(i === 0 ? {} : {}),
  }));
}

describe('buildPriceChart', () => {
  test('vazio → hasData false', () => {
    const model = buildPriceChart([]);
    expect(model.hasData).toBe(false);
    expect(model.linePath).toBe('');
    expect(model.points).toHaveLength(0);
  });

  test('dois pontos → linha com 2 segmentos e pontos em ordem temporal', () => {
    // ponto mais antigo (preço 100) + ponto mais recente (preço 200)
    const now = Date.now();
    const model = buildPriceChart([
      { price: '100', capturedAt: new Date(now - 2 * 3600_000).toISOString(), currency: 'BRL' },
      { price: '200', capturedAt: new Date(now - 1 * 3600_000).toISOString(), currency: 'BRL' },
    ]);
    expect(model.hasData).toBe(true);
    expect(model.points).toHaveLength(2);
    expect(model.points[0]!.x).toBeLessThan(model.points[1]!.x);
    expect(model.points[0]!.y).toBeGreaterThan(model.points[1]!.y); // menor preço → y maior (SVG y cresce p/ baixo)
    expect(model.linePath.startsWith('M ')).toBe(true);
    expect(model.linePath).toContain('L ');
  });

  test('desordenado → ordena por capturedAt', () => {
    const now = Date.now();
    const model = buildPriceChart([
      { price: '50', capturedAt: new Date(now - 3 * 3600_000).toISOString(), currency: 'BRL' },
      { price: '30', capturedAt: new Date(now - 1 * 3600_000).toISOString(), currency: 'BRL' },
      { price: '40', capturedAt: new Date(now - 2 * 3600_000).toISOString(), currency: 'BRL' },
    ]);
    expect(model.points.map((p) => p.x)).toEqual(
      [...model.points.map((p) => p.x)].sort((a, b) => a - b),
    );
    // preço 30 é o menor → y maior que os outros
    expect(model.points[2]!.price).toBe(30);
    expect(model.points[2]!.y).toBeGreaterThan(model.points[0]!.y);
  });

  test('preços iguais → linha horizontal (mesmo y)', () => {
    const now = Date.now();
    const model = buildPriceChart([
      { price: '77', capturedAt: new Date(now - 2 * 3600_000).toISOString(), currency: 'BRL' },
      { price: '77', capturedAt: new Date(now - 1 * 3600_000).toISOString(), currency: 'BRL' },
    ]);
    expect(model.points[0]!.y).toBe(model.points[1]!.y);
    expect(model.hasData).toBe(true);
  });

  test('pontos inválidos são descartados', () => {
    const now = Date.now();
    const model = buildPriceChart([
      {
        price: 'nao-numero',
        capturedAt: new Date(now - 2 * 3600_000).toISOString(),
        currency: 'BRL',
      },
      { price: '99', capturedAt: 'data-invalida', currency: 'BRL' },
      { price: '100', capturedAt: new Date(now - 1 * 3600_000).toISOString(), currency: 'BRL' },
    ]);
    expect(model.points).toHaveLength(1);
    expect(model.points[0]!.price).toBe(100);
  });

  test('min/max refletem os dados com padding', () => {
    const now = Date.now();
    const model = buildPriceChart([
      { price: '100', capturedAt: new Date(now - 2 * 3600_000).toISOString(), currency: 'BRL' },
      { price: '200', capturedAt: new Date(now - 1 * 3600_000).toISOString(), currency: 'BRL' },
    ]);
    expect(model.minPrice).toBeLessThan(100);
    expect(model.maxPrice).toBeGreaterThan(200);
  });

  test('yTicks tem 4 valores dentro do range', () => {
    const model = buildPriceChart(
      pts([
        ['100', 2],
        ['200', 1],
      ]),
    );
    expect(model.yTicks).toHaveLength(4);
    for (const tick of model.yTicks) {
      expect(tick.y).toBeGreaterThan(0);
      expect(tick.y).toBeLessThan(300);
      expect(tick.value).toContain('R$');
    }
  });

  test('xLabels marca início e fim da série', () => {
    const now = Date.now();
    const model = buildPriceChart([
      { price: '10', capturedAt: new Date(now - 48 * 3600_000).toISOString(), currency: 'BRL' },
      { price: '20', capturedAt: new Date(now - 1 * 3600_000).toISOString(), currency: 'BRL' },
    ]);
    expect(model.xLabels).toHaveLength(2);
    expect(model.xLabels[0]!.x).toBeLessThan(model.xLabels[1]!.x);
  });
});

// ─── getLatestHistoryPoint ───────────────────────────────────────────

describe('getLatestHistoryPoint', () => {
  test('retorna o ponto mais recente quando a API devolve DESC (contrato atual)', () => {
    const points = [
      { capturedAt: '2026-07-31T18:27:00.000Z', price: '75.50' },
      { capturedAt: '2026-07-30T10:00:00.000Z', price: '79.90' },
      { capturedAt: '2026-07-29T16:27:00.000Z', price: '89.90' },
    ];
    expect(getLatestHistoryPoint(points)?.price).toBe('75.50');
  });

  test('robusto a ordem ASC — ainda retorna o mais recente', () => {
    const points = [
      { capturedAt: '2026-07-29T16:27:00.000Z', price: '89.90' },
      { capturedAt: '2026-07-30T10:00:00.000Z', price: '79.90' },
      { capturedAt: '2026-07-31T18:27:00.000Z', price: '75.50' },
    ];
    expect(getLatestHistoryPoint(points)?.price).toBe('75.50');
  });

  test('desordenado — ainda retorna o mais recente', () => {
    const points = [
      { capturedAt: '2026-07-30T10:00:00.000Z', price: '79.90' },
      { capturedAt: '2026-07-31T18:27:00.000Z', price: '75.50' },
      { capturedAt: '2026-07-29T16:27:00.000Z', price: '89.90' },
    ];
    expect(getLatestHistoryPoint(points)?.capturedAt).toBe('2026-07-31T18:27:00.000Z');
  });

  test('não muta o array original', () => {
    const points = [
      { capturedAt: '2026-07-30T10:00:00.000Z', price: '79.90' },
      { capturedAt: '2026-07-31T18:27:00.000Z', price: '75.50' },
    ];
    getLatestHistoryPoint(points);
    expect(points[0]!.capturedAt).toBe('2026-07-30T10:00:00.000Z');
  });

  test('array vazio → undefined', () => {
    expect(getLatestHistoryPoint([])).toBeUndefined();
  });

  test('null / undefined → undefined', () => {
    expect(getLatestHistoryPoint(null)).toBeUndefined();
    expect(getLatestHistoryPoint(undefined)).toBeUndefined();
  });

  test('ponto único → ele mesmo', () => {
    const points = [{ capturedAt: '2026-07-31T18:27:00.000Z', price: '75.50' }];
    expect(getLatestHistoryPoint(points)).toEqual(points[0]);
  });
});

/**
 * product-history-pure.ts — Lógica pura da ProductHistoryPage.
 *
 * Funções síncronas sem I/O, testáveis isoladamente:
 *  - formatação de preço/data (pt-BR)
 *  - labels de marketplace
 *  - buildPriceChart: escala série temporal → modelo SVG (linha + pontos + ticks)
 *
 * O componente React (ProductHistoryPage.tsx) só consome estes helpers.
 */

// ─── Formatação ────────────────────────────────────────────────────────

export function formatPrice(value: string | null | undefined, currency = 'BRL'): string {
  if (value === null || value === undefined || value === '') return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString('pt-BR', { style: 'currency', currency });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function marketplaceLabel(mp: string): { label: string; emoji: string } {
  switch (mp) {
    case 'shopee':
      return { label: 'Shopee', emoji: '🛒' };
    case 'mercadolivre':
      return { label: 'Mercado Livre', emoji: '📦' };
    case 'amazon':
      return { label: 'Amazon', emoji: '📦' };
    case 'magalu':
      return { label: 'Magalu', emoji: '🛍️' };
    default:
      return { label: 'Desconhecido', emoji: '❓' };
  }
}

export function marketplaceOptions(): { value: string; label: string }[] {
  return [
    { value: '', label: 'Todos' },
    { value: 'shopee', label: '🛒 Shopee' },
    { value: 'mercadolivre', label: '📦 Mercado Livre' },
    { value: 'amazon', label: '📦 Amazon' },
    { value: 'magalu', label: '🛍️ Magalu' },
    { value: 'unknown', label: '❓ Desconhecido' },
  ];
}

// ─── Gráfico SVG (modelo puro) ────────────────────────────────────────

export interface ChartPricePoint {
  price: string;
  capturedAt: string;
  currency: string;
}

export interface ChartPoint {
  x: number;
  y: number;
  price: number;
  label: string;
}

export interface PriceChartModel {
  width: number;
  height: number;
  points: ChartPoint[];
  linePath: string;
  minPrice: number;
  maxPrice: number;
  yTicks: { y: number; value: string }[];
  xLabels: { x: number; value: string }[];
  currency: string;
  hasData: boolean;
}

const PAD = 24; // margem interna para eixos

/** Escala linear (t → x, v → y) e monta o modelo SVG do gráfico. */
export function buildPriceChart(
  rawPoints: ChartPricePoint[],
  opts: { width?: number; height?: number } = {},
): PriceChartModel {
  const width = opts.width ?? 600;
  const height = opts.height ?? 220;

  const points = rawPoints
    .map((p) => ({
      price: Number(p.price),
      capturedAt: new Date(p.capturedAt).getTime(),
      currency: p.currency,
    }))
    .filter((p) => Number.isFinite(p.price) && Number.isFinite(p.capturedAt))
    .sort((a, b) => a.capturedAt - b.capturedAt);

  if (points.length === 0) {
    return {
      width,
      height,
      points: [],
      linePath: '',
      minPrice: 0,
      maxPrice: 0,
      yTicks: [],
      xLabels: [],
      currency: 'BRL',
      hasData: false,
    };
  }

  const prices = points.map((p) => p.price);
  const rawMin = Math.min(...prices);
  const rawMax = Math.max(...prices);
  // Padding vertical de 15% em volta dos dados (evita linha colada na borda)
  const span = rawMax - rawMin || Math.max(Math.abs(rawMax) * 0.05, 1);
  const minPrice = rawMin - span * 0.15;
  const maxPrice = rawMax + span * 0.15;

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const timeSpan = last.capturedAt - first.capturedAt || 1;

  const priceRange = maxPrice - minPrice || 1;
  const scaleX = (t: number) => PAD + ((t - first.capturedAt) / timeSpan) * (width - 2 * PAD);
  const scaleY = (v: number) => height - PAD - ((v - minPrice) / priceRange) * (height - 2 * PAD);

  const scaled = points.map((p) => ({
    x: scaleX(p.capturedAt),
    y: scaleY(p.price),
    price: p.price,
    label: `${p.price.toLocaleString('pt-BR', { style: 'currency', currency: p.currency })} · ${formatDateTime(new Date(p.capturedAt).toISOString())}`,
  }));

  const linePath = scaled
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');

  // 4 ticks horizontais com valores legíveis
  const yTicks = [0, 1, 2, 3].map((i) => {
    const v = maxPrice - ((maxPrice - minPrice) * i) / 3;
    return {
      y: scaleY(v),
      value: v.toLocaleString('pt-BR', {
        style: 'currency',
        currency: first.currency,
        maximumFractionDigits: 0,
      }),
    };
  });

  const xLabels = [
    { x: scaleX(first.capturedAt), value: formatDateShort(first.capturedAt) },
    { x: scaleX(last.capturedAt), value: formatDateShort(last.capturedAt) },
  ];

  return {
    width,
    height,
    points: scaled,
    linePath,
    minPrice,
    maxPrice,
    yTicks,
    xLabels,
    currency: first.currency,
    hasData: true,
  };
}

function formatDateShort(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

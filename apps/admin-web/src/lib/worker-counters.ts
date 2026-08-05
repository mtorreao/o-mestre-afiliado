/**
 * Helpers para parsear e agregar contadores Prometheus com labels.
 *
 * O metrics-server retorna `counters` como chaves flat:
 *   "pipeline_messages_received_total"                                    → 12
 *   "pipeline_messages_blocked_total{reason=conversion_failed}"           → 3
 *   "sender_messages_sent_total{marketplace=shopee}"                      → 47
 *
 * Esta camada transforma essas chaves em objetos estruturados para a UI.
 */

export interface CounterKey {
  /** Nome base (sem labels), ex: "pipeline_messages_blocked_total" */
  name: string;
  /** Labels parseadas, ex: { reason: "conversion_failed" } */
  labels: Record<string, string>;
}

/**
 * Parseia uma chave de counter Prometheus.
 * Aceita tanto chaves sem labels quanto com labels no formato `{k=v,k=v}`.
 *
 * @example
 *   parseCounterKey("sender_messages_sent_total{marketplace=shopee}")
 *   // { name: "sender_messages_sent_total", labels: { marketplace: "shopee" } }
 */
export function parseCounterKey(raw: string): CounterKey {
  const openBrace = raw.indexOf('{');
  if (openBrace === -1) {
    return { name: raw, labels: {} };
  }
  const name = raw.slice(0, openBrace);
  const closeBrace = raw.lastIndexOf('}');
  const inner = closeBrace > openBrace ? raw.slice(openBrace + 1, closeBrace) : '';
  const labels: Record<string, string> = {};
  if (inner) {
    for (const pair of inner.split(',')) {
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      const key = pair.slice(0, eq).trim();
      let value = pair.slice(eq + 1).trim();
      // Strip surrounding quotes se vierem do escape Prometheus
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      if (key) labels[key] = value;
    }
  }
  return { name, labels };
}

/**
 * Soma TODOS os valores de contadores com o nome base `name`,
 * independente das labels. Útil para "total de mensagens recebidas".
 */
export function sumByName(
  counters: Record<string, number | string> | undefined,
  name: string,
): number {
  if (!counters) return 0;
  let total = 0;
  for (const [key, value] of Object.entries(counters)) {
    if (parseCounterKey(key).name !== name) continue;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isNaN(n)) total += n;
  }
  return total;
}

/**
 * Agrupa valores de um counter por valor de uma label específica.
 * Útil para "Enviadas por marketplace" → { shopee: 47, mercadolivre: 12, amazon: 3 }.
 *
 * @returns objeto com chave = valor da label, valor = soma (1 counter por chave neste projeto)
 */
export function aggregateByLabel(
  counters: Record<string, number | string> | undefined,
  name: string,
  labelKey: string,
): Record<string, number> {
  const result: Record<string, number> = {};
  if (!counters) return result;
  for (const [key, value] of Object.entries(counters)) {
    const parsed = parseCounterKey(key);
    if (parsed.name !== name) continue;
    const labelValue = parsed.labels[labelKey];
    if (!labelValue) continue;
    const n = typeof value === 'number' ? value : Number(value);
    if (Number.isNaN(n)) continue;
    // Se houver múltiplos counters com o mesmo label value (raro, mas possível),
    // soma. Caso comum: 1 entrada por combinação de labels.
    result[labelValue] = (result[labelValue] ?? 0) + n;
  }
  return result;
}

/**
 * Lista os pares (labelValue, value) de um counter, ordenados por value desc.
 * Útil para renderizar "Top reasons de bloqueio".
 */
export function rankedByLabel(
  counters: Record<string, number | string> | undefined,
  name: string,
  labelKey: string,
): Array<{ label: string; value: number }> {
  const aggregated = aggregateByLabel(counters, name, labelKey);
  return Object.entries(aggregated)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

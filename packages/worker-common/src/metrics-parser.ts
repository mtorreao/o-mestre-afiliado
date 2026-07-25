/**
 * Parser de métricas Prometheus (text format).
 *
 * Extrai counters simples e labels. Não é um parser completo — apenas o
 * necessário para o healthcheck.
 */

/**
 * Extrai o valor de um counter do formato Prometheus text.
 * Se houver múltiplas séries (com labels diferentes), soma todos.
 *
 * @example
 *   pipeline_messages_received_total 42
 *   pipeline_messages_received_total{instance="a"} 10
 *   pipeline_messages_received_total{instance="b"} 5
 *   parsePromCounter(text, 'pipeline_messages_received_total') // → 57
 */
export function parsePromCounter(text: string, name: string): number {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match: nome (sem labels) OU nome{labels} → seguido de valor numérico
  const regex = new RegExp(`^${escaped}(?:\\{[^}]*\\})?\\s+([0-9eE.+-]+)$`, 'gm');
  let total = 0;
  for (const match of text.matchAll(regex)) {
    const value = parseFloat(match[1]!);
    if (!Number.isNaN(value)) total += value;
  }
  return total;
}
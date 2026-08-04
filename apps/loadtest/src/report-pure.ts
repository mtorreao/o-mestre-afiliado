/**
 * report-pure.ts — renderizacao pura do relatorio de carga (texto).
 * Sem I/O: recebe o summary + SLO e devolve string. Testavel.
 */

import type { RunSummary, SloResult } from './metrics-pure.ts';

function pad(label: string, value: string): string {
  return `${label.padEnd(22)} ${value}`;
}

export function renderReport(
  title: string,
  summary: RunSummary,
  sloResult: SloResult | null,
): string {
  const lines: string[] = [];
  lines.push('═'.repeat(60));
  lines.push(`  ${title}`);
  lines.push('═'.repeat(60));
  lines.push(pad('Total de reqs', String(summary.total)));
  lines.push(pad('Erros (transporte)', String(summary.errors)));
  lines.push(pad('Throughput', `${summary.rps.toFixed(1)} req/s`));
  lines.push(pad('Janela', `${(summary.windowMs / 1000).toFixed(1)} s`));
  lines.push(pad('2xx', String(summary.status['2xx'])));
  lines.push(pad('3xx', String(summary.status['3xx'])));
  lines.push(pad('4xx', String(summary.status['4xx'])));
  lines.push(pad('5xx', String(summary.status['5xx'])));
  lines.push(pad('erro transporte', String(summary.status.error)));
  lines.push('─'.repeat(60));
  lines.push(
    pad(
      'Latência (ms)',
      `min ${summary.latency.min.toFixed(0)} / p50 ${summary.latency.p50.toFixed(
        0,
      )} / p95 ${summary.latency.p95.toFixed(0)} / p99 ${summary.latency.p99.toFixed(
        0,
      )} / max ${summary.latency.max.toFixed(0)}`,
    ),
  );
  lines.push('═'.repeat(60));
  if (sloResult) {
    if (sloResult.passed) {
      lines.push('  ✅ SLO APROVADO');
    } else {
      lines.push('  ❌ SLO REPROVADO:');
      for (const f of sloResult.failures) lines.push(`     - ${f}`);
    }
  } else {
    lines.push('  (sem SLO configurado)');
  }
  lines.push('═'.repeat(60));
  return lines.join('\n');
}

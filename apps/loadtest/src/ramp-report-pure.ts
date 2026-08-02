/**
 * ramp-report-pure.ts — renderizacao pura do relatorio de ramp-up. Sem I/O.
 */

import type { RampAnalysis, StageResult } from './ramp-pure.ts';

function pct(part: number, total: number): string {
  if (total <= 0) return '0.0';
  return ((part / total) * 100).toFixed(1);
}

export function renderRampReport(
  name: string,
  stages: StageResult[],
  analysis: RampAnalysis,
): string {
  const lines: string[] = [];
  lines.push('='.repeat(74));
  lines.push('  RAMP-UP: ' + name);
  lines.push('='.repeat(74));
  const header =
    '#'.padStart(3) +
    ' ' +
    'conc'.padStart(5) +
    ' ' +
    'rps'.padStart(8) +
    ' ' +
    'p50'.padStart(6) +
    ' ' +
    'p95'.padStart(6) +
    ' ' +
    'p99'.padStart(6) +
    ' ' +
    '5xx%'.padStart(6) +
    ' ' +
    'err%'.padStart(6) +
    ' ' +
    'SLO'.padStart(5);
  lines.push(header);
  lines.push('-'.repeat(74));

  for (const s of stages) {
    const slo = s.slo ? (s.slo.passed ? 'OK' : 'FAIL') : '-';
    const row =
      String(s.stage).padStart(3) +
      ' ' +
      String(s.concurrency).padStart(5) +
      ' ' +
      s.summary.rps.toFixed(0).padStart(8) +
      ' ' +
      s.summary.latency.p50.toFixed(0).padStart(6) +
      ' ' +
      s.summary.latency.p95.toFixed(0).padStart(6) +
      ' ' +
      s.summary.latency.p99.toFixed(0).padStart(6) +
      ' ' +
      pct(s.summary.status['5xx'], s.summary.total).padStart(6) +
      ' ' +
      pct(s.summary.errors, s.summary.total).padStart(6) +
      ' ' +
      slo.padStart(5);
    lines.push(row);
  }

  lines.push('-'.repeat(74));
  if (analysis.breachedSloStage !== null) {
    const c = stages[analysis.breachedSloStage - 1]?.concurrency;
    lines.push('  X SLO rompido no estagio ' + analysis.breachedSloStage + ' (conc ' + c + ')');
  }
  if (analysis.saturationStage !== null) {
    const c = stages[analysis.saturationStage - 1]?.concurrency;
    lines.push(
      '  ! Saturacao detectada em conc ' + c + ' (estagio ' + analysis.saturationStage + ')',
    );
    lines.push('  Capacidade estimada: ' + analysis.capacityRps.toFixed(0) + ' req/s');
  } else {
    lines.push('  OK Sem saturacao detectada no intervalo testado.');
  }
  for (const r of analysis.reasons) lines.push('     - ' + r);
  lines.push('='.repeat(74));
  return lines.join('\n');
}

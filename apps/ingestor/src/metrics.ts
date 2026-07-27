/**
 * Step Trackers e counters Prometheus do Ingestor.
 *
 * - `steps`: instâncias de StepTracker usadas para medir duração de
 *   etapas do pipeline (dedup, extract, blacklist, whitelist, etc.).
 * - `initMetrics()`: registra os counters + step trackers no
 *   `metrics-server` do @omestre/worker-common.
 */
import { StepTracker, registerStepTrackers, createCounter } from '@omestre/worker-common';

export const steps = {
  dedup: new StepTracker(),
  extract: new StepTracker(),
  blacklist: new StepTracker(),
  whitelist: new StepTracker(),
  imageFetch: new StepTracker(),
  fanOut: new StepTracker(),
  total: new StepTracker(),
};

export function initMetrics(): void {
  registerStepTrackers(steps);

  createCounter('pipeline_messages_received_total', 'Mensagens recebidas da Queue A');
  createCounter('pipeline_messages_blocked_total', 'Mensagens bloqueadas', ['reason']);
  createCounter('pipeline_affiliates_per_message', 'Afiliados por mensagem', ['count']);
  createCounter('pipeline_send_events_published_total', 'SendEvents publicados na Queue B', [
    'count',
  ]);
  createCounter('pipeline_image_fetch_total', 'Resultado da busca de imagem', [
    'marketplace',
    'result',
  ]);
  createCounter(
    'pipeline_image_missing_fallback_total',
    'Ofertas enviadas como texto (sem imagem)',
    ['marketplace'],
  );
}

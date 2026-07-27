/**
 * Métricas Prometheus e Step Trackers do Dispatcher.
 *
 * - `steps`: instâncias de StepTracker usadas para medir duração de
 *   etapas do pipeline (rateLimitWait, send, total).
 * - `initMetrics()`: registra os counters + step trackers no
 *   `metrics-server` do @omestre/worker-common.
 *
 * O pipeline principal importa `steps` para usar com `measureStep()`;
 * `index.ts` chama `initMetrics()` no startup do worker.
 */
import { StepTracker, registerStepTrackers, createCounter } from '@omestre/worker-common';

export const steps = {
  rateLimitWait: new StepTracker(),
  send: new StepTracker(),
  total: new StepTracker(),
};

export function initMetrics(): void {
  registerStepTrackers(steps);

  createCounter('sender_events_received_total', 'SendEvents recebidos da Queue B');
  createCounter('sender_messages_sent_total', 'Mensagens enviadas com sucesso', ['marketplace']);
  createCounter('sender_messages_sent_with_image_total', 'Mensagens enviadas com imagem');
  createCounter('sender_messages_skipped_total', 'Mensagens descartadas sem enviar', ['reason']);
  createCounter('sender_failures_total', 'Falhas de envio', ['type', 'marketplace']);
}

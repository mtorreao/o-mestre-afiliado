/**
 * @omestre/worker-common — Código compartilhado entre Ingestor e Dispatcher.
 *
 * Módulos:
 *   - step-tracker  → StepTracker, measureStep, measureStepSync
 *   - dead-letter-queue → DLQ compartilhada (Redis LIST + ZSET)
 *   - notifier      → Sistema de notificações proativas (cooldown, acumulação)
 *   - metrics-server → Servidor HTTP /health, /status, /metrics, /dlq/*
 */

export { StepTracker, measureStep, measureStepSync } from './step-tracker.ts';

export {
  pushToDLQ,
  listDLQ,
  getDLQItem,
  requeueFromDLQ,
  removeFromDLQ,
  countDLQ,
  purgeOldDLQItems,
} from './dead-letter-queue.ts';
export type {
  DLQPushParams,
  DLQListOptions,
  DLQListResult,
} from './dead-letter-queue.ts';

export {
  classifyConversionError,
  getNotifiableType,
  isInCooldown,
  setCooldown,
  incrementOccurrence,
  processFailure,
  notifyDirect,
} from './notifier.ts';
export type {
  UserFixableType,
  SilentType,
  FailureType,
} from './notifier.ts';

export {
  startMetricsServer,
  stopMetricsServer,
  resetMetrics,
  getStatusResponse,
  registerStepTrackers,
  setStatusMeta,
  createCounter,
  createHistogram,
  incrementCounter,
  observeHistogram,
  getMetrics,
  trackError,
} from './metrics-server.ts';
export type { StepTrackers, StatusResponse } from './metrics-server.ts';
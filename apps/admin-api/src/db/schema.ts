/**
 * Schema Postgres `omestre_admin` — tabelas do admin-api.
 *
 * Cobertura:
 *
 *   backup        — histórico de backups (R2 key, sha256, sizes, status)
 *   deployment    — histórico de deploys (tag, sha, status, actor)
 *   audit_log     — ações sensíveis (login, deploy, backup, restore)
 *   session       — sessões (single-user hoje, preparado p/ multi)
 *   alert         — alertas operacionais (backup falhou, deploy quebrou)
 *   health_check  — snapshots de health check de Postgres/Redis/etc
 *
 * Idempotente: cada tabela tem `IF NOT EXISTS` na migration.
 */
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgSchema,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { omestreAdmin } from './omestre-admin.ts';

/* ─── Enums ──────────────────────────────────────────────────────────── */

export const backupTypeEnum = pgEnum('omestre_admin_backup_type', ['auto', 'manual']);
export const backupStatusEnum = pgEnum('omestre_admin_backup_status', [
  'pending',
  'running',
  'success',
  'failed',
  'deleted',
]);
export const deploymentStatusEnum = pgEnum('omestre_admin_deployment_status', [
  'active',
  'superseded',
  'rolled_back',
  'failed',
]);
export const deploymentTriggerEnum = pgEnum('omestre_admin_deployment_trigger', [
  'tag',
  'manual',
  'auto',
]);
export const auditStatusEnum = pgEnum('omestre_admin_audit_status', ['success', 'failed']);
export const alertSeverityEnum = pgEnum('omestre_admin_alert_severity', [
  'info',
  'warning',
  'critical',
]);
export const healthStatusEnum = pgEnum('omestre_admin_health_status', [
  'healthy',
  'degraded',
  'unhealthy',
]);

/* ─── Tabelas ────────────────────────────────────────────────────────── */

/**
 * Histórico de backups cifrados no R2.
 * Cada backup = 1 linha (status: pending → running → success/failed).
 */
export const backup = omestreAdmin.table(
  'backup',
  {
    id: serial('id').primaryKey(),
    tag: text('tag').notNull().unique(),
    type: backupTypeEnum('type').notNull(),
    status: backupStatusEnum('status').notNull().default('pending'),
    schemas: text('schemas').notNull(),

    // Identificação no R2
    r2Key: text('r2_key'),
    r2Bucket: text('r2_bucket'),

    // Checksums + sizes
    sha256: text('sha256'),
    sizeBytes: integer('size_bytes'),
    ciphertextSize: integer('ciphertext_size'),

    // Métricas (preenchidas no success path)
    pgDumpMs: integer('pg_dump_ms'),
    encryptMs: integer('encrypt_ms'),
    uploadMs: integer('upload_ms'),
    totalMs: integer('total_ms'),

    // Erro (preenchido no failure path)
    errorCode: text('error_code'),
    errorMessage: text('error_message'),

    // Quem disparou
    createdBy: text('created_by').notNull(),

    // Timestamps (ISO 8601)
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index('idx_backup_status').on(table.status),
    startedAtIdx: index('idx_backup_started_at').on(table.startedAt.desc()),
  }),
);

/**
 * Histórico de deploys (já temos registry local em JSON no VPS, este é
 * a versão persistida para query via admin-center).
 */
export const deployment = omestreAdmin.table(
  'deployment',
  {
    id: serial('id').primaryKey(),
    tag: text('tag').notNull(),
    sha: text('sha').notNull(),
    status: deploymentStatusEnum('status').notNull(),
    triggeredBy: deploymentTriggerEnum('triggered_by').notNull(),
    actorEmail: text('actor_email'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    errorMessage: text('error_message'),
    gitSshUrl: text('git_ssh_url'),
    deployedTo: text('deployed_to').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index('idx_deployment_status').on(table.status),
    startedAtIdx: index('idx_deployment_started_at').on(table.startedAt.desc()),
  }),
);

/**
 * Audit log — ações sensíveis são registradas com metadata.
 * Sample: 'login', 'backup.run', 'deployment.rollback', 'restore'.
 */
export const auditLog = omestreAdmin.table(
  'audit_log',
  {
    id: serial('id').primaryKey(),
    actorEmail: text('actor_email').notNull(),
    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    status: auditStatusEnum('status').notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    actionIdx: index('idx_audit_log_action').on(table.action),
    createdAtIdx: index('idx_audit_log_created_at').on(table.createdAt.desc()),
  }),
);

/**
 * Sessões do admin (single-user hoje, mas o schema suporta multi).
 */
export const session = omestreAdmin.table('session', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  csrfToken: text('csrf_token').notNull(),
  encryptedPayload: text('encrypted_payload').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Alertas operacionais (geralmente resultado de health checks repetidos).
 */
export const alert = omestreAdmin.table(
  'alert',
  {
    id: serial('id').primaryKey(),
    severity: alertSeverityEnum('severity').notNull(),
    source: text('source').notNull(),
    title: text('title').notNull(),
    message: text('message'),
    metadata: jsonb('metadata'),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    acknowledgedBy: text('acknowledged_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    createdAtIdx: index('idx_alert_created_at').on(table.createdAt.desc()),
  }),
);

/**
 * Health checks — snapshots periódicos (cron) para visualização no portal.
 */
export const healthCheck = omestreAdmin.table(
  'health_check',
  {
    id: serial('id').primaryKey(),
    source: text('source').notNull(),
    status: healthStatusEnum('status').notNull(),
    latencyMs: integer('latency_ms'),
    httpStatusCode: integer('http_status_code'),
    errorMessage: text('error_message'),
    metadata: jsonb('metadata'),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    checkedAtIdx: index('idx_health_check_checked_at').on(table.checkedAt.desc()),
  }),
);

/* ─── Types (Drizzle infers) ─────────────────────────────────────────── */

export type Backup = typeof backup.$inferSelect;
export type NewBackup = typeof backup.$inferInsert;
export type Deployment = typeof deployment.$inferSelect;
export type NewDeployment = typeof deployment.$inferInsert;
export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
export type Session = typeof session.$inferSelect;
export type NewSession = typeof session.$inferInsert;
export type Alert = typeof alert.$inferSelect;
export type NewAlert = typeof alert.$inferInsert;
export type HealthCheck = typeof healthCheck.$inferSelect;
export type NewHealthCheck = typeof healthCheck.$inferInsert;

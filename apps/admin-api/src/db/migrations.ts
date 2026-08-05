/**
 * Migrations SQL do admin-api (schema `omestre_admin`).
 *
 * Diferente de @omestre/db (que usa drizzle-kit generate), o admin-api
 * mantém migrations em SQL manual porque:
 *   1. São 6 tabelas — não justifica o overhead de gerar
 *   2. SQL é legível e auditável via git diff
 *   3. CREATE ... IF NOT EXISTS é idempotente (safe re-run)
 *
 * Execução: rodado automaticamente pelo `migrateAdminDb()` no
 * startup do admin-api (após `createAdminDb`).
 *
 * Convenção: prefixo `omestre_admin_` em enums (evita colisão de nomes
 * nos domínios Postgres compartidos `omestre`, `evolution_api`).
 */
export const ADMIN_MIGRATIONS: readonly string[] = [
  // Schema vazio — `pgSchema` cria implicitamente, mas garantimos
  // existência por idempotência.
  `CREATE SCHEMA IF NOT EXISTS omestre_admin`,

  // Enums (CREATE TYPE não tem IF NOT EXISTS nativo — exige DO block).
  `DO $$ BEGIN
    CREATE TYPE omestre_admin.omestre_admin_backup_type AS ENUM ('auto', 'manual');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    CREATE TYPE omestre_admin.omestre_admin_backup_status AS ENUM (
      'pending', 'running', 'success', 'failed', 'deleted'
    );
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    CREATE TYPE omestre_admin.omestre_admin_deployment_status AS ENUM (
      'active', 'superseded', 'rolled_back', 'failed'
    );
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    CREATE TYPE omestre_admin.omestre_admin_deployment_trigger AS ENUM (
      'tag', 'manual', 'auto'
    );
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    CREATE TYPE omestre_admin.omestre_admin_audit_status AS ENUM ('success', 'failed');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    CREATE TYPE omestre_admin.omestre_admin_alert_severity AS ENUM (
      'info', 'warning', 'critical'
    );
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    CREATE TYPE omestre_admin.omestre_admin_health_status AS ENUM (
      'healthy', 'degraded', 'unhealthy'
    );
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  // Tabela: backup — histórico de backups cifrados no R2.
  `CREATE TABLE IF NOT EXISTS omestre_admin.backup (
    id SERIAL PRIMARY KEY,
    tag TEXT NOT NULL UNIQUE,
    type omestre_admin.omestre_admin_backup_type NOT NULL,
    status omestre_admin.omestre_admin_backup_status NOT NULL DEFAULT 'pending',
    schemas TEXT NOT NULL,
    r2_key TEXT,
    r2_bucket TEXT,
    sha256 TEXT,
    size_bytes INTEGER,
    ciphertext_size INTEGER,
    pg_dump_ms INTEGER,
    encrypt_ms INTEGER,
    upload_ms INTEGER,
    total_ms INTEGER,
    error_code TEXT,
    error_message TEXT,
    created_by TEXT NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    finished_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_backup_status ON omestre_admin.backup(status)`,
  `CREATE INDEX IF NOT EXISTS idx_backup_started_at ON omestre_admin.backup(started_at DESC)`,

  // Tabela: deployment — histórico de deploys.
  `CREATE TABLE IF NOT EXISTS omestre_admin.deployment (
    id SERIAL PRIMARY KEY,
    tag TEXT NOT NULL,
    sha TEXT NOT NULL,
    status omestre_admin.omestre_admin_deployment_status NOT NULL,
    triggered_by omestre_admin.omestre_admin_deployment_trigger NOT NULL,
    actor_email TEXT,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    finished_at TIMESTAMP WITH TIME ZONE,
    duration_ms INTEGER,
    error_message TEXT,
    git_ssh_url TEXT,
    deployed_to TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_deployment_status ON omestre_admin.deployment(status)`,
  `CREATE INDEX IF NOT EXISTS idx_deployment_started_at ON omestre_admin.deployment(started_at DESC)`,

  // Tabela: audit_log — ações sensíveis (login, deploy, backup).
  `CREATE TABLE IF NOT EXISTS omestre_admin.audit_log (
    id SERIAL PRIMARY KEY,
    actor_email TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    ip_address TEXT,
    user_agent TEXT,
    request_id TEXT,
    status omestre_admin.omestre_admin_audit_status NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_action ON omestre_admin.audit_log(action)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON omestre_admin.audit_log(created_at DESC)`,

  // Tabela: session — sessões (single-user, preparado p/ multi).
  `CREATE TABLE IF NOT EXISTS omestre_admin.session (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    csrf_token TEXT NOT NULL,
    encrypted_payload TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_session_expires_at ON omestre_admin.session(expires_at)`,

  // Tabela: alert — alertas operacionais.
  `CREATE TABLE IF NOT EXISTS omestre_admin.alert (
    id SERIAL PRIMARY KEY,
    severity omestre_admin.omestre_admin_alert_severity NOT NULL,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT,
    metadata JSONB,
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    acknowledged_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_alert_created_at ON omestre_admin.alert(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_alert_unread ON omestre_admin.alert(acknowledged_at) WHERE acknowledged_at IS NULL`,

  // Tabela: health_check — snapshots de health check.
  `CREATE TABLE IF NOT EXISTS omestre_admin.health_check (
    id SERIAL PRIMARY KEY,
    source TEXT NOT NULL,
    status omestre_admin.omestre_admin_health_status NOT NULL,
    latency_ms INTEGER,
    http_status_code INTEGER,
    error_message TEXT,
    metadata JSONB,
    checked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_health_check_checked_at ON omestre_admin.health_check(checked_at DESC)`,
];

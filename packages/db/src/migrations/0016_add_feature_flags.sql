-- Migration: 0016_add_feature_flags.sql
-- Cria tabela de feature flags admin-only
CREATE TABLE omestre.feature_flags (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

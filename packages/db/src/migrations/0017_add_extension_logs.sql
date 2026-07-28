-- Migration: 0017_add_extension_logs.sql
-- Tabela para logs estruturados enviados pela extensão Chrome.
-- Auth via API key dedicada (X-Extension-Logs-Key) — escopo apenas inserir.
-- Retenção: 7 dias (cleanup job separado).
CREATE TABLE omestre.extension_logs (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_email TEXT,
  level TEXT NOT NULL,
  event TEXT NOT NULL,
  data JSONB,
  extension_version TEXT NOT NULL,
  chrome_version TEXT,
  user_agent TEXT,
  received_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_extension_logs_session_id ON omestre.extension_logs (session_id);
CREATE INDEX idx_extension_logs_received_at ON omestre.extension_logs (received_at DESC);
CREATE INDEX idx_extension_logs_user_email ON omestre.extension_logs (user_email) WHERE user_email IS NOT NULL;
CREATE SCHEMA IF NOT EXISTS omestre;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS omestre.auth_refresh_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  family_id UUID NOT NULL,
  revoked_at TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE omestre.auth_refresh_tokens
  ADD CONSTRAINT auth_refresh_tokens_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES omestre.users(id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id
  ON omestre.auth_refresh_tokens (user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family_id
  ON omestre.auth_refresh_tokens (family_id);

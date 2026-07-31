-- Migration: 0019_add_users_is_admin.sql
-- Adiciona coluna is_admin em users para suportar admin bootstrap via ADMIN_EMAILS.
-- Default false (todos começam não-admin); ADMIN_EMAILS é aplicado em
-- apps/api/src/modules/auth/auth.routes.ts (login + register).
ALTER TABLE omestre.users
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;
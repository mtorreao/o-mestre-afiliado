-- Migration: 0004_add_revalidation_columns.sql
-- Adds columns for periodic group revalidation tracking.

ALTER TABLE omestre.affiliates
  ADD COLUMN IF NOT EXISTS last_validated_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS last_validation_passed BOOLEAN,
  ADD COLUMN IF NOT EXISTS last_validation_report JSONB;

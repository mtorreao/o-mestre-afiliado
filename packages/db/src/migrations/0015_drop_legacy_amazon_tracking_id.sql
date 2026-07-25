-- Migration 0015: Remove coluna legada user_credentials.amazon_tracking_id
--
-- A coluna amazon_tracking_id (criada em 0007 / 0009) era usada pelo modelo
-- antigo "1 tracking ID por usuário". Foi substituída por amazon_affiliates
-- (1:1 com users, com array jsonb tracking_ids de até 100 entries).
--
-- Migration 0014 já fez o backfill: copiou todos os amazon_tracking_id
-- existentes para amazon_affiliates.tracking_ids[0] (com isDefault=true).
--
-- Esta migration remove a coluna legada. Após rodar:
--   - PUT /api/affiliate/profile não aceita mais `amazonTrackingId` (404 no JSON body)
--   - GET /api/affiliate/profile continua retornando `profile.amazonTrackingId`
--     (campo derivado: tracking ID default do novo modelo amazon_affiliates)
--   - Afiliados usam /api/amazon/affiliate/tracking-ids para gerenciar tracking IDs

ALTER TABLE "omestre"."user_credentials" DROP COLUMN IF EXISTS "amazon_tracking_id";

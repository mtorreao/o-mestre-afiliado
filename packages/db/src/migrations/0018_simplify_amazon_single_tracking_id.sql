-- Migration 0018: simplifica integração Amazon para um Tracking ID.
-- Mantém o primeiro ID existente por usuário e remove o apelido sem uso funcional.

UPDATE "omestre"."amazon_affiliates"
SET "tracking_ids" = CASE
  WHEN jsonb_array_length("tracking_ids") = 0 THEN '[]'::jsonb
  ELSE jsonb_build_array(
    ("tracking_ids" -> 0) || jsonb_build_object('active', true, 'isDefault', true)
  )
END
WHERE jsonb_array_length("tracking_ids") > 0;

ALTER TABLE "omestre"."amazon_affiliates" DROP COLUMN IF EXISTS "nickname";

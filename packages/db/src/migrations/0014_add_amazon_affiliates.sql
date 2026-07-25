-- Migration 0014: Amazon Affiliates (multi-tracking ID)
-- Adiciona tabela amazon_affiliates com 1:1 em users e array jsonb de tracking IDs.
-- Backfill: copia user_credentials.amazon_tracking_id para o 1º tracking ID do afiliado.

CREATE TABLE IF NOT EXISTS "omestre"."amazon_affiliates" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"nickname" text,
	"tracking_ids" jsonb DEFAULT '[]' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "amazon_affiliates_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "omestre"."amazon_affiliates" ADD CONSTRAINT "amazon_affiliates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "omestre"."users"("id");
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Backfill: para cada user_credentials com amazon_tracking_id, criar amazon_affiliate
-- com o tracking ID como entrada default.
INSERT INTO "omestre"."amazon_affiliates"
  ("user_id", "nickname", "tracking_ids", "active", "connected_at", "last_used_at")
SELECT
  uc.user_id,
  NULL,
  jsonb_build_array(
    jsonb_build_object(
      'tag',         uc.amazon_tracking_id,
      'label',       'Importado',
      'region',      'BR',
      'active',      true,
      'isDefault',   true,
      'createdAt',   to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  ),
  true,
  now(),
  now()
FROM "omestre"."user_credentials" uc
WHERE uc.amazon_tracking_id IS NOT NULL
  AND uc.amazon_tracking_id <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "omestre"."amazon_affiliates" aa WHERE aa.user_id = uc.user_id
  );

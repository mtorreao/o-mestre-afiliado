-- Migration: 0020_add_magalu_affiliates.sql
-- Adiciona tabela magalu_affiliates para suporte ao marketplace Magalu (Magazine Luiza).
-- Estrutura paralela a amazon_affiliates, mas usando store_slug único em vez de tracking_ids[].
-- Programa "Influenciador Magalu": 1 loja por CPF, slug escolhido no cadastro.

CREATE TABLE IF NOT EXISTS "omestre"."magalu_affiliates" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"nickname" text,
	"store_slug" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "magalu_affiliates_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "omestre"."magalu_affiliates" ADD CONSTRAINT "magalu_affiliates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "omestre"."users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_magalu_affiliates_user_id" ON "omestre"."magalu_affiliates" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_magalu_affiliates_active" ON "omestre"."magalu_affiliates" ("active") WHERE "active" = true;

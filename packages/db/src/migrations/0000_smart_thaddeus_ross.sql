CREATE SCHEMA "omestre";
--> statement-breakpoint
CREATE TYPE "public"."marketplace" AS ENUM('shopee', 'mercadolivre', 'amazon', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('sent', 'failed');--> statement-breakpoint
CREATE TABLE "omestre"."affiliates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"evolution_instance_id" text,
	"source_groups" jsonb DEFAULT '[]'::jsonb,
	"target_groups" jsonb DEFAULT '[]'::jsonb,
	"filters" jsonb DEFAULT '{"blacklist":[],"keywords":[],"dedupHours":24}'::jsonb,
	"credentials_encrypted" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "affiliates_evolution_instance_id_unique" UNIQUE("evolution_instance_id")
);
--> statement-breakpoint
CREATE TABLE "omestre"."reflected_offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"affiliate_id" integer NOT NULL,
	"source_group_jid" text NOT NULL,
	"target_group_jid" text NOT NULL,
	"original_link" text NOT NULL,
	"converted_link" text NOT NULL,
	"marketplace" "marketplace" NOT NULL,
	"message_preview" text,
	"media_path" text,
	"reflected_at" timestamp DEFAULT now() NOT NULL,
	"status" "offer_status" DEFAULT 'sent' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "omestre"."reflected_offers" ADD CONSTRAINT "reflected_offers_affiliate_id_affiliates_id_fk" FOREIGN KEY ("affiliate_id") REFERENCES "omestre"."affiliates"("id") ON DELETE no action ON UPDATE no action;
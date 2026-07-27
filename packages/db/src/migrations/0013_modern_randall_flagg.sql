ALTER TYPE "public"."marketplace" ADD VALUE 'magalu' BEFORE 'unknown';--> statement-breakpoint
CREATE TABLE "omestre"."amazon_affiliates" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"nickname" text,
	"tracking_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "amazon_affiliates_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "omestre"."amazon_affiliates" ADD CONSTRAINT "amazon_affiliates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "omestre"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "omestre"."affiliates" DROP COLUMN "source_groups";--> statement-breakpoint
ALTER TABLE "omestre"."affiliates" DROP COLUMN "target_groups";--> statement-breakpoint
ALTER TABLE "omestre"."affiliates" DROP COLUMN "excluded_groups";--> statement-breakpoint
ALTER TABLE "omestre"."affiliates" DROP COLUMN "message_template";--> statement-breakpoint
ALTER TABLE "omestre"."affiliates" DROP COLUMN "filters";--> statement-breakpoint
ALTER TABLE "omestre"."affiliates" DROP COLUMN "last_validated_at";--> statement-breakpoint
ALTER TABLE "omestre"."affiliates" DROP COLUMN "last_validation_passed";--> statement-breakpoint
ALTER TABLE "omestre"."affiliates" DROP COLUMN "last_validation_report";--> statement-breakpoint
ALTER TABLE "omestre"."user_credentials" DROP COLUMN "amazon_tracking_id";
ALTER TYPE "public"."offer_status" ADD VALUE 'blocked';--> statement-breakpoint
ALTER TABLE "omestre"."affiliates" ADD COLUMN "notification_channel" text DEFAULT 'disabled' NOT NULL;--> statement-breakpoint
ALTER TABLE "omestre"."affiliates" ADD COLUMN "notification_jid" text;--> statement-breakpoint
ALTER TABLE "omestre"."reflected_offers" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "omestre"."user_credentials" ADD COLUMN "amazon_tracking_id" text;
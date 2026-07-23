-- Add sub-rate limit columns to mirrors table (already exists)
ALTER TABLE "omestre"."mirrors" ADD COLUMN IF NOT EXISTS "sub_rate_limit_max_msgs" integer DEFAULT 5;
--> statement-breakpoint
ALTER TABLE "omestre"."mirrors" ADD COLUMN IF NOT EXISTS "sub_rate_limit_window_sec" integer DEFAULT 300;
--> statement-breakpoint

-- Make api_key optional (it was NOT NULL before)
ALTER TABLE "omestre"."user_whatsapp_instances" ALTER COLUMN "api_key" DROP NOT NULL;
--> statement-breakpoint

-- Add channel and rate limit columns to user_whatsapp_instances
ALTER TABLE "omestre"."user_whatsapp_instances" ADD COLUMN IF NOT EXISTS "channel_type" text DEFAULT 'whatsapp' NOT NULL;
--> statement-breakpoint
ALTER TABLE "omestre"."user_whatsapp_instances" ADD COLUMN IF NOT EXISTS "rate_limit_max_msgs" integer DEFAULT 15 NOT NULL;
--> statement-breakpoint
ALTER TABLE "omestre"."user_whatsapp_instances" ADD COLUMN IF NOT EXISTS "rate_limit_window_sec" integer DEFAULT 300 NOT NULL;

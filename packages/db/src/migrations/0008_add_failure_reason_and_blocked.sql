ALTER TYPE "public"."offer_status" ADD VALUE 'blocked';
--> statement-breakpoint
ALTER TABLE "omestre"."reflected_offers" ADD COLUMN "failure_reason" text;

CREATE TABLE IF NOT EXISTS "omestre"."mirrors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"user_id" integer,
	"source_groups" jsonb DEFAULT '[]'::jsonb,
	"target_groups" jsonb DEFAULT '[]'::jsonb,
	"message_template" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "omestre"."mirrors" ADD CONSTRAINT "mirrors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "omestre"."users"("id") ON DELETE no action ON UPDATE no action;

DO $$ BEGIN
  CREATE SCHEMA IF NOT EXISTS "omestre";
EXCEPTION WHEN duplicate_schema THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "omestre"."user_whatsapp_instances" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"instance_id" text NOT NULL,
	"api_key" text NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_whatsapp_instances_instance_id_unique" UNIQUE("instance_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "omestre"."user_whatsapp_instances" ADD CONSTRAINT "user_whatsapp_instances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "omestre"."users"("id");
EXCEPTION WHEN duplicate_object THEN null;
END $$;

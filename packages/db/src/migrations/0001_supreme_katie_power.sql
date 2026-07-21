CREATE TABLE "omestre"."ml_affiliates" (
	"id" serial PRIMARY KEY NOT NULL,
	"ml_user_id" text NOT NULL,
	"nickname" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"connected_at" timestamp NOT NULL,
	"last_used_at" timestamp NOT NULL,
	"meliid" text,
	"melitat" text,
	"session_cookies" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ml_affiliates_ml_user_id_unique" UNIQUE("ml_user_id")
);

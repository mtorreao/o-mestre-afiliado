ALTER TABLE "omestre"."affiliates" ADD COLUMN "excluded_groups" jsonb DEFAULT '[]'::jsonb;

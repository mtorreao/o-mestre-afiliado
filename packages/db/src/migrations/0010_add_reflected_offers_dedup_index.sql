CREATE INDEX IF NOT EXISTS idx_reflected_offers_dedup ON "omestre"."reflected_offers"("affiliate_id", "original_link", "reflected_at" DESC);

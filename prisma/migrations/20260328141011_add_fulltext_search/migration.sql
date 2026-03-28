-- Create immutable wrapper for to_tsvector to allow GIN index usage
CREATE OR REPLACE FUNCTION immutable_tsvector(text) RETURNS tsvector AS $$
  SELECT to_tsvector('english', $1);
$$ LANGUAGE sql IMMUTABLE;

-- Add full-text search index on ClawTemplate
CREATE INDEX IF NOT EXISTS "ClawTemplate_fulltext_idx" ON "ClawTemplate"
USING gin (immutable_tsvector(coalesce(name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(tagline, '')));

-- Add full-text search index on MarketplaceSkill
CREATE INDEX IF NOT EXISTS "MarketplaceSkill_fulltext_idx" ON "MarketplaceSkill"
USING gin (immutable_tsvector(coalesce(name, '') || ' ' || coalesce(description, '')));

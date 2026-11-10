-- searchVector is a generated tsvector. Prisma cannot express GENERATED STORED,
-- so the column lives in SQL. 20260620120100 dropped it to match schema.prisma.
-- Store search queries t."searchVector", so a fresh migrate must create it again.

CREATE OR REPLACE FUNCTION claw_template_search_vector(
  name text,
  tagline text,
  description text,
  tags text[]
) RETURNS tsvector
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(tagline, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(array_to_string(tags, ' '), '')), 'C');
$$;

CREATE OR REPLACE FUNCTION marketplace_skill_search_vector(
  name text,
  description text,
  tags text[]
) RETURNS tsvector
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(tags, ' '), '')), 'C');
$$;

ALTER TABLE "ClawTemplate" ADD COLUMN IF NOT EXISTS "searchVector" tsvector
  GENERATED ALWAYS AS (claw_template_search_vector("name", "tagline", "description", "tags")) STORED;

CREATE INDEX IF NOT EXISTS idx_claw_template_search ON "ClawTemplate" USING gin("searchVector");

ALTER TABLE "MarketplaceSkill" ADD COLUMN IF NOT EXISTS "searchVector" tsvector
  GENERATED ALWAYS AS (marketplace_skill_search_vector("name", "description", "tags")) STORED;

CREATE INDEX IF NOT EXISTS idx_marketplace_skill_search ON "MarketplaceSkill" USING gin("searchVector");

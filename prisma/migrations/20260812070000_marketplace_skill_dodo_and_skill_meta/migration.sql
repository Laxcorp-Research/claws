-- PR-7: community skill checkout needs a stored Dodo product id (DYNAMIC-AT-APPROVAL).
ALTER TABLE "MarketplaceSkill" ADD COLUMN IF NOT EXISTS "dodoProductId" TEXT;

-- PR-8: marketplace → Skill bridge carries bins/env/emoji into generator emission.
ALTER TABLE "Skill" ADD COLUMN IF NOT EXISTS "emoji" TEXT;
ALTER TABLE "Skill" ADD COLUMN IF NOT EXISTS "requiredBins" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Skill" ADD COLUMN IF NOT EXISTS "requiredEnvVars" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

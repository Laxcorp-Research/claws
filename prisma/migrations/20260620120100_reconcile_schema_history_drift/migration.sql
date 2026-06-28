-- Reconcile schema-history drift left by prior db-push changes.
--
-- This migration is intentionally idempotent. It is a no-op on live databases
-- where these schema objects already exist, and it makes a from-zero migration
-- replay match prisma/schema.prisma.

DO $$
BEGIN
  CREATE TYPE "ApiKeySource" AS ENUM ('NONE', 'PLATFORM_CREDIT', 'USER_OWN_KEY');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "ToolConnectionStatus" ADD VALUE IF NOT EXISTS 'NEEDS_CREDENTIALS';
ALTER TYPE "WorkspaceStatus" ADD VALUE IF NOT EXISTS 'HIBERNATED';
ALTER TYPE "WorkspaceStatus" ADD VALUE IF NOT EXISTS 'WAKING';

ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "isPaused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "lastActiveAt" TIMESTAMP(3);

ALTER TABLE "ClawTemplate" ADD COLUMN IF NOT EXISTS "autoScanPassed" BOOLEAN;
ALTER TABLE "ClawTemplate" ADD COLUMN IF NOT EXISTS "autoScanReport" TEXT;
ALTER TABLE "ClawTemplate" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;

ALTER TABLE "MarketplaceSkill" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;

ALTER TABLE "ToolConnection" ADD COLUMN IF NOT EXISTS "encryptedCredentials" TEXT;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "apiKeySource" "ApiKeySource" NOT NULL DEFAULT 'NONE';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerifiedForCredits" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "apiKeySourceOverride" "ApiKeySource";

DROP INDEX IF EXISTS "idx_claw_template_search";
DROP INDEX IF EXISTS "idx_marketplace_skill_search";

ALTER TABLE "ClawTemplate" DROP COLUMN IF EXISTS "searchVector";
ALTER TABLE "MarketplaceSkill" DROP COLUMN IF EXISTS "searchVector";

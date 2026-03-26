-- Pricing model update: Remove tiers, simplify to flat pricing
-- Old: Free/Pro/Enterprise tiers with per-template monthly fees and self-host
-- New: One-time template purchase ($149/$199/$299) + $79/mo per running Claw

-- 1. User model: Replace subscriptionTier with hasActiveSubscription
ALTER TABLE "User" ADD COLUMN "hasActiveSubscription" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" DROP COLUMN "subscriptionTier";
ALTER TABLE "User" DROP COLUMN "maxWorkspaces";
ALTER TABLE "User" DROP COLUMN "maxAgentsPerWorkspace";

-- 2. Drop SubscriptionTier enum
DROP TYPE "SubscriptionTier";

-- 3. Workspace model: Remove deploymentType
ALTER TABLE "Workspace" DROP COLUMN "deploymentType";

-- 4. Drop DeploymentType enum
DROP TYPE "DeploymentType";

-- 5. ClawTemplate: Rename priceSetup to price, drop priceMonthly and dodoSupportProductId
ALTER TABLE "ClawTemplate" RENAME COLUMN "priceSetup" TO "price";
ALTER TABLE "ClawTemplate" DROP COLUMN "priceMonthly";
ALTER TABLE "ClawTemplate" DROP COLUMN "dodoSupportProductId";

-- PR1: Add per-workspace subscription fields.
-- Part of the billing-model overhaul (PR1-9 sequence). Columns are
-- populated by PR3 (webhook dual-write) and read by PR5 (eligibility
-- cutover). This migration is purely additive - no column drops, no
-- data manipulation, no changes to existing rows. All new columns are
-- nullable, so existing workspaces are valid without updates.

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "canceledAt" TIMESTAMP(3),
ADD COLUMN     "currentPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "stateRetainedUntil" TIMESTAMP(3),
ADD COLUMN     "subscriptionId" TEXT,
ADD COLUMN     "subscriptionStatus" "SubscriptionStatus";

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_subscriptionId_key" ON "Workspace"("subscriptionId");

-- CreateIndex
CREATE INDEX "Workspace_subscriptionStatus_currentPeriodEnd_idx" ON "Workspace"("subscriptionStatus", "currentPeriodEnd");

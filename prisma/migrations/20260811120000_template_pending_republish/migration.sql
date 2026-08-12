-- PR-2: pending republish fields so live listings stay public until admin approve.
-- WAVE ACK REQUIRED before staging migrate deploy / merge.

ALTER TABLE "ClawTemplate" ADD COLUMN IF NOT EXISTS "pendingWorkspaceSnapshot" TEXT;
ALTER TABLE "ClawTemplate" ADD COLUMN IF NOT EXISTS "pendingVersion" INTEGER;
ALTER TABLE "ClawTemplate" ADD COLUMN IF NOT EXISTS "pendingSubmittedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "ClawTemplate_pendingSubmittedAt_idx" ON "ClawTemplate"("pendingSubmittedAt");

-- Data-only, idempotent backfill for Batch B onboarding gate.
-- Pre-Batch-B accounts (created before 2026-07-16) that already have at least
-- one workspace are marked complete so they are not imprisoned by the gate.
-- Post-Batch-B users (including the staging verification account) are
-- deliberately excluded — they re-onboard through the fixed flow (D-ii).
--
-- Schema note: Workspace owner column is "userId" (not "ownerId").

UPDATE "User"
SET "onboardingCompleted" = true
WHERE "onboardingCompleted" = false
  AND "createdAt" < '2026-07-16T00:00:00Z'
  AND EXISTS (
    SELECT 1 FROM "Workspace" w WHERE w."userId" = "User".id
  );

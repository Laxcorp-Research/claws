-- PR-2 (syncThenDestroy): teardown-time snapshot freshness markers on
-- ContainerState. Both additive, both nullable, no backfill (existing rows
-- get NULL, meaning "no incomplete teardown sync recorded").
--
-- Written by syncThenDestroy when a Stop/hibernate's pre-destroy
-- /internal/sync-now call does NOT confirm a persist (non-200, timeout, or
-- unreachable container): we destroy anyway (never trap the container) and
-- stamp lastSyncIncompleteAt = now() + a short lastSyncIncompleteReason
-- (e.g. 'timeout', 'unreachable', 'rejected', 'unconfirmed', 'http-401').
-- Both are cleared (NULL) on a confirmed sync and reset on the next
-- deployToCloud upsert. Mirrors Workspace.lastHealthCheck / lastHealthReason.
--
-- Reversible (DROP COLUMN x2). SQL generated via
--   prisma migrate diff --from-schema <HEAD> --to-schema <edited> --script
-- See src/lib/openclaw/deployer.ts (syncThenDestroy).

-- AlterTable
ALTER TABLE "ContainerState" ADD COLUMN     "lastSyncIncompleteAt" TIMESTAMP(3),
ADD COLUMN     "lastSyncIncompleteReason" TEXT;

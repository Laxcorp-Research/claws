-- PR-8a/C: env-reconciliation rotation cursor.
--
-- Purely additive + nullable, no backfill. NULL means "never reconciled",
-- which the cron treats as oldest priority: it orders RUNNING workspaces by
-- lastEnvReconcileAt ASC (NULLS FIRST), takes the per-tick cap, and stamps
-- now() after each check - giving fair rotation under the cap. Distinct from
-- Workspace.lastHealthCheck (owned by the health monitor). Reversible
-- (DROP COLUMN + DROP INDEX). SQL generated via `prisma migrate diff
-- --from-schema <HEAD> --to-schema <edited> --script`. See
-- src/app/api/cron/reconcile-container-env/route.ts and
-- docs/CONTAINER_ENV_RECONCILIATION_CONTRACT.md.

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "lastEnvReconcileAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Workspace_lastEnvReconcileAt_idx" ON "Workspace"("lastEnvReconcileAt");

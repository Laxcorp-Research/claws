-- Version-keyed emission contract + per-workspace runtime pin + snapshot
-- generations (RUNTIME-9.4 soak containment wave 2, 2026-09-13).
--
-- 1. OpenClawVersion.runtimeContract: the config-shape contract the image's
--    gateway validates. Backfill: every existing 2026.9.x row is the 9.4
--    contract; everything else (2026.5.x line) is 5.22. Future rows are
--    stamped by the register route via deriveRuntimeContract().
ALTER TABLE "OpenClawVersion" ADD COLUMN "runtimeContract" TEXT NOT NULL DEFAULT '5.22';
UPDATE "OpenClawVersion" SET "runtimeContract" = '9.4' WHERE "version" LIKE '2026.9.%';

-- 2. Workspace.runtimeImagePin: explicit version pin, highest-priority image
--    resolution (above candidate soak and isStable). NULL = normal resolution.
ALTER TABLE "Workspace" ADD COLUMN "runtimeImagePin" TEXT;

-- 3. ContainerState snapshot generations: previous + current, plus a
--    pre-migration generation pinned 7 days after first persist on a new
--    contract. Rollback material - see persistRuntimeStateSnapshot.
ALTER TABLE "ContainerState" ADD COLUMN "runtimeStatePrevSnapshot" BYTEA;
ALTER TABLE "ContainerState" ADD COLUMN "runtimeStatePrevUpdatedAt" TIMESTAMP(3);
ALTER TABLE "ContainerState" ADD COLUMN "runtimeStatePrevSizeBytes" INTEGER;
ALTER TABLE "ContainerState" ADD COLUMN "runtimeStateContract" TEXT;
ALTER TABLE "ContainerState" ADD COLUMN "deployedRuntimeContract" TEXT;
ALTER TABLE "ContainerState" ADD COLUMN "preMigrationSnapshot" BYTEA;
ALTER TABLE "ContainerState" ADD COLUMN "preMigrationContract" TEXT;
ALTER TABLE "ContainerState" ADD COLUMN "preMigrationTakenAt" TIMESTAMP(3);
ALTER TABLE "ContainerState" ADD COLUMN "preMigrationPinnedUntil" TIMESTAMP(3);

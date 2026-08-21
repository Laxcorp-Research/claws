-- PR-C #10: Workspace.alwaysOn opt-out of the hibernation sweep.
-- PR-C #13: Workspace.stateSyncStaleConsecutive cry-wolf guard (2-consecutive-probe
-- requirement before decideStateSyncStale sets stateSyncStaleDetectedAt). Bundled in
-- the same migration per PR-C scope - both are additive Workspace columns with safe
-- defaults, no backfill required.
ALTER TABLE "Workspace" ADD COLUMN "alwaysOn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Workspace" ADD COLUMN "stateSyncStaleConsecutive" INTEGER NOT NULL DEFAULT 0;

-- Lifecycle P3: auto-hibernate refused (unsynced / stale state). DATA banner.
ALTER TABLE "Workspace"
ADD COLUMN "hibernationRefusedAt" TIMESTAMP(3);

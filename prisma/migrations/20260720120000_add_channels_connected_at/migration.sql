-- P1.1: stamp when channels first became active (preserved across redeploy).
ALTER TABLE "ContainerState" ADD COLUMN IF NOT EXISTS "channelsConnectedAt" TIMESTAMP(3);

-- Existing channel-active rows: treat as connected well before the 24h idle cutoff
-- so warmIdle v2 can match without waiting another day after migrate.
UPDATE "ContainerState"
SET "channelsConnectedAt" = NOW() - INTERVAL '25 hours'
WHERE "hasActiveChannels" = true
  AND "channelsConnectedAt" IS NULL;

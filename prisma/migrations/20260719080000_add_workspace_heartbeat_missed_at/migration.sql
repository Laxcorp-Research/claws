-- Lifecycle P2: Watchtower missed-heartbeat window flag (ops-gap banner).
ALTER TABLE "Workspace"
ADD COLUMN "heartbeatMissedAt" TIMESTAMP(3);

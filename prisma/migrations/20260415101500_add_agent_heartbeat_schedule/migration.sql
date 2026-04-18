-- Add heartbeat scheduling fields to Agent.
-- Idempotent (IF NOT EXISTS) because some environments received these columns
-- via an earlier `prisma db push` before migrations caught up.

ALTER TABLE "Agent"
  ADD COLUMN IF NOT EXISTS "heartbeatFrequency" TEXT,
  ADD COLUMN IF NOT EXISTS "heartbeatTime" TEXT;

-- Per-agent thinking effort (OpenClaw agents.list[].thinkingDefault).
-- Nullable, no backfill: null means "runtime default" and is omitted from
-- generated config, so existing agents behave exactly as before.
ALTER TABLE "Agent" ADD COLUMN "thinkingDefault" TEXT;

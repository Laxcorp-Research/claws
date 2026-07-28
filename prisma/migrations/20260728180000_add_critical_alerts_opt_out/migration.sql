-- PR-B: critical alerts push (Telegram, fallback email) opt-out.
ALTER TABLE "Workspace" ADD COLUMN "criticalAlertsOptOut" BOOLEAN NOT NULL DEFAULT false;

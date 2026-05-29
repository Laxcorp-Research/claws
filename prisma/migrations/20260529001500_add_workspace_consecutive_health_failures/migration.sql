-- PR-3: Health monitor debounce counter.
-- Default 0, not null. No backfill needed (existing rows get the default).
-- Reset to 0 on a successful admin-rpc health probe; incremented on each
-- failure. >=2 escalates healthStatus to UNHEALTHY; >=5 escalates status to
-- ERROR. See src/app/api/cron/health-monitor/route.ts.
ALTER TABLE "Workspace"
  ADD COLUMN "consecutiveHealthFailures" INTEGER NOT NULL DEFAULT 0;
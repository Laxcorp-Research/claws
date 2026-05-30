-- PR-4: dashboard truthfulness fields. Both additive, both nullable, no backfill.
--
-- Workspace.lastHealthReason: the health monitor writes its per-pass probe
-- classification here (e.g. 'plugin-not-loaded', 'no-agents', 'timeout',
-- 'healthy') so the dashboard can pick the right banner — config drift (4xx,
-- alive-but-misconfigured) vs genuinely unreachable (5xx/timeout).
--
-- ActivityLog.detail: full untruncated context behind the short ction
-- summary (raw heartbeat prompt, full error text, complete message body).
-- Rendered only on click-to-expand in the activity feed.
ALTER TABLE "Workspace" ADD COLUMN "lastHealthReason" TEXT;
ALTER TABLE "ActivityLog" ADD COLUMN "detail" TEXT;
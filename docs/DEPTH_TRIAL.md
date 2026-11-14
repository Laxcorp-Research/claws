# Depth trial - SUCCESS CRITERIA

Committed from the Phase-2 arming runbook. Day 1 of the seven quiet days begins on the morning of the first scheduled daily digest after fixture redeploy with the trial mission config.

## Success criteria (verbatim)

all beats in-window or miss→ledger→recover (≤1 ledgered miss/day, GH-jitter documented); ZERO manual interventions (founder Telegram messages/approvals don't count); lossless sleep/wake; costs metered daily; wake-on-message responsive; launch-class failure (data loss / silent failure / unrecoverable strand) = fix + restart the 7-day clock. UI-class fixes during the trial don't reset it; lifecycle/metering/cron changes do.

## Operational notes

- Platform morning digest: `GET /api/cron/daily-digest` at `0 6 * * *` (UTC). Default fan-out = Telegram connected **and** heartbeat armed (`nextHeartbeatAt IS NOT NULL`) **and** ever-deployed (`Deployment` COMPLETED|SUPERSEDED) **and** status ∉ {DRAFT, SETUP_INCOMPLETE, STOPPED} (HIBERNATED included). Optional `DAILY_DIGEST_WORKSPACE_IDS` is a debug id override only (predicate still applies) - see `docs/VERCEL_ENV_MANIFEST.json`.
- Heartbeat evidence is receipt-based (typed `HEARTBEAT` / poll-marker `TASK_START`), not agent prose.
- Mission posture for the Twitter growth fixture: posting is manual-by-design (drafts + plan to founder Telegram); the agent must not drumbeat Twitter API reconnection.

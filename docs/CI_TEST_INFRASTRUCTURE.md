# CI Test Infrastructure

## Neon E2E Branch

The E2E test job (`e2e-tests` in `.github/workflows/ci.yml`) uses a dedicated
Neon Postgres branch, separate from staging and production.

- **Endpoint:** `ep-broad-smoke-andow2sv-pooler.c-6.us-east-1.aws.neon.tech`
- **Connection:** `secrets.TEST_DATABASE_URL` (GitHub Actions secret; distinct
  from staging `ep-polished-night-an1a17k4-pooler` and prod
  `ep-delicate-water-anjx9cip-pooler`)
- **Tier:** Free (auto-pauses after ~7 days of inactivity)

### Wake-up behavior (GH #73)

- Cold start: 5–15 seconds typical.
- `ci.yml`'s **"Wake up Neon database"** step runs **before** "Apply database
  schema" and retries up to **10 times × 6 seconds = 60-second budget**.
- **Fails loudly (`exit 1`)** if the budget is exhausted — a genuinely
  unreachable DB is a hard error, not a silently-swallowed flake.
- History: this step previously ran *after* the schema push and was single-shot
  with `process.exit(0)` on failure, so the schema push hit a cold endpoint and
  threw `P1001` before anything woke it. That ordering bug was GH #73.

### Keep-alive

- **Workflow:** `.github/workflows/neon-e2e-keepalive.yml`
- **Schedule:** every 5 days (`cron: '0 12 */5 * *'`), plus `workflow_dispatch`.
- **Purpose:** prevents the ~7-day auto-pause from triggering between PRs.
- **Fallback:** even if keep-alive misses (cron skipped, network hiccup,
  GitHub disabling schedules after 60 days of repo inactivity), the wake-retry
  loop in `ci.yml` handles the resulting cold start.

### Credential rotation

If `TEST_DATABASE_URL` needs rotation:

1. Generate a new connection string in the Neon dashboard for the E2E branch.
2. Update the GitHub secret `TEST_DATABASE_URL` (Settings → Secrets and
   variables → Actions).
3. Trigger a manual run of `neon-e2e-keepalive.yml` (Actions → Keep Neon E2E
   branch warm → Run workflow) to verify the new credentials.
4. No code changes needed.

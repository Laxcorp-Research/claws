# Vercel Cron - Operational Caveats

This document captures operational caveats about how Vercel runs the crons
declared in `vercel.json`. These bit us during the PR-8 arc; they are platform
behaviors, not bugs.

## Crons run on Production deployments only

`vercel.json` crons **never fire on preview/staging deployments** - only on the
Production deployment.

- Confirmed via Axiom: 2+ hours of `env_reconciliation` logs showed **100%
  `environment: production`**, zero preview/staging entries.
- This is documented Vercel platform behavior, not a bug.
- **Implication:** you cannot test a cron's *scheduled* firing on staging. The
  route is deployed and reachable on staging, but Vercel's scheduler will never
  invoke it there. Staging cron testing requires **manual `curl` triggering**
  (see the Neon section below for the auth pattern).

## Schedule changes propagate over 1–3 cycles

When a `vercel.json` cron schedule changes (e.g. `*/15` → `*/5`), the new cadence
takes effect on the next **Production deploy** - but the actual cron-firing can
take **5–15 minutes (1–3 cycles)** to reflect the new schedule.

- **Don't conclude "it didn't work" until 2–3 cycles have elapsed past the
  deploy.** The first post-deploy tick may still be on the old cadence.
- Observed during the PR-8c rollout (2026-06-09): prod deploy completed at
  ~14:12 UTC; the new `*/5` cadence was visibly active from ~14:20 UTC. The
  ticks at/just-before the cutover were *not* evidence of failure - they were
  the old schedule's already-scheduled invocations.

## Neon staging-cron limitation (PR-8 arc)

The `reconcile-container-env` cron is deployed to **both** staging and
production:

- It **auth-gates correctly on both** (`CRON_SECRET` enforced; unauthenticated
  requests get 401).
- But **only production** actually receives cron invocations from Vercel's
  scheduler (per "Crons run on Production deployments only" above).

For manual staging cron verification, trigger it with `curl` and the secret:

```bash
curl -s "https://staging.app.buildclaws.ai/api/cron/reconcile-container-env" \
  -H "Authorization: Bearer ${CRON_SECRET}"
```

**Automated staging ticks (D1):** `.github/workflows/staging-cron-scheduler.yml`
mirrors `vercel.json` cron paths on a schedule (hibernation / health-monitor use
Actions `*/5` - accepted delta vs prod every-minute / `*/2`). Requires repo secret
`STAGING_CRON_SECRET` (= staging Vercel `CRON_SECRET`). Failures turn the workflow
red - first scheduled-failure surface for staging crons.

See `docs/CONTAINER_ENV_RECONCILIATION_CONTRACT.md` §11 for the original PR-8
context in which this limitation was discovered.

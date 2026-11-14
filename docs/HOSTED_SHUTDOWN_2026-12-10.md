# Hosted shutdown 2026-12-10

Recorded 2026-11-14 after the scheduled GitHub Actions on both repos failed every day.

## What the runs were hitting

- `https://app.buildclaws.ai` and `https://staging.app.buildclaws.ai` both return HTTP 402 `DEPLOYMENT_DISABLED` (Vercel payment hold). The app code never runs. Checked on `/`, `/api/cron/health-monitor`, and `/api/cron/daily-digest`.
- `Laxcorp-Research/claws` (public) has no Actions secrets and no Actions variables. Its copies of these workflows failed before the HTTP call.
- On `Laxcorp-Research/claws-internal`, the daily runtime-image build and the Monday GHCR dry-run fail while minting a GHCR token (HTTP 403). The register URL those builds use is the same dead staging app.

Digest, hosted health (`/api/cron/health-monitor`), and the account-retention path inside the staging cron scheduler are in this set. There is no separate "Dec 3 reminder" workflow on either default branch. None of them can return 200 while the Vercel deployments are disabled, so they were disabled with the retired crons rather than left to fail.

## Disabled Nov 14, delete with repo archive

| Repo | Workflow | Last failing run |
| --- | --- | --- |
| claws | Staging cron scheduler | https://github.com/Laxcorp-Research/claws/actions/runs/43554725477 |
| claws | Staging daily digest | https://github.com/Laxcorp-Research/claws/actions/runs/43376086203 |
| claws | Build OpenClaw Runtime Image | https://github.com/Laxcorp-Research/claws/actions/runs/43376388382 |
| claws | Cleanup openclaw-runtime GHCR (dry-run) | https://github.com/Laxcorp-Research/claws/actions/runs/42584020621 |
| claws | Keep Neon E2E branch warm | https://github.com/Laxcorp-Research/claws/actions/runs/43019248347 |
| claws-internal | Staging cron scheduler | https://github.com/Laxcorp-Research/claws-internal/actions/runs/43555211123 |
| claws-internal | Staging daily digest | https://github.com/Laxcorp-Research/claws-internal/actions/runs/43376989629 |
| claws-internal | Build OpenClaw Runtime Image | https://github.com/Laxcorp-Research/claws-internal/actions/runs/43378035761 |
| claws-internal | Cleanup openclaw-runtime GHCR (dry-run) | https://github.com/Laxcorp-Research/claws-internal/actions/runs/42583247909 |

Disabled with `gh workflow disable`. State after that call is `disabled_manually`. Re-enable only if a living host exists: `gh workflow enable "<workflow>" --repo <repo>`.

## Left scheduled

- `claws-internal` / Keep Neon E2E branch warm. Last scheduled run succeeded: https://github.com/Laxcorp-Research/claws-internal/actions/runs/43019032085. It only pings the internal CI database. The public copy is disabled because that repo has no `TEST_DATABASE_URL`.
- Dependabot Updates on both repos. Latest runs succeeded. Not an `on.schedule` workflow.

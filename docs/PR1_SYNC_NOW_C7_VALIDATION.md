# C7 runtime validation - `/internal/sync-now` overlay route

Procedure to validate the PR-1 container overlay (`feat(container): /internal/sync-now`)
on a **real running staging container** before prod-promote. Re-run this for every
overlay rebuild that ships the route (the PR-branch `2026.5.22-3` build **and** the
post-merge `2026.5.22-4` rebuild that actually gets prod-promoted).

Why beyond the unit tests: the unit tests prove the route's logic in isolation.
This proves the route is actually **registered in the running gateway process**,
that `auth:"plugin"` actually wires the secret check on a live request, and that a
real bundle of real session/`MEMORY.md` data actually lands in the snapshot column.

## Verified-against-code facts (so the script can't drift)
- **Auth header:** the handler reads `req.headers["x-metering-secret"]`
  (`container/claws-activity-reporter/index.mjs:561`). HTTP header names are
  case-insensitive and Node lowercases them, so send `X-Metering-Secret` on the wire.
- **Secret value:** the container's `CLAWS_METERING_SECRET` == backend
  `METERING_MASTER_SECRET` (`src/lib/openclaw/deployer.ts:525`). Use the staging
  `METERING_MASTER_SECRET`.
- **Persist columns** (`prisma/schema.prisma:1214-1216`, model `ContainerState`,
  keyed by unique `workspaceId`): `runtimeStateSnapshot Bytes?`,
  `runtimeStateUpdatedAt DateTime?`, `runtimeStateSizeBytes Int?`.
- **Route contract** (handler): `POST` only (else 405); missing/wrong secret → 401;
  `200` only on a **confirmed persist** (`count>=1`) or an empty data dir
  (`{"persisted":false,"empty":true}`); `rejected`→502, `error`/`accepted-unconfirmed`/
  `unconfigured`→503.

## Operator setup (staging-only; reverted at the end - no prod impact)
1. **Pin the candidate as staging-stable** so a deploy uses it (`resolveDeployImage()`
   reads the `isStable` row, and the candidate is `isStable:false`): on **staging**
   `/admin/versions`, **Promote to Stable** on the overlay version under test
   (`2026.5.22-3`, later `-4`). Note the current stable to restore later.
2. **Deploy a fresh staging Claw**, send it **one chat message**, let it run once -
   so `agents/<id>/sessions/*.jsonl` (and ideally a `MEMORY.md`) exist to bundle.
   (With an empty data dir you'll get `{"persisted":false,"empty":true}` - that still
   validates auth + route, but not the real-bundle-persists path.)
3. Capture: `HOST` = the workspace's `containerHost` (`*.up.railway.app`),
   `SECRET` = staging `METERING_MASTER_SECRET`, `WORKSPACE_ID` = the test workspace id.

## Step 1 - BEFORE persist read (capture the baseline)
Run against the **staging** DB. Capture the returned timestamp:
```sql
SELECT "runtimeStateUpdatedAt", "runtimeStateSizeBytes"
FROM "ContainerState"
WHERE "workspaceId" = '<WORKSPACE_ID>';
```
Record `BEFORE_TS = runtimeStateUpdatedAt` (may be a recent value from the 5-min
interval, or NULL on a brand-new container). **Tip to avoid interval coincidence:**
run the sync-now call shortly AFTER a fresh interval sync so the next interval is
~5 min away - then any advance in Step 3 is attributable to our call.

## Step 2 - route + auth validation
```bash
HOST="<workspace>.up.railway.app"
SECRET="<staging METERING_MASTER_SECRET>"

# Route present + wrong secret → 401 (a 404 would mean the route is NOT baked/registered)
curl -s -o /dev/null -w "wrong-secret: %{http_code}\n" \
  -X POST "https://$HOST/internal/sync-now" -H "X-Metering-Secret: WRONG"     # expect 401

# Missing secret → 401
curl -s -o /dev/null -w "no-secret:    %{http_code}\n" \
  -X POST "https://$HOST/internal/sync-now"                                    # expect 401

# Wrong method → 405
curl -s -o /dev/null -w "GET:          %{http_code}\n" \
  -X GET "https://$HOST/internal/sync-now" -H "X-Metering-Secret: $SECRET"     # expect 405

# Correct secret → 200 + confirmed persist (capture the body)
curl -s -w "\nstatus: %{http_code}\n" \
  -X POST "https://$HOST/internal/sync-now" -H "X-Metering-Secret: $SECRET"
# expect: status 200, body {"ok":true,"persisted":true,"count":>=1,"fileCount":N}
#  (empty data dir → {"ok":true,"persisted":false,"empty":true}: send a message, re-run)
```

## Step 3 - AFTER persist read (prove OUR call caused the write)
Immediately after the 200, re-run the same query:
```sql
SELECT "runtimeStateUpdatedAt", "runtimeStateSizeBytes"
FROM "ContainerState"
WHERE "workspaceId" = '<WORKSPACE_ID>';
```
**Pass:** `runtimeStateUpdatedAt` is **strictly greater** than `BEFORE_TS` (advanced to
~now), and `runtimeStateSizeBytes > 0`. The advance during the few-second window
between the BEFORE read and the 200 attributes the persist to the sync-now call, not
a coinciding interval sync.

## Step 4 - refactor-safety (existing interval/SIGTERM sync still works)
In the container/Railway logs, confirm the periodic line still appears (fires ~30s
after boot, then every 5 min):
```
[process-manager] State synced (N files, K KB compressed)
```
Its presence proves `process-manager` → shared `runStateSync()` is intact after the
refactor.

## Teardown
Re-promote the previous stable (`2026.5.22-2`) to staging-stable; delete the test Claw.

## Pass criteria (all must hold)
- `401` on wrong **and** missing secret; `405` on `GET`.
- `200` + `{"persisted":true,"count":>=1}` on the real call (non-empty data dir).
- `runtimeStateUpdatedAt` advanced past `BEFORE_TS`; `runtimeStateSizeBytes > 0`.
- `[process-manager] State synced (...)` present in logs.

# Fly.io Machines Adapter — Phase A Capability Map + Cutover Plan

Provider-per-workspace second cloud (`Workspace.provider = RAILWAY | FLY`).
Phase A verdict: **CONTINUE — no hard gap.** Two integration costs (image
mirror, org machine quota raise) and one partial gap (logs API), all with
workable paths. Researched 2026-09-17 against live Fly docs + community
threads; re-verify quotas at cutover.

## Capability map vs `deployer.ts`

| Capability (Railway shape) | Fly Machines equivalent | Status |
|---|---|---|
| `createService` (service per claw) | App per claw (`POST /v1/apps`, per-app 6PN network isolation) + `POST /v1/apps/{app}/machines` with full `config` (image, env, services, checks) | ✓ better isolation than one shared project |
| `serviceInstanceDeployV2` + poll deployment SUCCESS | Machine create/start + `GET /machines/{id}/wait?state=started` + existing `/healthz` poll over the domain | ✓ |
| HWD hibernate: `deploymentRemove` keep service/domain | **Native `POST /machines/{id}/stop`** — machine + app + domain persist; `guest.persist_rootfs: "restart"` keeps rootfs across nap/wake (default wipes it). Suspend/resume exists (≤2GB RAM) as a later fast-wake option | ✓ first-class; stronger than Railway |
| Wake: `updateAndRedeploy` on kept service | `POST /machines/{id}` config update (full-config POST, no PATCH) + `start` | ✓ |
| Env vars (`variableCollectionUpsert` replace) | `config.env` string map in the same config POST. No documented size cap — our ~30KB gz payloads must be smoke-tested (fixture) | ✓ verify at fixture-fire |
| Domain + TLS (`serviceDomainCreate`, *.up.railway.app) | `<app>.fly.dev` + shared IPv4 (free) via GraphQL `allocateIpAddress` (api.fly.io — the ONE non-REST call); TLS at Fly proxy via `services.ports.handlers [tls,http]` | ✓ |
| Health checks (`healthcheckPath /healthz`) | `config.checks` http check, surfaced on `GET machine` | ✓ |
| Logs (`deploymentLogs` GraphQL) | **Partial gap**: Machines REST has no logs endpoint. Best-effort legacy `api.fly.io/api/v1/apps/{app}/logs`; NATS/log-shipper for real tailing | ~ acceptable (dashboard activity feed is platform-side anyway) |
| GHCR private pull (`registryCredentials`) | **Gap**: Machines API supports public registries or `registry.fly.io` only. Fix: image pipeline pushes each version to `registry.fly.io/<runtime app>` alongside GHCR (org-wide reusable, "build once deploy many" per Fly blueprint). `FLY_IMAGE_MIRROR_PREFIX` maps the tag at deploy time — version-aware resolution unchanged | ~ CI step + retention check with Fly support |
| Secrets | `config.env` (readable via GET, same posture as Railway's variables API). App-level secrets exist if we want write-only later | ✓ |
| Private networking | 6PN per org; per-app custom networks isolate claws from each other | ✓ |
| API limits | 1 req/s per action **per machine** (burst 3); `GET machine` 5 r/s (burst 10); app deletes 100/min. Per-identifier scoping → fleet-wide operations don't share one bucket | ✓ |
| Inventory ceiling | Org machine quota default **50** (all states), raisable via billing@fly.io — Fly customers run 100k+ machines (community, Mar 2026). No app-count limit | ~ request raise BEFORE cutover |
| Create cap (Railway 25/day) | **None** — no daily machine-create cap. Governor + service pool stay RAILWAY-only | ✓ the reason we're here |

## Cost (list prices 2026-09)

Started machines bill per second; stopped machines bill rootfs only
($0.15/GB-month, image base size). shared-cpu-1x: 256MB $1.94/mo,
512MB $3.32/mo, 1GB $5.92/mo (24/7). Reservation blocks −40%.

| Fleet | All-on 24/7 (1GB) | Nap-heavy (~10% started, ~1.5GB rootfs) |
|---|---|---|
| 100 claws | ~$592/mo | ~$59 compute + ~$23 stopped rootfs ≈ **$82/mo** |
| 1,000 claws | ~$5,920/mo | ~$592 + ~$225 ≈ **$817/mo** |

HWD napping is the whole cost story on Fly, same as Railway.

## Build shape (Part 2 B)

- `Workspace.provider` enum, default `RAILWAY` (additive migration).
- `src/lib/fly/machines-client.ts` — REST client (apps, machines, wait,
  start/stop/restart/delete) + GraphQL shared-IPv4 allocation.
- `src/lib/fly/fly-deployer.ts` — `deployToFly` mirroring `deployToCloud`'s
  observable contract: same Deployment/ContainerState writes, same
  `buildRailwayEnvVars` payloads (container contract is provider-neutral),
  same `resolveDeployTarget` (version pins/candidate soak unchanged), image
  ref mapped through `FLY_IMAGE_MIRROR_PREFIX`.
- Dispatch at the four provider seams in `deployer.ts`: `deployToCloud`
  front door, `removeDeploymentKeepService` (hibernate), `destroyContainer`
  (terminal), `restartContainer`. Sync gates, hibernation manager, wake
  entitlement, state-sync: untouched.
- Governor + service pool: RAILWAY-only by construction (Fly path never
  imports them). Env-reconcile cron + runtime heals: RAILWAY-filtered v1.
- Env: `FLY_API_TOKEN`, `FLY_ORG_SLUG`, `FLY_REGION` (default `iad`),
  `FLY_IMAGE_MIRROR_PREFIX`, `FLY_MACHINE_MEMORY_MB` (default 1024).

## Soak + cutover plan (Part 2 C)

1. **Prereqs (founder/ops):** Fly org + `FLY_API_TOKEN` in Vercel; machine
   quota raise (email billing@fly.io — ask ≥ 2× target fleet); CI job pushes
   runtime image versions to `registry.fly.io/<runtime app>`.
2. **Rule-36 smoke on Fly:** deploy a fixture claw on `provider=FLY`; walk
   the contract rows (healthz, live write, exec, mission/cron, extract,
   approve). KEEP canary stays on Railway — never migrate it during soak.
3. **Fixture-fire a Twitter clone on Fly**; 24h soak: beats on schedule,
   nap/wake (machine stop/start with rootfs persist), decision push, zero
   heals. Soak gate = the same evidence rows the staging soak uses today.
4. **Flag cutover:** `NEW_WORKSPACE_PROVIDER=FLY` — new workspaces mint on
   Fly once soak is green. Rollback for new deploys = flip the env var back
   (one Vercel change, no data touched).
5. **Existing claws migrate on natural wake:** wake path checks a
   `MIGRATE_ON_WAKE_TO=FLY` flag → deployToFly fresh-provision + state
   restore from the platform snapshot (state-sync is provider-neutral;
   `preMigrationSnapshot` pins the last pre-migration generation for 7 days
   — same mechanism as the 9.4 runtime migration). Rollback per claw =
   provider flip back to RAILWAY + wake (Railway service pool supplies the
   service instantly; domain changes are re-pointed by the wake).
6. **KEEP canary migrates last**, manually, after ≥7 days of fleet-green.

## Receipts (Phase A sources)

- Machines API rate limits + working guide — fly.io/docs/machines/api/working-with-machines-api
- `persist_rootfs` knob — community.fly.io/t/your-rootfs-reboot-resistant-try-persist-rootfs/26146
- "Start operations clear filesystem changes" — fly.io/docs/machines/guides-examples/functions-with-machines
- Suspend/resume constraints — fly.io/docs/reference/suspend-resume
- Private registries unsupported → registry.fly.io — community.fly.io/t/securing-images-for-use-with-machines-api/23277 + fly.io/docs/blueprints/using-the-fly-docker-registry
- Org machine quota 50 default, raisable (100k+ possible) — community.fly.io/t/is-the-maximum-of-50-machines-correct/26432 + /t/scaling-fly-io-machines-quota-is-10k-containers-possible/27302
- Pricing — fly.io/pricing + fly.io/docs/about/pricing (stopped rootfs $0.15/GB-mo)

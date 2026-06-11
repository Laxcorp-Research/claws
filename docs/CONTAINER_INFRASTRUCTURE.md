# Container Infrastructure

How Claws deploys and manages OpenClaw containers on Railway.

Last updated: 2026-05-31

---

## Architecture Overview

```
+---------------------+     GraphQL API     +--------------------------+
|  Vercel (Next.js)   | ------------------> |  Railway                 |
|                     |   Bearer token      |  backboard.railway.com   |
|  src/lib/openclaw/  |                     |                          |
|  railway-client.ts  | <------------------ |  Per-workspace services  |
|  deployer.ts        |   JSON responses    |  +-- claw-<wsId-1>       |
|  generator.ts       |                     |  +-- claw-<wsId-2>       |
|                     |                     |  +-- ...                 |
+---------------------+                     +--------------------------+
```

Each Claw workspace gets its own Railway service (Docker container). Vercel calls
Railway's GraphQL API via `src/lib/openclaw/railway-client.ts`. There is no
self-managed infrastructure — Railway handles Docker image pulling, networking,
TLS, scaling, and restarts.

---

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/openclaw/railway-client.ts` | GraphQL client for Railway API. All container operations go through here. |
| `src/lib/openclaw/deployer.ts` | Orchestrates the full deploy lifecycle: generate files, create Railway service, poll for success. Falls back to simulation when Railway is not configured. |
| `src/lib/openclaw/generator.ts` | Converts Prisma DB models into OpenClaw workspace files (`openclaw.json`, `.env`, per-agent `SOUL.md`/`AGENTS.md`/etc). |
| `src/app/api/deploy/[workspaceId]/cloud/route.ts` | API route that triggers `deployToCloud()`. |
| `src/app/api/deploy/[workspaceId]/health/route.ts` | API route for checking Railway deployment status. |
| `src/app/api/deploy/[workspaceId]/logs/route.ts` | API route for fetching container logs from Railway. |
| `src/app/api/admin/containers/health/route.ts` | Admin endpoint listing all Railway services in the project. |

---

## Environment Variables

These must be set in `.env.local` (dev) and in Vercel (staging/production):

| Variable | Example | Purpose |
|----------|---------|---------|
| `RAILWAY_API_TOKEN` | `railway_token_xxxx` | API token from Railway dashboard (Account Settings > Tokens) |
| `RAILWAY_PROJECT_ID` | `xxxxxxxx-xxxx-xxxx` | Railway project ID (one project for all Claw containers) |
| `RAILWAY_ENVIRONMENT_ID` | `xxxxxxxx-xxxx-xxxx` | Railway environment ID (production environment) |
| `OPENCLAW_DOCKER_IMAGE` | `ghcr.io/laxcorp-research/openclaw-runtime:2026.5.22` | Last-resort fallback only. Post-PR-1 the deployer reads `OpenClawVersion.dockerImage` from the `isStable=true` row (`resolveDeployImage()` in `deployer.ts`); this env var is consulted only if no such row exists. Leave unset in normal operation. |

If `RAILWAY_API_TOKEN` or `RAILWAY_PROJECT_ID` is missing, the deployer runs
in **simulation mode** — it walks through all deployment stages with fake delays
and produces a `sim-xxxxxxxx` container ID. No real container is created.
Simulation mode throws in `NODE_ENV=production`.

---

## Config Delivery

OpenClaw reads config from files at `/home/node/.openclaw/`. Since Railway
services don't support external volume writes, config is delivered via env vars
and unpacked at container boot:

| Env Var | Content |
|---------|---------|
| `CLAWS_CONFIG_B64` | Base64-encoded `openclaw.json` |
| `CLAWS_ENV_B64` | Base64-encoded `.env` file (API keys, channel tokens) |
| `CLAWS_FILES_B64` | Base64-encoded JSON blob of all workspace files (SOUL.md, AGENTS.md, etc.) |

Railway's `startCommand` runs a Node.js one-liner that decodes these env vars
and writes them to `/home/node/.openclaw/` before starting the OpenClaw gateway.

---

## Deployment Pipeline

When a user clicks "Deploy to Cloud" in the UI:

```
User clicks Deploy
       |
       v
POST /api/deploy/[workspaceId]/cloud
       |
       +-- Auth + ownership + trial check
       +-- Set workspace status -> DEPLOYING
       |
       v
deployer.deployToCloud(workspaceId)
       |
       +-- isRailwayConfigured()?
       |     NO  -> simulateDeploy() (dev only, throws in prod)
       |     YES v
       |
       +-- [GENERATING]    generator.generateWorkspace()
       |                   -> openclaw.json, .env, per-agent workspace files
       |
       +-- [PROVISIONING]  Build Railway env vars (base64 config + files)
       |
       +-- [STARTING]      railway-client.createService()
       |                   -> serviceCreate + serviceInstanceUpdate (image + startCommand)
       |                   -> variableCollectionUpsert (env vars)
       |                   -> serviceDomainCreate (*.up.railway.app domain)
       |                   -> serviceInstanceDeployV2 (trigger deploy)
       |
       +-- [HEALTH_CHECK]  Poll Railway deployment status
       |                   (3s interval, 180s timeout, wait for SUCCESS)
       |
       +-- [WAITING_CHANNELS]  Hit https://<domain>/readyz if channels configured
       |
       +-- [COMPLETED]     Update workspace: status=RUNNING, containerId=serviceId,
                           containerHost=domain, gatewayToken=encrypted
```

### Container naming

- Railway service name: `claw-<workspaceId>` (max 32 chars)
- Domain: auto-assigned `*.up.railway.app`

---

## OpenClaw Runtime Inside the Container

Each container runs a single OpenClaw gateway instance. The start command
unpacks config from env vars to `/home/node/.openclaw/`:

```
/home/node/.openclaw/
+-- openclaw.json          <- Gateway + agent config
+-- .env                   <- API keys, channel tokens
+-- workspace-orchestrator/
|   +-- SOUL.md, AGENTS.md, USER.md, IDENTITY.md, TOOLS.md,
|   +-- HEARTBEAT.md, BOOT.md, skills/<name>/SKILL.md
+-- workspace-<worker-id>/
+-- workspace-<critic-id>/
+-- cron/
    +-- jobs.json
```

### Health endpoints (inside the container)

- `/healthz` -- Liveness: gateway process is up
- `/readyz` -- Readiness: channels are connected

These are accessed via `https://<domain>/healthz` (Railway provides TLS).

---

## Version Management

The runtime image `ghcr.io/laxcorp-research/openclaw-runtime` is built and
published by `.github/workflows/build-openclaw-image.yml` and promoted to
production by `.github/workflows/promote-openclaw-image.yml`. The two
workflows enforce a separation between "newest built" and "newest stable"
that the deployer relies on for safety.

### Image resolution at deploy time (what Railway actually pulls)

`deployer.deployToCloud()` resolves the image via `resolveDeployImage()`
(`src/lib/openclaw/deployer.ts:108`):

1. **Primary**: `prisma.openClawVersion.findFirst({ where: { isStable: true }, orderBy: { releasedAt: 'desc' } })` → returns the row's `dockerImage`, which is an immutable `:<version>` reference (the register endpoint at `src/app/api/internal/versions/register/route.ts:88-93` rejects moving pointers like `:latest`/`:candidate` so this field can never be a tag that drifts).
2. **Fallback**: `OPENCLAW_DOCKER_IMAGE` Vercel env var (manual override; not used in normal operation).
3. **Hardcoded last-resort**: `ghcr.io/laxcorp-research/openclaw-runtime:latest` — fires only if both (1) and (2) are unset. The current prod and staging DBs each have a stable row, so this path is never taken in normal operation.

The resolved string is passed to `railway-client.createService({ image })` /
`updateAndRedeployService(..., image)`. Railway never independently consults
`:latest` — it pulls the exact tag the deployer hands it.

### Tagging policy

The build workflow pushes three immutable tags + one moving pointer per
successful run:

| Tag | Mutability | Purpose |
|---|---|---|
| `:base-<upstream-version>` | **Immutable** (one per upstream release) | Upstream OpenClaw base image (no overlay). Reused across overlay-only rebuilds (e.g. `:base-2026.5.22` serves both `:2026.5.22` and `:2026.5.22-1`). |
| `:<output-version>` | **Immutable** (PR-2b policy enforced in the workflow) | Extended image with our overlay (`container/process-manager.mjs`, `container/credit-proxy.mjs`, `container/claws-activity-reporter/`). Output version equals upstream version on a clean release (`2026.5.22`) and gets a `-N` suffix for overlay-only rebuilds (`2026.5.22-1`). |
| `:candidate` | Moving | Always points at the newest auto-built extended image. Promote workflow asserts this digest matches the requested `:<version>` digest before retagging `:latest`. |
| `:latest` | Moving — **only the promote workflow rewrites it** | Marks the newest stable image. Build workflow never touches this tag. |

The immutable-tag policy is hard-enforced in `build-openclaw-image.yml:242-250`:
running `force_version=<X>` against an already-existing `:<X>` tag fails the
job with an error pointing the operator at `force_version=<X>-1`.

### Automatic (weekly) builds

`build-openclaw-image.yml` runs every Monday at 06:00 UTC via cron
(`schedule: cron: '0 6 * * 1'`):

1. Detect the newest upstream STABLE release via the GitHub Releases API on
   `openclaw/openclaw` (filtered to `prerelease==false`).
2. **Overlay-aware skip-check** (PR-2b #7): if `:<upstream-version>` already
   exists on GHCR, fetch its `ai.buildclaws.overlay-sha` label and compare
   to the current hash of `docker/` + `container/`. If the label matches,
   skip; if it differs or is absent, rebuild even though upstream version
   is unchanged. This is what lets a `container/`-only change ship in the
   Monday auto-build instead of silently sitting unbuilt.
3. Clone upstream at `v<upstream-version>`, build `:base-<upstream-version>`.
4. Build the extended image, push `:<output-version>` + `:candidate`.
5. POST to the register endpoint with `isCandidate=true` so a new
   `OpenClawVersion` row lands with `isLatest=true, isStable=false`. The
   default register endpoint is **staging**
   (`https://staging.app.buildclaws.ai/api/internal/versions/register`) —
   pass `register_endpoint` to override for prod registration on
   manual-dispatch runs.

The auto-build never writes `:latest` and never sets `isStable=true`. A
human must run the promote workflow to advance production.

### Manual (force) builds

To force a rebuild between Mondays (typically: an overlay change that
needs to ship before next cron):

```bash
gh workflow run build-openclaw-image.yml --ref staging \
  -f force_version=<upstream-version>           # clean rebuild for a never-built upstream release
# OR
gh workflow run build-openclaw-image.yml --ref staging \
  -f force_version=<upstream-version>-N         # overlay-only rebuild on top of an existing upstream release
```

Two cases:

- **First build of a particular upstream release** (`force_version=2026.5.23`): identical to the cron path. Pushes `:base-2026.5.23`, `:2026.5.23`, `:candidate`.
- **Overlay-only rebuild on top of an upstream release that's already been built** (`force_version=2026.5.22-1`): reuses `:base-2026.5.22`, builds a new extended image, pushes the new immutable `:2026.5.22-1`, moves `:candidate`. The `-N` suffix is **required** in this case — bare `force_version=2026.5.22` against an existing `:2026.5.22` tag is rejected to preserve immutability. The PR-4c workflow refactor introduced four distinct outputs (`output_version`, `upstream_version`, `upstream_tag`, deprecated alias `source_version`) so the overlay-suffixed value and the upstream-source value never get conflated in clone/label/tag operations.

`force_version` runs use whatever SHA the **dispatched ref** points at to
COPY `container/*.mjs` into the final image. Overlay changes land on
`staging` first in our flow, so **always pass `--ref staging`** — a
default-branch (`main`) dispatch silently builds the overlay from main and
omits anything merged to staging but not yet promoted to main. This was
caught live during the PR-9/A-container release (2026-06-10): the first
dispatch defaulted to `main` and had to be cancelled before push.

### Image release runbook (overlay changes)

The verified end-to-end sequence for shipping a `container/` overlay change
(first executed for PR-9/A-container, 2026-06-10/11):

1. **Merge the overlay PR to `staging`.** The image build copies
   `container/*.mjs` from the dispatched ref — staging is where the change
   lives.
2. **Dispatch the build with `--ref staging`** (see the warning above —
   default-branch dispatch silently builds a stale overlay):

   ```bash
   gh workflow run build-openclaw-image.yml --ref staging -f force_version=<upstream>-N
   ```

   The `-N` suffix is **required** when the upstream `:<version>` tag already
   exists (immutable-tag policy). The build registers an `isCandidate` row on
   **staging** by default.
3. **Flip the staging stable row via the admin promote route**
   (`POST /api/admin/versions/<row-id>/promote`, admin session) — **not** the
   promote workflow at this stage. The workflow also retags GHCR `:latest`,
   which should stay parked until prod promotion; the admin route flips
   `isStable` transactionally on the staging DB and touches nothing in GHCR.
4. **Validate on staging**: deploy/redeploy a staging workspace; confirm
   `Deployment.containerImage` AND Railway `serviceInstance.source.image`
   show the new tag; exercise the changed behavior end-to-end. Note: use a
   full **container redeploy** for any restart needed during validation —
   the in-process `gateway.restart.request` path silently kills the
   activity wire (see
   [#122](https://github.com/Laxcorp-Research/claws/issues/122)).
5. **Prod promotion (separate, operator-gated step)**:
   `promote-openclaw-image.yml` with the prod register endpoint — moves
   `:latest` and writes prod's stable row.

**Pre-first-customer-deploy verification item:** as of 2026-06-11 the
**prod `OpenClawVersion` table is EMPTY** ("No versions registered" in the
prod admin). A first prod deploy would fall through image resolution to the
`OPENCLAW_DOCKER_IMAGE` env var or the hardcoded `:latest` fallback
(`resolveDeployImage`, `src/lib/openclaw/deployer.ts`) — unpinned and
unaudited. The first prod promotion fixes this; verify a stable row exists
on prod **before** any first customer deploy. (Master-tracker item.)

### Tag mutability summary

| Tag | Mutable? | When it moves |
|---|---|---|
| `:base-<upstream-version>` | No | Never (single push per upstream release; immutable per PR-2b). |
| `:<output-version>` | No | Never (PR-2b's immutable-tag policy rejects re-pushes). |
| `:candidate` | Yes | On every successful build. |
| `:latest` | Yes | Only on a successful `promote-openclaw-image.yml` run. |
| `@sha256:...` (digest) | No | Never (content-addressed). |

Documentation that pins to a specific `:<version>` is permanent — the tag
will not be re-pointed. Documentation that pins to `:latest` is a snapshot
of "the digest `:latest` resolved to when the doc was written"; the
underlying immutable `:<version>` it pointed to is the durable reference.

### Promoting a candidate to production

`promote-openclaw-image.yml` is the only path that flips a candidate into
the stable slot:

```bash
gh workflow run promote-openclaw-image.yml --ref main \
  -f version=<version-to-promote> \
  -f register_endpoint=https://app.buildclaws.ai/api/internal/versions/register
# Default register_endpoint is prod. Pass the staging URL to soak a candidate
# on staging without affecting prod's stable pointer (prod's deployer reads
# its own DB's isStable row, which the staging endpoint never touches).
```

The workflow:
1. Asserts `:candidate` and `:<version>` resolve to the same digest in GHCR.
   This catches the case where another build slipped a different candidate
   in between QA review and promote click. `skip_candidate_check=true`
   bypasses this assertion (hotfix-only escape hatch).
2. Server-side retags `:<version>` → `:latest` via
   `docker buildx imagetools create` (atomic manifest copy, preserves
   digest, no re-upload).
3. POSTs to the register endpoint with `isStable=true`. The register
   endpoint transactionally sets `isStable=true` on the target row and
   clears `isStable` from all other rows (`updateMany` inside
   `prisma.$transaction`), so the DB never holds two stable rows.

Note that `:latest` is moved unconditionally by the promote workflow even
when `register_endpoint` is staging. This is safe because nothing in the
prod runtime path reads `:latest` — the prod deployer pulls
`OpenClawVersion.dockerImage` from its own DB's stable row, which is an
immutable `:<version>` reference. The `:latest` tag is operational
furniture, not a deploy instruction.

### Updating what Railway pulls (prod)

The full sequence to move a prod workspace onto a new runtime version:

1. `build-openclaw-image.yml` runs (cron or manual) — registers a candidate
   row on **staging**.
2. Soak the candidate on staging: redeploy a staging workspace; the staging
   deployer reads the (post-promote) staging stable row and pulls the new
   image. Validate Railway logs, plugin load, dashboard behavior.
3. `promote-openclaw-image.yml` runs with the **prod** register endpoint
   (the default) — flips prod's `OpenClawVersion` stable row and retags
   GHCR `:latest`.
4. Prod workspaces continue running on their old image until they are
   redeployed (env change, builder save, `/api/deploy/.../redeploy`, or a
   user-triggered redeploy from the dashboard). The change is opt-in per
   workspace; nothing auto-rolls.

The `OPENCLAW_DOCKER_IMAGE` env var is no longer the daily knob. Treat it
as an escape hatch only — e.g. to force a specific workspace's next
`createService` call to use a non-stable image during incident response.

---

## Quick Reference

### Common operations

| Task | How |
|------|-----|
| Check Railway project status | Admin panel > Containers, or Railway dashboard |
| View a container's logs | Dashboard > Logs tab, or Railway dashboard |
| Redeploy with new config | Builder > Save > Setup > Deploy |
| Stop a workspace | Dashboard > Pause |
| Check if Railway is configured | `isRailwayConfigured()` in `railway-client.ts` |

### Simulation mode

When `RAILWAY_API_TOKEN` is not set, the deployer enters simulation mode:
- Creates fake container IDs (`sim-xxxxxxxx`)
- Walks through deployment stages with delays
- No real container is created
- Throws in `NODE_ENV=production`

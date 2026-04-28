# Container Infrastructure

How Claws deploys and manages OpenClaw containers on Railway.

Last updated: 2026-04-10

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
| `OPENCLAW_DOCKER_IMAGE` | `ghcr.io/laxcorp-research/openclaw-runtime:latest` | Docker image Railway pulls when creating services |

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
published by the GitHub Actions workflow at
`.github/workflows/build-openclaw-image.yml`. What Railway pulls is governed
by `OPENCLAW_IMAGE` in `src/lib/openclaw/railway-client.ts`, which falls back
to `:latest` if the Vercel env var `OPENCLAW_DOCKER_IMAGE` is unset.

### Automatic (weekly) builds

The workflow runs every Monday at 06:00 UTC via cron. It:
1. Queries `ghcr.io/openclaw/openclaw` for tags matching `YYYY.MM.PATCH`,
   picks the highest semver as the upstream version.
2. Checks whether `laxcorp-research/openclaw-runtime:<version>` already
   exists on GHCR — if so, skips (no rebuild).
3. Clones upstream at `v<version>`, builds the base image, layers our
   `container/process-manager.mjs` + `container/credit-proxy.mjs` via
   `docker/Dockerfile`, publishes to both `:<version>` AND `:latest`.

### Manual (force) builds

To force a rebuild (e.g., when you've changed `container/process-manager.mjs`
and need it baked into the image before next Monday):

```bash
gh workflow run build-openclaw-image.yml -f force_version=<upstream-version>
```

`force_version` bypasses the skip-if-exists check and rebuilds `:<version>`
AND `:latest` with a fresh digest. The workflow uses whatever `main`-branch
SHA is current at trigger time to COPY `container/*.mjs` into the final
image — so your code changes must be merged to `main` BEFORE you run
`gh workflow run`.

### Tag mutability

**Both `:<version>` and `:latest` are MUTABLE.** Every weekly cron and every
`force_version` dispatch overwrites them. Old digests remain pullable by
digest (`@sha256:...`) but are unreferenced by the named tags.

Documentation that pins to a specific digest (audits, runtime contracts) is
a snapshot — a subsequent rebuild doesn't invalidate the running containers
that were deployed against the old digest, but it does mean "the digest
currently at `:latest`" is not the same as "the digest `:latest` pointed at
when the audit was written."

### Updating what Railway pulls

- **If `OPENCLAW_DOCKER_IMAGE` is unset (or set to `:latest`) in Vercel env**:
  next container deploy automatically picks up the newest `:latest` digest.
  No code change or env change needed.
- **If `OPENCLAW_DOCKER_IMAGE` is pinned to `:<version>`**: update the env
  var via `npx vercel env add OPENCLAW_DOCKER_IMAGE` to point at the new
  version. Redeploy Vercel (env changes require a redeploy to propagate).

Running containers are unaffected — only NEW `createService` calls see the
new image. To pick up a new runtime in an already-deployed workspace, trigger
a redeploy (Builder → Save → Setup → Deploy, or `/api/deploy/.../redeploy`).

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

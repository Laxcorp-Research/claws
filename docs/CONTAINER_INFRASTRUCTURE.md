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
| `OPENCLAW_DOCKER_IMAGE` | `ghcr.io/laxcorp/openclaw-runtime:latest` | Docker image Railway pulls when creating services |

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

The admin versions page (`/admin/versions`) manages `OpenClawVersion` records.
The `dockerImage` field specifies which image Railway pulls. To update:

1. Pull the new upstream image and re-tag: `docker tag ghcr.io/openclaw/openclaw:<version> ghcr.io/laxcorp/openclaw-runtime:latest`
2. Push to ghcr.io (or update the tag reference)
3. In admin panel: add new version, promote to stable
4. Users see "Update available" banner and can redeploy

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

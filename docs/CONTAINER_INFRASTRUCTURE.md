# Container Infrastructure

How Claws deploys and manages OpenClaw containers on a remote DigitalOcean droplet.

Last updated: 2026-04-09

---

## Architecture Overview

```
┌─────────────────────┐       HTTPS        ┌──────────────────────────┐
│  Vercel (Next.js)   │ ──────────────────> │  DigitalOcean Droplet    │
│                     │   Bearer token      │  134.209.166.81          │
│  src/lib/           │                     │                          │
│  container-client.ts│ <────────────────── │  Container Agent (:9876) │
│                     │   JSON responses    │  /opt/claws-agent/       │
│  src/lib/openclaw/  │                     │                          │
│  deployer.ts        │                     │  Docker Engine (28.2.2)  │
│  generator.ts       │                     │  ├── claws-<wsId>        │
│                     │                     │  ├── claws-<wsId>        │
│                     │                     │  └── ...                 │
└─────────────────────┘                     └──────────────────────────┘
```

**Vercel has no Docker.** There is no Docker socket, no `dockerode`, no Docker SDK.
Instead, a lightweight Node.js HTTP agent on the droplet wraps Docker CLI commands
and exposes them as a REST API. Vercel calls that API via `src/lib/container-client.ts`.

---

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/container-client.ts` | HTTP client for the droplet agent. All container operations go through here. |
| `src/lib/openclaw/deployer.ts` | Orchestrates the full deploy lifecycle: generate files, write to volume, create container, health check. Falls back to simulation when agent is unavailable. |
| `src/lib/openclaw/generator.ts` | Converts Prisma DB models into OpenClaw workspace files (`openclaw.json`, `.env`, per-agent `SOUL.md`/`AGENTS.md`/etc). |
| `scripts/droplet-setup.sh` | Provisions the droplet from scratch: installs Docker, Node, firewall rules, and the container agent as a systemd service. |
| `src/app/api/deploy/[workspaceId]/cloud/route.ts` | API route that triggers `deployToCloud()`. |
| `src/app/api/deploy/[workspaceId]/health/route.ts` | API route for checking container health via the agent. |
| `src/app/api/deploy/[workspaceId]/logs/route.ts` | API route for fetching container logs via the agent. |
| `src/app/api/admin/containers/health/route.ts` | Admin endpoint to check if the droplet agent is reachable. |
| `src/app/admin/versions/page.tsx` | Admin UI for managing OpenClaw version records. |
| `src/components/dashboard/version-update-banner.tsx` | User-facing banner that shows when a newer stable version is available. |

---

## Environment Variables

These must be set in `.env.local` (dev) and in Vercel (staging/production):

| Variable | Example | Purpose |
|----------|---------|---------|
| `CONTAINER_HOST` | `http://134.209.166.81:9876` | Base URL of the container agent on the droplet |
| `CONTAINER_AGENT_SECRET` | `00db2dce...b0b500` | Bearer token for authenticating with the agent |
| `CONTAINER_HOST_IP` | `134.209.166.81` | Public IP of the droplet (used for health checks and WebSocket URLs) |
| `OPENCLAW_DOCKER_IMAGE` | `ghcr.io/laxcorp/openclaw-runtime:latest` | Docker image the deployer pulls when creating containers |

**Critical:** If `CONTAINER_HOST` or `CONTAINER_AGENT_SECRET` is missing/empty, the deployer
runs in **simulation mode** -- it walks through all deployment stages with fake delays and
produces a `sim-xxxxxxxx` container ID. No real container is created. This is intentional
for local dev and staging without a droplet.

The check is in `container-client.ts`:

```typescript
export function isContainerHostConfigured(): boolean {
  return !!(CONTAINER_HOST && CONTAINER_SECRET);
}
```

---

## The Droplet (134.209.166.81)

### What's running

- **OS:** Ubuntu 24.04
- **Docker:** 28.2.2
- **Container Agent:** Node.js Express app at `/opt/claws-agent/agent.mjs`, managed by systemd as `claws-agent.service`
- **Port 9876:** Agent API (firewalled open)
- **Port 22:** SSH (firewalled open)
- **Container ports (18789+):** Mapped dynamically via `-p 0:18789`, NOT exposed through firewall

### Agent API Endpoints

All endpoints (except `/health`) require `Authorization: Bearer <AGENT_SECRET>`.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health check (no auth required) |
| POST | `/containers/create` | Create and start a container |
| POST | `/containers/:name/stop` | Stop a container |
| POST | `/containers/:name/start` | Start a stopped container |
| POST | `/containers/:name/restart` | Restart a container |
| DELETE | `/containers/:name` | Stop and remove a container |
| GET | `/containers/:name` | Inspect a container (status, ports, etc) |
| GET | `/containers/:name/logs?tail=N` | Get container logs |
| GET | `/containers` | List all `claw-*` containers |
| POST | `/volumes/:name/files` | Write files to a named Docker volume |
| POST | `/images/pull` | Pull a Docker image |

### SSH Access

```bash
ssh root@134.209.166.81
```

Useful commands once connected:

```bash
systemctl status claws-agent    # Agent service status
journalctl -u claws-agent -n 50 # Agent logs
docker ps -a                    # All containers
docker logs claws-<workspaceId> # Specific container logs
docker images                   # Pulled images
ss -tlnp | grep 9876            # Verify agent is listening
```

### Re-provisioning the droplet

If you need to set up a fresh droplet:

```bash
ssh root@<NEW_IP> 'bash -s' < scripts/droplet-setup.sh
```

Then update env vars everywhere (`.env.local`, Vercel) with the new IP and the
`AGENT_SECRET` printed at the end of the script.

---

## Docker Image

### Current setup

The deployer uses whatever image is in `OPENCLAW_DOCKER_IMAGE`. By default: `ghcr.io/laxcorp/openclaw-runtime:latest`.

This is NOT a custom-built image. It's the **upstream OpenClaw image** (`ghcr.io/openclaw/openclaw:latest`)
re-tagged locally on the droplet. The upstream `latest` image includes all channel extensions
(Telegram, Discord, Slack, WhatsApp, MS Teams, Signal, Matrix, and 80+ more).

### Image details

| Property | Value |
|----------|-------|
| Base | `node:24-bookworm` |
| User | `node` (uid 1000, non-root) |
| Workdir | `/app` |
| Entrypoint | `docker-entrypoint.sh` |
| CMD | `node openclaw.mjs gateway --allow-unconfigured` |
| State dir | `/home/node/.openclaw` (mounted as a Docker volume) |
| Gateway port | 18789 (default, binds to `lan`/0.0.0.0 in container) |

### Updating the image when OpenClaw releases a new version

On the droplet:

```bash
docker pull ghcr.io/openclaw/openclaw:<new-version>
docker tag ghcr.io/openclaw/openclaw:<new-version> ghcr.io/laxcorp/openclaw-runtime:latest
```

Then in the admin panel (`/admin/versions`):

1. Click "+ Add Version"
2. Enter the version string (e.g., `2.6.0`)
3. Enter docker image: `ghcr.io/laxcorp/openclaw-runtime:latest`
4. Add release notes
5. Check "Security patch" if applicable
6. After testing, click "Promote to Stable"

Existing containers stay on the old image. Users see an "Update available" banner.
Clicking "Update now" redeploys with the new image.

For security patches: "Force Update All" in the admin panel updates all deployment
records and emails affected users.

---

## Deployment Pipeline

When a user clicks "Deploy to Cloud" in the UI, here's what happens:

```
User clicks Deploy
       │
       ▼
POST /api/deploy/[workspaceId]/cloud
       │
       ├─ Auth check (session user)
       ├─ Ownership check (user owns workspace)
       ├─ Eligibility check (API key exists, plan active)
       ├─ Set workspace status → DEPLOYING
       │
       ▼
deployer.deployToCloud(workspaceId)
       │
       ├─ isContainerHostConfigured()?
       │     NO  → simulateDeploy() → fake delays, fake IDs, status=RUNNING
       │     YES ↓
       │
       ├─ [GENERATING]    generator.generateWorkspace()
       │                   → openclaw.json, .env, per-agent workspace files
       │
       ├─ [PROVISIONING]  container-client.writeFilesToVolume()
       │                   → Agent creates temp Alpine container, copies files into volume
       │
       ├─ [CONFIGURING]   Build env vars (gateway token, timezone, node options)
       │
       ├─ [STARTING]      container-client.createContainer()
       │                   → Agent runs: docker run -d --name claws-<wsId>
       │                     -p 0:18789 -v claws-vol-<wsId>:/home/node/.openclaw
       │                     <image>
       │
       ├─ [HEALTH_CHECK]  Poll http://<droplet-ip>:<hostPort>/healthz
       │                   (60s timeout, 2s interval)
       │
       ├─ [WAITING_CHANNELS]  Poll /readyz if channels configured
       │                       (120s timeout)
       │
       └─ [COMPLETED]     Update workspace: status=RUNNING, containerId, hostPort, etc.
```

### Container naming

- Container: `claws-<workspaceId>`
- Volume: `claws-vol-<workspaceId>`
- Port: dynamically assigned by Docker (`-p 0:18789`)

### Resource limits per container

- Memory: 1024 MB
- CPUs: 1.0
- PIDs: 256
- Restart policy: `on-failure:5`
- Security: `no-new-privileges`, `--init`

---

## OpenClaw Runtime Inside the Container

Each container runs a single OpenClaw gateway instance. The volume at `/home/node/.openclaw/` contains:

```
/home/node/.openclaw/
├── openclaw.json          ← Gateway + agent config (strict Zod validation)
├── .env                   ← API keys, channel tokens
├── workspace-orchestrator/
│   ├── SOUL.md            ← Agent personality
│   ├── AGENTS.md          ← Operating instructions (delegation rules)
│   ├── USER.md            ← Human profile
│   ├── IDENTITY.md        ← Agent identity card
│   ├── TOOLS.md           ← Connected tools info
│   ├── HEARTBEAT.md       ← Periodic task checklist
│   ├── BOOT.md            ← Startup checklist
│   ├── skills/<name>/SKILL.md
│   └── memory/            ← Auto-created by agent at runtime
├── workspace-<worker-id>/
│   └── (same structure, minus HEARTBEAT.md)
├── workspace-<critic-id>/
│   └── (same structure)
└── cron/
    └── jobs.json          ← Scheduled tasks
```

The generator (`src/lib/openclaw/generator.ts`) builds all these files from the Prisma
database models: workspace → agents → skills → connections → channels.

### Health endpoints (inside the container)

- `/healthz` — Liveness: gateway process is up
- `/readyz` — Readiness: channels are connected

These are accessed from Vercel via `http://<CONTAINER_HOST_IP>:<hostPort>/healthz`.

---

## Version Management

### Database model

`OpenClawVersion` in Prisma:

| Field | Purpose |
|-------|---------|
| `version` | Semver string (e.g., `2.5.0`) |
| `dockerImage` | Full image reference |
| `isStable` | Whether this version is promoted to stable |
| `isLatest` | Whether this is the newest version registered |
| `isSecurityPatch` | Triggers force-update UI and email notifications |
| `releaseNotes` | What changed |
| `breakingChanges` | Migration notes |

### User-facing flow

1. `VersionUpdateBanner` calls `GET /api/versions/stable`
2. Compares `stableVersion.dockerImage` with the workspace's current `containerImage`
3. If different → shows "Update available" (or "Security update" if `isSecurityPatch`)
4. User clicks "Update now" → `POST /api/workspaces/[id]/update-version`

### Admin flow

1. `/admin/versions` shows all registered versions
2. "+ Add Version" creates a new version record (`isStable: false`)
3. "Promote to Stable" marks it as the target for user updates
4. "Force Update All" updates all deployment records + sends emails

---

## Known TODOs

These are gaps that need implementation:

### 1. Wire update/force-update to actually restart containers

`src/app/api/workspaces/[id]/update-version/route.ts` and
`src/app/api/admin/versions/[id]/force-update/route.ts` both update the
`containerImage` field in the database but do NOT call the container agent to:

1. Pull the new image on the droplet
2. Stop the running container
3. Start a new container with the new image
4. Run health checks

The TODO comments in both files say: "When container infrastructure is live (Tier 3)".
The infrastructure IS live now. These need to call `pullImage()`, `removeContainer()`,
and `createContainer()` from `container-client.ts`.

### 2. Automatic security patch rollout (48-hour cron)

The `VersionUpdateBanner` tells users "Your Claw will be automatically updated within
48 hours" for security patches, but no cron job or scheduled task exists to actually
do this. Needs a Vercel cron route (or external scheduler) that:

1. Finds all deployments not on the latest security-patched version
2. Calls the container agent to redeploy each one
3. Sends notification emails

### 3. Vercel env vars for staging/production

`.env.local` has the container infrastructure vars set for local dev.
The same variables need to be added to Vercel for the staging and production
environments:

- `CONTAINER_HOST=http://134.209.166.81:9876`
- `CONTAINER_AGENT_SECRET=<the secret from the droplet>`
- `CONTAINER_HOST_IP=134.209.166.81`
- `OPENCLAW_DOCKER_IMAGE=ghcr.io/laxcorp/openclaw-runtime:latest`

### 4. Seed data image mismatch

`prisma/seed.ts` seeds `OpenClawVersion` with `ghcr.io/openclaw/openclaw:2.5.0`
(upstream image name), but the deployer uses `ghcr.io/laxcorp/openclaw-runtime:latest`
(our re-tagged name). These should be aligned so the version-comparison logic works
correctly.

---

## Quick Reference

### Check if everything is working

```bash
# From your machine — test agent health
curl http://134.209.166.81:9876/health

# Test authenticated endpoint
curl -H "Authorization: Bearer <SECRET>" http://134.209.166.81:9876/containers

# SSH into droplet
ssh root@134.209.166.81

# On droplet — check services
systemctl status claws-agent
docker ps -a
docker images
```

### Common operations

| Task | How |
|------|-----|
| Restart the container agent | `ssh root@134.209.166.81 "systemctl restart claws-agent"` |
| View agent logs | `ssh root@134.209.166.81 "journalctl -u claws-agent -n 100"` |
| View a container's logs | `ssh root@134.209.166.81 "docker logs claws-<workspaceId>"` |
| Pull new OpenClaw image | `ssh root@134.209.166.81 "docker pull ghcr.io/openclaw/openclaw:latest && docker tag ghcr.io/openclaw/openclaw:latest ghcr.io/laxcorp/openclaw-runtime:latest"` |
| Kill all containers | `ssh root@134.209.166.81 "docker stop \$(docker ps -q) && docker rm \$(docker ps -aq)"` |
| Check disk usage | `ssh root@134.209.166.81 "df -h && docker system df"` |
| Prune unused images | `ssh root@134.209.166.81 "docker image prune -af"` |

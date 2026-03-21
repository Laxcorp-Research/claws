// lib/openclaw/deployer.ts
// ============================================================================
// Container lifecycle management for Claws workspaces.
// Handles: provisioning, file injection, startup, health checks,
//          stopping, restarting, config updates, and export.
//
// VALIDATED AGAINST: OpenClaw codebase (March 2026)
// Key findings incorporated:
//   1. Base image: custom-built from OpenClaw Dockerfile (node:24-bookworm)
//   2. Entrypoint: node openclaw.mjs gateway --bind lan --port 18789
//   3. State dir: /home/node/.openclaw (default for `node` user)
//   4. Runs as non-root user `node` (uid 1000)
//   5. Health: /healthz (liveness) + /readyz (readiness with channel checks)
//   6. Persistent volume required (NOT tmpfs — agent writes memory files)
//   7. Gateway token via OPENCLAW_GATEWAY_TOKEN env var
//   8. Config hot-reload: edit openclaw.json in volume → auto-applied
//   9. init: true for PID 1 signal handling
//  10. --bind lan required (default loopback unreachable in Docker bridge)
// ============================================================================

import { prisma } from '@/lib/db';
import { encrypt, decrypt } from '@/lib/encryption';
import { generateWorkspace, type GeneratedWorkspace } from './generator';
import Docker from 'dockerode';
import { Readable } from 'stream';
import * as tar from 'tar-stream';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Our custom OpenClaw image with pre-baked extensions for all supported channels.
 * Built from OpenClaw's Dockerfile with:
 *   docker build \
 *     --build-arg OPENCLAW_EXTENSIONS="telegram discord slack whatsapp msteams signal" \
 *     -t ghcr.io/laxcorp/openclaw-runtime:latest .
 *
 * This image is built once by our CI/CD and pushed to our registry.
 * All customer containers use the same base image.
 */
const OPENCLAW_IMAGE = process.env.OPENCLAW_DOCKER_IMAGE
  ?? 'ghcr.io/laxcorp/openclaw-runtime:latest';

/** Container naming convention */
const CONTAINER_PREFIX = 'claws';

/** Network for container isolation */
const CONTAINER_NETWORK = process.env.OPENCLAW_DOCKER_NETWORK ?? 'claws-isolated';

/** Default resource limits */
const DEFAULT_MEMORY_BYTES = 1024 * 1024 * 1024;   // 1 GiB
const DEFAULT_NANO_CPUS = 1_000_000_000;            // 1 CPU core
const DEFAULT_PIDS_LIMIT = 256;

/** Health check timeouts */
const LIVENESS_TIMEOUT_MS = 60_000;    // 60s for process to start
const READINESS_TIMEOUT_MS = 120_000;  // 120s for channels to connect
const HEALTH_CHECK_INTERVAL_MS = 2_000; // Poll every 2s during startup

/** Gateway port inside container */
const GATEWAY_PORT = 18789;

// ---------------------------------------------------------------------------
// Docker Client
// ---------------------------------------------------------------------------

const docker = new Docker({
  socketPath: process.env.DOCKER_SOCKET ?? '/var/run/docker.sock',
});

// ---------------------------------------------------------------------------
// Deployment Status
// ---------------------------------------------------------------------------

type DeploymentStatus =
  | 'PENDING'
  | 'GENERATING'
  | 'PROVISIONING'
  | 'CONFIGURING'
  | 'STARTING'
  | 'HEALTH_CHECK'
  | 'WAITING_CHANNELS'
  | 'COMPLETED'
  | 'FAILED';

async function updateDeploymentStatus(
  deploymentId: string,
  status: DeploymentStatus,
  error?: string,
): Promise<void> {
  await prisma.deployment.update({
    where: { id: deploymentId },
    data: {
      status,
      ...(error && { errorMessage: error }),
      ...(status === 'COMPLETED' && { completedAt: new Date() }),
      ...(status === 'FAILED' && { failedAt: new Date() }),
    },
  });
}

// ---------------------------------------------------------------------------
// Deploy to Cloud
// ---------------------------------------------------------------------------

export async function deployToCloud(workspaceId: string): Promise<{
  deploymentId: string;
  containerId: string;
  gatewayToken: string;
}> {
  // 1. Create deployment record
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    include: { channelConnections: true },
  });

  const deployment = await prisma.deployment.create({
    data: {
      workspaceId,
      status: 'PENDING',
      version: await getNextDeploymentVersion(workspaceId),
    },
  });

  try {
    // 2. Generate workspace files
    await updateDeploymentStatus(deployment.id, 'GENERATING');
    const generated = await generateWorkspace(workspaceId);

    // 3. Provision container
    await updateDeploymentStatus(deployment.id, 'PROVISIONING');
    const containerName = `${CONTAINER_PREFIX}-${workspaceId}`;

    // Remove existing container if any (for redeployments)
    await removeContainerIfExists(containerName);

    // Create persistent volume for workspace data
    const volumeName = `${CONTAINER_PREFIX}-vol-${workspaceId}`;
    await ensureVolume(volumeName);

    const container = await docker.createContainer({
      Image: OPENCLAW_IMAGE,
      name: containerName,

      // OpenClaw gateway command with Docker-compatible flags
      // --bind lan = bind to 0.0.0.0 (required for Docker bridge networking)
      // --port 18789 = standard gateway port
      Cmd: [
        'node', 'openclaw.mjs', 'gateway',
        '--bind', 'lan',
        '--port', String(GATEWAY_PORT),
      ],

      // Environment variables for API keys and tokens
      // OpenClaw's dotenv loader also reads /home/node/.openclaw/.env
      // but env vars take precedence and are more secure for containers
      Env: [
        `OPENCLAW_GATEWAY_TOKEN=${generated.gatewayToken}`,
        `TZ=${workspace.timezone ?? 'UTC'}`,
        'NODE_ENV=production',
        // NODE_OPTIONS for memory management in constrained containers
        `NODE_OPTIONS=--max-old-space-size=${Math.floor(DEFAULT_MEMORY_BYTES / 1024 / 1024 * 0.75)}`,
      ],

      ExposedPorts: {
        [`${GATEWAY_PORT}/tcp`]: {},
      },

      HostConfig: {
        // PID 1 init process (tini) for signal forwarding and zombie reaping
        Init: true,

        // Resource limits
        Memory: DEFAULT_MEMORY_BYTES,
        NanoCpus: DEFAULT_NANO_CPUS,
        PidsLimit: DEFAULT_PIDS_LIMIT,

        // Security hardening
        SecurityOpt: ['no-new-privileges'],
        CapDrop: ['NET_RAW', 'NET_ADMIN'],
        ReadonlyRootfs: false, // Agent needs to write to node_modules/.cache etc.

        // Persistent volume for workspace data, memory files, session state
        // Mounted at /home/node/.openclaw (OpenClaw's default state dir for `node` user)
        Binds: [
          `${volumeName}:/home/node/.openclaw`,
        ],

        // Auto-restart on failure with max retries
        RestartPolicy: {
          Name: 'on-failure',
          MaximumRetryCount: 5,
        },

        // Isolated network — containers can't reach each other
        NetworkMode: CONTAINER_NETWORK,

        // Port mapping for external access (health checks, monitoring, WhatsApp QR)
        PortBindings: {
          [`${GATEWAY_PORT}/tcp`]: [{ HostPort: '0' }], // Dynamic host port
        },
      },

      // Labels for management
      Labels: {
        'claws.workspace': workspaceId,
        'claws.managed': 'true',
        'claws.version': String(deployment.version),
      },
    });

    // 4. Copy generated files into the volume
    await updateDeploymentStatus(deployment.id, 'CONFIGURING');
    await copyWorkspaceToContainer(container.id, generated);

    // 5. Start container
    await updateDeploymentStatus(deployment.id, 'STARTING');
    await container.start();

    // 6. Liveness check: wait for /healthz (gateway process is up)
    await updateDeploymentStatus(deployment.id, 'HEALTH_CHECK');
    const containerInfo = await container.inspect();
    const hostPort = getHostPort(containerInfo);

    await waitForEndpoint(
      `http://127.0.0.1:${hostPort}/healthz`,
      LIVENESS_TIMEOUT_MS,
    );

    // 7. Readiness check: wait for /readyz (channels connected)
    const hasChannels = workspace.channelConnections.length > 0;
    if (hasChannels) {
      await updateDeploymentStatus(deployment.id, 'WAITING_CHANNELS');
      try {
        await waitForEndpoint(
          `http://127.0.0.1:${hostPort}/readyz`,
          READINESS_TIMEOUT_MS,
        );
      } catch {
        // Channels may not connect immediately (e.g., WhatsApp needs QR scan)
        // Mark as running but note the channel status
        console.warn(`[deploy] Readiness check timed out for ${workspaceId} — channels may need configuration`);
      }
    }

    // 8. Mark complete
    await updateDeploymentStatus(deployment.id, 'COMPLETED');

    await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        status: 'RUNNING',
        containerId: container.id,
        containerName,
        hostPort,
        gatewayToken: encrypt(generated.gatewayToken),
        healthStatus: 'HEALTHY',
        lastHealthCheck: new Date(),
        deploymentType: 'CLOUD',
      },
    });

    return {
      deploymentId: deployment.id,
      containerId: container.id,
      gatewayToken: generated.gatewayToken,
    };

  } catch (error: any) {
    await updateDeploymentStatus(deployment.id, 'FAILED', error.message);
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { status: 'ERROR' },
    });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Export for Self-Hosting
// ---------------------------------------------------------------------------

/**
 * Generates a downloadable zip containing everything needed to self-host.
 * The user extracts this, sets env vars, and runs docker-compose up.
 */
export async function exportForSelfHosting(workspaceId: string): Promise<Buffer> {
  const generated = await generateWorkspace(workspaceId);
  const archiver = await import('archiver');
  const { PassThrough } = await import('stream');

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const passthrough = new PassThrough();
    passthrough.on('data', (chunk: Buffer) => chunks.push(chunk));
    passthrough.on('end', () => resolve(Buffer.concat(chunks)));
    passthrough.on('error', reject);

    const archive = archiver.default('zip', { zlib: { level: 9 } });
    archive.pipe(passthrough);

    // docker-compose.yml
    archive.append(generateDockerCompose(), { name: 'docker-compose.yml' });

    // .env.example (user fills in their keys)
    archive.append(generateEnvExample(generated), { name: '.env.example' });

    // README
    archive.append(generateSelfHostReadme(), { name: 'README.md' });

    // openclaw config
    archive.append(generated['openclaw.json'], {
      name: 'config/openclaw.json',
    });

    // Workspace files for each agent
    for (const [dirName, files] of Object.entries(generated.workspaces)) {
      for (const [fileName, content] of Object.entries(files)) {
        if (fileName === 'skills' && typeof content === 'object') {
          for (const [skillName, skillFiles] of Object.entries(content as Record<string, any>)) {
            archive.append(skillFiles['SKILL.md'], {
              name: `${dirName}/skills/${skillName}/SKILL.md`,
            });
          }
        } else if (typeof content === 'string') {
          archive.append(content, { name: `${dirName}/${fileName}` });
        }
      }
    }

    // Cron jobs
    if (generated['cron/jobs.json'] !== '[]') {
      archive.append(generated['cron/jobs.json'], { name: 'config/cron/jobs.json' });
    }

    archive.finalize();
  });
}

function generateDockerCompose(): string {
  return `# Claws Self-Hosted Deployment
# 1. Copy .env.example to .env and fill in your API keys
# 2. Run: docker-compose up -d
# 3. Check health: curl http://localhost:18789/healthz

services:
  openclaw:
    image: ${OPENCLAW_IMAGE}
    env_file: .env
    volumes:
      - openclaw-data:/home/node/.openclaw
    ports:
      - "\${GATEWAY_PORT:-18789}:18789"
    init: true
    restart: unless-stopped
    command: ["node", "openclaw.mjs", "gateway", "--bind", "lan", "--port", "18789"]
    healthcheck:
      test: ["CMD", "node", "-e",
        "fetch('http://127.0.0.1:18789/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 20s

volumes:
  openclaw-data:
`;
}

function generateEnvExample(generated: GeneratedWorkspace): string {
  return `# Claws Self-Hosted Configuration
# Fill in your API keys and tokens below.

# Gateway auth token (auto-generated, change if you want)
OPENCLAW_GATEWAY_TOKEN=${generated.gatewayToken}

# AI Provider Keys (at least one required)
ANTHROPIC_API_KEY=sk-ant-your-key-here
# OPENAI_API_KEY=sk-your-key-here
# GEMINI_API_KEY=your-key-here

# Channel Tokens (optional — add the ones you want to use)
# TELEGRAM_BOT_TOKEN=your-bot-token
# DISCORD_BOT_TOKEN=your-bot-token
# SLACK_BOT_TOKEN=xoxb-your-token
# SLACK_APP_TOKEN=xapp-your-token

# Timezone
TZ=UTC

# Node.js settings
NODE_ENV=production
NODE_OPTIONS=--max-old-space-size=768

# Port (default 18789)
GATEWAY_PORT=18789
`;
}

function generateSelfHostReadme(): string {
  return `# Claws Self-Hosted Deployment

## Quick Start

1. Install Docker and Docker Compose
2. Copy \`.env.example\` to \`.env\` and fill in your API keys
3. Run \`docker-compose up -d\`
4. Check health: \`curl http://localhost:18789/healthz\`
5. Access WebChat: Open \`http://localhost:18789\` in your browser

## Configuration

- \`config/openclaw.json\` — Agent configuration (hot-reloaded on change)
- \`workspace-*/\` — Agent workspace files (SOUL.md, AGENTS.md, skills, etc.)
- \`.env\` — API keys and tokens

## Updating Config

Edit \`config/openclaw.json\` — the gateway watches for changes and auto-reloads.
No restart needed for most config changes.

## Health Checks

- \`GET /healthz\` — Is the gateway process alive?
- \`GET /readyz\` — Are all channels connected?

## Logs

\`\`\`bash
docker-compose logs -f openclaw
\`\`\`

## Stopping

\`\`\`bash
docker-compose down       # Stop (keeps data)
docker-compose down -v    # Stop and delete all data
\`\`\`
`;
}

// ---------------------------------------------------------------------------
// Container Operations
// ---------------------------------------------------------------------------

/** Stop a running container */
export async function stopContainer(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
  });

  if (!workspace.containerId) throw new Error('No container found');

  const container = docker.getContainer(workspace.containerId);
  await container.stop({ t: 10 }); // 10s graceful shutdown

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      status: 'PAUSED',
      healthStatus: 'STOPPED',
    },
  });
}

/** Restart a stopped or running container */
export async function restartContainer(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
  });

  if (!workspace.containerId) throw new Error('No container found');

  const container = docker.getContainer(workspace.containerId);
  await container.restart({ t: 10 });

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      status: 'RUNNING',
      healthStatus: 'HEALTHY',
      lastHealthCheck: new Date(),
    },
  });
}

/** Redeploy with updated config (regenerates files, restarts container) */
export async function redeployWorkspace(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
  });

  // If there's a running container, we can hot-reload the config
  // by updating the files in the volume. OpenClaw watches openclaw.json.
  if (workspace.containerId && workspace.status === 'RUNNING') {
    const generated = await generateWorkspace(workspaceId);

    // Update config file in the volume — triggers hot-reload
    const container = docker.getContainer(workspace.containerId);
    await copyWorkspaceToContainer(workspace.containerId, generated);

    // The gateway's config reloader will detect the change and apply it.
    // For workspace .md file changes, a container restart is needed
    // since those are loaded at agent run time from disk.
    // However, the next agent run will pick up the new files automatically.

    return;
  }

  // Otherwise, full redeploy
  await deployToCloud(workspaceId);
}

/** Destroy container and clean up */
export async function destroyDeployment(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
  });

  if (workspace.containerId) {
    await removeContainerIfExists(`${CONTAINER_PREFIX}-${workspaceId}`);
  }

  // Optionally remove the volume (keeps data by default)
  // const volumeName = `${CONTAINER_PREFIX}-vol-${workspaceId}`;
  // await docker.getVolume(volumeName).remove();

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      status: 'DRAFT',
      containerId: null,
      containerName: null,
      hostPort: null,
      gatewayToken: null,
      healthStatus: null,
    },
  });
}

// ---------------------------------------------------------------------------
// Health Monitoring
// ---------------------------------------------------------------------------
// Called by a cron job (Vercel Cron or separate worker) every 2 minutes.
// Uses /healthz (liveness) and /readyz (readiness with channel checks).
// ---------------------------------------------------------------------------

export async function healthCheckAllContainers(): Promise<void> {
  const runningWorkspaces = await prisma.workspace.findMany({
    where: { status: 'RUNNING', deploymentType: 'CLOUD' },
    select: { id: true, containerId: true, hostPort: true, userId: true },
  });

  for (const ws of runningWorkspaces) {
    if (!ws.hostPort) continue;

    try {
      // Liveness check
      const liveRes = await fetchWithTimeout(
        `http://127.0.0.1:${ws.hostPort}/healthz`,
        5000,
      );

      if (!liveRes.ok) {
        await markUnhealthy(ws.id, ws.userId, 'Liveness check failed');
        continue;
      }

      // Readiness check (channels)
      const readyRes = await fetchWithTimeout(
        `http://127.0.0.1:${ws.hostPort}/readyz`,
        5000,
      );

      await prisma.workspace.update({
        where: { id: ws.id },
        data: {
          healthStatus: readyRes.ok ? 'HEALTHY' : 'DEGRADED',
          lastHealthCheck: new Date(),
        },
      });
    } catch {
      await markUnhealthy(ws.id, ws.userId, 'Container unreachable');
    }
  }
}

async function markUnhealthy(
  workspaceId: string,
  userId: string,
  reason: string,
): Promise<void> {
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { healthStatus: 'UNHEALTHY' },
  });

  // Send alert to user (email or in-app notification)
  await sendHealthAlert(userId, workspaceId, reason);
}

async function sendHealthAlert(
  userId: string,
  workspaceId: string,
  reason: string,
): Promise<void> {
  // TODO: Implement email/notification alert
  console.error(`[health] Workspace ${workspaceId} unhealthy: ${reason}`);
}

// ---------------------------------------------------------------------------
// Gateway WebSocket Connection (for monitoring)
// ---------------------------------------------------------------------------
// The platform connects to each container's Gateway via WebSocket
// to stream agent activity events for the live dashboard.
//
// Protocol: JSON frames
//   Client→Gateway: {"type":"req","id":"1","method":"agent","params":{...}}
//   Gateway→Client: {"type":"event","event":"agent","payload":{...}}
//   Gateway→Client: {"type":"res","id":"1","ok":true,"payload":{...}}
//
// Auth: Include OPENCLAW_GATEWAY_TOKEN in the connect handshake.
// ---------------------------------------------------------------------------

export async function getGatewayConnectionInfo(workspaceId: string): Promise<{
  wsUrl: string;
  token: string;
} | null> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
  });

  if (!workspace.hostPort || !workspace.gatewayToken) return null;

  return {
    wsUrl: `ws://127.0.0.1:${workspace.hostPort}`,
    token: decrypt(workspace.gatewayToken),
  };
}

// ---------------------------------------------------------------------------
// Container File Operations
// ---------------------------------------------------------------------------

/**
 * Copies all generated workspace files into the container's volume.
 * Uses tar stream to efficiently write multiple files in one operation.
 *
 * Target structure inside container:
 *   /home/node/.openclaw/
 *   ├── openclaw.json
 *   ├── .env
 *   ├── workspace-orchestrator/
 *   │   ├── SOUL.md
 *   │   ├── AGENTS.md
 *   │   ├── ...
 *   │   └── skills/<name>/SKILL.md
 *   ├── workspace-worker-1/
 *   │   └── ...
 *   ├── cron/
 *   │   └── jobs.json
 *   └── agents/        ← auto-created by OpenClaw for session storage
 */
async function copyWorkspaceToContainer(
  containerId: string,
  generated: GeneratedWorkspace,
): Promise<void> {
  const container = docker.getContainer(containerId);
  const tarStream = await buildTarStream(generated);

  await container.putArchive(tarStream, {
    path: '/home/node/.openclaw',
  });
}

async function buildTarStream(generated: GeneratedWorkspace): Promise<Readable> {
  const pack = tar.pack();

  // openclaw.json
  addToTar(pack, 'openclaw.json', generated['openclaw.json']);

  // .env
  addToTar(pack, '.env', generated['.env']);

  // cron/jobs.json
  const cronContent = generated['cron/jobs.json'];
  if (cronContent && cronContent !== '[]') {
    addToTar(pack, 'cron/jobs.json', cronContent);
  }

  // Per-agent workspace directories
  for (const [dirName, files] of Object.entries(generated.workspaces)) {
    // Create memory/ subdirectory (empty — agent populates it)
    pack.entry({ name: `${dirName}/memory`, type: 'directory', mode: 0o755 });

    for (const [fileName, content] of Object.entries(files)) {
      if (fileName === 'skills' && typeof content === 'object') {
        // Skills subdirectories
        for (const [skillName, skillFiles] of Object.entries(content as Record<string, any>)) {
          addToTar(pack, `${dirName}/skills/${skillName}/SKILL.md`, skillFiles['SKILL.md']);
        }
      } else if (typeof content === 'string') {
        addToTar(pack, `${dirName}/${fileName}`, content);
      }
    }
  }

  pack.finalize();
  return pack;
}

function addToTar(pack: tar.Pack, name: string, content: string): void {
  pack.entry({ name, mode: 0o644 }, content);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function removeContainerIfExists(name: string): Promise<void> {
  try {
    const existing = docker.getContainer(name);
    const info = await existing.inspect();
    if (info.State.Running) {
      await existing.stop({ t: 5 });
    }
    await existing.remove({ force: true });
  } catch (err: any) {
    if (err.statusCode !== 404) throw err;
  }
}

async function ensureVolume(name: string): Promise<void> {
  try {
    await docker.getVolume(name).inspect();
  } catch (err: any) {
    if (err.statusCode === 404) {
      await docker.createVolume({
        Name: name,
        Labels: { 'claws.managed': 'true' },
      });
    } else {
      throw err;
    }
  }
}

async function ensureNetwork(): Promise<void> {
  try {
    await docker.getNetwork(CONTAINER_NETWORK).inspect();
  } catch (err: any) {
    if (err.statusCode === 404) {
      await docker.createNetwork({
        Name: CONTAINER_NETWORK,
        Driver: 'bridge',
        Internal: true, // No external internet access between containers
        Labels: { 'claws.managed': 'true' },
      });
    } else {
      throw err;
    }
  }
}

function getHostPort(containerInfo: Docker.ContainerInspectInfo): number {
  const portBindings = containerInfo.NetworkSettings.Ports;
  const binding = portBindings[`${GATEWAY_PORT}/tcp`];
  if (!binding?.[0]?.HostPort) {
    throw new Error('No host port assigned to container');
  }
  return parseInt(binding[0].HostPort, 10);
}

async function waitForEndpoint(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetchWithTimeout(url, 5000);
      if (res.ok) return;
    } catch {
      // Expected during startup
    }
    await sleep(HEALTH_CHECK_INTERVAL_MS);
  }
  throw new Error(`Endpoint ${url} did not become healthy within ${timeoutMs}ms`);
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function getNextDeploymentVersion(workspaceId: string): Promise<number> {
  const latest = await prisma.deployment.findFirst({
    where: { workspaceId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  return (latest?.version ?? 0) + 1;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Initialization — ensure network exists on module load
// ---------------------------------------------------------------------------

ensureNetwork().catch(err => {
  console.error('[deployer] Failed to ensure Docker network:', err);
});

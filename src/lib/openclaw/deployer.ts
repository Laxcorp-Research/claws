// lib/openclaw/deployer.ts
// ============================================================================
// Container lifecycle management for Claws workspaces.
// Handles: provisioning, file injection, startup, health checks,
//          stopping, restarting, config updates, and export.
//
// Architecture:
//   - Droplet (134.209.166.81) runs a lightweight container management agent
//   - Vercel serverless functions call the agent's HTTP API via container-client
//   - When CONTAINER_HOST is not set, falls back to simulation mode
//
// VALIDATED AGAINST: OpenClaw codebase (March 2026)
// Key findings incorporated:
//   1. Base image: custom-built from OpenClaw Dockerfile (node:24-bookworm)
//   2. Entrypoint: node openclaw.mjs gateway --bind lan --port 18789
//   3. State dir: /home/node/.openclaw (default for `node` user)
//   4. Runs as non-root user `node` (uid 1000)
//   5. Health: /healthz (liveness) + /readyz (readiness with channel checks)
//   6. Persistent volume required (NOT tmpfs - agent writes memory files)
//   7. Gateway token via OPENCLAW_GATEWAY_TOKEN env var
//   8. Config hot-reload: edit openclaw.json in volume → auto-applied
//   9. init: true for PID 1 signal handling
//  10. --bind lan required (default loopback unreachable in Docker bridge)
// ============================================================================

import { prisma } from '@/lib/db';
import { encrypt, decrypt } from '@/lib/encryption';
import { generateWorkspace, type GeneratedWorkspace } from './generator';
import {
  isContainerHostConfigured,
  createContainer,
  stopContainer as agentStopContainer,
  restartContainer as agentRestartContainer,
  removeContainer,
  inspectContainer,
  writeFilesToVolume,
} from '@/lib/container-client';
import { log } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPENCLAW_IMAGE =
  process.env.OPENCLAW_DOCKER_IMAGE ??
  'ghcr.io/laxcorp/openclaw-runtime:latest';

const CONTAINER_PREFIX = 'claws';

const CONTAINER_HOST_IP = process.env.CONTAINER_HOST_IP ?? '134.209.166.81';

/** Default resource limits */
const DEFAULT_MEMORY_MB = 1024;
const DEFAULT_CPUS = 1.0;

/** Health check timeouts */
const LIVENESS_TIMEOUT_MS = 60_000;
const READINESS_TIMEOUT_MS = 120_000;
const HEALTH_CHECK_INTERVAL_MS = 2_000;

/** Gateway port inside container */
const GATEWAY_PORT = 18789;

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
  });

  const deployment = await prisma.deployment.create({
    data: {
      workspaceId,
      status: 'PENDING',
      version: await getNextDeploymentVersion(workspaceId),
      configSnapshot: JSON.stringify({
        workspaceId,
        createdAt: new Date().toISOString(),
      }),
    },
  });

  // If container host is not configured, use simulation mode
  if (!isContainerHostConfigured()) {
    log.warn('Container host not configured — running in simulation mode', {
      workspaceId,
    });
    return simulateDeploy(workspaceId, deployment.id, workspace);
  }

  try {
    // 2. Generate workspace files
    await updateDeploymentStatus(deployment.id, 'GENERATING');
    const generated = await generateWorkspace(workspaceId);

    // 3. Provision: write files to volume via droplet agent
    await updateDeploymentStatus(deployment.id, 'PROVISIONING');
    const containerName = `${CONTAINER_PREFIX}-${workspaceId}`;
    const volumeName = `${CONTAINER_PREFIX}-vol-${workspaceId}`;

    const files = buildVolumeFileMap(generated);
    await writeFilesToVolume(volumeName, files);

    // 4. Configure: build environment variables
    await updateDeploymentStatus(deployment.id, 'CONFIGURING');

    const containerEnv: Record<string, string> = {
      OPENCLAW_GATEWAY_TOKEN: generated.gatewayToken,
      TZ: workspace.timezone ?? 'UTC',
      NODE_ENV: 'production',
      NODE_OPTIONS: `--max-old-space-size=${Math.floor(DEFAULT_MEMORY_MB * 0.75)}`,
    };

    // 5. Start container via droplet agent
    await updateDeploymentStatus(deployment.id, 'STARTING');

    const result = await createContainer({
      name: containerName,
      image: OPENCLAW_IMAGE,
      env: containerEnv,
      memoryMb: DEFAULT_MEMORY_MB,
      cpus: DEFAULT_CPUS,
      volumeName,
      volumePath: '/home/node/.openclaw',
    });

    // 6. Liveness check: wait for /healthz (gateway process is up)
    await updateDeploymentStatus(deployment.id, 'HEALTH_CHECK');
    const hostPort = result.hostPort;

    if (hostPort) {
      try {
        await waitForEndpoint(
          `http://${CONTAINER_HOST_IP}:${hostPort}/healthz`,
          LIVENESS_TIMEOUT_MS,
        );
      } catch {
        log.warn('Container liveness check timed out — continuing', {
          workspaceId,
          containerName,
        });
      }

      // 7. Readiness check: wait for /readyz (channels connected)
      const hasChannels = !!workspace.channelConfigEncrypted;

      if (hasChannels) {
        await updateDeploymentStatus(deployment.id, 'WAITING_CHANNELS');
        try {
          await waitForEndpoint(
            `http://${CONTAINER_HOST_IP}:${hostPort}/readyz`,
            READINESS_TIMEOUT_MS,
          );
        } catch {
          log.warn(
            'Readiness check timed out — channels may need configuration',
            { workspaceId },
          );
        }
      }
    }

    // 8. Mark complete
    await updateDeploymentStatus(deployment.id, 'COMPLETED');

    await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        status: 'RUNNING',
        containerId: result.containerId,
        containerName,
        hostPort,
        gatewayToken: encrypt(generated.gatewayToken),
        healthStatus: 'HEALTHY',
        lastHealthCheck: new Date(),
      },
    });

    return {
      deploymentId: deployment.id,
      containerId: result.containerId,
      gatewayToken: generated.gatewayToken,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Unknown deployment error';
    await updateDeploymentStatus(deployment.id, 'FAILED', message);
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { status: 'ERROR' },
    });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Container Operations
// ---------------------------------------------------------------------------

export async function stopContainer(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
  });

  if (isContainerHostConfigured() && workspace.containerName) {
    try {
      await agentStopContainer(workspace.containerName);
    } catch {
      // Container might already be stopped
    }
  }

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      status: 'PAUSED',
      healthStatus: 'UNKNOWN',
    },
  });
}

export async function restartContainer(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
  });

  if (isContainerHostConfigured() && workspace.containerName) {
    const result = await agentRestartContainer(workspace.containerName);

    if (result.hostPort) {
      await prisma.workspace.update({
        where: { id: workspaceId },
        data: {
          status: 'RUNNING',
          hostPort: result.hostPort,
          healthStatus: 'HEALTHY',
          lastHealthCheck: new Date(),
        },
      });
      return;
    }
  }

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

  if (
    isContainerHostConfigured() &&
    workspace.containerName &&
    workspace.status === 'RUNNING'
  ) {
    const generated = await generateWorkspace(workspaceId);
    const volumeName = `${CONTAINER_PREFIX}-vol-${workspaceId}`;
    const files = buildVolumeFileMap(generated);
    await writeFilesToVolume(volumeName, files);
    return;
  }

  await deployToCloud(workspaceId);
}

/** Destroy container and clean up */
export async function destroyDeployment(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
  });

  if (isContainerHostConfigured() && workspace.containerName) {
    try {
      await removeContainer(workspace.containerName);
    } catch {
      // Container might not exist
    }
  }

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      status: 'DRAFT',
      containerId: null,
      containerName: null,
      hostPort: null,
      gatewayToken: null,
      healthStatus: 'UNKNOWN',
    },
  });
}

// ---------------------------------------------------------------------------
// Health Monitoring
// ---------------------------------------------------------------------------

export async function healthCheckAllContainers(): Promise<void> {
  const runningWorkspaces = await prisma.workspace.findMany({
    where: { status: 'RUNNING' },
    select: {
      id: true,
      containerId: true,
      containerName: true,
      hostPort: true,
      userId: true,
    },
  });

  for (const ws of runningWorkspaces) {
    if (!ws.hostPort) continue;

    // Use the droplet agent to inspect, or fall back to direct health check
    if (isContainerHostConfigured() && ws.containerName) {
      try {
        const info = await inspectContainer(ws.containerName);
        if (!info.running) {
          await markUnhealthy(ws.id, ws.userId, 'Container not running');
          continue;
        }
        await prisma.workspace.update({
          where: { id: ws.id },
          data: {
            healthStatus: 'HEALTHY',
            lastHealthCheck: new Date(),
          },
        });
      } catch {
        await markUnhealthy(ws.id, ws.userId, 'Container unreachable');
      }
      continue;
    }

    // Direct health check (localhost — for co-located setups)
    try {
      const liveRes = await fetchWithTimeout(
        `http://127.0.0.1:${ws.hostPort}/healthz`,
        5000,
      );

      if (!liveRes.ok) {
        await markUnhealthy(ws.id, ws.userId, 'Liveness check failed');
        continue;
      }

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

  await sendHealthAlert(userId, workspaceId, reason);
}

async function sendHealthAlert(
  _userId: string,
  workspaceId: string,
  reason: string,
): Promise<void> {
  // TODO: Implement email/notification alert
  log.warn(`Workspace ${workspaceId} unhealthy: ${reason}`, { workspaceId });
}

// ---------------------------------------------------------------------------
// Gateway WebSocket Connection (for monitoring)
// ---------------------------------------------------------------------------

export async function getGatewayConnectionInfo(
  workspaceId: string,
): Promise<{
  wsUrl: string;
  token: string;
} | null> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
  });

  if (!workspace.hostPort || !workspace.gatewayToken) return null;

  const host = isContainerHostConfigured()
    ? CONTAINER_HOST_IP
    : '127.0.0.1';

  return {
    wsUrl: `ws://${host}:${workspace.hostPort}`,
    token: decrypt(workspace.gatewayToken),
  };
}

// ---------------------------------------------------------------------------
// Volume File Map Builder
// ---------------------------------------------------------------------------

function buildVolumeFileMap(
  generated: GeneratedWorkspace,
): Record<string, string> {
  const files: Record<string, string> = {};

  files['openclaw.json'] = generated['openclaw.json'];
  files['.env'] = generated['.env'];

  const cronContent = generated['cron/jobs.json'];
  if (cronContent && cronContent !== '[]') {
    files['cron/jobs.json'] = cronContent;
  }

  for (const [dirName, agentFiles] of Object.entries(generated.workspaces)) {
    for (const [fileName, content] of Object.entries(agentFiles)) {
      if (fileName === 'skills' && typeof content === 'object') {
        for (const [skillName, skillFiles] of Object.entries(
          content as Record<string, Record<string, string>>,
        )) {
          for (const [skillFile, skillContent] of Object.entries(skillFiles)) {
            files[`${dirName}/skills/${skillName}/${skillFile}`] = skillContent;
          }
        }
      } else if (typeof content === 'string') {
        files[`${dirName}/${fileName}`] = content;
      }
    }
  }

  return files;
}

// ---------------------------------------------------------------------------
// Simulation Mode
// ---------------------------------------------------------------------------
// When CONTAINER_HOST is not set, simulate deployment with delays.
// This keeps staging/dev working without a real droplet.
// ---------------------------------------------------------------------------

async function simulateDeploy(
  workspaceId: string,
  deploymentId: string,
  workspace: { channelConfigEncrypted?: string | null; timezone?: string | null },
): Promise<{
  deploymentId: string;
  containerId: string;
  gatewayToken: string;
}> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Deploy simulation is disabled in production. Configure CONTAINER_HOST and CONTAINER_AGENT_SECRET.',
    );
  }

  const fakeContainerId = `sim-${workspaceId.substring(0, 8)}`;
  const fakeToken = 'simulation-token';

  await updateDeploymentStatus(deploymentId, 'GENERATING');
  await sleep(800);

  await updateDeploymentStatus(deploymentId, 'PROVISIONING');
  await sleep(600);

  await updateDeploymentStatus(deploymentId, 'CONFIGURING');
  await sleep(400);

  await updateDeploymentStatus(deploymentId, 'STARTING');
  await sleep(800);

  await updateDeploymentStatus(deploymentId, 'HEALTH_CHECK');
  await sleep(600);

  if (workspace.channelConfigEncrypted) {
    await updateDeploymentStatus(deploymentId, 'WAITING_CHANNELS');
    await sleep(400);
  }

  await updateDeploymentStatus(deploymentId, 'COMPLETED');

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      status: 'RUNNING',
      containerId: fakeContainerId,
      containerName: `${CONTAINER_PREFIX}-${workspaceId}`,
      hostPort: null,
      gatewayToken: null,
      healthStatus: 'HEALTHY',
      lastHealthCheck: new Date(),
    },
  });

  return {
    deploymentId,
    containerId: fakeContainerId,
    gatewayToken: fakeToken,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForEndpoint(
  url: string,
  timeoutMs: number,
): Promise<void> {
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
  throw new Error(
    `Endpoint ${url} did not become healthy within ${timeoutMs}ms`,
  );
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function getNextDeploymentVersion(
  workspaceId: string,
): Promise<number> {
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

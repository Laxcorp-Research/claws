// lib/openclaw/deployer.ts
// ============================================================================
// Container lifecycle management for Claws workspaces.
// Handles: provisioning, startup, health checks, stopping, restarting,
//          config updates, and destruction.
//
// Architecture:
//   - Each workspace gets its own Railway service (Docker container)
//   - Vercel serverless functions call Railway's GraphQL API
//   - Config is delivered via base64-encoded env vars, unpacked at boot
//   - Health monitored via Railway deployment status + direct /healthz
//
// Config delivery:
//   - openclaw.json → base64 → CLAWS_CONFIG_B64 env var
//   - .env content → base64 → CLAWS_ENV_B64 env var
//   - Workspace files (SOUL.md etc.) → JSON → base64 → CLAWS_FILES_B64
//   - Railway start command decodes these to /home/node/.openclaw/ on boot
// ============================================================================

import { prisma } from '@/lib/db';
import { encrypt, decrypt } from '@/lib/encryption';
import { generateWorkspace, type GeneratedWorkspace } from './generator';
import {
  isRailwayConfigured,
  createService,
  deleteService,
  redeployService,
  updateServiceVariables,
  updateAndRedeployService,
  findServiceByName,
  getServiceStatus,
  BOOT_SCRIPT_B64,
} from './railway-client';
import { log } from '@/lib/logger';
import { publishDeployEvent, clearDeployEvents } from '@/lib/deploy-events';
import { getApiKeySource } from '@/lib/credits/api-key-source';
import { CronExpressionParser } from 'cron-parser';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONTAINER_PREFIX = 'claw';

const DEPLOY_POLL_INTERVAL_MS = 3_000;
const DEPLOY_TIMEOUT_MS = 180_000;

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
  workspaceId: string,
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
  publishDeployEvent(workspaceId, deploymentId, status, error).catch(() => {});
}

// ---------------------------------------------------------------------------
// Deploy to Cloud (Railway)
// ---------------------------------------------------------------------------

export async function deployToCloud(workspaceId: string): Promise<{
  deploymentId: string;
  containerId: string;
  gatewayToken: string;
}> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
  });

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: workspace.userId },
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

  await clearDeployEvents(workspaceId).catch(() => {});

  if (!isRailwayConfigured()) {
    log.warn('Railway not configured — running in simulation mode', { workspaceId });
    return simulateDeploy(workspaceId, deployment.id, workspace);
  }

  try {
    await updateDeploymentStatus(deployment.id, workspaceId, 'GENERATING');
    const generated = await generateWorkspace(workspaceId);

    await updateDeploymentStatus(deployment.id, workspaceId, 'PROVISIONING');
    const serviceName = `${CONTAINER_PREFIX}-${workspaceId}`.substring(0, 32);
    const apiKeySource = getApiKeySource(workspace, user);
    const envVars = buildRailwayEnvVars(generated, workspace, {
      creditMode: apiKeySource === 'PLATFORM_CREDIT',
      workspaceId,
      userId: workspace.userId,
    });

    await updateDeploymentStatus(deployment.id, workspaceId, 'CONFIGURING');

    await updateDeploymentStatus(deployment.id, workspaceId, 'STARTING');

    let result: { serviceId: string; domain: string };

    if (workspace.containerId) {
      log.info('Reusing existing Railway service', { serviceId: workspace.containerId, workspaceId });
      result = await updateAndRedeployService(workspace.containerId, envVars);
      if (!result.domain && workspace.containerHost) {
        result.domain = workspace.containerHost;
      }
    } else {
      try {
        result = await createService({ name: serviceName, envVars });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('already exists')) {
          log.warn('Service already exists, looking it up by name', { serviceName, workspaceId });
          const existingId = await findServiceByName(serviceName);
          if (!existingId) throw new Error(`Service "${serviceName}" exists but could not be found`);
          result = await updateAndRedeployService(existingId, envVars);
        } else {
          throw err;
        }
      }
    }

    await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        containerId: result.serviceId,
        containerName: serviceName,
        ...(result.domain && { containerHost: result.domain }),
      },
    });

    await updateDeploymentStatus(deployment.id, workspaceId, 'HEALTH_CHECK');
    await waitForDeploymentSuccess(result.serviceId);

    if (workspace.channelConfigEncrypted) {
      await updateDeploymentStatus(deployment.id, workspaceId, 'WAITING_CHANNELS');
      try {
        await waitForEndpoint(`https://${result.domain}/readyz`, 60_000);
      } catch {
        log.warn('Readiness check timed out — channels may need configuration', { workspaceId });
      }
    }

    await updateDeploymentStatus(deployment.id, workspaceId, 'COMPLETED');

    await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        status: 'RUNNING',
        containerId: result.serviceId,
        containerName: serviceName,
        containerHost: result.domain,
        hostPort: null,
        gatewayToken: encrypt(generated.gatewayToken),
        healthStatus: 'HEALTHY',
        lastHealthCheck: new Date(),
      },
    });

    const channelsActive = hasChannels(workspace);
    await prisma.containerState.upsert({
      where: { workspaceId },
      update: {
        containerPhase: channelsActive ? 'WARM' : 'RUNNING',
        lastActiveAt: new Date(),
        hibernatedAt: null,
        wakeRequestedAt: null,
        hasActiveChannels: channelsActive,
        nextHeartbeatAt: calculateNextHeartbeat(generated['cron/jobs.json']),
        heartbeatCronExpressions: generated['cron/jobs.json'] !== '[]' ? generated['cron/jobs.json'] : null,
      },
      create: {
        workspaceId,
        containerPhase: channelsActive ? 'WARM' : 'RUNNING',
        lastActiveAt: new Date(),
        hasActiveChannels: channelsActive,
        nextHeartbeatAt: calculateNextHeartbeat(generated['cron/jobs.json']),
        heartbeatCronExpressions: generated['cron/jobs.json'] !== '[]' ? generated['cron/jobs.json'] : null,
      },
    });

    return {
      deploymentId: deployment.id,
      containerId: result.serviceId,
      gatewayToken: generated.gatewayToken,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown deployment error';
    await updateDeploymentStatus(deployment.id, workspaceId, 'FAILED', message);
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

  if (isRailwayConfigured() && workspace.containerId) {
    try {
      await deleteService(workspace.containerId);
    } catch {
      log.warn('Failed to delete Railway service — may already be removed', { workspaceId });
    }
  }

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      status: 'PAUSED',
      containerId: null,
      containerName: null,
      containerHost: null,
      hostPort: null,
      healthStatus: 'UNKNOWN',
    },
  });
}

export async function restartContainer(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
  });

  if (isRailwayConfigured() && workspace.containerId) {
    await redeployService(workspace.containerId);
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        status: 'RUNNING',
        healthStatus: 'HEALTHY',
        lastHealthCheck: new Date(),
      },
    });
    return;
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

export async function redeployWorkspace(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
  });

  if (isRailwayConfigured() && workspace.containerId && workspace.status === 'RUNNING') {
    const redeployUser = await prisma.user.findUniqueOrThrow({
      where: { id: workspace.userId },
    });
    const generated = await generateWorkspace(workspaceId);
    const redeploySource = getApiKeySource(workspace, redeployUser);
    const envVars = buildRailwayEnvVars(generated, workspace, {
      creditMode: redeploySource === 'PLATFORM_CREDIT',
      workspaceId,
      userId: workspace.userId,
    });
    await updateServiceVariables(workspace.containerId, envVars);
    await redeployService(workspace.containerId);
    return;
  }

  await deployToCloud(workspaceId);
}

export async function destroyDeployment(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
  });

  if (isRailwayConfigured() && workspace.containerId) {
    try {
      await deleteService(workspace.containerId);
    } catch {
      log.warn('Failed to delete Railway service during destroy', { workspaceId });
    }
  }

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      status: 'DRAFT',
      containerId: null,
      containerName: null,
      containerHost: null,
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
  if (!isRailwayConfigured()) return;

  const runningWorkspaces = await prisma.workspace.findMany({
    where: { status: 'RUNNING', containerId: { not: null } },
    select: { id: true, containerId: true, containerHost: true, userId: true },
  });

  for (const ws of runningWorkspaces) {
    if (!ws.containerId) continue;

    try {
      const status = await getServiceStatus(ws.containerId);
      if (!status.healthy) {
        await markUnhealthy(ws.id, ws.userId, `Railway deployment status: ${status.status}`);
        continue;
      }

      if (ws.containerHost) {
        try {
          const res = await fetchWithTimeout(`https://${ws.containerHost}/healthz`, 5000);
          if (!res.ok) {
            await markUnhealthy(ws.id, ws.userId, 'Gateway /healthz check failed');
            continue;
          }
        } catch {
          log.warn('Direct health check failed, but Railway reports healthy', { workspaceId: ws.id });
        }
      }

      await prisma.workspace.update({
        where: { id: ws.id },
        data: { healthStatus: 'HEALTHY', lastHealthCheck: new Date() },
      });
    } catch {
      await markUnhealthy(ws.id, ws.userId, 'Railway service unreachable');
    }
  }
}

async function markUnhealthy(workspaceId: string, userId: string, reason: string): Promise<void> {
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { healthStatus: 'UNHEALTHY' },
  });
  log.warn(`Workspace ${workspaceId} unhealthy: ${reason}`, { workspaceId });
}

// ---------------------------------------------------------------------------
// Gateway WebSocket Connection (for monitoring)
// ---------------------------------------------------------------------------

export async function getGatewayConnectionInfo(
  workspaceId: string,
): Promise<{ wsUrl: string; token: string } | null> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
  });

  if (!workspace.containerHost || !workspace.gatewayToken) return null;

  return {
    wsUrl: `wss://${workspace.containerHost}`,
    token: decrypt(workspace.gatewayToken),
  };
}

// ---------------------------------------------------------------------------
// Railway Env Var Builder
// ---------------------------------------------------------------------------

interface CreditConfig {
  creditMode: boolean;
  workspaceId: string;
  userId: string;
}

function buildRailwayEnvVars(
  generated: GeneratedWorkspace,
  workspace: { timezone?: string | null; containerHost?: string | null },
  creditConfig?: CreditConfig,
): Record<string, string> {
  const configJson = generated['openclaw.json'];
  const envFileContent = generated['.env'];
  const workspaceFiles = buildWorkspaceFileMap(generated);

  const vars: Record<string, string> = {
    CLAWS_BOOT_B64: BOOT_SCRIPT_B64,
    CLAWS_CONFIG_B64: Buffer.from(configJson).toString('base64'),
    CLAWS_ENV_B64: Buffer.from(envFileContent).toString('base64'),
    CLAWS_FILES_B64: Buffer.from(JSON.stringify(workspaceFiles)).toString('base64'),
    OPENCLAW_GATEWAY_TOKEN: generated.gatewayToken,
    TZ: workspace.timezone ?? 'UTC',
    NODE_ENV: 'production',
    PORT: '18789',
  };

  if (workspace.containerHost) {
    vars.CLAWS_PUBLIC_URL = `https://${workspace.containerHost}`;
  }

  if (creditConfig?.creditMode) {
    vars.CLAWS_CREDIT_MODE = 'true';
    vars.CLAWS_WORKSPACE_ID = creditConfig.workspaceId;
    vars.CLAWS_USER_ID = creditConfig.userId;
    vars.CLAWS_METERING_ENDPOINT = process.env.METERING_ENDPOINT || 'https://app.buildclaws.ai/api/internal/metering';
    vars.CLAWS_METERING_SECRET = process.env.METERING_MASTER_SECRET || '';
    vars.ANTHROPIC_API_KEY = process.env.CLAWS_MASTER_ANTHROPIC_KEY || '';
    vars.ANTHROPIC_BASE_URL = 'http://localhost:3789';
    vars.NODE_OPTIONS = '--max-old-space-size=700';
  } else {
    vars.CLAWS_CREDIT_MODE = 'false';
    vars.NODE_OPTIONS = '--max-old-space-size=768';
  }

  return vars;
}

function buildWorkspaceFileMap(generated: GeneratedWorkspace): Record<string, string> {
  const files: Record<string, string> = {};

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
// Simulation Mode (dev/staging without Railway credentials)
// ---------------------------------------------------------------------------

async function simulateDeploy(
  workspaceId: string,
  deploymentId: string,
  workspace: { channelConfigEncrypted?: string | null; timezone?: string | null },
): Promise<{ deploymentId: string; containerId: string; gatewayToken: string }> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Deploy simulation is disabled in production. Configure RAILWAY_API_TOKEN, RAILWAY_PROJECT_ID, and RAILWAY_ENVIRONMENT_ID.');
  }

  const fakeContainerId = `sim-${workspaceId.substring(0, 8)}`;

  await updateDeploymentStatus(deploymentId, workspaceId, 'GENERATING');
  await sleep(500);
  await updateDeploymentStatus(deploymentId, workspaceId, 'PROVISIONING');
  await sleep(300);
  await updateDeploymentStatus(deploymentId, workspaceId, 'STARTING');
  await sleep(500);
  await updateDeploymentStatus(deploymentId, workspaceId, 'HEALTH_CHECK');
  await sleep(300);

  if (workspace.channelConfigEncrypted) {
    await updateDeploymentStatus(deploymentId, workspaceId, 'WAITING_CHANNELS');
    await sleep(200);
  }

  await updateDeploymentStatus(deploymentId, workspaceId, 'COMPLETED');

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      status: 'RUNNING',
      containerId: fakeContainerId,
      containerName: `${CONTAINER_PREFIX}-${workspaceId}`,
      containerHost: null,
      hostPort: null,
      gatewayToken: null,
      healthStatus: 'HEALTHY',
      lastHealthCheck: new Date(),
    },
  });

  return { deploymentId, containerId: fakeContainerId, gatewayToken: 'simulation-token' };
}

// ---------------------------------------------------------------------------
// Container State Helpers
// ---------------------------------------------------------------------------

function hasChannels(workspace: { channelConfigEncrypted?: string | null }): boolean {
  if (!workspace.channelConfigEncrypted) return false;
  try {
    const config = JSON.parse(decrypt(workspace.channelConfigEncrypted));
    return !!(
      config.telegram?.botToken ||
      config.discord?.botToken ||
      config.slack?.botToken ||
      config.whatsapp?.phoneNumberId ||
      config.msteams?.webhookUrl
    );
  } catch {
    return false;
  }
}

function calculateNextHeartbeat(cronJobsJson: string | null | undefined): Date | null {
  if (!cronJobsJson || cronJobsJson === '[]') return null;
  try {
    const jobs = JSON.parse(cronJobsJson);
    if (!Array.isArray(jobs) || jobs.length === 0) return null;
    let earliest: Date | null = null;
    for (const job of jobs) {
      const schedule = job.schedule || job.cron;
      if (!schedule) continue;
      try {
        const next = CronExpressionParser.parse(schedule).next().toDate();
        if (!earliest || next < earliest) earliest = next;
      } catch {
        // Invalid cron expression — skip
      }
    }
    return earliest;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForDeploymentSuccess(serviceId: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < DEPLOY_TIMEOUT_MS) {
    const status = await getServiceStatus(serviceId);
    if (status.status === 'SUCCESS') return;
    if (status.status === 'FAILED' || status.status === 'CRASHED') {
      throw new Error(`Railway deployment ${status.status}`);
    }
    await sleep(DEPLOY_POLL_INTERVAL_MS);
  }
  throw new Error(`Railway deployment did not succeed within ${DEPLOY_TIMEOUT_MS / 1000}s`);
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
    await sleep(2000);
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

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
//   - openclaw.json → gzip → base64 → CLAWS_CONFIG_GZ_B64 env var
//   - .env content → gzip → base64 → CLAWS_ENV_GZ_B64 env var
//   - Workspace files (SOUL.md etc.) → JSON → gzip → base64 → CLAWS_FILES_GZ_B64
//   - Railway start command decodes these to /home/node/.openclaw/ on boot
// ============================================================================

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { prisma } from '@/lib/db';
import { encrypt, decrypt, decryptAndMaybeReencrypt } from '@/lib/encryption';
import {
  requireActivityEndpoint,
  requireMeteringEndpoint,
  assertEndpointHostMatchesApp,
} from './env-guards';
import { generateWorkspace, type GeneratedWorkspace } from './generator';
import { buildWorkspaceConfigFingerprint, type WorkspaceConfigFingerprint } from './config-fingerprint';
import {
  isRailwayConfigured,
  createService,
  deleteService,
  redeployService,
  updateAndRedeployService,
  findServiceByName,
  getServiceStatus,
  getRailwayTargetProvenance,
  BOOT_SCRIPT_B64,
} from './railway-client';
import { log } from '@/lib/logger';
import { publishDeployEvent, clearDeployEvents } from '@/lib/deploy-events';
import { deriveContainerEnv, type DeriveWorkspaceInput, type DeriveUserInput } from './derive-container-env';
import {
  hasConfiguredChannels,
  parseChannelConfigBlob,
} from './channel-config';
import { getComposioUserId } from '@/lib/composio';
import { probeMcpEndpoint } from './mcp-longtail';
import { CronExpressionParser } from 'cron-parser';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONTAINER_PREFIX = 'claw';

const DEPLOY_POLL_INTERVAL_MS = 3_000;
const DEPLOY_TIMEOUT_MS = 180_000;
const UPDATE_REDEPLOY_TIMEOUT_MS = 120_000;
const CONTAINER_PAYLOAD_SAFETY_CEILING = 30_000;

// PR-2 (syncThenDestroy): default upper bound for the pre-destroy
// /internal/sync-now call. Tuned for the single-workspace Stop path
// (route maxDuration=60). The hibernation cron passes a tighter value
// (HIBERNATE_SYNC_TIMEOUT_MS) because it loops under a 55s ceiling — see
// src/app/api/cron/hibernation/route.ts.
const DEFAULT_SYNC_TIMEOUT_MS = 18_000;

function isMissingRailwayServiceError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /(?:service|deployment).*not\s+found|not\s+found.*(?:service|deployment)|404/i.test(message);
}

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

type DeploymentCompletionData = {
  configHash: string;
  configSnapshot: string;
  configSnapshotGzip: Uint8Array<ArrayBuffer>;
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function buildEnvManifest(envFile: string): Record<string, string> {
  const manifest: Record<string, string> = {};
  for (const rawLine of envFile.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq);
    const value = line.slice(eq + 1);
    manifest[key] = sha256(value);
  }
  return manifest;
}

async function updateDeploymentStatus(
  deploymentId: string,
  workspaceId: string,
  status: DeploymentStatus,
  error?: string,
  completionData?: DeploymentCompletionData,
): Promise<void> {
  await prisma.deployment.update({
    where: { id: deploymentId },
    data: {
      status,
      ...(error && { errorMessage: error }),
      ...(status === 'COMPLETED' && { completedAt: new Date() }),
      ...(status === 'COMPLETED' && completionData ? completionData : {}),
    },
  });
  publishDeployEvent(workspaceId, deploymentId, status, error).catch(() => {});
}

function buildDeploymentCompletionData(
  fingerprint: WorkspaceConfigFingerprint,
  generated: GeneratedWorkspace,
): DeploymentCompletionData {
  const envManifest = buildEnvManifest(generated['.env']);
  const snapshotPayload = {
    version: 1,
    hash: fingerprint.hash,
    areas: fingerprint.areas,
    envManifest,
    'openclaw.json': JSON.parse(generated['openclaw.json']),
    'cron/jobs.json': JSON.parse(generated['cron/jobs.json']),
    workspaces: generated.workspaces,
  };

  const compressed = gzipSync(JSON.stringify(snapshotPayload));
  const configSnapshotGzip = new Uint8Array(compressed.byteLength);
  configSnapshotGzip.set(compressed);

  return {
    configHash: fingerprint.hash,
    configSnapshot: JSON.stringify({
      version: 1,
      hash: fingerprint.hash,
      generatedAt: new Date().toISOString(),
      areas: fingerprint.areas,
      envManifest,
    }),
    configSnapshotGzip,
  };
}

function withRailwayDeploymentId(
  completionData: DeploymentCompletionData,
  railwayDeploymentId: string | null,
): DeploymentCompletionData {
  const metadata = JSON.parse(completionData.configSnapshot) as Record<string, unknown>;
  metadata.railwayDeploymentId = railwayDeploymentId;
  return { ...completionData, configSnapshot: JSON.stringify(metadata) };
}

// ---------------------------------------------------------------------------
// Image Resolution
// ---------------------------------------------------------------------------

/**
 * Resolves the container image to use for a deploy at deploy time.
 *
 * Priority:
 *   1. Current `isStable` OpenClawVersion row (canonical — set by the
 *      promote-openclaw-image.yml workflow after manual QA). The row's
 *      `dockerImage` is an immutable `:<version>` reference per the
 *      register-route validator.
 *   2. `OPENCLAW_DOCKER_IMAGE` env var (Vercel-set; used as dev/bootstrap
 *      fallback before the first promote has happened).
 *   3. Hard-coded default at the railway-client level — last-resort safety
 *      net so a deploy never tries to pull an empty image string.
 *
 * Returning the string here (instead of mutating module state in
 * railway-client.ts) lets the caller also persist it on
 * `Deployment.containerImage`, which is what makes that column finally
 * reflect what's actually deployed.
 */
export async function resolveDeployImage(): Promise<string> {
  const stable = await prisma.openClawVersion.findFirst({
    where: { isStable: true },
    orderBy: { releasedAt: 'desc' },
    select: { dockerImage: true, version: true },
  });

  if (stable?.dockerImage) {
    return stable.dockerImage;
  }

  const envFallback = process.env.OPENCLAW_DOCKER_IMAGE?.trim();
  if (envFallback) {
    log.warn('resolveDeployImage: no isStable OpenClawVersion row; using OPENCLAW_DOCKER_IMAGE env fallback', {
      envFallback,
    });
    return envFallback;
  }

  const HARDCODED_FALLBACK = 'ghcr.io/laxcorp-research/openclaw-runtime:latest';
  log.warn('resolveDeployImage: no isStable row and OPENCLAW_DOCKER_IMAGE unset; using hardcoded default', {
    fallback: HARDCODED_FALLBACK,
  });
  return HARDCODED_FALLBACK;
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
    include: { apiKeys: true },
  });

  // PR-1: resolve once and persist on the Deployment row so the column
  // finally matches what Railway actually pulls. Previously the
  // `Deployment.containerImage` schema default ('ghcr.io/openclaw/openclaw:latest')
  // was never overwritten — every Deployment row carried that string
  // regardless of the real image used, which broke the admin
  // versions deployment-count query and the force-update WHERE clause.
  const image = await resolveDeployImage();
  const railwayTarget = getRailwayTargetProvenance();

  const deployment = await prisma.deployment.create({
    data: {
      workspaceId,
      status: 'PENDING',
      version: await getNextDeploymentVersion(workspaceId),
      containerImage: image,
      railwayProjectId: railwayTarget.railwayProjectId,
      railwayEnvironmentId: railwayTarget.railwayEnvironmentId,
      configSnapshot: JSON.stringify({
        workspaceId,
        image,
        createdAt: new Date().toISOString(),
      }),
    },
  });

  await clearDeployEvents(workspaceId).catch(() => {});

  try {
    await updateDeploymentStatus(deployment.id, workspaceId, 'GENERATING');
    const generated = await generateWorkspace(workspaceId);
    const fingerprint = await buildWorkspaceConfigFingerprint(workspaceId);
    const completionData = buildDeploymentCompletionData(fingerprint, generated);

    if (!isRailwayConfigured()) {
      log.warn('Railway not configured — running in simulation mode', { workspaceId });
      return simulateDeploy(workspaceId, deployment.id, workspace, completionData);
    }

    // Pre-populate ContainerState BEFORE any Railway call. The container's
    // first state sync (~30s after boot, per PR2) uses updateMany on this
    // row — if the row doesn't exist yet, the sync is silently dropped
    // (count=0 no-op). Creating the row first makes the write idempotent
    // and closes the race.
    //
    // Error path at the bottom of this try/catch uses updateMany with
    // containerPhase='STOPPED', which will now correctly find this row
    // and flip it on failure. No semantic drift.
    //
    // Known staleness windows (accepted, documented so future readers
    // don't re-derive from git archaeology):
    //   - hasChannels(workspace) reflects the workspace at deploy-start
    //     time, not deploy-completion. If the user toggles channels
    //     mid-deploy (~30-60s window for deployToCloud), the ContainerState
    //     row's hasActiveChannels may lag by one deploy cycle. Concurrent
    //     channel reconfiguration during an active deploy is rare enough
    //     to accept rather than add a second write after waitForDeploymentSuccess.
    //   - lastActiveAt is set at deploy-start (was previously post-success).
    //     The hibernation threshold is 10 min idle, well above the ~60s
    //     window, so no practical impact on hibernation decisions.
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
        // PR-2: a fresh container makes any prior teardown's incomplete-sync
        // marker moot — clear it so a stale flag never lingers across deploys.
        lastSyncIncompleteAt: null,
        lastSyncIncompleteReason: null,
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

    await updateDeploymentStatus(deployment.id, workspaceId, 'PROVISIONING');
    const serviceName = `${CONTAINER_PREFIX}-${workspaceId}`.substring(0, 32);
    const envVars = buildRailwayEnvVars(generated, workspace, user);

    await updateDeploymentStatus(deployment.id, workspaceId, 'CONFIGURING');

    await updateDeploymentStatus(deployment.id, workspaceId, 'STARTING');

    let result: { serviceId: string; domain: string };
    let previousDeploymentId: string | null = null;

    if (workspace.containerId) {
      try {
        log.info('Reusing existing Railway service', { serviceId: workspace.containerId, workspaceId, image });
        const beforeStatus = await getServiceStatus(workspace.containerId);
        previousDeploymentId = beforeStatus.deploymentId;
        result = await updateAndRedeployService(workspace.containerId, envVars, image);
        if (!result.domain && workspace.containerHost) {
          result.domain = workspace.containerHost;
        }
      } catch (redeployErr) {
        log.warn('Failed to update existing service, deleting and creating fresh', {
          workspaceId,
          oldServiceId: workspace.containerId,
          error: redeployErr instanceof Error ? redeployErr.message : String(redeployErr),
        });
        if (!isMissingRailwayServiceError(redeployErr)) {
          throw redeployErr;
        }

        const existingId = await findServiceByName(serviceName);
        if (existingId) {
          log.warn('Stored Railway service id is stale; adopting service found by name', {
            workspaceId,
            staleServiceId: workspace.containerId,
            foundServiceId: existingId,
          });
          const beforeStatus = await getServiceStatus(existingId);
          previousDeploymentId = beforeStatus.deploymentId;
          result = await updateAndRedeployService(existingId, envVars, image);
        } else {
          await prisma.workspace.update({
            where: { id: workspaceId },
            data: { containerId: null, containerName: null, containerHost: null },
          });
          result = await createService({ name: serviceName, envVars, image });
        }
      }
    } else {
      try {
        result = await createService({ name: serviceName, envVars, image });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('already exists')) {
          log.warn('Service already exists, looking it up by name', { serviceName, workspaceId });
          const existingId = await findServiceByName(serviceName);
          if (!existingId) throw new Error(`Service "${serviceName}" exists but could not be found`);
          const beforeStatus = await getServiceStatus(existingId);
          previousDeploymentId = beforeStatus.deploymentId;
          result = await updateAndRedeployService(existingId, envVars, image);
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
    const railwayDeploymentId = await waitForDeploymentSuccess(
      result.serviceId,
      previousDeploymentId,
      previousDeploymentId ? UPDATE_REDEPLOY_TIMEOUT_MS : DEPLOY_TIMEOUT_MS,
    );
    const completedData = withRailwayDeploymentId(completionData, railwayDeploymentId);

    if (workspace.channelConfigEncrypted) {
      await updateDeploymentStatus(deployment.id, workspaceId, 'WAITING_CHANNELS');
      try {
        await waitForEndpoint(`https://${result.domain}/readyz`, 60_000);
      } catch {
        log.warn('Readiness check timed out — channels may need configuration', { workspaceId });
      }
    }

    // C-engine B1: cold-boot MCP surfacing. The container's own MCP-connect
    // failure is SILENT (one gateway log line, and only on first agent run
    // — the runtime connects lazily), so for MCP-enabled deploys we probe
    // the Tool Router endpoint directly from here and surface a failure as
    // an ActivityLog ERROR row. Best-effort and non-blocking by contract:
    // NEVER fails or delays the deploy.
    await surfaceMcpBootFailure(workspaceId, generated).catch(() => {});

    await updateDeploymentStatus(deployment.id, workspaceId, 'COMPLETED', undefined, completedData);

    await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        status: 'RUNNING',
        containerId: result.serviceId,
        containerName: serviceName,
        containerHost: result.domain,
        hostPort: null,
        ...(workspace.gatewayToken ? {} : { gatewayToken: encrypt(generated.gatewayToken) }),
        healthStatus: 'HEALTHY',
        lastHealthCheck: new Date(),
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
    // Atomically converge Workspace + ContainerState rows on deploy failure.
    // ContainerState.containerPhase='STOPPED' is correct here: the ContainerPhase
    // enum has no ERROR value, and on a failed deploy the container (if any)
    // is non-functional and needs a rebuild — which is what STOPPED semantically
    // means under the post-PR-#52 vocabulary. updateMany avoids throwing when
    // a first-time deploy failure happens before ContainerState is created.
    await prisma.$transaction([
      prisma.workspace.update({
        where: { id: workspaceId },
        data: { status: 'ERROR' },
      }),
      prisma.containerState.updateMany({
        where: { workspaceId },
        data: { containerPhase: 'STOPPED' },
      }),
    ]);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Container Operations
// ---------------------------------------------------------------------------

/**
 * FAST, NON-THROWING teardown: deletes the Railway service (best-effort,
 * swallows errors) and converges the Workspace + ContainerState rows to a
 * STOPPED state. It does NOT flush the container's runtime state first — the
 * only pre-destroy persistence on this path is the container's own best-effort
 * SIGTERM sync (process-manager.mjs), which Railway may cut short with SIGKILL.
 *
 * Use this directly ONLY where speed / not-throwing matters more than a
 * guaranteed-fresh snapshot: the Dodo webhook (must stay fast to avoid retry
 * storms) and credit exhaustion. For any user-/admin-initiated stop of a
 * RUNNING container whose history must be preserved (Stop button, hibernate,
 * and the future force-update restart step), call syncThenDestroy instead — it
 * confirms the snapshot before calling this.
 */
export async function destroyContainer(workspaceId: string): Promise<void> {
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

  // Atomically update Workspace row AND ContainerState row. Previous bug:
  // only Workspace.status was updated, leaving ContainerState.containerPhase
  // stale (still 'RUNNING' / 'WARM' / whatever it was before). The hibernation
  // cron and health-check cron already filtered on Workspace.containerId
  // being non-null so they skipped these drifted rows, but the divergence
  // was real and cost us a live Railway service in one incident
  // (service 00000000-0000-4000-8000-000000000001, cleaned up manually
  // on 2026-04-27 — companion to this fix).
  //
  // updateMany is used (not update) so we don't throw if a workspace has
  // never had a container and therefore has no ContainerState row. The
  // Railway deleteService call stays OUTSIDE the transaction — we never
  // want to hold a DB transaction open across a network call.
  await prisma.$transaction([
    prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        status: 'STOPPED',
        containerId: null,
        containerName: null,
        containerHost: null,
        hostPort: null,
        healthStatus: 'UNKNOWN',
      },
    }),
    prisma.containerState.updateMany({
      where: { workspaceId },
      data: { containerPhase: 'STOPPED' },
    }),
  ]);
}

export interface SyncThenDestroyOptions {
  /** Upper bound for the /internal/sync-now call. Default DEFAULT_SYNC_TIMEOUT_MS (~18s). */
  syncTimeoutMs?: number;
  /**
   * Budget-guard / explicit bare path: skip the sync entirely and go straight
   * to destroyContainer. The hibernation cron sets this when it is low on its
   * 55s ceiling so an in-flight sync can't be killed mid-write.
   */
  skipSync?: boolean;
}

type SyncNowOutcome = { synced: true } | { synced: false; reason: string };

/**
 * POSTs the pre-destroy confirmed-sync request to the container's
 * /internal/sync-now route (the claws-activity-reporter overlay plugin).
 *
 * Returns synced:true ONLY on an HTTP 200 whose body confirms a persist
 * (persisted:true) or a genuinely empty data dir (empty:true) — the exact
 * contract enforced by container/claws-activity-reporter/index.mjs and locked
 * by src/__tests__/claws-sync-now-route.test.ts. Any non-200, unparseable
 * body, timeout, or network error → synced:false with a short reason for the
 * incomplete-sync marker. NEVER throws.
 */
async function trySyncNow(containerHost: string, timeoutMs: number): Promise<SyncNowOutcome> {
  // The backend sends the value of METERING_MASTER_SECRET (the same value it
  // injects into the container as CLAWS_METERING_SECRET — see
  // buildRailwayEnvVars). Do NOT read CLAWS_METERING_SECRET here: that name
  // exists only inside the container, never on the backend.
  const secret = process.env.METERING_MASTER_SECRET;
  if (!secret) {
    return { synced: false, reason: 'unconfigured' };
  }

  const url = `https://${containerHost}/internal/sync-now`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'X-Metering-Secret': secret },
    });
  } catch (err) {
    const isTimeout = controller.signal.aborted || (err instanceof Error && err.name === 'AbortError');
    return { synced: false, reason: isTimeout ? 'timeout' : 'unreachable' };
  } finally {
    clearTimeout(timer);
  }

  if (res.status !== 200) {
    // 502 carries {status:'rejected'}; 503 carries {status:'error'|
    // 'accepted-unconfirmed'|'unconfigured'}. Prefer the server's own
    // discriminant for the marker; fall back to the bare HTTP code (e.g. 401).
    let serverStatus: string | undefined;
    try {
      const body = (await res.json()) as { status?: unknown };
      if (typeof body?.status === 'string') serverStatus = body.status;
    } catch {
      /* non-JSON or empty body */
    }
    return { synced: false, reason: serverStatus ?? `http-${res.status}` };
  }

  let body: { persisted?: unknown; empty?: unknown };
  try {
    body = (await res.json()) as { persisted?: unknown; empty?: unknown };
  } catch {
    return { synced: false, reason: 'unparseable' };
  }

  if (body.persisted === true || body.empty === true) {
    return { synced: true };
  }
  return { synced: false, reason: 'unconfirmed' };
}

/**
 * Confirmed-sync teardown: flushes + persists the container's runtime state via
 * POST /internal/sync-now BEFORE destroying it, so "your history is saved" is a
 * guarantee rather than best-effort. ALWAYS destroys — on any sync failure
 * (non-200, timeout, unreachable container, or the SYNC_BEFORE_DESTROY
 * kill-switch being off) it records an incomplete-sync marker on ContainerState
 * and proceeds to destroyContainer anyway. It NEVER traps the container.
 *
 * Gated by SYNC_BEFORE_DESTROY (default ON; set to "false" for an instant
 * rollback to bare destroyContainer behaviour), following the
 * HIBERNATION_ENABLED convention.
 *
 * Callers: the Stop route (default ~18s budget) and hibernate (10s + a
 * cron-loop budget guard via skipSync). Bare destroyContainer stays on the
 * fast/non-throwing paths (Dodo webhook, credit exhaustion).
 */
export async function syncThenDestroy(
  workspaceId: string,
  opts: SyncThenDestroyOptions = {},
): Promise<void> {
  const { syncTimeoutMs = DEFAULT_SYNC_TIMEOUT_MS, skipSync = false } = opts;

  // Kill-switch (default ON). Off → behave exactly like bare destroyContainer.
  const enabled = process.env.SYNC_BEFORE_DESTROY !== 'false';
  if (!enabled || skipSync) {
    await destroyContainer(workspaceId);
    return;
  }

  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    include: { containerState: { select: { runtimeStateUpdatedAt: true } } },
  });

  // Nothing to sync to: already torn down, never deployed, or simulation mode
  // (no containerHost). Skip the network call and just destroy — idempotent.
  if (!workspace.containerId || !workspace.containerHost) {
    await destroyContainer(workspaceId);
    return;
  }

  const outcome = await trySyncNow(workspace.containerHost, syncTimeoutMs);

  if (outcome.synced) {
    // Confirmed persist (or vacuously empty): clear any prior incomplete marker.
    // updateMany (not update) so a missing ContainerState row is a no-op, never a throw.
    await prisma.containerState.updateMany({
      where: { workspaceId },
      data: { lastSyncIncompleteAt: null, lastSyncIncompleteReason: null },
    });
    log.info('syncThenDestroy: pre-destroy sync confirmed', { workspaceId });
  } else {
    // Destroy anyway, but record that this teardown's snapshot may be stale.
    await prisma.containerState.updateMany({
      where: { workspaceId },
      data: { lastSyncIncompleteAt: new Date(), lastSyncIncompleteReason: outcome.reason },
    });
    log.warn('syncThenDestroy: pre-destroy sync NOT confirmed — destroying anyway', {
      workspaceId,
      reason: outcome.reason,
      lastRuntimeStateUpdatedAt: workspace.containerState?.runtimeStateUpdatedAt ?? null,
    });
  }

  await destroyContainer(workspaceId);
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

export async function redeployWorkspace(workspaceId: string): Promise<{ deploymentId: string; containerId: string | null }> {
  const result = await deployToCloud(workspaceId);
  return { deploymentId: result.deploymentId, containerId: result.containerId };
}

// ---------------------------------------------------------------------------
// Health Monitoring — moved to src/app/api/cron/health-monitor/route.ts
// ---------------------------------------------------------------------------
// PR-3 deleted the previous `healthCheckAllContainers` + `markUnhealthy`
// pair that lived here. They had ZERO callers (verified via repo grep)
// and were silently dead since landed. The replacement is the Vercel
// cron at /api/cron/health-monitor which:
//   - polls admin-http-rpc on the container directly (not just /healthz)
//   - debounces failures (UNHEALTHY at 2, ERROR at 5)
//   - logs every transition per workspace
// Do NOT reintroduce a health check here — that would race the cron.

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

  // Re-encrypt-on-read: if the token only decrypts under the PREVIOUS master key
  // (mid key-rotation), transparently migrate it to the current key. The write
  // is best-effort — a failure must NOT break the read, so we always return the
  // decrypted token regardless.
  const token = await decryptAndMaybeReencrypt(workspace.gatewayToken, async (newBlob) => {
    try {
      await prisma.workspace.update({ where: { id: workspaceId }, data: { gatewayToken: newBlob } });
      log.info('gatewayToken migrated to current encryption key', { workspaceId });
    } catch (e) {
      log.warn('gatewayToken re-encrypt write failed (continuing with decrypted token)', {
        workspaceId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  return {
    wsUrl: `wss://${workspace.containerHost}`,
    token,
  };
}

// ---------------------------------------------------------------------------
// C-engine B1: cold-boot MCP surfacing (minimal detection; PR-R owns full
// handling). Extracts the emitted mcp.servers.composio block from the
// generated openclaw.json — its presence IS the "MCP-enabled deploy"
// signal — and probes the Tool Router endpoint (initialize + tools/list).
// On failure, writes one ActivityLog ERROR row so the outage is visible in
// the activity feed instead of only in a container log line nobody reads.
// ---------------------------------------------------------------------------

export async function surfaceMcpBootFailure(
  workspaceId: string,
  generated: Pick<GeneratedWorkspace, 'openclaw.json'>,
  probeImpl: typeof probeMcpEndpoint = probeMcpEndpoint,
): Promise<void> {
  let composioServer: { url?: unknown; headers?: unknown } | undefined;
  try {
    const config = JSON.parse(generated['openclaw.json']) as {
      mcp?: { servers?: { composio?: { url?: unknown; headers?: unknown } } };
    };
    composioServer = config.mcp?.servers?.composio;
  } catch {
    return;
  }
  if (!composioServer || typeof composioServer.url !== 'string') return;

  const headers =
    composioServer.headers && typeof composioServer.headers === 'object'
      ? (composioServer.headers as Record<string, string>)
      : {};

  const result = await probeImpl({ url: composioServer.url, headers });
  if (result.ok) {
    // B1's resolveToolRouterSession runs during generateWorkspace and already
    // recreates dead stored sessions before this probe. A successful deploy is
    // therefore the recovery path: the regenerated openclaw.json is baked into
    // Railway env, and this metadata tells the dashboard the MCP session is
    // healthy again.
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        mcpSessionHealthStatus: 'HEALTHY',
        mcpSessionCheckedAt: new Date(),
        mcpSessionLastError: null,
      },
    });
    return;
  }

  log.warn('MCP long-tail boot probe failed', { workspaceId, detail: result.detail });
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      mcpSessionHealthStatus: 'DEAD',
      mcpSessionCheckedAt: new Date(),
      mcpSessionLastError: result.detail,
    },
  });
  await prisma.activityLog.create({
    data: {
      workspaceId,
      action: 'Long-tail tool connection failed at boot',
      actionType: 'ERROR',
      detail: result.detail,
    },
  });
}

// ---------------------------------------------------------------------------
// Railway Env Var Builder
// ---------------------------------------------------------------------------

function gzipBase64(content: string): string {
  return gzipSync(Buffer.from(content, 'utf8')).toString('base64');
}

function assertContainerPayloadEnvVarSizes(vars: Record<string, string>): void {
  for (const [name, value] of Object.entries(vars)) {
    if (value.length > CONTAINER_PAYLOAD_SAFETY_CEILING) {
      throw new Error(
        `Container payload ${name} is ${value.length} chars — exceeds the 30,000 safety ceiling (Railway hard limit 32,768). Workspace too large to deploy.`,
      );
    }
  }
}

export function buildRailwayEnvVars(
  generated: GeneratedWorkspace,
  // PR-8a: workspace + user are passed explicitly so credit mode AND the
  // credential vars are derived from the SINGLE source of truth
  // (deriveContainerEnv) shared with the reconciliation cron and the
  // container-secrets path — not from a precomputed creditMode boolean.
  // The runtime throw in the Composio section remains as defense-in-depth.
  workspace: DeriveWorkspaceInput & {
    id: string;
    userId: string;
    timezone?: string | null;
    containerHost?: string | null;
  },
  user: DeriveUserInput,
): Record<string, string> {
  const configJson = generated['openclaw.json'];
  const envFileContent = generated['.env'];
  const workspaceFiles = buildWorkspaceFileMap(generated);

  const vars: Record<string, string> = {
    CLAWS_BOOT_B64: BOOT_SCRIPT_B64,
    CLAWS_CONFIG_GZ_B64: gzipBase64(configJson),
    CLAWS_ENV_GZ_B64: gzipBase64(envFileContent),
    CLAWS_FILES_GZ_B64: gzipBase64(JSON.stringify(workspaceFiles)),
    OPENCLAW_GATEWAY_TOKEN: generated.gatewayToken,
    TZ: workspace.timezone ?? 'UTC',
    NODE_ENV: 'production',
    PORT: '18789',
  };

  if (workspace.containerHost) {
    vars.CLAWS_PUBLIC_URL = `https://${workspace.containerHost}`;
  }

  // PR2: ungated for universal state preservation. These 3 vars were
  // credit-mode-gated until 2026-04-28. State sync (periodic + SIGTERM)
  // inside process-manager.mjs reads all three; without them, sync short-
  // circuits silently. By emitting them for every container we make every
  // deploy's state preservable regardless of apiKeySource. The remaining
  // credit-mode block below keeps credit-proxy-specific vars gated because
  // those genuinely require the proxy process (CLAWS_USER_ID, ANTHROPIC_*,
  // NODE_OPTIONS memory cap). creditConfig is now a required parameter,
  // so these three emit unconditionally — no silent-no-op failure mode.
  vars.CLAWS_WORKSPACE_ID = workspace.id;
  // PR-2b #1 + #2: fail-closed on unset/mismatched endpoint env. See
  // src/lib/openclaw/env-guards.ts for the full root-cause writeup.
  const meteringEndpoint = requireMeteringEndpoint();
  assertEndpointHostMatchesApp({ endpointUrl: meteringEndpoint, endpointName: 'METERING_ENDPOINT' });
  vars.CLAWS_METERING_ENDPOINT = meteringEndpoint;
  vars.CLAWS_METERING_SECRET = process.env.METERING_MASTER_SECRET || '';

  // PR-2: Activity Wire — universal, mirrors the metering triplet above.
  // The claws-activity-reporter plugin (overlay at /opt/claws-activity-reporter)
  // reads both, then POSTs batched events to
  //   ${CLAWS_ACTIVITY_ENDPOINT}/${CLAWS_WORKSPACE_ID}
  // with header X-Activity-Secret: ${CLAWS_ACTIVITY_SECRET}.
  // The matching env var in Vercel is ACTIVITY_PIPELINE_SECRET (and
  // ACTIVITY_ENDPOINT for the URL — REQUIRED, no fallback).
  const activityEndpoint = requireActivityEndpoint();
  assertEndpointHostMatchesApp({ endpointUrl: activityEndpoint, endpointName: 'ACTIVITY_ENDPOINT' });
  vars.CLAWS_ACTIVITY_ENDPOINT = activityEndpoint;
  vars.CLAWS_ACTIVITY_SECRET = process.env.ACTIVITY_PIPELINE_SECRET || '';

  // PR-8a: credit mode + the credential vars come from deriveContainerEnv —
  // the single source of truth shared with the reconciliation cron and the
  // container-secrets path. Non-credit deploys still emit NO ANTHROPIC_API_KEY
  // here: the user's BYOK key is baked into CLAWS_ENV_GZ_B64 by the generator,
  // not a Railway var (behavior preserved). CLAWS_USER_ID is pinned to
  // workspace.userId in credit mode (was creditConfig.userId).
  const credential = deriveContainerEnv(workspace, user);
  if (credential.CLAWS_CREDIT_MODE) {
    vars.CLAWS_CREDIT_MODE = 'true';
    vars.CLAWS_USER_ID = workspace.userId;
    vars.ANTHROPIC_API_KEY = credential.ANTHROPIC_API_KEY ?? '';
    if (credential.ANTHROPIC_BASE_URL) vars.ANTHROPIC_BASE_URL = credential.ANTHROPIC_BASE_URL;
    vars.NODE_OPTIONS = '--max-old-space-size=700';
  } else {
    vars.CLAWS_CREDIT_MODE = 'false';
  }

  // ---------------------------------------------------------------------
  // Composio coordinates (PR #4 Commit 2)
  //
  // COMPOSIO_API_KEY is a PLATFORM-SCOPED secret: the container holding it
  // can call Composio's tools.execute on behalf of ANY user that the
  // caller can name via `user_id` + `connected_account_id`. The ONLY thing
  // that scopes execution to this workspace's user is COMPOSIO_USER_ID.
  //
  // Emission policy (defense-in-depth, two independent sources of
  // COMPOSIO_USER_ID inside the container):
  //   1. Per-skill: generator emits skills.entries[slug].env.COMPOSIO_USER_ID
  //      — OpenClaw merges that into process.env when the skill runs.
  //   2. Container-level (this function): COMPOSIO_USER_ID is pinned at
  //      deploy time so any runtime code path reading process.env before
  //      the per-skill merge (or any accidental ad-hoc Composio call)
  //      reads the correct user id — NOT undefined, NOT another user's.
  //
  // Both landings are required. Without (2), a bug in the container (e.g.,
  // a skill that shells out to a helper that doesn't receive per-skill
  // env, or a runtime hook that loads before skill env injection) could
  // use the platform API key with a spoofed user_id. This function fails
  // closed: if COMPOSIO_API_KEY is present but we cannot pin a user id,
  // we refuse to emit the API key at all.
  //
  // See docs/COMPOSIO_RUNTIME_CONTRACT.md §"Emission shape" for the
  // canonical shape and docs/examples/composio-gmail.json for the
  // reference example.
  // ---------------------------------------------------------------------
  const composioApiKey = process.env.COMPOSIO_API_KEY?.trim();
  if (composioApiKey) {
    if (!workspace.userId) {
      // Fail-closed: refuse to deploy a platform API key into a container
      // that we cannot scope to a specific user. PR-8a: the user-id scope pin
      // now comes from workspace.userId (was creditConfig.userId). This throw
      // catches a future regression where a caller passes a workspace without
      // a userId. Error message is explicit so the fix is obvious.
      throw new Error(
        'buildRailwayEnvVars: COMPOSIO_API_KEY is set but workspace.userId is missing; refusing to emit platform API key without a user-id scope pin (security boundary — see docs/COMPOSIO_RUNTIME_CONTRACT.md §"Security considerations")',
      );
    }
    vars.COMPOSIO_API_KEY = composioApiKey;
    vars.COMPOSIO_USER_ID = getComposioUserId(workspace.userId);
  }

  assertContainerPayloadEnvVarSizes(vars);

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
  completionData: DeploymentCompletionData,
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

  await updateDeploymentStatus(deploymentId, workspaceId, 'COMPLETED', undefined, completionData);

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
    return hasConfiguredChannels(parseChannelConfigBlob(workspace.channelConfigEncrypted, decrypt));
  } catch {
    return false;
  }
}

export function calculateNextHeartbeat(cronJobsJson: string | null | undefined): Date | null {
  if (!cronJobsJson || cronJobsJson === '[]') return null;
  try {
    const jobs = JSON.parse(cronJobsJson);
    if (!Array.isArray(jobs) || jobs.length === 0) return null;
    let earliest: Date | null = null;
    for (const job of jobs) {
      const cronExpr = extractCronExpression(job);
      if (!cronExpr) continue;
      try {
        const tz = extractCronTimezone(job);
        const next = CronExpressionParser.parse(cronExpr, tz ? { tz } : {}).next().toDate();
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

/**
 * Pulls the cron expression string out of a job entry. Handles the
 * verified OpenClaw shape `{ schedule: { kind: 'cron', expr } }` plus a
 * couple of legacy/string fallbacks defensively. Non-cron schedule kinds
 * (`every`, `at`) intentionally return null because they aren't cron-parseable.
 */
export function extractCronExpression(job: unknown): string | null {
  if (!job || typeof job !== 'object') return null;
  const obj = job as { schedule?: unknown; cron?: unknown };
  if (obj.schedule && typeof obj.schedule === 'object') {
    const sched = obj.schedule as { kind?: unknown; expr?: unknown };
    if (sched.kind === 'cron' && typeof sched.expr === 'string' && sched.expr.length > 0) {
      return sched.expr;
    }
    return null;
  }
  if (typeof obj.schedule === 'string' && obj.schedule.length > 0) return obj.schedule;
  if (typeof obj.cron === 'string' && obj.cron.length > 0) return obj.cron;
  return null;
}

function extractCronTimezone(job: unknown): string | null {
  if (!job || typeof job !== 'object') return null;
  const obj = job as { schedule?: unknown };
  if (obj.schedule && typeof obj.schedule === 'object') {
    const sched = obj.schedule as { tz?: unknown };
    if (typeof sched.tz === 'string' && sched.tz.length > 0) return sched.tz;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForDeploymentSuccess(
  serviceId: string,
  previousDeploymentId: string | null,
  timeoutMs = DEPLOY_TIMEOUT_MS,
): Promise<string | null> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const status = await getServiceStatus(serviceId);

    // If we know the previous deployment ID, ignore it entirely.
    // Keep polling until Railway registers the NEW deployment.
    if (previousDeploymentId && status.deploymentId === previousDeploymentId) {
      await sleep(DEPLOY_POLL_INTERVAL_MS);
      continue;
    }

    if (status.status === 'SUCCESS') return status.deploymentId;
    if (status.status === 'FAILED' || status.status === 'CRASHED') {
      throw new Error(`Railway deployment ${status.status}`);
    }
    await sleep(DEPLOY_POLL_INTERVAL_MS);
  }
  throw new Error(`Railway deployment did not succeed within ${timeoutMs / 1000}s`);
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

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
//   - Birth stubs (shared/VOICE.md once, workspace-*/memory/MEMORY.md per agent) → JSON → gzip → base64 → CLAWS_SEED_FILES_GZ_B64
//     unpacked IF-ABSENT so agent/hibernation writes survive redeploy
//   - Railway start command decodes these to /home/node/.openclaw/ on boot
// ============================================================================

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { prisma } from '@/lib/db';
import { supersedePriorDeployments } from '@/lib/deploy/supersede-deployments';
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
  redeployService,
  updateAndRedeployService,
  findServiceByName,
  getServiceStatus,
  removeLatestDeployment,
  getRailwayTargetProvenance,
  BOOT_SCRIPT_B64,
} from './railway-client';
import { mayDeployCandidateImage } from './candidate-soak';
import {
  deriveRuntimeContract,
  isRuntimeContract,
  type RuntimeContract,
} from './runtime-contract';
import { log } from '@/lib/logger';
import { DEFAULT_SYNC_TIMEOUT_MS, trySyncNow } from './sync-now';
import { withTransientDeployRetry } from '@/lib/healing/guards';
import { publishDeployEvent, clearDeployEvents } from '@/lib/deploy-events';
import {
  assertNoPlaceholderEnvValues,
  deriveContainerEnv,
  type DeriveWorkspaceInput,
  type DeriveUserInput,
} from './derive-container-env';
import {
  hasConfiguredChannels,
  parseChannelConfigBlob,
} from './channel-config';
import { getComposioUserId } from '@/lib/composio';
import { probeMcpEndpoint } from './mcp-longtail';
import {
  calculateNextHeartbeat,
  computeNextHeartbeatAt,
  extractCronExpression,
  extractHeartbeatIntervalMsFromOpenclawJson,
} from '@/lib/hibernation/next-heartbeat';
import { isRuntimeStateStale } from '@/lib/hibernation/stale-destroy';
import {
  assertCreateBudgetOrEnqueue,
  enqueueFromQuotaRejection,
  isProvisioningQueuedError,
  ProvisioningQueuedError,
  recordSuccessfulCreate,
} from '@/lib/railway/governor';
import { isRailwayCreateQuotaError } from '@/lib/railway/governor-budget';
import {
  checkoutPooledService,
  releasePoolEntryForSweep,
  teardownServiceViaPool,
} from '@/lib/railway/service-pool';
import { sendOwnerAlert } from '@/lib/alerts/owner-alert';
import {
  isRailwayDomainCapError,
  publicDeployErrorMessage,
  RailwayDomainCapError,
} from '@/lib/openclaw/service-domain';

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
// (HIBERNATE_SYNC_TIMEOUT_MS) because it loops under a 55s ceiling - see
// src/app/api/cron/hibernation/route.ts.
/**
 * Missing Railway service (404 / not found) - safe to adopt-by-name or fresh-create.
 * BEFORE P4: only this shape fell through; NotAuthorized rethrew forever.
 */
export function isMissingRailwayServiceError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /(?:service|deployment).*not\s+found|not\s+found.*(?:service|deployment)|404/i.test(message);
}

/**
 * Lifecycle P4: orphan-class errors on an EXISTING service id during redeploy.
 * Includes missing-service AND NotAuthorized (stale ACL / deleted service
 * still referenced by our stored containerId). Fresh createService auth
 * outages are NOT orphan - they must fail loud (no infinite provision loop).
 */
export function isOrphanRailwayServiceError(err: unknown): boolean {
  if (isMissingRailwayServiceError(err)) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /NotAuthorized|not\s*authorized|unauthorized/i.test(message);
}

function isRailwayAuthOutageError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /NotAuthorized|not\s*authorized|unauthorized|401/i.test(message);
}

/**
 * Every serviceCreate goes through the governor. Reuse / wake (existing
 * containerId → updateAndRedeployService) never call this.
 */
async function createServiceGoverned(
  workspaceId: string,
  config: { name: string; envVars: Record<string, string>; image?: string },
): Promise<{ serviceId: string; domain: string }> {
  await assertCreateBudgetOrEnqueue(workspaceId);
  try {
    const result = await createService(config);
    await recordSuccessfulCreate(workspaceId, result.serviceId);
    return result;
  } catch (err: unknown) {
    if (isRailwayCreateQuotaError(err)) {
      const queued = await enqueueFromQuotaRejection(workspaceId);
      throw new ProvisioningQueuedError(queued);
    }
    throw err;
  }
}

/**
 * Fresh-provision path: POOL CHECKOUT FIRST, serviceCreate only when the
 * pool is empty. A pooled checkout deploys through the exact same
 * updateAndRedeployService mutations (image, startCommand, healthcheck,
 * env replace, domain reuse, deployV2) as the wake/reuse path - a claw
 * deployed from a pooled service boots identically to one deployed onto a
 * fresh createService (Rule-36).
 *
 * The governor is therefore consulted ONLY when the pool is empty: queueing
 * happens when pool empty AND create budget spent, never merely because the
 * budget is spent.
 */
async function provisionFreshService(
  workspaceId: string,
  config: { name: string; envVars: Record<string, string>; image?: string },
): Promise<{
  serviceId: string;
  domain: string;
  previousDeploymentId: string | null;
}> {
  const pooled = await checkoutPooledService(workspaceId, config.name);
  if (pooled) {
    try {
      // A banked service normally has no deployment; a reclaimed stranded one
      // may. Capture it so waitForDeploymentSuccess never confuses a stale
      // SUCCESS for the new deploy.
      const beforeStatus = await getServiceStatus(pooled.serviceId);
      const previousDeploymentId =
        beforeStatus.status === 'REMOVED' || beforeStatus.status === 'NO_DEPLOYMENT'
          ? null
          : beforeStatus.deploymentId;
      const result = await withTransientDeployRetry(() =>
        updateAndRedeployService(pooled.serviceId, config.envVars, config.image, pooled.domain),
      );
      if (!result.domain && pooled.domain) {
        result.domain = pooled.domain;
      }
      log.info('Deployed onto pooled Railway service', {
        workspaceId,
        serviceId: pooled.serviceId,
        domain: result.domain,
      });
      return { ...result, previousDeploymentId };
    } catch (err) {
      // Dead pooled service (deleted out-of-band / stale ACL): release the
      // entry for the sweeper and fall through to a governed create. Any
      // other failure propagates - it would fail a fresh create too.
      if (!isOrphanRailwayServiceError(err)) throw err;
      await releasePoolEntryForSweep(
        pooled.entryId,
        err instanceof Error ? err.message : String(err),
      );
      log.warn('Pooled service unusable at deploy; released for sweep, creating fresh', {
        workspaceId,
        serviceId: pooled.serviceId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const created = await withTransientDeployRetry(() =>
    createServiceGoverned(workspaceId, config),
  );
  return { ...created, previousDeploymentId: null };
}

// ---------------------------------------------------------------------------
// Deployment Status
// ---------------------------------------------------------------------------

export type DeploymentStatus =
  | 'PENDING'
  | 'GENERATING'
  | 'PROVISIONING'
  | 'CONFIGURING'
  | 'STARTING'
  | 'HEALTH_CHECK'
  | 'WAITING_CHANNELS'
  | 'COMPLETED'
  | 'FAILED';

export type DeploymentCompletionData = {
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

export async function updateDeploymentStatus(
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

export function buildDeploymentCompletionData(
  fingerprint: WorkspaceConfigFingerprint,
  generated: GeneratedWorkspace,
): DeploymentCompletionData {
  const envManifest = buildEnvManifest(generated['.env']);
  const generatorSha = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? null;
  const snapshotPayload = {
    version: 1,
    fingerprintVersion: fingerprint.version,
    hash: fingerprint.hash,
    generatorSha,
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
      fingerprintVersion: fingerprint.version,
      hash: fingerprint.hash,
      generatedAt: new Date().toISOString(),
      generatorSha,
      areas: fingerprint.areas,
      envManifest,
    }),
    configSnapshotGzip,
  };
}

export function withRailwayDeploymentId(
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
 * Resolves the container image AND its emission contract for a deploy.
 *
 * Priority:
 *   0. `Workspace.runtimeImagePin` - explicit per-workspace version pin.
 *      Never falls through: a pin naming an unregistered version THROWS.
 *      (Founder claw: its volume is 9.4-shaped; a silent 5.22-18 stable
 *      fallback on wake would boot history into an image that cannot read
 *      it. Loud failure over silent data loss.)
 *   1. Candidate soak (PR-2): flagged staging clones only - the `isLatest`
 *      row (isCandidate register). KEEP canary and production CLAWS_ENV
 *      never take this branch.
 *   2. Current `isStable` OpenClawVersion row (canonical pin).
 *   3. `OPENCLAW_DOCKER_IMAGE` env var (dev/bootstrap; contract derived from
 *      the image tag, defaulting to "9.4" when unparseable).
 *   4. Hard-coded org default.
 *
 * The returned `runtimeContract` keys the generator's config shape - see
 * src/lib/openclaw/runtime-contract.ts (KEEP wake Invalid-config P0).
 */
export type ResolveDeployImageOpts = {
  workspaceId?: string;
  candidateSoak?: boolean | null;
  runtimeImagePin?: string | null;
};

export type ResolvedDeployTarget = {
  dockerImage: string;
  /** OpenClawVersion.version when resolved from a row; null on env/hardcoded fallback. */
  version: string | null;
  runtimeContract: RuntimeContract;
};

function contractFromRow(row: { version: string; runtimeContract: string }): RuntimeContract {
  // The column is the source of truth ("property of the OpenClawVersion
  // row"); derive only if a raw insert bypassed the register route and left
  // an invalid value.
  return isRuntimeContract(row.runtimeContract)
    ? row.runtimeContract
    : deriveRuntimeContract(row.version);
}

/** Best-effort contract from an image string's tag; "9.4" when unparseable. */
function contractFromImageTag(image: string): RuntimeContract {
  const tag = image.split(':').pop() ?? '';
  try {
    return deriveRuntimeContract(tag);
  } catch {
    return '9.4';
  }
}

export async function resolveDeployTarget(
  opts: ResolveDeployImageOpts = {},
): Promise<ResolvedDeployTarget> {
  if (opts.runtimeImagePin) {
    const pinned = await prisma.openClawVersion.findUnique({
      where: { version: opts.runtimeImagePin },
      select: { dockerImage: true, version: true, runtimeContract: true },
    });
    if (!pinned?.dockerImage) {
      throw new Error(
        `runtimeImagePin "${opts.runtimeImagePin}" has no OpenClawVersion row - refusing stable/candidate fallback for workspace ${opts.workspaceId ?? 'unknown'}`,
      );
    }
    log.info('resolveDeployTarget: using explicit per-workspace pin', {
      workspaceId: opts.workspaceId,
      version: pinned.version,
      dockerImage: pinned.dockerImage,
      runtimeContract: pinned.runtimeContract,
    });
    return {
      dockerImage: pinned.dockerImage,
      version: pinned.version,
      runtimeContract: contractFromRow(pinned),
    };
  }

  if (mayDeployCandidateImage(opts)) {
    const candidate = await prisma.openClawVersion.findFirst({
      where: { isLatest: true },
      orderBy: { releasedAt: 'desc' },
      select: { dockerImage: true, version: true, isStable: true, runtimeContract: true },
    });
    if (candidate?.dockerImage) {
      log.info('resolveDeployTarget: using isLatest candidate for flagged staging soak', {
        workspaceId: opts.workspaceId,
        version: candidate.version,
        dockerImage: candidate.dockerImage,
        isStable: candidate.isStable,
        runtimeContract: candidate.runtimeContract,
      });
      return {
        dockerImage: candidate.dockerImage,
        version: candidate.version,
        runtimeContract: contractFromRow(candidate),
      };
    }
    log.warn('resolveDeployTarget: candidate soak flagged but no isLatest row; falling back to isStable', {
      workspaceId: opts.workspaceId,
    });
  }

  const stable = await prisma.openClawVersion.findFirst({
    where: { isStable: true },
    orderBy: { releasedAt: 'desc' },
    select: { dockerImage: true, version: true, runtimeContract: true },
  });

  if (stable?.dockerImage) {
    return {
      dockerImage: stable.dockerImage,
      version: stable.version,
      runtimeContract: contractFromRow(stable),
    };
  }

  const envFallback = process.env.OPENCLAW_DOCKER_IMAGE?.trim();
  if (envFallback) {
    log.warn('resolveDeployTarget: no isStable OpenClawVersion row; using OPENCLAW_DOCKER_IMAGE env fallback', {
      envFallback,
    });
    return {
      dockerImage: envFallback,
      version: null,
      runtimeContract: contractFromImageTag(envFallback),
    };
  }

  const HARDCODED_FALLBACK = 'ghcr.io/laxcorp-research/openclaw-runtime:latest';
  log.warn('resolveDeployTarget: no isStable row and OPENCLAW_DOCKER_IMAGE unset; using hardcoded default', {
    fallback: HARDCODED_FALLBACK,
  });
  return { dockerImage: HARDCODED_FALLBACK, version: null, runtimeContract: '9.4' };
}

/** Image-string view of resolveDeployTarget (admin/tools display callers). */
export async function resolveDeployImage(
  opts: ResolveDeployImageOpts = {},
): Promise<string> {
  return (await resolveDeployTarget(opts)).dockerImage;
}

// ---------------------------------------------------------------------------
// Shared deploy scaffolding (Railway deployToCloud + Fly deployToFly)
// ---------------------------------------------------------------------------

/**
 * Pre-populate ContainerState BEFORE any provider call. The container's
 * first state sync (~30s after boot, per PR2) uses updateMany on this
 * row - if the row doesn't exist yet, the sync is silently dropped
 * (count=0 no-op). Creating the row first makes the write idempotent
 * and closes the race.
 *
 * Error paths use updateMany with containerPhase='STOPPED', which will
 * correctly find this row and flip it on failure. No semantic drift.
 *
 * Known staleness windows (accepted, documented so future readers
 * don't re-derive from git archaeology):
 *   - hasChannels(workspace) reflects the workspace at deploy-start
 *     time, not deploy-completion. If the user toggles channels
 *     mid-deploy (~30-60s window), the ContainerState row's
 *     hasActiveChannels may lag by one deploy cycle. Concurrent
 *     channel reconfiguration during an active deploy is rare enough
 *     to accept rather than add a second write after deploy success.
 *   - lastActiveAt is set at deploy-start (was previously post-success).
 *     The hibernation threshold is 10 min idle, well above the ~60s
 *     window, so no practical impact on hibernation decisions.
 */
export async function upsertContainerStateForDeploy(args: {
  workspaceId: string;
  generated: Pick<GeneratedWorkspace, 'openclaw.json' | 'cron/jobs.json'>;
  channelsActive: boolean;
  runtimeContract: RuntimeContract;
}): Promise<void> {
  const { workspaceId, generated, channelsActive } = args;
  // Lifecycle P2: persist interval ms + rolling wake hint (cron OR now+interval).
  const heartbeatIntervalMs = extractHeartbeatIntervalMsFromOpenclawJson(
    generated['openclaw.json'],
  );
  const cronExprs =
    generated['cron/jobs.json'] !== '[]' ? generated['cron/jobs.json'] : null;
  const nextHeartbeatAt = computeNextHeartbeatAt({
    now: new Date(),
    heartbeatCronExpressions: cronExprs,
    heartbeatIntervalMs,
  });
  await prisma.containerState.upsert({
    where: { workspaceId },
    update: {
      containerPhase: channelsActive ? 'WARM' : 'RUNNING',
      lastActiveAt: new Date(),
      hibernatedAt: null,
      wakeRequestedAt: null,
      hasActiveChannels: channelsActive,
      // Clear connect stamp when channels leave; first-connect stamp is
      // set below via updateMany (preserves age across redeploy).
      ...(channelsActive ? {} : { channelsConnectedAt: null }),
      nextHeartbeatAt,
      heartbeatInterval: heartbeatIntervalMs,
      heartbeatCronExpressions: cronExprs,
      // PR-2: a fresh container makes any prior teardown's incomplete-sync
      // marker moot - clear it so a stale flag never lingers across deploys.
      lastSyncIncompleteAt: null,
      lastSyncIncompleteReason: null,
      // Snapshot generations: the persist path compares this against
      // runtimeStateContract to pin a pre-migration generation on the
      // first persist after a contract change.
      deployedRuntimeContract: args.runtimeContract,
    },
    create: {
      workspaceId,
      deployedRuntimeContract: args.runtimeContract,
      containerPhase: channelsActive ? 'WARM' : 'RUNNING',
      lastActiveAt: new Date(),
      hasActiveChannels: channelsActive,
      channelsConnectedAt: channelsActive ? new Date() : null,
      nextHeartbeatAt,
      heartbeatInterval: heartbeatIntervalMs,
      heartbeatCronExpressions: cronExprs,
    },
  });
  // P1.1: stamp channelsConnectedAt only when still null (redeploy must
  // not reset the 24h warmIdle clock).
  if (channelsActive) {
    await prisma.containerState.updateMany({
      where: { workspaceId, channelsConnectedAt: null },
      data: { channelsConnectedAt: new Date() },
    });
  }
}

/** Exported for the Fly deployer (same channel semantics as Railway). */
export function workspaceHasChannels(workspace: { channelConfigEncrypted?: string | null }): boolean {
  return hasChannels(workspace);
}

/** Exported for the Fly deployer (shared /readyz + /healthz polling). */
export async function waitForHttpEndpoint(url: string, timeoutMs: number): Promise<void> {
  return waitForEndpoint(url, timeoutMs);
}

export async function nextDeploymentVersion(workspaceId: string): Promise<number> {
  return getNextDeploymentVersion(workspaceId);
}

// ---------------------------------------------------------------------------
// Deploy to Cloud (provider front door + Railway implementation)
// ---------------------------------------------------------------------------

export type DeployToCloudOptions = {
  /**
   * Wake (HWD): never serviceCreate when Workspace.containerId is set.
   * Orphan adopt-by-name is still reuse, not create.
   */
  forbidCreate?: boolean;
  /**
   * Hibernation wake: do not terminalize Workspace to ERROR / phase STOPPED.
   * The wake catch restores HIBERNATED so the claw stays in the scheduler.
   */
  preserveHibernationOnFailure?: boolean;
};

export async function deployToCloud(
  workspaceId: string,
  opts: DeployToCloudOptions = {},
): Promise<{
  deploymentId: string;
  containerId: string;
  gatewayToken: string;
  /** Self-host docker: true only after /healthz answered. */
  gatewayListening?: boolean;
}> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
  });

  // Provider front door: FLY workspaces (stamped, or new-workspace flag)
  // deploy via the Fly Machines adapter behind the same contract. Dynamic
  // import keeps the module graph acyclic (fly-deployer imports this
  // module's exported scaffolding). Everything below this line is the
  // battle-tested RAILWAY path, untouched.
  const { resolveEffectiveProvider } = await import('@/lib/fly/provider');
  const effectiveProvider = await resolveEffectiveProvider(workspace);
  if (effectiveProvider === 'FLY') {
    const { deployToFly } = await import('@/lib/fly/fly-deployer');
    return deployToFly(workspaceId, opts);
  }
  if (effectiveProvider === 'DOCKER') {
    const { deployToDocker } = await import('@/lib/openclaw/docker-provider');
    return deployToDocker(workspaceId, opts);
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: workspace.userId },
    include: { apiKeys: true },
  });

  // PR-1: resolve once and persist on the Deployment row so the column
  // finally matches what Railway actually pulls. Previously the
  // `Deployment.containerImage` schema default ('ghcr.io/openclaw/openclaw:latest')
  // was never overwritten - every Deployment row carried that string
  // regardless of the real image used, which broke the admin
  // versions deployment-count query and the force-update WHERE clause.
  const target = await resolveDeployTarget({
    workspaceId,
    candidateSoak: workspace.candidateRuntimeSoak,
    runtimeImagePin: workspace.runtimeImagePin,
  });
  const image = target.dockerImage;
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

  // Retire prior COMPLETED rows so force-update / admin counts target current only.
  await supersedePriorDeployments(workspaceId, deployment.id);

  await clearDeployEvents(workspaceId).catch(() => {});

  try {
    await updateDeploymentStatus(deployment.id, workspaceId, 'GENERATING');
    // Version-keyed emission: the generator MUST produce the config shape the
    // resolved image's gateway validates (KEEP wake Invalid-config P0).
    const generated = await generateWorkspace(workspaceId, {
      runtimeContract: target.runtimeContract,
    });
    if (generated.workflowFenceCorrected) {
      // Ledger only when a stale/tampered fence was actually replaced.
      await prisma.activityLog.create({
        data: {
          workspaceId,
          action: 'Workflow fence regenerated',
          actionType: 'SYSTEM',
          detail: 'Orchestrator AGENTS.md workflow fence was corrected from canvas + knobs.',
          metadata: JSON.stringify({ eventKind: 'workflow_fence_regenerated' }),
        },
      }).catch(() => {});
    }
    const fingerprint = await buildWorkspaceConfigFingerprint(workspaceId);
    const completionData = buildDeploymentCompletionData(fingerprint, generated);

    if (!isRailwayConfigured()) {
      log.warn('Railway not configured - running in simulation mode', { workspaceId });
      return simulateDeploy(workspaceId, deployment.id, workspace, completionData);
    }

    const channelsActive = hasChannels(workspace);
    await upsertContainerStateForDeploy({
      workspaceId,
      generated,
      channelsActive,
      runtimeContract: target.runtimeContract,
    });

    await updateDeploymentStatus(deployment.id, workspaceId, 'PROVISIONING');
    const serviceName = `${CONTAINER_PREFIX}-${workspaceId}`.substring(0, 32);
    const envVars = buildRailwayEnvVars(generated, workspace, user);

    await updateDeploymentStatus(deployment.id, workspaceId, 'CONFIGURING');

    await updateDeploymentStatus(deployment.id, workspaceId, 'STARTING');

    let result: { serviceId: string; domain: string };
    let previousDeploymentId: string | null = null;

    if (workspace.containerId) {
      const existingServiceId = workspace.containerId
      try {
        log.info('Reusing existing Railway service', { serviceId: existingServiceId, workspaceId, image });
        const beforeStatus = await getServiceStatus(existingServiceId);
        previousDeploymentId =
          beforeStatus.status === 'REMOVED' || beforeStatus.status === 'NO_DEPLOYMENT'
            ? null
            : beforeStatus.deploymentId;
        result = await withTransientDeployRetry(() =>
          updateAndRedeployService(existingServiceId, envVars, image, workspace.containerHost),
        );
        if (!result.domain && workspace.containerHost) {
          result.domain = workspace.containerHost;
        }
      } catch (redeployErr) {
        log.warn('Failed to update existing service, deleting and creating fresh', {
          workspaceId,
          oldServiceId: workspace.containerId,
          error: redeployErr instanceof Error ? redeployErr.message : String(redeployErr),
        });
        // P4: NotAuthorized on existing service → orphan fall-through (was rethrow).
        if (!isOrphanRailwayServiceError(redeployErr)) {
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
          previousDeploymentId =
            beforeStatus.status === 'REMOVED' || beforeStatus.status === 'NO_DEPLOYMENT'
              ? null
              : beforeStatus.deploymentId;
          result = await withTransientDeployRetry(() =>
            updateAndRedeployService(existingId, envVars, image, workspace.containerHost),
          );
        } else {
          if (opts.forbidCreate) {
            throw new Error(
              `Wake forbidCreate: refused serviceCreate while containerId=${workspace.containerId} is set`,
            );
          }
          await prisma.workspace.update({
            where: { id: workspaceId },
            data: { containerId: null, containerName: null, containerHost: null },
          });
          try {
            const fresh = await provisionFreshService(workspaceId, {
              name: serviceName,
              envVars,
              image,
            });
            previousDeploymentId = fresh.previousDeploymentId;
            result = { serviceId: fresh.serviceId, domain: fresh.domain };
          } catch (freshErr) {
            // Guard: auth outage on NEW provision fails loud - do not loop.
            if (isRailwayAuthOutageError(freshErr)) {
              throw new Error(
                `Railway auth outage on fresh provision after orphan clear: ${
                  freshErr instanceof Error ? freshErr.message : String(freshErr)
                }`,
              );
            }
            throw freshErr;
          }
        }
      }
    } else {
      try {
        const fresh = await provisionFreshService(workspaceId, {
          name: serviceName,
          envVars,
          image,
        });
        previousDeploymentId = fresh.previousDeploymentId;
        result = { serviceId: fresh.serviceId, domain: fresh.domain };
      } catch (err: unknown) {
        // Fresh provision NotAuthorized → fail loud (no orphan clear/retry loop).
        if (isRailwayAuthOutageError(err) && !String(err).includes('already exists')) {
          throw err;
        }
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('already exists')) {
          log.warn('Service already exists, looking it up by name', { serviceName, workspaceId });
          const existingId = await findServiceByName(serviceName);
          if (!existingId) throw new Error(`Service "${serviceName}" exists but could not be found`);
          const beforeStatus = await getServiceStatus(existingId);
          previousDeploymentId =
            beforeStatus.status === 'REMOVED' || beforeStatus.status === 'NO_DEPLOYMENT'
              ? null
              : beforeStatus.deploymentId;
          result = await withTransientDeployRetry(() =>
            updateAndRedeployService(existingId, envVars, image, workspace.containerHost),
          );
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
        log.warn('Readiness check timed out - channels may need configuration', { workspaceId });
      }
    }

    // C-engine B1: cold-boot MCP surfacing. The container's own MCP-connect
    // failure is SILENT (one gateway log line, and only on first agent run
    // - the runtime connects lazily), so for MCP-enabled deploys we probe
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
    if (isProvisioningQueuedError(error)) {
      // Honest wait - never ERROR. Workspace is already PROVISIONING_QUEUED.
      await updateDeploymentStatus(deployment.id, workspaceId, 'FAILED', error.queued.message);
      throw error;
    }
    const message = publicDeployErrorMessage(error);
    if (isRailwayDomainCapError(error)) {
      try {
        await sendOwnerAlert({
          alertKey: 'railway-domain-cap',
          title: 'Railway domain cap heal failed',
          detail: `workspace ${workspaceId}`,
          workspaceId,
        });
      } catch (alertErr) {
        log.error('owner-alert railway-domain-cap failed', {
          workspaceId,
          error: alertErr instanceof Error ? alertErr.message : String(alertErr),
        });
      }
    }
    await updateDeploymentStatus(deployment.id, workspaceId, 'FAILED', message);
    // Atomically converge Workspace + ContainerState rows on deploy failure.
    // ContainerState.containerPhase='STOPPED' is correct here: the ContainerPhase
    // enum has no ERROR value, and on a failed deploy the container (if any)
    // is non-functional and needs a rebuild - which is what STOPPED semantically
    // means under the post-PR-#52 vocabulary. updateMany avoids throwing when
    // a first-time deploy failure happens before ContainerState is created.
    // Wake failures must NOT leave ERROR/STOPPED or the hibernation cron
    // drops the claw (silent-wake #43).
    if (!opts.preserveHibernationOnFailure) {
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
    }
    if (isRailwayDomainCapError(error)) {
      throw new RailwayDomainCapError();
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Container Operations
// ---------------------------------------------------------------------------

/**
 * FAST, NON-THROWING teardown: RECYCLES the Railway service into the pool
 * (env wiped, volumes destroyed, domain kept - see
 * src/lib/railway/service-pool.ts) and converges the Workspace +
 * ContainerState rows to a STOPPED state. With SERVICE_POOL_ENABLED=false it
 * falls back to the legacy serviceDelete. It does NOT flush the container's
 * runtime state first - the only pre-destroy persistence on this path is the
 * container's own best-effort SIGTERM sync (process-manager.mjs), which
 * Railway may cut short with SIGKILL.
 *
 * Terminal teardown callers (recycle is correct here, NOT hibernate):
 *   - user Stop (`syncThenDestroy`)
 *   - trial / credit termination
 *   - Dodo enforcement
 *   - workspace deletion
 *
 * Hibernate uses removeDeploymentKeepService / syncThenRemoveDeployment.
 *
 * Use this directly ONLY where speed / not-throwing matters more than a
 * guaranteed-fresh snapshot: the Dodo webhook (must stay fast to avoid retry
 * storms) and credit exhaustion. For any user-/admin-initiated stop of a
 * RUNNING container whose history must be preserved (Stop button, and the
 * future force-update restart step), call syncThenDestroy instead - it
 * confirms the snapshot before calling this.
 */
export async function destroyContainer(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
  });

  // "survived" (delete failed with the container possibly alive) is the
  // only outcome that keeps containerHost so hibernate/wake can reuse the
  // domain (DOMAIN_REUSE / service-survives). Every pool outcome detaches:
  // recycled/deferred means the pool state machine owns the service now.
  let serviceGone: boolean;
  if (workspace.provider === 'DOCKER') {
    const { destroyDockerWorkspace } = await import('@/lib/openclaw/docker-provider');
    await destroyDockerWorkspace(workspace);
    serviceGone = true;
    log.info('destroyContainer teardown outcome (DOCKER)', {
      workspaceId,
      containerId: workspace.containerId,
    });
  } else if (workspace.provider === 'FLY') {
    // Fly terminal teardown: destroy machine + app (no pool - machine
    // creates are uncapped). Never throws.
    const { destroyFlyWorkspace } = await import('@/lib/fly/fly-deployer');
    const outcome = await destroyFlyWorkspace(workspace);
    serviceGone = outcome !== 'survived';
    log.info('destroyContainer teardown outcome (FLY)', {
      workspaceId,
      machineId: workspace.containerId,
      outcome,
    });
  } else {
    serviceGone = !(isRailwayConfigured() && workspace.containerId);
    if (isRailwayConfigured() && workspace.containerId) {
      const outcome = await teardownServiceViaPool({
        serviceId: workspace.containerId,
        workspaceId,
      });
      serviceGone = outcome !== 'survived';
      log.info('destroyContainer teardown outcome', {
        workspaceId,
        serviceId: workspace.containerId,
        outcome,
      });
    }
  }

  // Atomically update Workspace row AND ContainerState row. Previous bug:
  // only Workspace.status was updated, leaving ContainerState.containerPhase
  // stale (still 'RUNNING' / 'WARM' / whatever it was before). The hibernation
  // cron and health-check cron already filtered on Workspace.containerId
  // being non-null so they skipped these drifted rows, but the divergence
  // was real and cost us a live Railway service in one incident
  // (service 00000000-0000-4000-8000-000000000001, cleaned up manually
  // on 2026-04-27 - companion to this fix).
  //
  // updateMany is used (not update) so we don't throw if a workspace has
  // never had a container and therefore has no ContainerState row. The
  // Railway deleteService call stays OUTSIDE the transaction - we never
  // want to hold a DB transaction open across a network call.
  await prisma.$transaction([
    prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        status: 'STOPPED',
        containerId: serviceGone ? null : workspace.containerId,
        containerName: serviceGone ? null : workspace.containerName,
        // Keep host when service survives so domain reuse on wake still works.
        containerHost: serviceGone ? null : workspace.containerHost,
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

/**
 * HWD hibernate teardown: stop compute, keep identity (same container id,
 * same domain). Does NOT null containerId/containerHost and does NOT write
 * STOPPED - hibernateWorkspace then sets HIBERNATED.
 *   RAILWAY: deploymentRemove(latest) - service + domain persist.
 *   FLY: native machine stop - machine + app + domain + rootfs persist.
 */
export async function removeDeploymentKeepService(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
  });

  if (workspace.provider === 'FLY') {
    if (workspace.containerId) {
      const { stopFlyMachineKeepApp } = await import('@/lib/fly/fly-deployer');
      await stopFlyMachineKeepApp(workspace);
    }
    return;
  }

  if (workspace.provider === 'DOCKER') {
    if (workspace.containerId) {
      const { stopDockerContainer } = await import('@/lib/openclaw/docker-provider');
      await stopDockerContainer(workspace.containerId);
    }
    return;
  }

  if (isRailwayConfigured() && workspace.containerId) {
    await removeLatestDeployment(workspace.containerId);
  }
}

/**
 * Lifecycle P3 destroy policy:
 * - destroy-anyway (default): user Stop / exhaustion - sync fail → destroy + marker
 * - refuse-unsafe: auto-hibernate - sync fail OR stale snapshot → keep container
 * - force: ops override - destroy regardless of sync/stale
 */
export type DestroyPolicy = 'destroy-anyway' | 'refuse-unsafe' | 'force';

export interface SyncThenDestroyOptions {
  /** Upper bound for the /internal/sync-now call. Default DEFAULT_SYNC_TIMEOUT_MS (~18s). */
  syncTimeoutMs?: number;
  /**
   * Budget-guard / explicit bare path: skip the sync entirely.
   * With destroy-anyway/force → bare destroyContainer.
   * With refuse-unsafe → REFUSE (auto-hibernate never destroys unsynced state).
   */
  skipSync?: boolean;
  /** Default destroy-anyway (user Stop / exhaustion). Hibernate passes refuse-unsafe. */
  destroyPolicy?: DestroyPolicy;
}

export type SyncThenDestroyResult =
  | { destroyed: true; syncWarning?: string }
  | { destroyed: false; refused: true; reason: string };

/**
 * Shared sync gate for syncThenDestroy (terminal teardown) and
 * syncThenRemoveDeployment (hibernate keep-service).
 */
async function confirmedSyncThenTeardown(
  workspaceId: string,
  opts: SyncThenDestroyOptions,
  teardown: (id: string) => Promise<void>,
  logLabel: string,
): Promise<SyncThenDestroyResult> {
  const {
    syncTimeoutMs = DEFAULT_SYNC_TIMEOUT_MS,
    skipSync = false,
    destroyPolicy = 'destroy-anyway',
  } = opts;

  const enabled = process.env.SYNC_BEFORE_DESTROY !== 'false';
  if (!enabled || skipSync) {
    if (destroyPolicy === 'refuse-unsafe') {
      log.warn(`${logLabel}: refuse-unsafe - skipSync/kill-switch will not teardown`, {
        workspaceId,
        skipSync,
        syncBeforeDestroy: enabled,
      });
      return {
        destroyed: false,
        refused: true,
        reason: skipSync ? 'skip-sync-budget' : 'sync-disabled',
      };
    }
    await teardown(workspaceId);
    return { destroyed: true };
  }

  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    include: { containerState: { select: { runtimeStateUpdatedAt: true } } },
  });

  if (!workspace.containerId || !workspace.containerHost) {
    await teardown(workspaceId);
    return { destroyed: true };
  }

  const outcome = await trySyncNow(workspace.containerHost, syncTimeoutMs);

  if (outcome.synced) {
    await prisma.containerState.updateMany({
      where: { workspaceId },
      data: { lastSyncIncompleteAt: null, lastSyncIncompleteReason: null },
    });
    log.info(`${logLabel}: pre-destroy sync confirmed`, { workspaceId });
  } else {
    await prisma.containerState.updateMany({
      where: { workspaceId },
      data: { lastSyncIncompleteAt: new Date(), lastSyncIncompleteReason: outcome.reason },
    });
    log.warn(`${logLabel}: pre-destroy sync NOT confirmed`, {
      workspaceId,
      reason: outcome.reason,
      destroyPolicy,
      lastRuntimeStateUpdatedAt: workspace.containerState?.runtimeStateUpdatedAt ?? null,
    });

    if (destroyPolicy === 'refuse-unsafe') {
      return { destroyed: false, refused: true, reason: `sync-failed:${outcome.reason}` };
    }
  }

  const freshState = await prisma.containerState.findUnique({
    where: { workspaceId },
    select: { runtimeStateUpdatedAt: true },
  });
  const stale = isRuntimeStateStale(freshState?.runtimeStateUpdatedAt ?? null);

  if (stale && destroyPolicy === 'refuse-unsafe') {
    log.warn(`${logLabel}: refuse-unsafe - runtime state stale beyond threshold`, {
      workspaceId,
      runtimeStateUpdatedAt: freshState?.runtimeStateUpdatedAt ?? null,
    });
    return { destroyed: false, refused: true, reason: 'stale-snapshot' };
  }

  await teardown(workspaceId);

  if (!outcome.synced) {
    return {
      destroyed: true,
      syncWarning: `Pre-destroy sync failed (${outcome.reason}); container stopped with possibly stale snapshot.`,
    };
  }
  if (stale && destroyPolicy !== 'force') {
    return {
      destroyed: true,
      syncWarning: 'Runtime state snapshot was older than the stale threshold at stop.',
    };
  }
  return { destroyed: true };
}

/**
 * Confirmed-sync teardown: flushes + persists runtime state via POST
 * /internal/sync-now BEFORE destroy when possible.
 *
 * Lifecycle P3 destroyPolicy:
 * - destroy-anyway (default): sync fail → marker + destroy (user Stop / exhaustion)
 * - refuse-unsafe: sync fail OR runtimeStateUpdatedAt older than
 *   STALE_DESTROY_MAX_AGE_MIN (default 30) → keep container (auto-hibernate)
 * - force: ops override - destroy regardless
 *
 * Gated by SYNC_BEFORE_DESTROY (default ON; "false" → bare destroy for
 * destroy-anyway/force; refuse-unsafe still refuses bare skip).
 */
export async function syncThenDestroy(
  workspaceId: string,
  opts: SyncThenDestroyOptions = {},
): Promise<SyncThenDestroyResult> {
  return confirmedSyncThenTeardown(workspaceId, opts, destroyContainer, 'syncThenDestroy');
}

/**
 * Hibernate path: same sync/refuse-unsafe gates as syncThenDestroy, then
 * deploymentRemove(latest) - NEVER serviceDelete. containerId/containerHost persist.
 */
export async function syncThenRemoveDeployment(
  workspaceId: string,
  opts: SyncThenDestroyOptions = {},
): Promise<SyncThenDestroyResult> {
  return confirmedSyncThenTeardown(
    workspaceId,
    opts,
    removeDeploymentKeepService,
    'syncThenRemoveDeployment',
  );
}

export async function restartContainer(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
  });

  if (workspace.provider === 'DOCKER' && workspace.containerId) {
    const { startDockerContainer } = await import('@/lib/openclaw/docker-provider');
    await startDockerContainer(workspace.containerId);
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

  if (workspace.provider === 'FLY' && workspace.containerId) {
    const { restartFlyWorkspace } = await import('@/lib/fly/fly-deployer');
    await restartFlyWorkspace(workspace);
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
// Health Monitoring - moved to src/app/api/cron/health-monitor/route.ts
// ---------------------------------------------------------------------------
// PR-3 deleted the previous `healthCheckAllContainers` + `markUnhealthy`
// pair that lived here. They had ZERO callers (verified via repo grep)
// and were silently dead since landed. The replacement is the Vercel
// cron at /api/cron/health-monitor which:
//   - polls admin-http-rpc on the container directly (not just /healthz)
//   - debounces failures (UNHEALTHY at 2, ERROR at 5)
//   - logs every transition per workspace
// Do NOT reintroduce a health check here - that would race the cron.

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
  // is best-effort - a failure must NOT break the read, so we always return the
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

  const { gatewayWebSocketUrl } = await import('@/lib/openclaw/docker-engine');
  return {
    wsUrl: gatewayWebSocketUrl(workspace.containerHost, workspace.provider),
    token,
  };
}

// ---------------------------------------------------------------------------
// C-engine B1: cold-boot MCP surfacing (minimal detection; PR-R owns full
// handling). Extracts the emitted mcp.servers.composio block from the
// generated openclaw.json - its presence IS the "MCP-enabled deploy"
// signal - and probes the Tool Router endpoint (initialize + tools/list).
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
        `Container payload ${name} is ${value.length} chars - exceeds the 30,000 safety ceiling (Railway hard limit 32,768). Workspace too large to deploy.`,
      );
    }
  }
}

export function buildRailwayEnvVars(
  generated: GeneratedWorkspace,
  // PR-8a: workspace + user are passed explicitly so credit mode AND the
  // credential vars are derived from the SINGLE source of truth
  // (deriveContainerEnv) shared with the reconciliation cron and the
  // container-secrets path - not from a precomputed creditMode boolean.
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
  const seedFiles = generated.seedFiles ?? {};

  const vars: Record<string, string> = {
    CLAWS_BOOT_B64: BOOT_SCRIPT_B64,
    CLAWS_CONFIG_GZ_B64: gzipBase64(configJson),
    CLAWS_ENV_GZ_B64: gzipBase64(envFileContent),
    CLAWS_FILES_GZ_B64: gzipBase64(JSON.stringify(workspaceFiles)),
    OPENCLAW_GATEWAY_TOKEN: generated.gatewayToken,
    // Container process clock is infrastructure UTC. Workspace timezone stays
    // on cron schedule.tz + agent context docs; do NOT derive process TZ from it.
    // Was: TZ: workspace.timezone ?? 'UTC'
    TZ: 'UTC',
    NODE_ENV: 'production',
    PORT: '18789',
  };

  if (generated.runtimeContract === '9.4') {
    // 9.4 only: doctor must not rewrite generator-owned openclaw.json.
    // The 5.22 runtime has no such knob; keep its env byte-identical to the
    // proven 5.22 emission (KEEP canary).
    vars.OPENCLAW_CONFIG_READONLY = '1';
  }

  if (Object.keys(seedFiles).length > 0) {
    vars.CLAWS_SEED_FILES_GZ_B64 = gzipBase64(JSON.stringify(seedFiles));
  }

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
  // so these three emit unconditionally - no silent-no-op failure mode.
  vars.CLAWS_WORKSPACE_ID = workspace.id;
  // PR-2b #1 + #2: fail-closed on unset/mismatched endpoint env. See
  // src/lib/openclaw/env-guards.ts for the full root-cause writeup.
  const meteringEndpoint = requireMeteringEndpoint();
  assertEndpointHostMatchesApp({ endpointUrl: meteringEndpoint, endpointName: 'METERING_ENDPOINT' });
  vars.CLAWS_METERING_ENDPOINT = meteringEndpoint;
  vars.CLAWS_METERING_SECRET = process.env.METERING_MASTER_SECRET || '';

  // PR-2: Activity Wire - universal, mirrors the metering triplet above.
  // The claws-activity-reporter plugin (overlay at /opt/claws-activity-reporter)
  // reads both, then POSTs batched events to
  //   ${CLAWS_ACTIVITY_ENDPOINT}/${CLAWS_WORKSPACE_ID}
  // with header X-Activity-Secret: ${CLAWS_ACTIVITY_SECRET}.
  // The matching env var in Vercel is ACTIVITY_PIPELINE_SECRET (and
  // ACTIVITY_ENDPOINT for the URL - REQUIRED, no fallback).
  const activityEndpoint = requireActivityEndpoint();
  assertEndpointHostMatchesApp({ endpointUrl: activityEndpoint, endpointName: 'ACTIVITY_ENDPOINT' });
  vars.CLAWS_ACTIVITY_ENDPOINT = activityEndpoint;
  vars.CLAWS_ACTIVITY_SECRET = process.env.ACTIVITY_PIPELINE_SECRET || '';

  // PR-8a: credit mode + the credential vars come from deriveContainerEnv -
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
  //      - OpenClaw merges that into process.env when the skill runs.
  //   2. Container-level (this function): COMPOSIO_USER_ID is pinned at
  //      deploy time so any runtime code path reading process.env before
  //      the per-skill merge (or any accidental ad-hoc Composio call)
  //      reads the correct user id - NOT undefined, NOT another user's.
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
        'buildRailwayEnvVars: COMPOSIO_API_KEY is set but workspace.userId is missing; refusing to emit platform API key without a user-id scope pin (security boundary - see docs/COMPOSIO_RUNTIME_CONTRACT.md §"Security considerations")',
      );
    }
    vars.COMPOSIO_API_KEY = composioApiKey;
    vars.COMPOSIO_USER_ID = getComposioUserId(workspace.userId);
  }

  assertContainerPayloadEnvVarSizes(vars);
  // WAKE-4: local placeholder stubs (esp. CLAWS_METERING_SECRET) must never
  // reach Railway - same /^placeholder-/ gate as deriveContainerEnv.
  assertNoPlaceholderEnvValues(vars, "buildRailwayEnvVars");

  return vars;
}

/**
 * R16: always emit cron/jobs.json (including `[]`) so unpack overwrites the
 * canonical 9.4 store every deploy. Skipping empty left stale jobs on disk.
 */
export function buildWorkspaceFileMap(generated: GeneratedWorkspace): Record<string, string> {
  const files: Record<string, string> = {};

  const cronContent = generated['cron/jobs.json'];
  if (typeof cronContent === 'string') {
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

// Heartbeat schedule helpers live in hibernation/next-heartbeat; re-exported
// above via the import block for the historical deployer import path.
export { calculateNextHeartbeat, extractCronExpression };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export async function waitForDeploymentSuccess(
  serviceId: string,
  previousDeploymentId: string | null,
  timeoutMs = DEPLOY_TIMEOUT_MS,
): Promise<string | null> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const status = await getServiceStatus(serviceId);

    // Hibernated-with-service: latest may be REMOVED / NO_DEPLOYMENT until deployV2 lands.
    if (status.status === 'REMOVED' || status.status === 'NO_DEPLOYMENT') {
      await sleep(DEPLOY_POLL_INTERVAL_MS);
      continue;
    }

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

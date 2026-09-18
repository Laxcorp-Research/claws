/**
 * Fly Machines deployer - the FLY side of Workspace.provider, behind the
 * same observable contract as deployToCloud (Railway):
 *
 *   - same Deployment status walk (PENDING -> GENERATING -> ... -> COMPLETED)
 *   - same ContainerState upsert (upsertContainerStateForDeploy - shared fn)
 *   - same container env payloads (buildRailwayEnvVars - the container
 *     contract is provider-neutral: CLAWS_*_GZ_B64, gateway token, metering/
 *     activity wire, credit mode)
 *   - same version-aware image resolution (resolveDeployTarget: pins,
 *     candidate soak, stable row) - the ref is then mapped onto the Fly
 *     registry mirror (GHCR private pull is unsupported on Machines)
 *   - same workspace binding columns: containerId = machine id,
 *     containerName = app name, containerHost = <app>.fly.dev
 *
 * Provider differences (deliberate):
 *   - NO governor, NO service pool: Fly machine creates are uncapped.
 *   - HWD nap = native machine stop (app + domain + rootfs persist via
 *     persist_rootfs=restart); wake = config update + start.
 *   - Terminal teardown = machine + app destroy (no recycle - nothing to
 *     bank).
 *
 * State-sync, wake entitlement, sync gates, hibernation manager: unchanged -
 * they run above this seam.
 */

import { prisma } from '@/lib/db';
import { log } from '@/lib/logger';
import { encrypt } from '@/lib/encryption';
import { supersedePriorDeployments } from '@/lib/deploy/supersede-deployments';
import { generateWorkspace } from '@/lib/openclaw/generator';
import { buildWorkspaceConfigFingerprint } from '@/lib/openclaw/config-fingerprint';
import {
  buildDeploymentCompletionData,
  buildRailwayEnvVars,
  nextDeploymentVersion,
  resolveDeployTarget,
  surfaceMcpBootFailure,
  updateDeploymentStatus,
  upsertContainerStateForDeploy,
  waitForHttpEndpoint,
  workspaceHasChannels,
  type DeployToCloudOptions,
} from '@/lib/openclaw/deployer';
import {
  createFlyApp,
  createFlyMachine,
  destroyFlyApp,
  destroyFlyMachine,
  ensureSharedIpV4,
  flyAppDomain,
  flyAppNameForWorkspace,
  getFlyMachine,
  isFlyConfigured,
  isMissingFlyResourceError,
  resolveFlyImage,
  restartFlyMachine,
  startFlyMachine,
  stopFlyMachine,
  updateFlyMachineConfig,
  waitForFlyMachineState,
} from '@/lib/fly/machines-client';

const FLY_START_TIMEOUT_SEC = 120;
const FLY_HEALTHZ_TIMEOUT_MS = 120_000;

export async function deployToFly(
  workspaceId: string,
  opts: DeployToCloudOptions = {},
): Promise<{
  deploymentId: string;
  containerId: string;
  gatewayToken: string;
}> {
  if (!isFlyConfigured()) {
    throw new Error(
      'deployToFly: Fly is not configured (FLY_API_TOKEN / FLY_ORG_SLUG / FLY_IMAGE_MIRROR_PREFIX)',
    );
  }

  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
  });
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: workspace.userId },
    include: { apiKeys: true },
  });

  // Version-aware image resolution is IDENTICAL to Railway (pins, candidate
  // soak, stable row); only the registry host changes (Fly mirror).
  const target = await resolveDeployTarget({
    workspaceId,
    candidateSoak: workspace.candidateRuntimeSoak,
    runtimeImagePin: workspace.runtimeImagePin,
  });
  const flyImage = resolveFlyImage(target.dockerImage);

  // Machine-bound workspaces reuse their stored app name; fresh provisions
  // derive it (containerName is always nulled on detach/migration).
  const appName =
    workspace.containerId && workspace.containerName
      ? workspace.containerName
      : flyAppNameForWorkspace(workspaceId);

  const deployment = await prisma.deployment.create({
    data: {
      workspaceId,
      status: 'PENDING',
      version: await nextDeploymentVersion(workspaceId),
      // Store the CANONICAL (GHCR) ref so admin version counts + force-update
      // WHERE clauses stay provider-neutral; the Fly mirror ref is derived.
      containerImage: target.dockerImage,
      railwayProjectId: null,
      railwayEnvironmentId: null,
      configSnapshot: JSON.stringify({
        workspaceId,
        provider: 'FLY',
        image: target.dockerImage,
        flyImage,
        flyApp: appName,
        createdAt: new Date().toISOString(),
      }),
    },
  });

  await supersedePriorDeployments(workspaceId, deployment.id);

  try {
    await updateDeploymentStatus(deployment.id, workspaceId, 'GENERATING');
    const generated = await generateWorkspace(workspaceId, {
      runtimeContract: target.runtimeContract,
    });
    const fingerprint = await buildWorkspaceConfigFingerprint(workspaceId);
    const completionData = buildDeploymentCompletionData(fingerprint, generated);

    const channelsActive = workspaceHasChannels(workspace);
    await upsertContainerStateForDeploy({
      workspaceId,
      generated,
      channelsActive,
      runtimeContract: target.runtimeContract,
    });

    await updateDeploymentStatus(deployment.id, workspaceId, 'PROVISIONING');
    const envVars = buildRailwayEnvVars(generated, workspace, user);

    await updateDeploymentStatus(deployment.id, workspaceId, 'CONFIGURING');
    await updateDeploymentStatus(deployment.id, workspaceId, 'STARTING');

    let machineId: string;

    if (workspace.containerId) {
      // Wake / redeploy on the kept machine: full-config replace + start.
      try {
        machineId = workspace.containerId;
        await updateFlyMachineConfig(appName, machineId, { image: flyImage, env: envVars });
        await startFlyMachine(appName, machineId);
      } catch (err) {
        if (!isMissingFlyResourceError(err)) throw err;
        // Machine deleted out-of-band. Same orphan semantics as Railway:
        // wake (forbidCreate) refuses a fresh create; a user deploy clears
        // the binding and creates fresh.
        if (opts.forbidCreate) {
          throw new Error(
            `Wake forbidCreate: Fly machine ${workspace.containerId} is gone for workspace ${workspaceId}`,
          );
        }
        log.warn('Fly machine missing; creating fresh in the same app', {
          workspaceId,
          staleMachineId: workspace.containerId,
        });
        await prisma.workspace.update({
          where: { id: workspaceId },
          data: { containerId: null },
        });
        await createFlyApp(appName);
        await ensureSharedIpV4(appName);
        const machine = await createFlyMachine(appName, {
          name: appName,
          image: flyImage,
          env: envVars,
        });
        machineId = machine.id;
      }
    } else {
      await createFlyApp(appName);
      await ensureSharedIpV4(appName);
      const machine = await createFlyMachine(appName, {
        name: appName,
        image: flyImage,
        env: envVars,
      });
      machineId = machine.id;
    }

    const domain = flyAppDomain(appName);

    await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        containerId: machineId,
        containerName: appName,
        containerHost: domain,
      },
    });

    await updateDeploymentStatus(deployment.id, workspaceId, 'HEALTH_CHECK');
    await waitForFlyMachineState(appName, machineId, 'started', FLY_START_TIMEOUT_SEC);
    // Same health surface as Railway: the gateway's /healthz over the domain.
    await waitForHttpEndpoint(`https://${domain}/healthz`, FLY_HEALTHZ_TIMEOUT_MS);

    if (workspace.channelConfigEncrypted) {
      await updateDeploymentStatus(deployment.id, workspaceId, 'WAITING_CHANNELS');
      try {
        await waitForHttpEndpoint(`https://${domain}/readyz`, 60_000);
      } catch {
        log.warn('Fly readiness check timed out - channels may need configuration', { workspaceId });
      }
    }

    await surfaceMcpBootFailure(workspaceId, generated).catch(() => {});

    await updateDeploymentStatus(
      deployment.id,
      workspaceId,
      'COMPLETED',
      undefined,
      completionData,
    );

    await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        status: 'RUNNING',
        containerId: machineId,
        containerName: appName,
        containerHost: domain,
        hostPort: null,
        ...(workspace.gatewayToken ? {} : { gatewayToken: encrypt(generated.gatewayToken) }),
        healthStatus: 'HEALTHY',
        lastHealthCheck: new Date(),
      },
    });

    log.info('Fly deploy completed', { workspaceId, appName, machineId, domain, image: flyImage });
    return {
      deploymentId: deployment.id,
      containerId: machineId,
      gatewayToken: generated.gatewayToken,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown deployment error';
    await updateDeploymentStatus(deployment.id, workspaceId, 'FAILED', message);
    // Same failure convergence as Railway (silent-wake #43: wake failures
    // must NOT leave ERROR/STOPPED or the hibernation cron drops the claw).
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
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Lifecycle seams (called from deployer.ts provider dispatch)
// ---------------------------------------------------------------------------

/**
 * HWD nap on Fly: native machine stop. Machine + app + <app>.fly.dev + rootfs
 * (persist_rootfs=restart) all persist; containerId/containerHost are KEPT -
 * exactly the Railway keep-service semantics.
 */
export async function stopFlyMachineKeepApp(workspace: {
  id: string;
  containerId: string | null;
  containerName: string | null;
}): Promise<void> {
  if (!workspace.containerId) return;
  const appName = workspace.containerName ?? flyAppNameForWorkspace(workspace.id);
  await stopFlyMachine(appName, workspace.containerId);
  try {
    await waitForFlyMachineState(appName, workspace.containerId, 'stopped', 60);
  } catch (err) {
    log.warn('Fly machine stop wait timed out (stop request accepted)', {
      workspaceId: workspace.id,
      machineId: workspace.containerId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export type FlyTeardownOutcome = 'destroyed' | 'missing' | 'survived';

/**
 * Terminal teardown on Fly: destroy machine, then app (domain dies with the
 * app - nothing to bank; machine creates are uncapped). Never throws.
 */
export async function destroyFlyWorkspace(workspace: {
  id: string;
  containerId: string | null;
  containerName: string | null;
}): Promise<FlyTeardownOutcome> {
  const appName = workspace.containerName ?? flyAppNameForWorkspace(workspace.id);
  let outcome: FlyTeardownOutcome = 'missing';

  if (workspace.containerId) {
    try {
      await destroyFlyMachine(appName, workspace.containerId);
      outcome = 'destroyed';
    } catch (err) {
      if (isMissingFlyResourceError(err)) {
        outcome = 'missing';
      } else {
        log.warn('Fly machine destroy failed - machine may survive', {
          workspaceId: workspace.id,
          machineId: workspace.containerId,
          error: err instanceof Error ? err.message : String(err),
        });
        return 'survived';
      }
    }
  }

  try {
    await destroyFlyApp(appName);
  } catch (err) {
    if (!isMissingFlyResourceError(err)) {
      // Machine is gone (or never existed) - an app-delete failure leaves an
      // empty $0 app; log for ops cleanup, workspace is still detached.
      log.warn('Fly app destroy failed (empty app may linger)', {
        workspaceId: workspace.id,
        appName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return outcome;
}

export async function restartFlyWorkspace(workspace: {
  id: string;
  containerId: string | null;
  containerName: string | null;
}): Promise<void> {
  if (!workspace.containerId) return;
  const appName = workspace.containerName ?? flyAppNameForWorkspace(workspace.id);
  await restartFlyMachine(appName, workspace.containerId);
}

/** Machine state probe for admin/status surfaces. */
export async function getFlyMachineState(workspace: {
  id: string;
  containerId: string;
  containerName: string | null;
}): Promise<string> {
  const appName = workspace.containerName ?? flyAppNameForWorkspace(workspace.id);
  const machine = await getFlyMachine(appName, workspace.containerId);
  return machine.state;
}

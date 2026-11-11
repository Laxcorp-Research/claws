import { prisma } from "@/lib/db"
import type { DockerControl } from "@/lib/openclaw/docker-engine"
import { gatewayWebSocketUrl } from "@/lib/openclaw/docker-engine"
import { gatewayFailureHeadline } from "@/lib/openclaw/gateway-failure"
import { probeGatewayUpgrade, type UpgradeProbeResult } from "@/lib/openclaw/gateway-ingress"
import { isSelfHost } from "@/lib/profile"

export interface DockerLiveWorkspace {
  id: string
  status: string
  provider: string | null
  containerId: string | null
  containerHost?: string | null
  healthStatus?: string | null
  lastHealthReason?: string | null
}

export interface DockerLiveStatus {
  status: string
  errorMessage: string | null
  healthStatus: string | null
}

/**
 * Status comes from the container, not the last Deployment row.
 * A stopped hibernation stays HIBERNATED. An exited container that the
 * row still calls RUNNING becomes ERROR, with that deployment's log excerpt.
 */
export function statusFromDockerInspect(args: {
  storedStatus: string
  running: boolean
  errorMessage: string | null
}): DockerLiveStatus {
  if (
    args.storedStatus === "HIBERNATED" ||
    args.storedStatus === "WAKING" ||
    args.storedStatus === "STOPPED"
  ) {
    return { status: args.storedStatus, errorMessage: null, healthStatus: null }
  }
  if (!args.running) {
    return { status: "ERROR", errorMessage: args.errorMessage, healthStatus: "UNHEALTHY" }
  }
  if (args.storedStatus === "ERROR") {
    return { status: "RUNNING", errorMessage: null, healthStatus: "HEALTHY" }
  }
  return { status: args.storedStatus, errorMessage: null, healthStatus: null }
}

let injectedInspect: Pick<DockerControl, "inspect"> | null = null
let upgradeProbe: (wsUrl: string) => Promise<UpgradeProbeResult> = probeGatewayUpgrade

export function __setDockerInspectForTests(next: Pick<DockerControl, "inspect"> | null): void {
  injectedInspect = next
}

export function __setDashboardUpgradeProbeForTests(
  next: ((wsUrl: string) => Promise<UpgradeProbeResult>) | null,
): void {
  upgradeProbe = next ?? probeGatewayUpgrade
}

async function inspectEngine(): Promise<Pick<DockerControl, "inspect">> {
  if (injectedInspect) return injectedInspect
  const { dockerControlFromSocket } = await import("@/lib/openclaw/docker-socket")
  return dockerControlFromSocket()
}

async function rememberRejection(workspaceId: string, errorMessage: string): Promise<void> {
  const deployment = await prisma.deployment.findFirst({
    where: { workspaceId },
    orderBy: { version: "desc" },
    select: { id: true },
  })
  if (!deployment) return
  await prisma.deployment.update({
    where: { id: deployment.id },
    data: { errorMessage },
  })
}

/** Chat 502 records the gateway's rejection so the next paint is not "all clear". */
export async function noteSelfHostGatewayRejection(workspaceId: string, detail: string): Promise<void> {
  const headline = gatewayFailureHeadline(detail) ?? detail.slice(0, 500)
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      healthStatus: "UNHEALTHY",
      lastHealthCheck: new Date(),
      lastHealthReason: headline.slice(0, 500),
    },
  })
  await rememberRejection(workspaceId, headline)
}

export async function readSelfHostDashboardStatus(
  workspace: DockerLiveWorkspace,
): Promise<DockerLiveStatus> {
  if (!isSelfHost() || workspace.provider !== "DOCKER" || !workspace.containerId) {
    return { status: workspace.status, errorMessage: null, healthStatus: workspace.healthStatus ?? null }
  }
  const docker = await inspectEngine()
  const inspected = await docker.inspect(workspace.containerId)
  if (
    workspace.status === "HIBERNATED" ||
    workspace.status === "WAKING" ||
    workspace.status === "STOPPED"
  ) {
    return { status: workspace.status, errorMessage: null, healthStatus: workspace.healthStatus ?? null }
  }
  if (!inspected.running) {
    const deployment = await prisma.deployment.findFirst({
      where: { workspaceId: workspace.id },
      orderBy: { version: "desc" },
      select: { errorMessage: true },
    })
    const next = statusFromDockerInspect({
      storedStatus: workspace.status,
      running: false,
      errorMessage: deployment?.errorMessage ?? null,
    })
    if (next.status !== workspace.status) {
      await prisma.workspace.update({
        where: { id: workspace.id },
        data: { status: "ERROR", healthStatus: "UNHEALTHY" },
      })
    }
    return next
  }

  if (!workspace.containerHost) {
    return { status: workspace.status, errorMessage: null, healthStatus: workspace.healthStatus ?? null }
  }
  const upgrade = await upgradeProbe(gatewayWebSocketUrl(workspace.containerHost, "DOCKER"))
  if (upgrade.ok) {
    const deployment = await prisma.deployment.findFirst({
      where: { workspaceId: workspace.id },
      orderBy: { version: "desc" },
      select: { errorMessage: true },
    })
    const recorded =
      gatewayFailureHeadline(workspace.lastHealthReason) ??
      gatewayFailureHeadline(deployment?.errorMessage)
    if (recorded) {
      return {
        status: workspace.status === "ERROR" ? "RUNNING" : workspace.status,
        errorMessage: recorded,
        healthStatus: "UNHEALTHY",
      }
    }
    const next: DockerLiveStatus = {
      status: workspace.status === "ERROR" ? "RUNNING" : workspace.status,
      errorMessage: null,
      healthStatus: "HEALTHY",
    }
    if (workspace.status === "ERROR" || workspace.healthStatus !== "HEALTHY") {
      await prisma.workspace.update({
        where: { id: workspace.id },
        data: {
          ...(workspace.status === "ERROR" ? { status: "RUNNING" as const } : {}),
          healthStatus: "HEALTHY",
          lastHealthCheck: new Date(),
        },
      })
    }
    return next
  }
  const headline =
    gatewayFailureHeadline(upgrade.body) ??
    (upgrade.body.trim() || "websocket upgrade was rejected")
  if (workspace.healthStatus !== "UNHEALTHY" || workspace.status === "ERROR") {
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: {
        status: "RUNNING",
        healthStatus: "UNHEALTHY",
        lastHealthCheck: new Date(),
        lastHealthReason: headline.slice(0, 500),
      },
    })
  }
  await rememberRejection(workspace.id, headline)
  return { status: "RUNNING", errorMessage: headline, healthStatus: "UNHEALTHY" }
}

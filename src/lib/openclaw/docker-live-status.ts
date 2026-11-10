import { prisma } from "@/lib/db"
import type { DockerControl } from "@/lib/openclaw/docker-engine"
import { isSelfHost } from "@/lib/profile"

export interface DockerLiveWorkspace {
  id: string
  status: string
  provider: string | null
  containerId: string | null
}

export interface DockerLiveStatus {
  status: string
  errorMessage: string | null
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
    return { status: args.storedStatus, errorMessage: null }
  }
  if (!args.running) {
    return { status: "ERROR", errorMessage: args.errorMessage }
  }
  if (args.storedStatus === "ERROR") {
    return { status: "RUNNING", errorMessage: null }
  }
  return { status: args.storedStatus, errorMessage: null }
}

let injectedInspect: Pick<DockerControl, "inspect"> | null = null

export function __setDockerInspectForTests(next: Pick<DockerControl, "inspect"> | null): void {
  injectedInspect = next
}

async function inspectEngine(): Promise<Pick<DockerControl, "inspect">> {
  if (injectedInspect) return injectedInspect
  const { dockerControlFromSocket } = await import("@/lib/openclaw/docker-socket")
  return dockerControlFromSocket()
}

export async function readSelfHostDashboardStatus(
  workspace: DockerLiveWorkspace,
): Promise<DockerLiveStatus> {
  if (!isSelfHost() || workspace.provider !== "DOCKER" || !workspace.containerId) {
    return { status: workspace.status, errorMessage: null }
  }
  const docker = await inspectEngine()
  const inspected = await docker.inspect(workspace.containerId)
  const deployment = inspected.running
    ? null
    : await prisma.deployment.findFirst({
        where: { workspaceId: workspace.id },
        orderBy: { version: "desc" },
        select: { errorMessage: true },
      })
  const next = statusFromDockerInspect({
    storedStatus: workspace.status,
    running: inspected.running,
    errorMessage: deployment?.errorMessage ?? null,
  })
  if (next.status !== workspace.status && (next.status === "ERROR" || next.status === "RUNNING")) {
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: {
        status: next.status,
        healthStatus: next.status === "ERROR" ? "UNHEALTHY" : "HEALTHY",
      },
    })
  }
  return next
}

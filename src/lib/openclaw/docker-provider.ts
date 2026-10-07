/**
 * Docker provider behind deployer.ts.
 *
 * stop = hibernation (container + named volume stay).
 * start = wake.
 * host publish maps the gateway port, or CLAWS_DOCKER_PUBLISH=proxy leaves
 * the port unpublished for a reverse proxy on CLAWS_DOCKER_PROXY_HOST.
 */
import { randomBytes } from "node:crypto"
import { prisma } from "@/lib/db"
import { decrypt, encrypt } from "@/lib/encryption"
import { log } from "@/lib/logger"
import { supersedePriorDeployments } from "@/lib/deploy/supersede-deployments"
import { generateWorkspace } from "@/lib/openclaw/generator"
import {
  DOCKER_GATEWAY_PORT,
  dockerContainerName,
  dockerNetworkName,
  dockerPublishMode,
  dockerVolumeName,
  resolveDockerImage,
  type DockerControl,
  type DockerCreateSpec,
} from "@/lib/openclaw/docker-engine"
import type { DeployToCloudOptions } from "@/lib/openclaw/deployer"

export interface DockerDeployResult {
  deploymentId: string
  containerId: string
  gatewayToken: string
}

let injected: DockerControl | null = null

/** Tests inject a fake engine. Production uses the socket adapter. */
export function __setDockerControlForTests(next: DockerControl | null): void {
  injected = next
}

async function engine(): Promise<DockerControl> {
  if (injected) return injected
  const { dockerControlFromSocket } = await import("@/lib/openclaw/docker-socket")
  return dockerControlFromSocket()
}

function gatewayTokenFor(workspace: { gatewayToken: string | null }, generated: string): string {
  if (!workspace.gatewayToken) return generated
  try {
    return decrypt(workspace.gatewayToken)
  } catch {
    return generated
  }
}

function containerEnv(args: {
  workspaceId: string
  token: string
}): string[] {
  const env = [
    `GATEWAY_TOKEN=${args.token}`,
    `CLAWS_WORKSPACE_ID=${args.workspaceId}`,
    `PORT=${DOCKER_GATEWAY_PORT}`,
  ]
  const metering = process.env.METERING_MASTER_SECRET?.trim()
  if (metering) env.push(`METERING_MASTER_SECRET=${metering}`)
  const controlPlane =
    process.env.CONTROL_PLANE_INTERNAL_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim()
  if (controlPlane) env.push(`CONTROL_PLANE_INTERNAL_URL=${controlPlane.replace(/\/$/, "")}`)
  return env
}

async function runtimeLaunchForImage(
  image: string,
  generated: Awaited<ReturnType<typeof generateWorkspace>>,
  token: string,
): Promise<{ command?: string[]; env: string[] }> {
  const { isFixtureGatewayImage, dockerRuntimeCommand, runtimeLaunchEnv, workspaceFilesForBoot } =
    await import("@/lib/openclaw/docker-runtime-launch")
  if (isFixtureGatewayImage(image)) return { env: [] }
  return {
    command: dockerRuntimeCommand(),
    env: runtimeLaunchEnv({
      generated,
      files: workspaceFilesForBoot(generated),
      gatewayToken: token,
    }),
  }
}

function hostFor(name: string, publish: "host" | "proxy"): string {
  if (publish === "proxy") {
    const proxy = process.env.CLAWS_DOCKER_PROXY_HOST?.trim()
    if (!proxy) {
      throw new Error(
        "CLAWS_DOCKER_PUBLISH=proxy requires CLAWS_DOCKER_PROXY_HOST (the reverse proxy host:port the control plane dials).",
      )
    }
    return proxy
  }
  return `${name}:${DOCKER_GATEWAY_PORT}`
}

async function markRunning(args: {
  workspaceId: string
  containerId: string
  containerName: string
  containerHost: string
  hostPort: number | null
  token: string
  volumeName: string
}): Promise<void> {
  await prisma.workspace.update({
    where: { id: args.workspaceId },
    data: {
      status: "RUNNING",
      provider: "DOCKER",
      containerId: args.containerId,
      containerName: args.containerName,
      containerHost: args.containerHost,
      hostPort: args.hostPort,
      gatewayToken: encrypt(args.token),
      healthStatus: "HEALTHY",
      lastHealthCheck: new Date(),
    },
  })
  await prisma.containerState.upsert({
    where: { workspaceId: args.workspaceId },
    create: {
      workspaceId: args.workspaceId,
      containerPhase: "RUNNING",
      savedVolumeId: args.volumeName,
    },
    update: {
      containerPhase: "RUNNING",
      savedVolumeId: args.volumeName,
      hibernatedAt: null,
    },
  })
}

export async function deployToDocker(
  workspaceId: string,
  opts: DeployToCloudOptions = {},
): Promise<DockerDeployResult> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
  })
  const docker = await engine()
  const name = workspace.containerName || dockerContainerName(workspaceId)
  const volumeName = dockerVolumeName(workspaceId)
  const publish = dockerPublishMode()

  if (workspace.containerId) {
    await docker.start(workspace.containerId)
    const inspected = await docker.inspect(workspace.containerId)
    const token = workspace.gatewayToken
      ? decrypt(workspace.gatewayToken)
      : randomBytes(24).toString("hex")
    const containerHost = workspace.containerHost || hostFor(name, publish)
    await markRunning({
      workspaceId,
      containerId: workspace.containerId,
      containerName: name,
      containerHost,
      hostPort: inspected.publishedPort,
      token,
      volumeName,
    })
    log.info("docker: started existing container (wake)", {
      workspaceId,
      containerId: workspace.containerId,
    })
    const deployment = await prisma.deployment.findFirst({
      where: { workspaceId },
      orderBy: { version: "desc" },
      select: { id: true },
    })
    return {
      deploymentId: deployment?.id ?? workspace.containerId,
      containerId: workspace.containerId,
      gatewayToken: token,
    }
  }

  if (opts.forbidCreate) {
    throw new Error(`docker wake refused: workspace ${workspaceId} has no container to start`)
  }

  const image = resolveDockerImage()
  const containerHost = hostFor(name, publish)
  const generated = await generateWorkspace(workspaceId, { runtimeContract: "9.4" })
  const token = gatewayTokenFor(workspace, generated.gatewayToken)
  const launch = await runtimeLaunchForImage(image, generated, token)

  const latest = await prisma.deployment.findFirst({
    where: { workspaceId },
    orderBy: { version: "desc" },
    select: { version: true },
  })
  const deployment = await prisma.deployment.create({
    data: {
      workspaceId,
      status: "PENDING",
      version: (latest?.version ?? 0) + 1,
      containerImage: image,
      configSnapshot: JSON.stringify({
        workspaceId,
        image,
        volumeName,
        publish,
        createdAt: new Date().toISOString(),
      }),
    },
  })
  await supersedePriorDeployments(workspaceId, deployment.id)

  await docker.ensureVolume(volumeName)
  const spec: DockerCreateSpec = {
    name,
    image,
    env: [...containerEnv({ workspaceId, token }), ...launch.env],
    command: launch.command,
    volumeName,
    network: dockerNetworkName(),
    publish,
  }
  const containerId = await docker.createContainer(spec)
  await docker.start(containerId)
  const inspected = await docker.inspect(containerId)

  await prisma.deployment.update({
    where: { id: deployment.id },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      containerId,
      containerHost,
    },
  })
  await markRunning({
    workspaceId,
    containerId,
    containerName: name,
    containerHost,
    hostPort: inspected.publishedPort,
    token,
    volumeName,
  })

  log.info("docker: container created", {
    workspaceId,
    containerId,
    volumeName,
    publish,
    containerHost,
  })

  return { deploymentId: deployment.id, containerId, gatewayToken: token }
}

/** Hibernation: stop compute. Container name, id, and named volume stay. */
export async function stopDockerContainer(containerId: string): Promise<void> {
  const docker = await engine()
  await docker.stop(containerId)
}

/** Wake when the caller already holds the container id (restart). */
export async function startDockerContainer(containerId: string): Promise<void> {
  const docker = await engine()
  await docker.start(containerId)
}

/** Terminal teardown. Removes the container and its named volume. */
export async function destroyDockerWorkspace(workspace: {
  id: string
  containerId: string | null
}): Promise<void> {
  const docker = await engine()
  if (workspace.containerId) {
    try {
      await docker.remove(workspace.containerId)
    } catch (err) {
      log.warn("docker: container remove failed", {
        workspaceId: workspace.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  try {
    await docker.removeVolume(dockerVolumeName(workspace.id))
  } catch (err) {
    log.warn("docker: volume remove failed", {
      workspaceId: workspace.id,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

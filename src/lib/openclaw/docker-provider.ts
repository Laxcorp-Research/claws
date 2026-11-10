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
  gatewayWebSocketUrl,
  resolveDockerImage,
  type DockerControl,
  type DockerCreateSpec,
} from "@/lib/openclaw/docker-engine"
import { probeGatewayUpgrade, type UpgradeProbeResult } from "@/lib/openclaw/gateway-ingress"
import type { DeployToCloudOptions } from "@/lib/openclaw/deployer"
import { certsBind, prefixCaBundle, readHostCertsSource } from "@/lib/openclaw/corporate-ca"
import { lastLogLines } from "@/lib/openclaw/gateway-failure"
import { loadSelfHostRuntimeContract } from "@/lib/openclaw/self-host-runtime-version"

export interface DockerDeployResult {
  deploymentId: string
  containerId: string
  gatewayToken: string
  /** True only after /healthz and a websocket upgrade both succeeded. */
  gatewayListening?: boolean
}

const GATEWAY_LISTEN_TIMEOUT_MS = 60_000

class GatewayNotListening extends Error {
  readonly logs: string
  constructor(logs: string) {
    super(lastLogLines(logs) || "Gateway did not start listening")
    this.name = "GatewayNotListening"
    this.logs = logs
  }
}

let healthProbe: (url: string) => Promise<boolean> = async (url) => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

/** Tests stub the /healthz probe. Production uses fetch, the same check hosted uses. */
export function __setGatewayHealthProbeForTests(next: ((url: string) => Promise<boolean>) | null): void {
  healthProbe = next ?? (async (url) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
      return res.ok
    } catch {
      return false
    }
  })
}

let upgradeProbe: (wsUrl: string) => Promise<UpgradeProbeResult> = probeGatewayUpgrade

export function __setGatewayUpgradeProbeForTests(
  next: ((wsUrl: string) => Promise<UpgradeProbeResult>) | null,
): void {
  upgradeProbe = next ?? probeGatewayUpgrade
}

export function gatewayHealthUrl(containerHost: string): string {
  const withScheme = containerHost.startsWith("http://") || containerHost.startsWith("https://")
    ? containerHost
    : `http://${containerHost}`
  return `${withScheme.replace(/\/$/, "")}/healthz`
}

function dialHost(name: string, publish: "host" | "proxy", publishedPort: number | null): string {
  if (publish === "host" && process.env.CLAWS_DOCKER_DIAL === "published-port" && publishedPort) {
    return `127.0.0.1:${publishedPort}`
  }
  return hostFor(name, publish)
}

async function waitForGatewayListening(args: {
  docker: DockerControl
  containerId: string
  name: string
  publish: "host" | "proxy"
}): Promise<{ containerHost: string; publishedPort: number | null }> {
  const deadline = Date.now() + GATEWAY_LISTEN_TIMEOUT_MS
  let host = hostFor(args.name, args.publish)
  while (Date.now() < deadline) {
    const inspected = await args.docker.inspect(args.containerId)
    if (!inspected.running) {
      throw new GatewayNotListening(await args.docker.logs(args.containerId))
    }
    host = dialHost(args.name, args.publish, inspected.publishedPort)
    if (await healthProbe(gatewayHealthUrl(host))) {
      const upgrade = await upgradeProbe(gatewayWebSocketUrl(host, "DOCKER"))
      if (upgrade.ok) {
        return { containerHost: host, publishedPort: inspected.publishedPort }
      }
      // A speaking gateway that refuses the upgrade will not become healthy
      // by waiting. /healthz alone is not listening.
      if (upgrade.status >= 400) {
        const logs = await args.docker.logs(args.containerId)
        throw new GatewayNotListening(`${upgrade.body}\n${logs}`)
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new GatewayNotListening(await args.docker.logs(args.containerId))
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
  // Proxy mode without a dial host must fail before any container is created.
  hostFor(name, publish)

  if (workspace.containerId) {
    await docker.start(workspace.containerId)
    const ready = await waitForGatewayListening({
      docker,
      containerId: workspace.containerId,
      name,
      publish,
    })
    const token = workspace.gatewayToken
      ? decrypt(workspace.gatewayToken)
      : randomBytes(24).toString("hex")
    const containerHost = ready.containerHost
    await markRunning({
      workspaceId,
      containerId: workspace.containerId,
      containerName: name,
      containerHost,
      hostPort: ready.publishedPort,
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
      gatewayListening: true,
    }
  }

  if (opts.forbidCreate) {
    throw new Error(`docker wake refused: workspace ${workspaceId} has no container to start`)
  }

  const image = resolveDockerImage()
  const runtimeContract = await loadSelfHostRuntimeContract(prisma)
  const generated = await generateWorkspace(workspaceId, { runtimeContract, directClient: true })
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
  const certHost = readHostCertsSource()
  const spec: DockerCreateSpec = {
    name,
    image,
    env: [...containerEnv({ workspaceId, token }), ...launch.env],
    command: certHost ? prefixCaBundle(launch.command) : launch.command,
    extraBinds: certHost ? [certsBind(certHost)] : undefined,
    volumeName,
    network: dockerNetworkName(),
    publish,
  }
  const containerId = await docker.createContainer(spec)
  await docker.start(containerId)
  let ready: { containerHost: string; publishedPort: number | null }
  try {
    ready = await waitForGatewayListening({ docker, containerId, name, publish })
  } catch (err) {
    const logs = err instanceof GatewayNotListening ? err.logs : ""
    const errorMessage = lastLogLines(logs)
    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: "FAILED",
        errorMessage,
        completedAt: new Date(),
        containerId,
        containerHost: hostFor(name, publish),
      },
    })
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        status: "ERROR",
        provider: "DOCKER",
        containerId,
        containerName: name,
        containerHost: hostFor(name, publish),
        healthStatus: "UNHEALTHY",
        lastHealthCheck: new Date(),
      },
    })
    throw err
  }

  await prisma.deployment.update({
    where: { id: deployment.id },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      containerId,
      containerHost: ready.containerHost,
    },
  })
  await markRunning({
    workspaceId,
    containerId,
    containerName: name,
    containerHost: ready.containerHost,
    hostPort: ready.publishedPort,
    token,
    volumeName,
  })

  log.info("docker: container created", {
    workspaceId,
    containerId,
    volumeName,
    publish,
    containerHost: ready.containerHost,
  })

  return { deploymentId: deployment.id, containerId, gatewayToken: token, gatewayListening: true }
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

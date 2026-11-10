/**
 * Docker engine seam. Unit tests inject a fake. Production uses the
 * socket adapter in docker-socket.ts (dockerode over /var/run/docker.sock).
 */

export const DOCKER_GATEWAY_PORT = 18789
export const DOCKER_STATE_MOUNT = "/home/node/.openclaw"

export interface DockerCreateSpec {
  name: string
  image: string
  env: string[]
  volumeName: string
  /** User-defined network so the control plane can reach the container by name. */
  network: string
  /** host: publish DOCKER_GATEWAY_PORT on an ephemeral host port. proxy: no publish. */
  publish: "host" | "proxy"
  /**
   * Set only for a real OpenClaw runtime image. The fixture gateway keeps
   * its image CMD so the proof still answers with fixture-reply.
   */
  command?: string[]
  /** Extra host binds, for example the corporate CA directory. */
  extraBinds?: string[]
}

export interface DockerInspect {
  running: boolean
  /** Published host port when publish=host. Null when unpublished or stopped-without-binding. */
  publishedPort: number | null
  /** Process exit code once the container has stopped. Null while it is running. */
  exitCode?: number | null
}

export interface DockerControl {
  ensureVolume(name: string): Promise<void>
  createContainer(spec: DockerCreateSpec): Promise<string>
  start(id: string): Promise<void>
  stop(id: string): Promise<void>
  remove(id: string): Promise<void>
  inspect(id: string): Promise<DockerInspect>
  /** Tail of stdout+stderr. Used when the gateway dies before /healthz answers. */
  logs(id: string): Promise<string>
  removeVolume(name: string): Promise<void>
}

export function dockerVolumeName(workspaceId: string): string {
  return `claws-${workspaceId}`
}

export function dockerContainerName(workspaceId: string): string {
  return `claws-${workspaceId}`
}

export function dockerPublishMode(
  raw = process.env.CLAWS_DOCKER_PUBLISH,
): "host" | "proxy" {
  return raw === "proxy" ? "proxy" : "host"
}

const RUNTIME_IMAGE_REPO = "ghcr.io/laxcorp-research/openclaw-runtime"

/**
 * CLAWS_DOCKER_IMAGE is the contributor override (fixture gateway).
 * The shipped tag is RUNTIME_IMAGE_TAG, the same variable Compose pulls.
 */
export function resolveDockerImage(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CLAWS_DOCKER_IMAGE?.trim() || env.OPENCLAW_DOCKER_IMAGE?.trim()
  if (override) return override
  const tag = env.RUNTIME_IMAGE_TAG?.trim()
  if (!tag) {
    throw new Error(
      "RUNTIME_IMAGE_TAG is not set. Self-host deploys need a runtime image (see SELF_HOSTING.md).",
    )
  }
  return `${RUNTIME_IMAGE_REPO}:${tag}`
}

/** Docker gateways speak plain ws. Hosted Railway/Fly hosts stay wss. */
export function gatewayWebSocketUrl(containerHost: string, provider: string): string {
  if (containerHost.startsWith("ws://") || containerHost.startsWith("wss://")) {
    return containerHost
  }
  const scheme = provider === "DOCKER" ? "ws" : "wss"
  return `${scheme}://${containerHost}`
}

export function dockerNetworkName(raw = process.env.CLAWS_DOCKER_NETWORK): string {
  const name = raw?.trim()
  return name && name.length > 0 ? name : "claws"
}

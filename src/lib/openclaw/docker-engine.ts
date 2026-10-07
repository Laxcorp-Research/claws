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
}

export interface DockerInspect {
  running: boolean
  /** Published host port when publish=host. Null when unpublished or stopped-without-binding. */
  publishedPort: number | null
}

export interface DockerControl {
  ensureVolume(name: string): Promise<void>
  createContainer(spec: DockerCreateSpec): Promise<string>
  start(id: string): Promise<void>
  stop(id: string): Promise<void>
  remove(id: string): Promise<void>
  inspect(id: string): Promise<DockerInspect>
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

export function resolveDockerImage(env: NodeJS.ProcessEnv = process.env): string {
  const image = env.CLAWS_DOCKER_IMAGE?.trim() || env.OPENCLAW_DOCKER_IMAGE?.trim()
  if (!image) {
    throw new Error(
      "CLAWS_DOCKER_IMAGE is not set. Self-host deploys need a runtime image (see SELF_HOSTING.md).",
    )
  }
  return image
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

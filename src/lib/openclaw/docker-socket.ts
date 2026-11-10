import Docker from "dockerode"
import {
  DOCKER_GATEWAY_PORT,
  DOCKER_STATE_MOUNT,
  type DockerControl,
  type DockerCreateSpec,
  type DockerInspect,
} from "@/lib/openclaw/docker-engine"

function socketPath(): string {
  return process.env.DOCKER_HOST_SOCKET?.trim() || "/var/run/docker.sock"
}

function publishedPort(info: Docker.ContainerInspectInfo): number | null {
  const bindings = info.NetworkSettings?.Ports?.[`${DOCKER_GATEWAY_PORT}/tcp`]
  const hostPort = bindings?.[0]?.HostPort
  if (!hostPort) return null
  const parsed = Number(hostPort)
  return Number.isInteger(parsed) ? parsed : null
}

/**
 * dockerode over the engine socket. Stop keeps the container and its named
 * volume (hibernation). Remove is terminal teardown only.
 */
export function dockerControlFromSocket(
  docker: Docker = new Docker({ socketPath: socketPath() }),
): DockerControl {
  return {
    async ensureVolume(name: string): Promise<void> {
      try {
        await docker.getVolume(name).inspect()
      } catch {
        await docker.createVolume({ Name: name })
      }
    },

    async createContainer(spec: DockerCreateSpec): Promise<string> {
      const portKey = `${DOCKER_GATEWAY_PORT}/tcp`
      const container = await docker.createContainer({
        name: spec.name,
        Image: spec.image,
        Env: spec.env,
        ...(spec.command ? { Cmd: spec.command } : {}),
        ExposedPorts: { [portKey]: {} },
        HostConfig: {
          Binds: [
            `${spec.volumeName}:${DOCKER_STATE_MOUNT}`,
            ...(spec.extraBinds ?? []),
          ],
          NetworkMode: spec.network,
          ...(spec.publish === "host"
            ? { PortBindings: { [portKey]: [{ HostPort: "0" }] } }
            : {}),
        },
      })
      return container.id
    },

    async start(id: string): Promise<void> {
      await docker.getContainer(id).start()
    },

    async stop(id: string): Promise<void> {
      await docker.getContainer(id).stop({ t: 10 })
    },

    async remove(id: string): Promise<void> {
      await docker.getContainer(id).remove({ force: true })
    },

    async inspect(id: string): Promise<DockerInspect> {
      const info = await docker.getContainer(id).inspect()
      return {
        running: info.State.Running === true,
        exitCode: info.State.Running === true ? null : info.State.ExitCode,
        publishedPort: publishedPort(info),
      }
    },

    async logs(id: string): Promise<string> {
      const output = await docker.getContainer(id).logs({
        stdout: true,
        stderr: true,
        tail: 50,
        follow: false,
      })
      if (Buffer.isBuffer(output)) return output.toString("utf8")
      const chunks: Buffer[] = []
      for await (const chunk of output as AsyncIterable<Buffer | string>) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      return Buffer.concat(chunks).toString("utf8")
    },

    async removeVolume(name: string): Promise<void> {
      await docker.getVolume(name).remove()
    },
  }
}

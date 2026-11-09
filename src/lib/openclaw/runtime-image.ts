import Docker from "dockerode"
import { resolveDockerImage } from "@/lib/openclaw/docker-engine"
import { isSelfHost } from "@/lib/profile"

export interface RuntimeImageStatus {
  tag: string
  image: string
  present: boolean
}

function socketPath(): string {
  return process.env.DOCKER_HOST_SOCKET?.trim() || "/var/run/docker.sock"
}

async function inspectWithDocker(image: string): Promise<void> {
  const docker = new Docker({ socketPath: socketPath() })
  await docker.getImage(image).inspect()
}

/**
 * Self-host only. `present` is false when the engine has no local copy of
 * the runtime image the control plane would boot.
 */
export async function readRuntimeImage(
  env: NodeJS.ProcessEnv = process.env,
  inspect: (image: string) => Promise<void> = inspectWithDocker,
): Promise<RuntimeImageStatus | null> {
  if (!isSelfHost(env.CLAWS_PROFILE)) return null
  const tagFromEnv = env.RUNTIME_IMAGE_TAG?.trim() || ""
  let image = ""
  let tag = tagFromEnv
  try {
    image = resolveDockerImage(env)
    if (!tag) tag = image.slice(image.lastIndexOf(":") + 1)
  } catch {
    return { tag: tag || "unset", image: "", present: false }
  }
  try {
    await inspect(image)
    return { tag, image, present: true }
  } catch {
    return { tag, image, present: false }
  }
}

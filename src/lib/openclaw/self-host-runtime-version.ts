import {
  deriveRuntimeContract,
  isRuntimeContract,
  type RuntimeContract,
} from "@/lib/openclaw/runtime-contract"

export const SELF_HOST_RUNTIME_REPO = "ghcr.io/laxcorp-research/openclaw-runtime"

export function selfHostRuntimeImage(tag: string): string {
  return `${SELF_HOST_RUNTIME_REPO}:${tag}`
}

/**
 * Stamp the emission contract from the runtime tag.
 * 2026.5.22-* → "5.22". 2026.9.4-* → "9.4".
 */
export function contractFromRuntimeTag(tag: string): RuntimeContract {
  return deriveRuntimeContract(tag)
}

type VersionRow = {
  version: string
  runtimeContract: string
  dockerImage: string
  isStable: boolean
}

type VersionDb = {
  openClawVersion: {
    upsert: (args: {
      where: { version: string }
      create: VersionRow & {
        isLatest: boolean
        isSecurityPatch: boolean
        releaseNotes: string
        releasedAt: Date
      }
      update: Pick<VersionRow, "runtimeContract" | "dockerImage" | "isStable">
    }) => Promise<unknown>
    findUnique: (args: {
      where: { version: string }
      select: { runtimeContract: true }
    }) => Promise<{ runtimeContract: string } | null>
  }
}

/**
 * Self-host seed. The OpenClawVersion row for RUNTIME_IMAGE_TAG is the only
 * contract the generator is allowed to trust. Hosted seed does not call this.
 */
export async function seedSelfHostOpenClawVersion(
  db: VersionDb,
  env: { CLAWS_PROFILE?: string; RUNTIME_IMAGE_TAG?: string } = {
    CLAWS_PROFILE: process.env.CLAWS_PROFILE,
    RUNTIME_IMAGE_TAG: process.env.RUNTIME_IMAGE_TAG,
  },
): Promise<{ version: string; runtimeContract: RuntimeContract }> {
  if (env.CLAWS_PROFILE !== "self-host") {
    throw new Error("seedSelfHostOpenClawVersion requires CLAWS_PROFILE=self-host")
  }
  const version = env.RUNTIME_IMAGE_TAG?.trim() ?? ""
  if (!version) {
    throw new Error("RUNTIME_IMAGE_TAG is not set")
  }
  const runtimeContract = contractFromRuntimeTag(version)
  await db.openClawVersion.upsert({
    where: { version },
    create: {
      version,
      runtimeContract,
      isStable: true,
      isLatest: false,
      isSecurityPatch: false,
      dockerImage: selfHostRuntimeImage(version),
      releaseNotes: "Self-host runtime pinned by RUNTIME_IMAGE_TAG.",
      releasedAt: new Date(),
    },
    update: {
      runtimeContract,
      dockerImage: selfHostRuntimeImage(version),
      isStable: true,
    },
  })
  return { version, runtimeContract }
}

/** Null when the seed row is missing or its contract is not 5.22 or 9.4. */
export async function loadSelfHostRuntimeContract(
  db: VersionDb,
  env: { CLAWS_PROFILE?: string; RUNTIME_IMAGE_TAG?: string } = {
    CLAWS_PROFILE: process.env.CLAWS_PROFILE,
    RUNTIME_IMAGE_TAG: process.env.RUNTIME_IMAGE_TAG,
  },
): Promise<RuntimeContract | null> {
  const version = env.RUNTIME_IMAGE_TAG?.trim() ?? ""
  if (!version) return null
  const row = await db.openClawVersion.findUnique({
    where: { version },
    select: { runtimeContract: true },
  })
  return row && isRuntimeContract(row.runtimeContract) ? row.runtimeContract : null
}

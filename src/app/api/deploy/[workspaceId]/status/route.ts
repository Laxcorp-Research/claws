import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { getApiKeySource } from "@/lib/credits/api-key-source"
import {
  CONFIG_FINGERPRINT_MIN_VERSION,
  CONFIG_FINGERPRINT_VERSION,
  FINGERPRINT_TRANSITIONS,
  buildWorkspaceConfigFingerprint,
  isKnownFingerprintVersion,
} from "@/lib/openclaw/config-fingerprint"

type SnapshotMetadata = {
  fingerprintVersion?: number
  areas?: Record<string, string>
}

const DRIFT_AREAS = ["tools", "agents", "connections", "channels", "keys", "workspace"] as const
type DriftArea = typeof DRIFT_AREAS[number]

function parseSnapshotMetadata(snapshot: string | null | undefined): SnapshotMetadata {
  if (!snapshot) return {}
  try {
    const parsed = JSON.parse(snapshot) as SnapshotMetadata
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function storedFingerprintVersion(deployedHash: string | null, metadata: SnapshotMetadata): number | null {
  if (!deployedHash) return null
  return typeof metadata.fingerprintVersion === "number"
    ? metadata.fingerprintVersion
    : CONFIG_FINGERPRINT_MIN_VERSION
}

function changedAreasForVersion(
  metadata: SnapshotMetadata,
  areas: Record<DriftArea, string>,
): DriftArea[] {
  if (!metadata.areas) return []
  return DRIFT_AREAS.filter((area) => metadata.areas?.[area] !== areas[area])
}

function nonEmptyIntroducedAreasSince(
  current: Awaited<ReturnType<typeof buildWorkspaceConfigFingerprint>>,
  storedVersion: number,
): DriftArea[] {
  const out = new Set<DriftArea>()
  for (let version = storedVersion + 1; version <= CONFIG_FINGERPRINT_VERSION; version += 1) {
    const transition = FINGERPRINT_TRANSITIONS[version] ?? {}
    const nonEmptyByArea = current.introducedAreas[version] ?? {}
    for (const area of DRIFT_AREAS) {
      if (transition[area] && nonEmptyByArea[area]) out.add(area)
    }
  }
  return [...out]
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params

  const { error, workspace } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const owner = await prisma.user.findUnique({
    where: { id: user.id },
    select: { apiKeySource: true },
  })
  const apiKeySource = getApiKeySource(workspace!, owner)

  const deployment = await prisma.deployment.findFirst({
    where: { workspaceId },
    orderBy: { startedAt: "desc" },
  })

  const includeDrift = new URL(req.url).searchParams.get("drift") === "1"
  const drift = includeDrift
    ? await (async () => {
        const [current, latestCompleted] = await Promise.all([
          buildWorkspaceConfigFingerprint(workspaceId),
          prisma.deployment.findFirst({
            where: { workspaceId, status: "COMPLETED" },
            orderBy: { completedAt: "desc" },
            select: { configHash: true, completedAt: true, configSnapshot: true },
          }),
        ])
        const deployedHash = latestCompleted?.configHash ?? null
        const metadata = parseSnapshotMetadata(latestCompleted?.configSnapshot)
        const deployedFingerprintVersion = storedFingerprintVersion(deployedHash, metadata)

        let isStale = false
        let changedAreas: DriftArea[] = []
        if (deployedHash && deployedFingerprintVersion === CONFIG_FINGERPRINT_VERSION) {
          isStale = current.hash !== deployedHash
          changedAreas = isStale ? changedAreasForVersion(metadata, current.areas) : []
        } else if (
          deployedHash &&
          deployedFingerprintVersion !== null &&
          deployedFingerprintVersion < CONFIG_FINGERPRINT_VERSION &&
          isKnownFingerprintVersion(deployedFingerprintVersion)
        ) {
          const comparable = current.versionFingerprints[deployedFingerprintVersion]
          if (comparable && comparable.hash !== deployedHash) {
            isStale = true
            changedAreas = changedAreasForVersion(metadata, comparable.areas)
          } else {
            // The deployed artifact predates the generator reading classes
            // introduced by later fingerprint versions. If those classes are
            // non-empty now, that state is by definition absent from the
            // container. If they are empty, stay silent: no nudge banners.
            changedAreas = nonEmptyIntroducedAreasSince(current, deployedFingerprintVersion)
            isStale = changedAreas.length > 0
          }
        }

        return {
          isStale,
          currentHash: current.hash,
          deployedHash,
          currentFingerprintVersion: CONFIG_FINGERPRINT_VERSION,
          deployedFingerprintVersion,
          changedAreas,
          latestCompletedAt: latestCompleted?.completedAt ?? null,
        }
      })()
    : undefined

  if (!deployment) return apiSuccess({ deployment: null, apiKeySource, workspaceStatus: workspace!.status, ...(includeDrift ? { drift } : {}) })

  return apiSuccess({
    deployment: {
      id: deployment.id,
      status: deployment.status,
      version: deployment.version,
      errorMessage: deployment.errorMessage,
      startedAt: deployment.startedAt,
      completedAt: deployment.completedAt,
      containerId: deployment.containerId,
      containerImage: deployment.containerImage,
    },
    apiKeySource,
    workspaceStatus: workspace!.status,
    ...(includeDrift ? { drift } : {}),
  })
}

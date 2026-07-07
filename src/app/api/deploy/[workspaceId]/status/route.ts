import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { getApiKeySource } from "@/lib/credits/api-key-source"
import { CONFIG_FINGERPRINT_VERSION, buildWorkspaceConfigFingerprint } from "@/lib/openclaw/config-fingerprint"

type SnapshotMetadata = {
  fingerprintVersion?: number
  areas?: Record<string, string>
}

const DRIFT_AREAS = ["tools", "agents", "connections", "channels", "keys", "workspace"] as const

function parseSnapshotMetadata(snapshot: string | null | undefined): SnapshotMetadata {
  if (!snapshot) return {}
  try {
    const parsed = JSON.parse(snapshot) as SnapshotMetadata
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
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
        const storedFingerprintVersion = metadata.fingerprintVersion ?? null
        const comparable = Boolean(deployedHash) && storedFingerprintVersion === CONFIG_FINGERPRINT_VERSION
        // Algorithm-version mismatch means the stored hash is unknown, not stale.
        // Trade accepted deliberately: real drift that happens across a fingerprint
        // algorithm change reads fresh until the next deploy resyncs the snapshot.
        // Silence is safer than fleet-wide cry-wolf banners on projection changes.
        const changedAreas = comparable
          ? DRIFT_AREAS.filter((area) => metadata.areas?.[area] !== current.areas[area])
          : []
        return {
          isStale: comparable ? current.hash !== deployedHash : false,
          currentHash: current.hash,
          deployedHash,
          currentFingerprintVersion: CONFIG_FINGERPRINT_VERSION,
          deployedFingerprintVersion: storedFingerprintVersion,
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

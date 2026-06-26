import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { apiSuccess, apiError, ERRORS } from '@/lib/api/response'
import { getSessionUser } from '@/lib/api/auth'
import { isNewerVersion, extractVersionFromImage } from '@/lib/openclaw/version-order'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const { id } = await params

  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id },
      select: { userId: true },
    })
    if (!workspace) return ERRORS.NOT_FOUND('Workspace')
    if (workspace.userId !== user.id) return ERRORS.FORBIDDEN()

    const stableVersion = await prisma.openClawVersion.findFirst({
      where: { isStable: true },
      orderBy: { releasedAt: 'desc' },
    })
    if (!stableVersion) {
      return apiError('NOT_FOUND', 'No stable version available', 404)
    }

    const latestDeployment = await prisma.deployment.findFirst({
      where: { workspaceId: id },
      orderBy: { startedAt: 'desc' },
    })

    if (!latestDeployment) {
      return apiError('NOT_FOUND', 'No deployment found for this workspace', 404)
    }

    // No-downgrade correctness guard: only re-point Deployment.containerImage
    // when the stable row is GENUINELY NEWER than the deployed image. The old
    // check (`containerImage !== dockerImage`) would rewrite the row to an
    // OLDER stable when the deployed image was newer (e.g. deployed -3, stable
    // -2) — a silent downgrade that also corrupted the image the next redeploy
    // would pull. isNewerVersion is fail-safe: an unparseable/unregistered
    // deployed image compares as not-newer, so we never write in that case.
    const deployedVer = extractVersionFromImage(latestDeployment.containerImage)
    if (!isNewerVersion(stableVersion.version, deployedVer)) {
      return apiSuccess({ message: 'Already on the latest version', queued: false })
    }

    await prisma.deployment.update({
      where: { id: latestDeployment.id },
      data: { containerImage: stableVersion.dockerImage },
    })

    // TODO (PR-1b restart): This only re-points Deployment.containerImage — the
    // change applies on the workspace's NEXT redeploy; no container restarts
    // here (hence the truthful "queued / applies on next redeploy" copy). When
    // the live image-swap restart is built, step 1 (stop) MUST go through
    // syncThenDestroy(workspaceId) (PR-2), NOT bare destroyContainer — otherwise
    // it silently discards the latest session/MEMORY state. Per the PR-2 plan,
    // PR-1b should add a stopForReplace(workspaceId) wrapper around
    // syncThenDestroy so bare destroy is structurally unreachable here.
    // 1. Stop current container  2. Pull new image  3. Restart  4. Health check

    return apiSuccess({
      message: `Queued v${stableVersion.version} — applies on your Claw's next redeploy`,
      queued: true,
      newVersion: stableVersion.version,
    })
  } catch (error) {
    console.error('Failed to update workspace version:', error)
    return apiError('INTERNAL_ERROR', 'Failed to update version', 500)
  }
}

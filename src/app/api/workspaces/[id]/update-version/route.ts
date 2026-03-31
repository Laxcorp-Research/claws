import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { apiSuccess, apiError, ERRORS } from '@/lib/api/response'
import { getSessionUser } from '@/lib/api/auth'

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

    if (latestDeployment.containerImage === stableVersion.dockerImage) {
      return apiSuccess({ message: 'Already on the latest stable version', updated: false })
    }

    await prisma.deployment.update({
      where: { id: latestDeployment.id },
      data: { containerImage: stableVersion.dockerImage },
    })

    // TODO: When container infrastructure is live (Tier 3):
    // 1. Stop current container  2. Pull new image  3. Restart  4. Health check

    return apiSuccess({
      message: `Updated to v${stableVersion.version}`,
      updated: true,
      newVersion: stableVersion.version,
    })
  } catch (error) {
    console.error('Failed to update workspace version:', error)
    return apiError('INTERNAL_ERROR', 'Failed to update version', 500)
  }
}

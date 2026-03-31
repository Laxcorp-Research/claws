import { prisma } from '@/lib/db'
import { apiSuccess, apiError } from '@/lib/api/response'

export async function GET() {
  try {
    const stable = await prisma.openClawVersion.findFirst({
      where: { isStable: true },
      orderBy: { releasedAt: 'desc' },
    })

    if (!stable) {
      return apiError('NOT_FOUND', 'No stable version found', 404)
    }

    return apiSuccess({
      version: stable.version,
      dockerImage: stable.dockerImage,
      isSecurityPatch: stable.isSecurityPatch,
      releaseNotes: stable.releaseNotes,
      breakingChanges: stable.breakingChanges,
      releasedAt: stable.releasedAt,
      stableAt: stable.stableAt,
    })
  } catch (error) {
    console.error('Failed to fetch stable version:', error)
    return apiError('INTERNAL_ERROR', 'Failed to fetch stable version', 500)
  }
}

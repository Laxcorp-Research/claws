import { prisma } from '@/lib/db'
import { apiSuccess, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/api/admin'

export async function GET() {
  try {
    await requireAdmin()
  } catch {
    return apiError('FORBIDDEN', 'Admin access required', 403)
  }

  try {
    const versions = await prisma.openClawVersion.findMany({
      orderBy: { releasedAt: 'desc' },
    })

    const enriched = await Promise.all(
      versions.map(async (v) => {
        const deploymentCount = await prisma.deployment.count({
          where: {
            containerImage: v.dockerImage,
            status: 'COMPLETED',
          },
        })
        return { ...v, deploymentCount }
      })
    )

    return apiSuccess(enriched)
  } catch (error) {
    console.error('Failed to fetch admin versions:', error)
    return apiError('INTERNAL_ERROR', 'Failed to fetch versions', 500)
  }
}

import { prisma } from '@/lib/db'
import { apiSuccess, apiError } from '@/lib/api/response'

export async function GET() {
  try {
    const versions = await prisma.openClawVersion.findMany({
      orderBy: { releasedAt: 'desc' },
    })

    return apiSuccess(versions)
  } catch (error) {
    console.error('Failed to fetch versions:', error)
    return apiError('INTERNAL_ERROR', 'Failed to fetch versions', 500)
  }
}

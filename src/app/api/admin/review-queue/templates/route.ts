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
    const templates = await prisma.clawTemplate.findMany({
      where: {
        reviewStatus: 'PENDING',
        trustTier: { not: 'OFFICIAL' },
      },
      include: {
        creator: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true,
            user: { select: { email: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    return apiSuccess(templates)
  } catch (error) {
    console.error('Failed to fetch review queue templates:', error)
    return apiError('INTERNAL_ERROR', 'Failed to fetch review queue', 500)
  }
}

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { apiSuccess, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/api/admin'

export async function GET(request: NextRequest) {
  try {
    await requireAdmin()
  } catch {
    return apiError('FORBIDDEN', 'Admin access required', 403)
  }

  const { searchParams } = new URL(request.url)
  const showResolved = searchParams.get('resolved') === 'true'

  try {
    const reports = await prisma.report.findMany({
      where: {
        resolved: showResolved,
      },
      orderBy: { createdAt: showResolved ? 'desc' : 'asc' },
    })

    const enrichedReports = await Promise.all(
      reports.map(async (report) => {
        let itemName = 'Unknown'
        let itemType = 'unknown'

        if (report.templateId) {
          const template = await prisma.clawTemplate.findUnique({
            where: { id: report.templateId },
            select: { name: true },
          })
          itemName = template?.name || 'Deleted template'
          itemType = 'template'
        } else if (report.skillId) {
          const skill = await prisma.marketplaceSkill.findUnique({
            where: { id: report.skillId },
            select: { name: true },
          })
          itemName = skill?.name || 'Deleted skill'
          itemType = 'skill'
        } else if (report.reviewId) {
          itemName = 'Review'
          itemType = 'review'
        }

        return { ...report, itemName, itemType }
      })
    )

    return apiSuccess(enrichedReports)
  } catch (error) {
    console.error('Failed to fetch reports:', error)
    return apiError('INTERNAL_ERROR', 'Failed to fetch reports', 500)
  }
}

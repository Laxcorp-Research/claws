import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { apiSuccess, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/api/admin'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin()
  } catch {
    return apiError('FORBIDDEN', 'Admin access required', 403)
  }

  const { id } = await params

  try {
    const template = await prisma.clawTemplate.findUnique({ where: { id } })
    if (!template) return apiError('NOT_FOUND', 'Template not found', 404)
    if (template.reviewStatus !== 'PENDING') {
      return apiError('INVALID_STATE', 'Template is not pending review', 400)
    }

    const updated = await prisma.clawTemplate.update({
      where: { id },
      data: {
        reviewStatus: 'APPROVED',
        trustTier: 'VERIFIED',
        reviewedAt: new Date(),
      },
    })

    return apiSuccess(updated)
  } catch (error) {
    console.error('Failed to approve template:', error)
    return apiError('INTERNAL_ERROR', 'Failed to approve template', 500)
  }
}

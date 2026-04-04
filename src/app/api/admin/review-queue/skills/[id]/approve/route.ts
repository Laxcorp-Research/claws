import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { apiSuccess, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/api/admin'
import { logAdminAction } from '@/lib/security/audit-log'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let admin
  try {
    admin = await requireAdmin()
  } catch {
    return apiError('FORBIDDEN', 'Admin access required', 403)
  }

  const { id } = await params

  try {
    const skill = await prisma.marketplaceSkill.findUnique({ where: { id } })
    if (!skill) return apiError('NOT_FOUND', 'Skill not found', 404)
    if (skill.reviewStatus !== 'PENDING') {
      return apiError('INVALID_STATE', 'Skill is not pending review', 400)
    }

    const newTier = skill.sandboxPassed ? 'VERIFIED' : 'SCANNED'

    const updated = await prisma.marketplaceSkill.update({
      where: { id },
      data: {
        reviewStatus: 'APPROVED',
        trustTier: newTier,
        reviewedAt: new Date(),
      },
    })

    logAdminAction({ action: 'skill.approve', adminId: admin.id, adminEmail: admin.email || '', targetId: id, targetType: 'skill', ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() })

    return apiSuccess(updated)
  } catch (error) {
    console.error('Failed to approve skill:', error)
    return apiError('INTERNAL_ERROR', 'Failed to approve skill', 500)
  }
}

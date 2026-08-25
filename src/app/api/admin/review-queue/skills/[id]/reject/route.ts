import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { apiSuccess, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/api/admin'
import { logAdminAction } from '@/lib/security/audit-log'
import { sendEmail } from '@/lib/email/send-email'

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
    const body = await request.json()
    const { reason } = body

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return apiError('VALIDATION_ERROR', 'Rejection reason is required', 400)
    }

    const skill = await prisma.marketplaceSkill.findUnique({
      where: { id },
      include: {
        creator: {
          select: {
            displayName: true,
            user: { select: { email: true } },
          },
        },
      },
    })

    if (!skill) return apiError('NOT_FOUND', 'Skill not found', 404)
    if (skill.reviewStatus !== 'PENDING') {
      return apiError('INVALID_STATE', 'Skill is not pending review', 400)
    }

    const updated = await prisma.marketplaceSkill.update({
      where: { id },
      data: {
        reviewStatus: 'REJECTED',
        rejectionReason: reason.trim(),
        isPublished: false,
        reviewedAt: new Date(),
      },
    })

    if (skill.creator?.user?.email) {
      // Wrapper checks the SDK's resolved error field and logs failures.
      await sendEmail({
        kind: 'skill_rejected',
        to: skill.creator.user.email,
        subject: `Your skill "${skill.name}" needs changes`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto;">
              <h2 style="font-size: 18px; font-weight: 600;">Skill Review Update</h2>
              <p style="font-size: 14px; color: #555; line-height: 1.6;">
                Hi ${skill.creator.displayName || 'there'},
              </p>
              <p style="font-size: 14px; color: #555; line-height: 1.6;">
                Your skill <strong>"${skill.name}"</strong> has been reviewed and needs some changes before it can be approved.
              </p>
              <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 14px; margin: 16px 0;">
                <p style="font-size: 13px; font-weight: 600; margin: 0 0 6px 0;">Reason:</p>
                <p style="font-size: 13px; color: #991b1b; margin: 0; white-space: pre-wrap;">${reason.trim()}</p>
              </div>
              <p style="font-size: 14px; color: #555; line-height: 1.6;">
                You can fix the issues and resubmit from your Creator Dashboard.
              </p>
              <p style="font-size: 13px; color: #999; margin-top: 24px;">
                &mdash; The Claws Team
              </p>
            </div>
          `,
      })
    }

    logAdminAction({ action: 'skill.reject', adminId: admin.id, adminEmail: admin.email || '', targetId: id, targetType: 'skill', details: { reason: reason.trim() }, ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() })

    return apiSuccess(updated)
  } catch (error) {
    console.error('Failed to reject skill:', error)
    return apiError('INTERNAL_ERROR', 'Failed to reject skill', 500)
  }
}

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { apiSuccess, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/api/admin'
import { logAdminAction } from '@/lib/security/audit-log'
import { getResend } from '@/lib/resend'
import { resolveCommunityApprovedTrustTier } from '@/lib/marketplace/public-visibility'

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
    const template = await prisma.clawTemplate.findUnique({
      where: { id },
      include: {
        creator: {
          select: {
            displayName: true,
            user: { select: { email: true, name: true } },
          },
        },
      },
    })
    if (!template) return apiError('NOT_FOUND', 'Template not found', 404)

    const isFirstPublish = template.reviewStatus === 'PENDING'
    const isRepublishPending = template.pendingSubmittedAt != null && !!template.pendingWorkspaceSnapshot
    if (!isFirstPublish && !isRepublishPending) {
      return apiError('INVALID_STATE', 'Template is not pending review', 400)
    }

    const trustTier = resolveCommunityApprovedTrustTier()

    const updated = await prisma.clawTemplate.update({
      where: { id },
      data: {
        reviewStatus: 'APPROVED',
        trustTier,
        isPublished: true,
        reviewedAt: new Date(),
        ...(isRepublishPending
          ? {
              workspaceSnapshot: template.pendingWorkspaceSnapshot!,
              version: template.pendingVersion ?? template.version + 1,
              pendingWorkspaceSnapshot: null,
              pendingVersion: null,
              pendingSubmittedAt: null,
            }
          : {}),
      },
    })

    logAdminAction({ action: 'template.approve', adminId: admin.id, adminEmail: admin.email || '', targetId: id, targetType: 'template', ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() })

    if (process.env.RESEND_API_KEY && template.creator?.user?.email) {
      try {
        const creatorName = template.creator.user.name || template.creator.displayName
        await getResend().emails.send({
          from: 'Claws <noreply@buildclaws.ai>',
          to: template.creator.user.email,
          subject: `Your template "${template.name}" has been approved`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto;">
              <h2 style="font-size: 18px; font-weight: 600;">Template approved</h2>
              <p style="font-size: 14px; color: #555; line-height: 1.6;">
                Hi ${creatorName || 'there'},
              </p>
              <p style="font-size: 14px; color: #555; line-height: 1.6;">
                Your template <strong>"${template.name}"</strong> has been reviewed and approved.
                It is now listed in the marketplace.
              </p>
              <p style="font-size: 14px; margin-top: 20px;">
                <a href="https://app.buildclaws.ai/store/${template.slug}"
                   style="display: inline-block; background: #111; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 8px; font-size: 13px; font-weight: 500;">
                  View in marketplace
                </a>
              </p>
              <p style="font-size: 13px; color: #999; margin-top: 24px;">
                &mdash; The Claws Team
              </p>
            </div>
          `,
        })
      } catch (emailError) {
        console.error('Failed to send template approval email:', emailError)
      }
    }

    return apiSuccess(updated)
  } catch (error) {
    console.error('Failed to approve template:', error)
    return apiError('INTERNAL_ERROR', 'Failed to approve template', 500)
  }
}

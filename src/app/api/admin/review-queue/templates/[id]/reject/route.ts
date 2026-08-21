import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { apiSuccess, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/api/admin'
import { logAdminAction } from '@/lib/security/audit-log'
import { Resend } from 'resend'

function getResend() {
  return new Resend(process.env.RESEND_API_KEY)
}

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

    const template = await prisma.clawTemplate.findUnique({
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

    if (!template) return apiError('NOT_FOUND', 'Template not found', 404)

    const isFirstPublish = template.reviewStatus === 'PENDING'
    const isRepublishPending = template.pendingSubmittedAt != null
    if (!isFirstPublish && !isRepublishPending) {
      return apiError('INVALID_STATE', 'Template is not pending review', 400)
    }

    // Republish reject: clear pending only - live listing stays public.
    // First-publish reject: mark REJECTED and unpublish.
    const updated = await prisma.clawTemplate.update({
      where: { id },
      data: isRepublishPending && !isFirstPublish
        ? {
            pendingWorkspaceSnapshot: null,
            pendingVersion: null,
            pendingSubmittedAt: null,
            rejectionReason: reason.trim(),
            reviewedAt: new Date(),
          }
        : {
            reviewStatus: 'REJECTED',
            rejectionReason: reason.trim(),
            isPublished: false,
            reviewedAt: new Date(),
            pendingWorkspaceSnapshot: null,
            pendingVersion: null,
            pendingSubmittedAt: null,
          },
    })

    if (template.creator?.user?.email) {
      try {
        await getResend().emails.send({
          from: 'Claws <noreply@buildclaws.ai>',
          to: template.creator.user.email,
          subject: `Your template "${template.name}" needs changes`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto;">
              <h2 style="font-size: 18px; font-weight: 600;">Template Review Update</h2>
              <p style="font-size: 14px; color: #555; line-height: 1.6;">
                Hi ${template.creator.displayName || 'there'},
              </p>
              <p style="font-size: 14px; color: #555; line-height: 1.6;">
                Your template <strong>"${template.name}"</strong> has been reviewed and needs some changes before it can be approved.
              </p>
              <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 14px; margin: 16px 0;">
                <p style="font-size: 13px; font-weight: 600; margin: 0 0 6px 0;">Reason:</p>
                <p style="font-size: 13px; color: #991b1b; margin: 0; white-space: pre-wrap;">${reason.trim()}</p>
              </div>
              <p style="font-size: 14px; color: #555; line-height: 1.6;">
                You can fix the issues and resubmit from your Creator Dashboard. Once resubmitted, your template will be queued for review again.
              </p>
              <p style="font-size: 13px; color: #999; margin-top: 24px;">
                &mdash; The Claws Team
              </p>
            </div>
          `,
        })
      } catch (emailError) {
        console.error('Failed to send rejection email:', emailError)
      }
    }

    logAdminAction({ action: 'template.reject', adminId: admin.id, adminEmail: admin.email || '', targetId: id, targetType: 'template', details: { reason: reason.trim() }, ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() })

    return apiSuccess(updated)
  } catch (error) {
    console.error('Failed to reject template:', error)
    return apiError('INTERNAL_ERROR', 'Failed to reject template', 500)
  }
}

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { apiSuccess, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/api/admin'
import { logAdminAction } from '@/lib/security/audit-log'
import { sendEmail } from '@/lib/email/send-email'
import { resolveCommunityApprovedTrustTier } from '@/lib/marketplace/public-visibility'
import { ensureCommunityDodoProduct } from '@/lib/marketplace/dodo-community-product'

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

    // PR-7 DYNAMIC-AT-APPROVAL: paid community templates get a Dodo product id.
    let dodoProductId = template.dodoProductId
    const isPaidCommunity =
      !!template.creatorId && !template.isFree && typeof template.price === 'number' && template.price > 0
    if (isPaidCommunity) {
      dodoProductId = await ensureCommunityDodoProduct({
        kind: 'template',
        itemId: template.id,
        name: template.name,
        priceUsd: template.price,
        existingDodoProductId: template.dodoProductId,
      })
    }

    const updated = await prisma.clawTemplate.update({
      where: { id },
      data: {
        reviewStatus: 'APPROVED',
        trustTier,
        isPublished: true,
        reviewedAt: new Date(),
        ...(dodoProductId && dodoProductId !== template.dodoProductId
          ? { dodoProductId }
          : {}),
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
      const creatorName = template.creator.user.name || template.creator.displayName
      // Wrapper checks the SDK's resolved error field and logs failures;
      // approval itself already succeeded, so the response stays 200.
      await sendEmail({
        kind: 'template_approved',
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
    }

    return apiSuccess(updated)
  } catch (error) {
    console.error('Failed to approve template:', error)
    return apiError('INTERNAL_ERROR', 'Failed to approve template', 500)
  }
}

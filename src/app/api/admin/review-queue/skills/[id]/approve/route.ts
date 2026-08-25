import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { apiSuccess, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/api/admin'
import { logAdminAction } from '@/lib/security/audit-log'
import { sendEmail } from '@/lib/email/send-email'
import {
  assertSandboxPassedForApprove,
  assertVerifiedMintAllowed,
  resolveCommunityApprovedTrustTier,
} from '@/lib/marketplace/public-visibility'
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
    const skill = await prisma.marketplaceSkill.findUnique({
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
    if (!skill) return apiError('NOT_FOUND', 'Skill not found', 404)
    if (skill.reviewStatus !== 'PENDING') {
      return apiError('INVALID_STATE', 'Skill is not pending review', 400)
    }

    // PR-5: when SANDBOX_VETTING_ENABLED, refuse approve until sandboxPassed=true.
    try {
      assertSandboxPassedForApprove(skill.sandboxPassed)
    } catch {
      return apiError(
        'SANDBOX_REQUIRED',
        'Sandbox must pass before approve when sandbox vetting is enabled',
        400,
      )
    }

    // VERIFIED only when jail-quality report (pinned image + real Haiku turn).
    const newTier = resolveCommunityApprovedTrustTier(
      skill.sandboxPassed,
      skill.sandboxReport,
    )
    if (newTier === 'VERIFIED') {
      try {
        assertVerifiedMintAllowed()
      } catch {
        return apiError('VERIFIED_UNMINTABLE', 'Verified tier requires sandbox vetting', 400)
      }
    }

    // PR-7 DYNAMIC-AT-APPROVAL: paid community skills get a Dodo product id.
    let dodoProductId = skill.dodoProductId
    const paidPrice = skill.price
    const isPaidCommunity =
      !!skill.creatorId && !skill.isFree && typeof paidPrice === 'number' && paidPrice > 0
    if (isPaidCommunity && paidPrice != null) {
      dodoProductId = await ensureCommunityDodoProduct({
        kind: 'skill',
        itemId: skill.id,
        name: skill.name,
        priceUsd: paidPrice,
        existingDodoProductId: skill.dodoProductId,
      })
    }

    // MUTATION lock: VERIFIED only via resolveCommunityApprovedTrustTier(sandboxPassed).
    // Never hardcode the verified tier string on the update payload.
    const updated = await prisma.marketplaceSkill.update({
      where: { id },
      data: {
        reviewStatus: 'APPROVED',
        trustTier: newTier,
        isPublished: true,
        publishedAt: skill.publishedAt ?? new Date(),
        reviewedAt: new Date(),
        ...(dodoProductId && dodoProductId !== skill.dodoProductId
          ? { dodoProductId }
          : {}),
      },
    })

    logAdminAction({ action: 'skill.approve', adminId: admin.id, adminEmail: admin.email || '', targetId: id, targetType: 'skill', ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() })

    if (process.env.RESEND_API_KEY && skill.creator?.user?.email) {
      const creatorName = skill.creator.user.name || skill.creator.displayName
      // Wrapper checks the SDK's resolved error field and logs failures;
      // approval itself already succeeded, so the response stays 200.
      await sendEmail({
        kind: 'skill_approved',
        to: skill.creator.user.email,
        subject: `Your skill "${skill.name}" has been approved`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto;">
              <h2 style="font-size: 18px; font-weight: 600;">Skill approved</h2>
              <p style="font-size: 14px; color: #555; line-height: 1.6;">
                Hi ${creatorName || 'there'},
              </p>
              <p style="font-size: 14px; color: #555; line-height: 1.6;">
                Your skill <strong>"${skill.name}"</strong> has been reviewed and approved and is live in the marketplace.
              </p>
              <p style="font-size: 14px; margin-top: 20px;">
                <a href="https://app.buildclaws.ai/store/skills/${skill.slug}"
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
    console.error('Failed to approve skill:', error)
    return apiError('INTERNAL_ERROR', 'Failed to approve skill', 500)
  }
}

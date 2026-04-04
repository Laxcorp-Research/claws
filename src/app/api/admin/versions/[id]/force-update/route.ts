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
    const targetVersion = await prisma.openClawVersion.findUnique({ where: { id } })
    if (!targetVersion) return apiError('NOT_FOUND', 'Version not found', 404)
    if (!targetVersion.isStable) {
      return apiError('INVALID_STATE', 'Can only force-update to a stable version', 400)
    }

    const affectedDeployments = await prisma.deployment.findMany({
      where: {
        status: 'COMPLETED',
        containerImage: { not: targetVersion.dockerImage },
      },
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            userId: true,
            user: { select: { email: true, name: true } },
          },
        },
      },
    })

    if (affectedDeployments.length === 0) {
      return apiSuccess({
        message: 'No deployments need updating',
        affectedCount: 0,
      })
    }

    const deploymentIds = affectedDeployments.map(d => d.id)
    await prisma.deployment.updateMany({
      where: { id: { in: deploymentIds } },
      data: { containerImage: targetVersion.dockerImage },
    })

    // TODO: When container infrastructure is live (Tier 3):
    // For each affected deployment: stop container, pull new image, restart, health check

    const uniqueUsers = new Map<string, { email: string; name: string | null; workspaceNames: string[] }>()
    for (const dep of affectedDeployments) {
      if (dep.workspace?.user?.email) {
        const existing = uniqueUsers.get(dep.workspace.userId)
        if (existing) {
          existing.workspaceNames.push(dep.workspace.name || 'Unnamed Claw')
        } else {
          uniqueUsers.set(dep.workspace.userId, {
            email: dep.workspace.user.email,
            name: dep.workspace.user.name,
            workspaceNames: [dep.workspace.name || 'Unnamed Claw'],
          })
        }
      }
    }

    const resend = getResend()
    const emailPromises = Array.from(uniqueUsers.values()).map(async (user) => {
      try {
        await resend.emails.send({
          from: 'Claws <noreply@buildclaws.ai>',
          to: user.email,
          subject: `Security update applied to your Claw${user.workspaceNames.length > 1 ? 's' : ''}`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto;">
              <h2 style="font-size: 18px; font-weight: 600;">Security Update Applied</h2>
              <p style="font-size: 14px; color: #555; line-height: 1.6;">
                Hi ${user.name || 'there'},
              </p>
              <p style="font-size: 14px; color: #555; line-height: 1.6;">
                We've updated your Claw${user.workspaceNames.length > 1 ? 's' : ''} to OpenClaw v${targetVersion.version} to patch a security vulnerability. No action is needed on your end.
              </p>
              <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px; margin: 16px 0;">
                <p style="font-size: 13px; font-weight: 600; margin: 0 0 6px 0;">Updated Claws:</p>
                <ul style="font-size: 13px; color: #166534; margin: 0; padding-left: 18px;">
                  ${user.workspaceNames.map(n => `<li>${n}</li>`).join('')}
                </ul>
              </div>
              ${targetVersion.releaseNotes ? `
              <p style="font-size: 13px; color: #777;">
                <strong>What changed:</strong> ${targetVersion.releaseNotes}
              </p>
              ` : ''}
              <p style="font-size: 13px; color: #999; margin-top: 24px;">
                &mdash; The Claws Team
              </p>
            </div>
          `,
        })
      } catch (emailError) {
        console.error(`Failed to send security update email to ${user.email}:`, emailError)
      }
    })

    Promise.allSettled(emailPromises)

    logAdminAction({ action: 'version.force-update', adminId: admin.id, adminEmail: admin.email || '', targetId: id, targetType: 'version', details: { affectedCount: affectedDeployments.length, targetVersion: targetVersion.version }, ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() })

    return apiSuccess({
      message: `Force update initiated for ${affectedDeployments.length} deployment(s)`,
      affectedCount: affectedDeployments.length,
      targetVersion: targetVersion.version,
    })
  } catch (error) {
    console.error('Failed to force update:', error)
    return apiError('INTERNAL_ERROR', 'Failed to force update', 500)
  }
}

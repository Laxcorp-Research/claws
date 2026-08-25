import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { apiSuccess, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/api/admin'
import { logAdminAction } from '@/lib/security/audit-log'
import { sendEmail } from '@/lib/email/send-email'
import {
  FORCE_UPDATE_CURRENT_STATUSES,
  buildSecurityPatchEmailHtml,
  selectCurrentDeploymentsPerWorkspace,
  uniqueSortedWorkspaceNames,
} from '@/lib/deploy/force-update-targets'

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

    // Historical COMPLETED rows (one per hibernate/wake) used to all match.
    // Select newest COMPLETED|SUPERSEDED per workspace only.
    const candidateRows = await prisma.deployment.findMany({
      where: {
        status: { in: [...FORCE_UPDATE_CURRENT_STATUSES] },
        containerImage: { not: targetVersion.dockerImage },
      },
      orderBy: { startedAt: 'desc' },
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

    const affectedDeployments = selectCurrentDeploymentsPerWorkspace(candidateRows)

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

    // TODO (PR-1b restart): When the live image-swap restart is built, the
    // STOP step MUST go through syncThenDestroy(workspaceId) (PR-2), NOT bare
    // destroyContainer - otherwise a forced security update silently discards
    // the latest session/MEMORY state. Per the PR-2 plan, PR-1b should add a
    // stopForReplace(workspaceId) wrapper around syncThenDestroy so bare
    // destroy is structurally unreachable on the restart path.
    // For each affected deployment: stop container, pull new image, restart, health check

    const uniqueUsers = new Map<string, { email: string; name: string | null; workspaceNames: string[] }>()
    for (const dep of affectedDeployments) {
      if (dep.workspace?.user?.email) {
        const existing = uniqueUsers.get(dep.workspace.userId)
        const clawName = dep.workspace.name || 'Unnamed Claw'
        if (existing) {
          existing.workspaceNames.push(clawName)
        } else {
          uniqueUsers.set(dep.workspace.userId, {
            email: dep.workspace.user.email,
            name: dep.workspace.user.name,
            workspaceNames: [clawName],
          })
        }
      }
    }

    const emailPromises = Array.from(uniqueUsers.values()).map(async (user) => {
      const uniqueNames = uniqueSortedWorkspaceNames(user.workspaceNames)
      // Wrapper checks the SDK's resolved error field and logs failures.
      await sendEmail({
        kind: 'security_update',
        to: user.email,
        subject: `Security update scheduled for your Claw${uniqueNames.length > 1 ? 's' : ''}`,
        html: buildSecurityPatchEmailHtml({
          userName: user.name,
          version: targetVersion.version,
          workspaceNames: user.workspaceNames,
          releaseNotes: targetVersion.releaseNotes,
        }),
      })
    })

    // Awaited (was fire-and-forget): a serverless response ends the
    // invocation, so unawaited sends could be killed mid-flight - none of
    // the wrapper's honesty matters if the process dies first.
    await Promise.allSettled(emailPromises)

    logAdminAction({ action: 'version.force-update', adminId: admin.id, adminEmail: admin.email || '', targetId: id, targetType: 'version', details: { affectedCount: affectedDeployments.length, targetVersion: targetVersion.version }, ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() })

    return apiSuccess({
      message: `Queued v${targetVersion.version} for ${affectedDeployments.length} deployment(s) - applies on each Claw's next redeploy`,
      affectedCount: affectedDeployments.length,
      targetVersion: targetVersion.version,
    })
  } catch (error) {
    console.error('Failed to force update:', error)
    return apiError('INTERNAL_ERROR', 'Failed to force update', 500)
  }
}

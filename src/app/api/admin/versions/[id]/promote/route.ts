import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { apiSuccess, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/api/admin'
import { logAdminAction } from '@/lib/security/audit-log'
import { neverPromotableReason } from '@/lib/openclaw/version-hygiene'
import { lookupGhcrManifest } from '@/lib/ghcr/manifest'

function tagFromDockerImage(dockerImage: string, version: string): string {
  const afterColon = dockerImage.includes(':')
    ? dockerImage.slice(dockerImage.lastIndexOf(':') + 1)
    : ''
  return afterColon || version
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
    const version = await prisma.openClawVersion.findUnique({ where: { id } })
    if (!version) return apiError('NOT_FOUND', 'Version not found', 404)
    if (version.isStable) {
      return apiError('INVALID_STATE', 'This version is already stable', 400)
    }

    const hygieneReason = neverPromotableReason(version.version)
    if (hygieneReason) {
      return apiError('INVALID_STATE', hygieneReason, 400)
    }

    // GHCR_MANIFEST_EXISTS_ASSERT — refuse promote when the image tag is absent.
    const tag = tagFromDockerImage(version.dockerImage, version.version)
    const manifest = await lookupGhcrManifest(tag)
    if (!manifest.exists) {
      return apiError(
        'INVALID_STATE',
        `GHCR manifest missing for :${tag}${manifest.error ? ` (${manifest.error})` : ''}`,
        400,
      )
    }

    await prisma.$transaction([
      prisma.openClawVersion.updateMany({
        where: { isStable: true },
        data: { isStable: false },
      }),
      prisma.openClawVersion.update({
        where: { id },
        data: { isStable: true, stableAt: new Date() },
      }),
    ])

    const updated = await prisma.openClawVersion.findUnique({ where: { id } })

    logAdminAction({ action: 'version.promote', adminId: admin.id, adminEmail: admin.email || '', targetId: id, targetType: 'version', ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() })

    return apiSuccess(updated)
  } catch (error) {
    console.error('Failed to promote version:', error)
    return apiError('INTERNAL_ERROR', 'Failed to promote version', 500)
  }
}

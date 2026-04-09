import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { apiSuccess, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/api/admin'
import { logAdminAction } from '@/lib/security/audit-log'

export async function PATCH(
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
    const existing = await prisma.openClawVersion.findUnique({ where: { id } })
    if (!existing) return apiError('NOT_FOUND', 'Version not found', 404)

    const body = await request.json()
    const {
      version,
      dockerImage,
      releaseNotes,
      breakingChanges,
      isSecurityPatch,
      isStable,
    } = body

    if (version !== undefined && typeof version !== 'string') {
      return apiError('VALIDATION_ERROR', 'Version must be a string', 400)
    }
    if (dockerImage !== undefined && typeof dockerImage !== 'string') {
      return apiError('VALIDATION_ERROR', 'Docker image must be a string', 400)
    }

    if (version && version !== existing.version) {
      const duplicate = await prisma.openClawVersion.findUnique({ where: { version } })
      if (duplicate) {
        return apiError('DUPLICATE', `Version ${version} already exists`, 409)
      }
    }

    const data: Record<string, unknown> = {}
    if (version !== undefined) data.version = version.trim()
    if (dockerImage !== undefined) data.dockerImage = dockerImage.trim()
    if (releaseNotes !== undefined) data.releaseNotes = releaseNotes || null
    if (breakingChanges !== undefined) data.breakingChanges = breakingChanges || null
    if (isSecurityPatch !== undefined) data.isSecurityPatch = isSecurityPatch === true

    if (isStable !== undefined && isStable !== existing.isStable) {
      if (isStable) {
        await prisma.openClawVersion.updateMany({
          where: { isStable: true, id: { not: id } },
          data: { isStable: false },
        })
        data.isStable = true
        data.stableAt = new Date()
      } else {
        data.isStable = false
      }
    }

    const updated = await prisma.openClawVersion.update({
      where: { id },
      data,
    })

    logAdminAction({
      action: 'version.edit',
      adminId: admin.id,
      adminEmail: admin.email || '',
      targetId: id,
      targetType: 'version',
      details: { fields: Object.keys(data) },
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    })

    return apiSuccess(updated)
  } catch (error) {
    console.error('Failed to update version:', error)
    return apiError('INTERNAL_ERROR', 'Failed to update version', 500)
  }
}

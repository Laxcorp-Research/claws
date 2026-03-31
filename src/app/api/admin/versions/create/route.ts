import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { apiSuccess, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/api/admin'

export async function POST(request: NextRequest) {
  try {
    await requireAdmin()
  } catch {
    return apiError('FORBIDDEN', 'Admin access required', 403)
  }

  try {
    const body = await request.json()
    const { version, dockerImage, releaseNotes, breakingChanges, isSecurityPatch } = body

    if (!version || typeof version !== 'string') {
      return apiError('VALIDATION_ERROR', 'Version string is required (e.g., "0.2.0")', 400)
    }
    if (!dockerImage || typeof dockerImage !== 'string') {
      return apiError('VALIDATION_ERROR', 'Docker image is required', 400)
    }

    const existing = await prisma.openClawVersion.findUnique({ where: { version } })
    if (existing) {
      return apiError('DUPLICATE', `Version ${version} already exists`, 409)
    }

    const newVersion = await prisma.openClawVersion.create({
      data: {
        version,
        dockerImage,
        releaseNotes: releaseNotes || null,
        breakingChanges: breakingChanges || null,
        isSecurityPatch: isSecurityPatch === true,
        isStable: false,
        isLatest: true,
        releasedAt: new Date(),
      },
    })

    await prisma.openClawVersion.updateMany({
      where: { id: { not: newVersion.id } },
      data: { isLatest: false },
    })

    return apiSuccess(newVersion)
  } catch (error) {
    console.error('Failed to create version:', error)
    return apiError('INTERNAL_ERROR', 'Failed to create version', 500)
  }
}

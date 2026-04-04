import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { apiSuccess, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/api/admin'
import { logAdminAction } from '@/lib/security/audit-log'

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
    const { resolution } = body

    if (!resolution || typeof resolution !== 'string' || resolution.trim().length === 0) {
      return apiError('VALIDATION_ERROR', 'Resolution notes are required', 400)
    }

    const report = await prisma.report.findUnique({ where: { id } })
    if (!report) return apiError('NOT_FOUND', 'Report not found', 404)
    if (report.resolved) {
      return apiError('INVALID_STATE', 'Report is already resolved', 400)
    }

    const updated = await prisma.report.update({
      where: { id },
      data: {
        resolved: true,
        resolvedAt: new Date(),
        resolution: resolution.trim(),
      },
    })

    logAdminAction({ action: 'report.resolve', adminId: admin.id, adminEmail: admin.email || '', targetId: id, targetType: 'report', details: { resolution: resolution.trim() }, ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() })

    return apiSuccess(updated)
  } catch (error) {
    console.error('Failed to resolve report:', error)
    return apiError('INTERNAL_ERROR', 'Failed to resolve report', 500)
  }
}

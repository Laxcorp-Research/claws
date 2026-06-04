// PR-8b/C (E2): DELETE /api/api-keys/[id] — removing a BYOK key schedules a
// fire-and-forget reconcile of the user's RUNNING containers.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '@/test/helpers/mock-prisma'
import { createMockRequest, parseResponse } from '@/test/helpers/mock-request'

vi.mock('@/lib/db', () => ({ prisma: prismaMock }))
vi.mock('@/lib/api/auth', () => ({
  getSessionUser: vi.fn().mockResolvedValue({ id: 'user-test-123', email: 'test@example.com' }),
}))

const mockAfter = vi.fn()
vi.mock('next/server', async (orig) => {
  const actual = await orig<typeof import('next/server')>()
  return { ...actual, after: (cb: () => unknown) => mockAfter(cb) }
})
const mockRequestReconcile = vi.fn()
vi.mock('@/lib/openclaw/request-reconcile', () => ({
  requestReconcileForUser: (...a: unknown[]) => mockRequestReconcile(...a),
}))

import { DELETE } from '@/app/api/api-keys/[id]/route'

const params = (id: string) => ({ params: Promise.resolve({ id }) })
const del = (id: string) =>
  DELETE(createMockRequest(`http://localhost/api/api-keys/${id}`, { method: 'DELETE' }), params(id))

beforeEach(() => {
  mockAfter.mockClear()
  mockRequestReconcile.mockReset()
  mockRequestReconcile.mockResolvedValue(undefined)
  ;(prismaMock.userApiKey.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'key-1', userId: 'user-test-123' })
  ;(prismaMock.userApiKey.delete as ReturnType<typeof vi.fn>).mockResolvedValue({})
})

describe('DELETE /api/api-keys/[id]', () => {
  it('returns 401 when not authenticated — no reconcile scheduled', async () => {
    const { getSessionUser } = await import('@/lib/api/auth')
    ;(getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    const res = await del('key-1')
    expect(res.status).toBe(401)
    expect(mockAfter).not.toHaveBeenCalled()
  })

  it('returns 404 when key not found / not owned — no delete, no reconcile', async () => {
    ;(prismaMock.userApiKey.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await del('key-x')
    expect(res.status).toBe(404)
    expect(prismaMock.userApiKey.delete).not.toHaveBeenCalled()
    expect(mockAfter).not.toHaveBeenCalled()
  })

  it('deletes the key and schedules requestReconcileForUser(userId) via after()', async () => {
    const res = await del('key-1')
    const { status, data } = await parseResponse(res)
    expect(status).toBe(200)
    expect(data.success).toBe(true)
    expect(prismaMock.userApiKey.delete).toHaveBeenCalledWith({ where: { id: 'key-1' } })
    // Scheduled, not run inline.
    expect(mockAfter).toHaveBeenCalledTimes(1)
    expect(mockRequestReconcile).not.toHaveBeenCalled()
    await (mockAfter.mock.calls[0][0] as () => Promise<void>)()
    expect(mockRequestReconcile).toHaveBeenCalledWith('user-test-123')
  })
})

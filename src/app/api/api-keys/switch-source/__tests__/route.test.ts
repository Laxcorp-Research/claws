// PR-8b/C (E3): switch-source - the canonical "30 seconds" TODO case. Now wires a
// real fire-and-forget reconcile + a mode-aware, truthful message.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prismaMock } from '@/test/helpers/mock-prisma'
import { parseResponse } from '@/test/helpers/mock-request'

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
// resolveMode is REAL (reads stubbed ENV) so the message reflects the actual mode.

import { POST } from '@/app/api/api-keys/switch-source/route'

beforeEach(() => {
  mockAfter.mockClear()
  mockRequestReconcile.mockReset()
  mockRequestReconcile.mockResolvedValue(undefined)
  ;(prismaMock.userApiKey.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'k1', provider: 'ANTHROPIC', isValid: true })
  ;(prismaMock.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
  ;(prismaMock.creditAccount.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 })
  ;(prismaMock.workspace.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 })
  ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'w1' }, { id: 'w2' }])
})

afterEach(() => vi.unstubAllEnvs())

describe('POST /api/api-keys/switch-source', () => {
  it('returns 401 when not authenticated', async () => {
    const { getSessionUser } = await import('@/lib/api/auth')
    ;(getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    const res = await POST()
    expect(res.status).toBe(401)
    expect(mockAfter).not.toHaveBeenCalled()
  })

  it('returns 400 when the user has no valid Anthropic key - no switch, no reconcile', async () => {
    ;(prismaMock.userApiKey.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await POST()
    expect(res.status).toBe(400)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
    expect(mockAfter).not.toHaveBeenCalled()
  })

  it('auto_heal → switches source, schedules reconcile, returns the ~30s message', async () => {
    vi.stubEnv('ENV_RECONCILE_MODE', 'auto_heal')
    const res = await POST()
    const { status, data } = await parseResponse(res)
    expect(status).toBe(200)
    expect(data.data.switched).toBe(true)
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { apiKeySource: 'USER_OWN_KEY' } }),
    )
    expect(data.data.message).toContain('30 seconds')
    expect(mockAfter).toHaveBeenCalledTimes(1)
    expect(mockRequestReconcile).not.toHaveBeenCalled()
    await (mockAfter.mock.calls[0][0] as () => Promise<void>)()
    expect(mockRequestReconcile).toHaveBeenCalledWith('user-test-123')
  })

  it('detect_only → returns the truthful "next sync" message (no 30s promise)', async () => {
    vi.stubEnv('ENV_RECONCILE_MODE', 'detect_only')
    const res = await POST()
    const { data } = await parseResponse(res)
    expect(data.data.message).toContain('next sync')
    expect(data.data.message).not.toContain('30 seconds')
    // Reconcile is still scheduled - it's a no-op under detect_only via the gate.
    expect(mockAfter).toHaveBeenCalledTimes(1)
  })
})

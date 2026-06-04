// PR-8b/C (Q8 gate, end-to-end): the event fast-path funnels through
// requestReconcileForUser → healWorkspace, which is gated by ENV_RECONCILE_MODE.
// Here BOTH are REAL (only redis / deployer / prisma / logger are mocked) so this
// proves an event-triggered reconcile performs NO redeploy under detect_only and
// DOES redeploy under auto_heal — the shared gate working at the event path.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prismaMock } from '@/test/helpers/mock-prisma'

vi.mock('@/lib/db', () => ({ prisma: prismaMock }))

const mockRedisSet = vi.fn()
const mockRedisDel = vi.fn()
vi.mock('@/lib/redis', () => ({
  redis: { set: (...a: unknown[]) => mockRedisSet(...a), del: (...a: unknown[]) => mockRedisDel(...a) },
}))

const mockRedeploy = vi.fn()
vi.mock('@/lib/openclaw/deployer', () => ({
  redeployWorkspace: (...a: unknown[]) => mockRedeploy(...a),
}))

vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { requestReconcileForUser } from '@/lib/openclaw/request-reconcile'

beforeEach(() => {
  vi.clearAllMocks()
  mockRedisSet.mockResolvedValue('OK')
  mockRedisDel.mockResolvedValue(1)
  mockRedeploy.mockResolvedValue(undefined)
  ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'w1' }])
})

afterEach(() => vi.unstubAllEnvs())

describe('event reconcile gating (Q8 shared ENV_RECONCILE_MODE gate, end-to-end)', () => {
  it('detect_only → NO redeploy and NO cooldown acquire (gate short-circuits)', async () => {
    vi.stubEnv('ENV_RECONCILE_MODE', 'detect_only')
    await requestReconcileForUser('u1')
    // Scope query ran (it found the running workspace)...
    expect(prismaMock.workspace.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', status: 'RUNNING', containerId: { not: null } },
      select: { id: true },
    })
    // ...but the gate stopped before any heal side effect.
    expect(mockRedeploy).not.toHaveBeenCalled()
    expect(mockRedisSet).not.toHaveBeenCalled()
  })

  it('auto_heal → redeploys the running workspace (gate open)', async () => {
    vi.stubEnv('ENV_RECONCILE_MODE', 'auto_heal')
    await requestReconcileForUser('u1')
    expect(mockRedisSet).toHaveBeenCalledWith('reconcile:cooldown:w1', '1', expect.objectContaining({ nx: true }))
    expect(mockRedeploy).toHaveBeenCalledWith('w1')
  })
})

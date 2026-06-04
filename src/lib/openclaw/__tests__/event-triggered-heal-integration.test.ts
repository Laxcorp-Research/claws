// PR-8b/D — cross-PR integration: the FULL event-triggered heal chain, real from
// the HTTP route down to the gate. Real: POST /api/api-keys, after() (captured),
// requestReconcileForUser, healWorkspace, resolveMode. Mocked only at the I/O
// boundary: prisma, redis, redeployWorkspace, encryption, getSessionUser, logger.
//
// Proves: HTTP route → after() (fire-and-forget) → requestReconcileForUser →
// healWorkspace → ENV_RECONCILE_MODE gate → conditional redeploy.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prismaMock } from '@/test/helpers/mock-prisma'
import { createMockRequest, parseResponse } from '@/test/helpers/mock-request'

vi.mock('@/lib/db', () => ({ prisma: prismaMock }))
vi.mock('@/lib/api/auth', () => ({
  getSessionUser: vi.fn().mockResolvedValue({ id: 'u1', email: 't@e.com' }),
}))
vi.mock('@/lib/encryption', () => ({
  encrypt: (v: string) => `enc:${v}`,
  generateKeyHint: (v: string) => `${v.slice(0, 7)}...`,
}))

// after() captures (does not run) the callback → lets us assert the response is
// returned before the reconcile runs, then drive the callback ourselves.
const mockAfter = vi.fn()
vi.mock('next/server', async (orig) => {
  const actual = await orig<typeof import('next/server')>()
  return { ...actual, after: (cb: () => unknown) => mockAfter(cb) }
})

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

// REAL below this line: POST, requestReconcileForUser, healWorkspace, resolveMode.
import { POST } from '@/app/api/api-keys/route'

const addKey = () =>
  POST(
    createMockRequest('http://localhost/api/api-keys', {
      method: 'POST',
      body: { provider: 'ANTHROPIC', apiKey: 'sk-ant-xxxxxxx-key' },
    }),
  )

const runAfterCallback = () => (mockAfter.mock.calls[0][0] as () => Promise<void>)()

beforeEach(() => {
  vi.clearAllMocks()
  mockRedisSet.mockResolvedValue('OK')
  mockRedisDel.mockResolvedValue(1)
  mockRedeploy.mockResolvedValue(undefined)
  ;(prismaMock.userApiKey.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
  ;(prismaMock.userApiKey.create as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'k-new', provider: 'ANTHROPIC', keyHint: 'h', label: null, isValid: true, createdAt: new Date(),
  })
  // The user's two RUNNING workspaces (requestReconcileForUser's scope query).
  ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'w1' }, { id: 'w2' }])
})

afterEach(() => vi.unstubAllEnvs())

describe('event-triggered heal integration — POST /api/api-keys → after → requestReconcileForUser → healWorkspace → gate', () => {
  it('auto_heal: response returns first; the deferred fan-out heals BOTH running workspaces', async () => {
    vi.stubEnv('ENV_RECONCILE_MODE', 'auto_heal')

    const res = await addKey()
    expect((await parseResponse(res)).status).toBe(201)
    // Fire-and-forget: the response was produced WITHOUT running any heal.
    expect(mockAfter).toHaveBeenCalledTimes(1)
    expect(mockRedeploy).not.toHaveBeenCalled()

    // Drive the deferred callback → the real chain executes.
    await runAfterCallback()

    expect(prismaMock.workspace.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', status: 'RUNNING', containerId: { not: null } },
      select: { id: true },
    })
    // One healWorkspace per workspace → NX cooldown acquire + redeploy each.
    expect(mockRedisSet).toHaveBeenCalledWith('reconcile:cooldown:w1', '1', expect.objectContaining({ nx: true }))
    expect(mockRedisSet).toHaveBeenCalledWith('reconcile:cooldown:w2', '1', expect.objectContaining({ nx: true }))
    expect(mockRedeploy).toHaveBeenCalledTimes(2)
    expect(mockRedeploy).toHaveBeenCalledWith('w1')
    expect(mockRedeploy).toHaveBeenCalledWith('w2')
  })

  it('detect_only (default): the fan-out still runs, but the gate blocks every heal', async () => {
    // ENV_RECONCILE_MODE unset → detect_only.
    const res = await addKey()
    expect((await parseResponse(res)).status).toBe(201)
    expect(mockAfter).toHaveBeenCalledTimes(1)

    await runAfterCallback()

    // The fan-out reached healWorkspace for the user's workspaces...
    expect(prismaMock.workspace.findMany).toHaveBeenCalled()
    // ...but the shared gate short-circuits inside healWorkspace: no acquire, no redeploy.
    expect(mockRedisSet).not.toHaveBeenCalled()
    expect(mockRedeploy).not.toHaveBeenCalled()
  })
})

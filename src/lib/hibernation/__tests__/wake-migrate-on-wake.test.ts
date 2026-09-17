// Fly cutover: existing RAILWAY claws migrate on NATURAL WAKE when
// MIGRATE_ON_WAKE_TO=FLY - old service recycled into the pool, workspace
// stamped FLY, wake fresh-provisions (forbidCreate lifted for the migration
// wake only). Flag off -> wake is byte-identical to before (regression).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockDeployToCloud = vi.fn()
const mockSyncThenRemoveDeployment = vi.fn()
vi.mock("@/lib/openclaw/deployer", async () => {
  const actual = await vi.importActual<typeof import("@/lib/openclaw/deployer")>(
    "@/lib/openclaw/deployer",
  )
  return {
    ...actual,
    deployToCloud: (...args: unknown[]) => mockDeployToCloud(...args),
    syncThenRemoveDeployment: (...args: unknown[]) => mockSyncThenRemoveDeployment(...args),
  }
})

const mockRecycleServiceIntoPool = vi.fn()
vi.mock("@/lib/railway/service-pool", async () => {
  const actual = await vi.importActual<typeof import("@/lib/railway/service-pool")>(
    "@/lib/railway/service-pool",
  )
  return {
    ...actual,
    recycleServiceIntoPool: (...args: unknown[]) => mockRecycleServiceIntoPool(...args),
  }
})

const mockIsFlyConfigured = vi.fn()
vi.mock("@/lib/fly/machines-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/fly/machines-client")>(
    "@/lib/fly/machines-client",
  )
  return {
    ...actual,
    isFlyConfigured: () => mockIsFlyConfigured(),
  }
})

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { wakeWorkspace } from "@/lib/hibernation/manager"

type MockFn = ReturnType<typeof vi.fn>

function hibernatedWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: "ws-1",
    status: "HIBERNATED",
    provider: "RAILWAY",
    containerId: "svc-old",
    containerName: "claw-ws-1",
    containerHost: "claw-ws-1.up.railway.app",
    containerState: {
      nextHeartbeatAt: null,
      heartbeatCronExpressions: null,
      heartbeatInterval: null,
      runtimeStateSnapshot: null,
      avgWakeDurationMs: null,
    },
    user: {
      trialUsed: false,
      trialStartedAt: null,
      trialEndsAt: null,
      hasActiveSubscription: true,
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.MIGRATE_ON_WAKE_TO
  mockIsFlyConfigured.mockReturnValue(true)
  mockDeployToCloud.mockResolvedValue({
    deploymentId: "dep-1",
    containerId: "mach-1",
    gatewayToken: "gw",
  })
  mockRecycleServiceIntoPool.mockResolvedValue({ outcome: "recycled" })
  ;(prismaMock.workspace.findUnique as MockFn).mockResolvedValue(hibernatedWorkspace())
  ;(prismaMock.workspace.update as MockFn).mockResolvedValue({})
  ;(prismaMock.containerState.update as MockFn).mockResolvedValue({})
  ;(prismaMock.containerState.findUnique as MockFn).mockResolvedValue({
    heartbeatCronExpressions: null,
    heartbeatInterval: null,
    avgWakeDurationMs: null,
  })
  ;(prismaMock.$transaction as MockFn).mockImplementation(
    async (ops: unknown) => (Array.isArray(ops) ? Promise.all(ops) : ops),
  )
})

afterEach(() => {
  delete process.env.MIGRATE_ON_WAKE_TO
})

describe("wakeWorkspace + MIGRATE_ON_WAKE_TO", () => {
  it("flag off: wake keeps forbidCreate and never touches provider or pool (regression)", async () => {
    await wakeWorkspace("ws-1")

    expect(mockDeployToCloud).toHaveBeenCalledWith("ws-1", {
      forbidCreate: true,
      preserveHibernationOnFailure: true,
    })
    expect(mockRecycleServiceIntoPool).not.toHaveBeenCalled()
    expect(prismaMock.workspace.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ provider: "FLY" }) }),
    )
  })

  it("flag=FLY: recycles the Railway service to the pool, stamps FLY + detaches, wakes with create allowed", async () => {
    process.env.MIGRATE_ON_WAKE_TO = "FLY"

    await wakeWorkspace("ws-1")

    expect(mockRecycleServiceIntoPool).toHaveBeenCalledWith({
      serviceId: "svc-old",
      workspaceId: "ws-1",
    })
    expect(prismaMock.workspace.update).toHaveBeenCalledWith({
      where: { id: "ws-1" },
      data: {
        provider: "FLY",
        containerId: null,
        containerName: null,
        containerHost: null,
      },
    })
    expect(mockDeployToCloud).toHaveBeenCalledWith("ws-1", {
      forbidCreate: false,
      preserveHibernationOnFailure: true,
    })
  })

  it("flag=FLY but workspace already FLY: normal wake, no re-migration", async () => {
    process.env.MIGRATE_ON_WAKE_TO = "FLY"
    ;(prismaMock.workspace.findUnique as MockFn).mockResolvedValue(
      hibernatedWorkspace({ provider: "FLY", containerId: "mach-1", containerName: "claw-ws-1" }),
    )

    await wakeWorkspace("ws-1")

    expect(mockRecycleServiceIntoPool).not.toHaveBeenCalled()
    expect(mockDeployToCloud).toHaveBeenCalledWith("ws-1", {
      forbidCreate: true,
      preserveHibernationOnFailure: true,
    })
  })

  it("flag=FLY but Fly unconfigured: stays on Railway (no half-migration)", async () => {
    process.env.MIGRATE_ON_WAKE_TO = "FLY"
    mockIsFlyConfigured.mockReturnValue(false)

    await wakeWorkspace("ws-1")

    expect(mockRecycleServiceIntoPool).not.toHaveBeenCalled()
    expect(mockDeployToCloud).toHaveBeenCalledWith("ws-1", {
      forbidCreate: true,
      preserveHibernationOnFailure: true,
    })
  })
})

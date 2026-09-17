// destroyContainer: terminal teardown now RECYCLES the service into the pool
// (env wiped + volumes destroyed + domain kept) instead of serviceDelete.
// Legacy delete semantics stay reachable behind SERVICE_POOL_ENABLED=false.
// Real service-pool logic runs against prismaMock; railway-client is mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockDeleteService = vi.fn()
const mockIsRailwayConfigured = vi.fn()
const mockRenameService = vi.fn()
const mockRemoveLatestDeployment = vi.fn()
const mockUpdateServiceVariables = vi.fn()
const mockListServiceVolumeIds = vi.fn()
const mockDeleteVolume = vi.fn()
vi.mock("@/lib/openclaw/railway-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/openclaw/railway-client")>(
    "@/lib/openclaw/railway-client",
  )
  return {
    ...actual,
    deleteService: (...args: unknown[]) => mockDeleteService(...args),
    isRailwayConfigured: () => mockIsRailwayConfigured(),
    renameService: (...args: unknown[]) => mockRenameService(...args),
    removeLatestDeployment: (...args: unknown[]) => mockRemoveLatestDeployment(...args),
    updateServiceVariables: (...args: unknown[]) => mockUpdateServiceVariables(...args),
    listServiceVolumeIds: (...args: unknown[]) => mockListServiceVolumeIds(...args),
    deleteVolume: (...args: unknown[]) => mockDeleteVolume(...args),
  }
})

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { destroyContainer } from "@/lib/openclaw/deployer"
import { POOL_WIPE_MARKER } from "@/lib/railway/service-pool"

type MockFn = ReturnType<typeof vi.fn>

// prisma.$transaction accepts an array and resolves with each op's result.
function stubTransactionToInvokeOps() {
  ;(prismaMock.$transaction as MockFn).mockImplementation(async (ops: unknown) => {
    if (Array.isArray(ops)) {
      return Promise.all(ops as Promise<unknown>[])
    }
    return undefined
  })
}

function stubPoolRecycleHappyPath() {
  ;(prismaMock.servicePool.upsert as MockFn).mockResolvedValue({
    id: "pe-1",
    serviceId: "svc-abc",
    state: "RECYCLING",
    workspaceId: "ws-1",
  })
  ;(prismaMock.servicePool.update as MockFn).mockResolvedValue({})
  ;(prismaMock.servicePool.delete as MockFn).mockResolvedValue({})
}

describe("destroyContainer", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.SERVICE_POOL_ENABLED
    mockDeleteService.mockResolvedValue(undefined)
    mockIsRailwayConfigured.mockReturnValue(true)
    mockRenameService.mockResolvedValue(undefined)
    mockRemoveLatestDeployment.mockResolvedValue(null)
    mockUpdateServiceVariables.mockResolvedValue(undefined)
    mockListServiceVolumeIds.mockResolvedValue([])
    mockDeleteVolume.mockResolvedValue(undefined)
    ;(prismaMock.containerState.updateMany as MockFn).mockResolvedValue({ count: 1 })
    ;(prismaMock.workspace.update as MockFn).mockResolvedValue({})
    stubPoolRecycleHappyPath()
    stubTransactionToInvokeOps()
  })

  afterEach(() => {
    delete process.env.SERVICE_POOL_ENABLED
  })

  it("sets workspace.status to STOPPED AND containerState.containerPhase to STOPPED", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as MockFn).mockResolvedValue({
      id: "ws-1",
      containerId: "svc-abc",
      containerHost: "claw-ws-1.up.railway.app",
    })

    await destroyContainer("ws-1")

    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ws-1" },
        data: expect.objectContaining({
          status: "STOPPED",
          containerId: null,
          containerName: null,
          containerHost: null,
          hostPort: null,
          healthStatus: "UNKNOWN",
        }),
      }),
    )
    expect(prismaMock.containerState.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1" },
      data: { containerPhase: "STOPPED" },
    })
    expect(prismaMock.$transaction).toHaveBeenCalledOnce()
  })

  it("RECYCLES into the pool: deployment removed + env wiped + renamed pool-*; serviceDelete NEVER called (service kept)", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as MockFn).mockResolvedValue({
      id: "ws-1",
      containerId: "svc-abc",
      containerHost: "claw-ws-1.up.railway.app",
    })

    await destroyContainer("ws-1")

    expect(mockDeleteService).not.toHaveBeenCalled()
    expect(mockRemoveLatestDeployment).toHaveBeenCalledWith("svc-abc")
    expect(mockUpdateServiceVariables).toHaveBeenCalledWith("svc-abc", POOL_WIPE_MARKER)
    expect(mockRenameService).toHaveBeenCalledWith("svc-abc", expect.stringMatching(/^pool-/))
    // Row returned to READY inventory.
    expect(prismaMock.servicePool.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: "READY", workspaceId: null }),
      }),
    )
  })

  it("recycle deferred (wipe step fails) -> workspace STILL fully detached; pool row owns the retry", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as MockFn).mockResolvedValue({
      id: "ws-1",
      containerId: "svc-abc",
      containerHost: "claw-ws-1.up.railway.app",
    })
    mockUpdateServiceVariables.mockRejectedValue(new Error("Railway API 503"))

    await destroyContainer("ws-1")

    // Detached regardless: the pool state machine owns the service now.
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "STOPPED",
          containerId: null,
          containerHost: null,
        }),
      }),
    )
    // Never flipped READY with tenant env still on it.
    const updates = (prismaMock.servicePool.update as MockFn).mock.calls
    expect(
      updates.some((c) => (c[0] as { data?: { state?: string } }).data?.state === "READY"),
    ).toBe(false)
  })

  it("skips Railway teardown when containerId is null (already destroyed)", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as MockFn).mockResolvedValue({
      id: "ws-1",
      containerId: null,
    })

    await destroyContainer("ws-1")

    expect(mockDeleteService).not.toHaveBeenCalled()
    expect(mockRemoveLatestDeployment).not.toHaveBeenCalled()
    expect(prismaMock.workspace.update).toHaveBeenCalled()
    expect(prismaMock.containerState.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1" },
      data: { containerPhase: "STOPPED" },
    })
  })

  it("does not throw when ContainerState row does not exist (never-deployed workspace)", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as MockFn).mockResolvedValue({
      id: "ws-never-deployed",
      containerId: null,
    })
    ;(prismaMock.containerState.updateMany as MockFn).mockResolvedValue({ count: 0 })

    await expect(destroyContainer("ws-never-deployed")).resolves.toBeUndefined()
    expect(prismaMock.containerState.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-never-deployed" },
      data: { containerPhase: "STOPPED" },
    })
  })

  describe("SERVICE_POOL_ENABLED=false (legacy delete)", () => {
    beforeEach(() => {
      process.env.SERVICE_POOL_ENABLED = "false"
    })

    it("calls Railway deleteService when configured and containerId is set (route removed from pool)", async () => {
      ;(prismaMock.workspace.findUniqueOrThrow as MockFn).mockResolvedValue({
        id: "ws-1",
        containerId: "svc-abc",
      })

      await destroyContainer("ws-1")

      expect(mockDeleteService).toHaveBeenCalledWith("svc-abc")
      expect(mockRemoveLatestDeployment).not.toHaveBeenCalled()
    })

    it("swallows deleteService not-found and still detaches (idempotent against prior delete)", async () => {
      ;(prismaMock.workspace.findUniqueOrThrow as MockFn).mockResolvedValue({
        id: "ws-1",
        containerId: "svc-abc",
        containerHost: "claw-ws-1.up.railway.app",
      })
      mockDeleteService.mockRejectedValueOnce(new Error("Service not found"))

      await expect(destroyContainer("ws-1")).resolves.toBeUndefined()
      expect(prismaMock.workspace.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ containerId: null, containerHost: null }),
        }),
      )
    })

    it("keeps containerHost (and containerId) when delete fails and service may survive", async () => {
      ;(prismaMock.workspace.findUniqueOrThrow as MockFn).mockResolvedValue({
        id: "ws-1",
        containerId: "svc-alive",
        containerName: "claw-ws-1",
        containerHost: "claw-ws-1.up.railway.app",
      })
      mockDeleteService.mockRejectedValueOnce(new Error("Railway API 503 unavailable"))

      await destroyContainer("ws-1")

      expect(prismaMock.workspace.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "STOPPED",
            containerId: "svc-alive",
            containerName: "claw-ws-1",
            containerHost: "claw-ws-1.up.railway.app",
          }),
        }),
      )
    })
  })
})

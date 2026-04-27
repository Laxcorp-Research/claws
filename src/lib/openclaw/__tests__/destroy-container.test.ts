import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockDeleteService = vi.fn()
const mockIsRailwayConfigured = vi.fn()
vi.mock("@/lib/openclaw/railway-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/openclaw/railway-client")>(
    "@/lib/openclaw/railway-client",
  )
  return {
    ...actual,
    deleteService: (...args: unknown[]) => mockDeleteService(...args),
    isRailwayConfigured: () => mockIsRailwayConfigured(),
  }
})

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { destroyContainer } from "@/lib/openclaw/deployer"

// prisma.$transaction accepts an array and resolves with each op's result.
// The real mock from vitest-mock-extended returns undefined by default,
// which is fine for our assertions (we only care that the two update
// calls were passed in). Stub it to actually invoke each inner promise
// so containerState.updateMany / workspace.update spies register their
// call arguments.
function stubTransactionToInvokeOps() {
  ;(prismaMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (ops: unknown) => {
    if (Array.isArray(ops)) {
      return Promise.all(ops as Promise<unknown>[])
    }
    return undefined
  })
}

describe("destroyContainer", () => {
  beforeEach(() => {
    mockDeleteService.mockReset()
    mockDeleteService.mockResolvedValue(undefined)
    mockIsRailwayConfigured.mockReset()
    mockIsRailwayConfigured.mockReturnValue(true)
    ;(prismaMock.containerState.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 })
    stubTransactionToInvokeOps()
  })

  it("sets workspace.status to STOPPED AND containerState.containerPhase to STOPPED", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ws-1",
      containerId: "svc-abc",
      containerHost: "claw-ws-1.up.railway.app",
    })
    ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({})

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

  it("calls Railway deleteService when configured and containerId is set", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ws-1",
      containerId: "svc-abc",
    })
    ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({})

    await destroyContainer("ws-1")

    expect(mockDeleteService).toHaveBeenCalledWith("svc-abc")
  })

  it("skips Railway deleteService when containerId is null (already destroyed)", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ws-1",
      containerId: null,
    })
    ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({})

    await destroyContainer("ws-1")

    expect(mockDeleteService).not.toHaveBeenCalled()
    // DB row still gets updated to STOPPED so we reach a consistent state,
    // and ContainerState.containerPhase is converged too.
    expect(prismaMock.workspace.update).toHaveBeenCalled()
    expect(prismaMock.containerState.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1" },
      data: { containerPhase: "STOPPED" },
    })
  })

  it("swallows Railway deleteService errors and still updates DB (idempotent against prior delete)", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ws-1",
      containerId: "svc-abc",
    })
    ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
    mockDeleteService.mockRejectedValueOnce(new Error("Service not found"))

    await expect(destroyContainer("ws-1")).resolves.toBeUndefined()
    expect(prismaMock.workspace.update).toHaveBeenCalled()
    expect(prismaMock.containerState.updateMany).toHaveBeenCalled()
  })

  it("does not throw when ContainerState row does not exist (never-deployed workspace)", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ws-never-deployed",
      containerId: null,
    })
    ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
    // updateMany returning count: 0 simulates "no ContainerState row matched"
    ;(prismaMock.containerState.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 })

    await expect(destroyContainer("ws-never-deployed")).resolves.toBeUndefined()
    expect(prismaMock.containerState.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-never-deployed" },
      data: { containerPhase: "STOPPED" },
    })
  })
})

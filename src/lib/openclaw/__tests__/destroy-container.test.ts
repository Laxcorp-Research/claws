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

describe("destroyContainer", () => {
  beforeEach(() => {
    mockDeleteService.mockReset()
    mockDeleteService.mockResolvedValue(undefined)
    mockIsRailwayConfigured.mockReset()
    mockIsRailwayConfigured.mockReturnValue(true)
  })

  it("sets workspace.status to STOPPED (not PAUSED)", async () => {
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
    // But DB row still gets updated to STOPPED so we reach a consistent state.
    expect(prismaMock.workspace.update).toHaveBeenCalled()
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
  })
})

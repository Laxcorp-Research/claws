import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { readFileSync } from "node:fs"
import { join } from "node:path"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockSyncThenDestroy = vi.fn()
vi.mock("@/lib/openclaw/deployer", () => ({
  syncThenRemoveDeployment: (...args: unknown[]) => mockSyncThenDestroy(...args),
  deployToCloud: vi.fn(),
}))

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const mockSendOwnerAlert = vi.hoisted(() => vi.fn())
vi.mock("@/lib/alerts/owner-alert", () => ({
  sendOwnerAlert: (...args: unknown[]) => mockSendOwnerAlert(...args),
}))

import { hibernateWorkspace } from "@/lib/hibernation/manager"
import {
  HIBERNATION_REFUSED_ACTION,
  isRuntimeStateStale,
  staleDestroyMaxAgeMs,
} from "@/lib/hibernation/stale-destroy"

describe("staleDestroyMaxAgeMs / isRuntimeStateStale", () => {
  it("defaults to 30 minutes", () => {
    delete process.env.STALE_DESTROY_MAX_AGE_MIN
    expect(staleDestroyMaxAgeMs()).toBe(30 * 60 * 1000)
  })

  it("treats null updatedAt as stale", () => {
    expect(isRuntimeStateStale(null)).toBe(true)
  })

  it("25m old is fresh under default 30m; 35m is stale", () => {
    const now = Date.now()
    expect(isRuntimeStateStale(new Date(now - 25 * 60 * 1000), now)).toBe(false)
    expect(isRuntimeStateStale(new Date(now - 35 * 60 * 1000), now)).toBe(true)
  })
})

describe("hibernateWorkspace - P3 refuse path", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ws-1",
      containerId: "svc-1",
      containerState: {
        runtimeStateUpdatedAt: new Date(),
        runtimeStateSnapshot: null,
        heartbeatInterval: null,
        heartbeatCronExpressions: null,
      },
    } as never)
    ;(prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({} as never)
    ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({} as never)
  })

  it("sync-fail → container kept + ERROR ActivityLog + hibernationRefusedAt", async () => {
    mockSyncThenDestroy.mockResolvedValue({
      destroyed: false,
      refused: true,
      reason: "sync-failed:timeout",
    })
    mockSendOwnerAlert.mockResolvedValue({ sent: false, channel: "skipped" })

    const result = await hibernateWorkspace("ws-1")

    expect(result).toEqual({
      hibernated: false,
      refused: true,
      reason: "sync-failed:timeout",
    })
    expect(mockSyncThenDestroy).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({ destroyPolicy: "refuse-unsafe" }),
    )
    expect(prismaMock.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: HIBERNATION_REFUSED_ACTION,
          actionType: "ERROR",
        }),
      }),
    )
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ hibernationRefusedAt: expect.any(Date) }),
      }),
    )
    expect(mockSendOwnerAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKey: "hibernation-refuse-unsafe",
        workspaceId: "ws-1",
      }),
    )
  })

  it("MUTATION: hibernate must pass refuse-unsafe (destroy-anyway restored → fail)", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/hibernation/manager.ts"), "utf8")
    expect(src).toContain('destroyPolicy: "refuse-unsafe"')
    expect(src).toContain("syncThenRemoveDeployment")
    expect(src).not.toMatch(/await syncThenDestroy\(/)
  })

  it("successful hibernate marks prior COMPLETED deployments SUPERSEDED", async () => {
    mockSyncThenDestroy.mockResolvedValue({ destroyed: true })
    ;(prismaMock.$transaction as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(prismaMock.deployment.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 3 })
    ;(prismaMock.agent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    const result = await hibernateWorkspace("ws-1")
    expect(result).toEqual({ hibernated: true })
    expect(prismaMock.deployment.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", status: "COMPLETED" },
      data: { status: "SUPERSEDED" },
    })
    expect(prismaMock.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "Workspace hibernated",
          metadata: expect.stringContaining("hibernation_complete"),
        }),
      }),
    )
  })
})

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

describe("hibernateWorkspace - P3 refuse path + escalation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ws-1",
      containerId: "svc-1",
      hibernationRefusedAt: null,
      containerState: {
        runtimeStateUpdatedAt: new Date(),
        runtimeStateSnapshot: null,
        heartbeatInterval: null,
        heartbeatCronExpressions: null,
      },
    } as never)
    ;(prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({} as never)
    ;(prismaMock.activityLog.count as ReturnType<typeof vi.fn>).mockResolvedValue(0)
    ;(prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({} as never)
  })

  function refusedRow() {
    const calls = (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mock.calls
    return calls
      .map((c) => c[0].data)
      .find((d) => d.action === HIBERNATION_REFUSED_ACTION)
  }

  it("first sync-fail: silent retry - SYSTEM row, hibernationRefusedAt set, NO owner page", async () => {
    mockSyncThenDestroy.mockResolvedValue({
      destroyed: false,
      refused: true,
      reason: "sync-failed:timeout",
    })

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
    const row = refusedRow()
    expect(row?.actionType).toBe("SYSTEM")
    expect(row?.metadata).toContain('"attempt":1')
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ hibernationRefusedAt: expect.any(Date) }),
      }),
    )
    expect(mockSendOwnerAlert).not.toHaveBeenCalled()
  })

  it("third sync-fail (exhaust): ERROR row + ONE owner page + alert-pushed ledger", async () => {
    mockSyncThenDestroy.mockResolvedValue({
      destroyed: false,
      refused: true,
      reason: "sync-failed:timeout",
    })
    ;(prismaMock.activityLog.count as ReturnType<typeof vi.fn>).mockResolvedValue(2)
    mockSendOwnerAlert.mockResolvedValue({ sent: true, channel: "telegram" })

    await hibernateWorkspace("ws-1")

    const row = refusedRow()
    expect(row?.actionType).toBe("ERROR")
    expect(row?.metadata).toContain('"attempt":3')
    expect(mockSendOwnerAlert).toHaveBeenCalledTimes(1)
    expect(mockSendOwnerAlert).toHaveBeenCalledWith(
      expect.objectContaining({ alertKey: "hibernation-refuse-unsafe", workspaceId: "ws-1" }),
    )
    const pushed = (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0].data)
      .find((d) => String(d.metadata).includes("hibernation_refusal_alert_pushed"))
    expect(pushed).toBeTruthy()
  })

  it("MUTATION: per-tick alert restored -> fails (fourth fail inside 12h dedup stays silent)", async () => {
    mockSyncThenDestroy.mockResolvedValue({
      destroyed: false,
      refused: true,
      reason: "sync-failed:timeout",
    })
    ;(prismaMock.activityLog.count as ReturnType<typeof vi.fn>).mockResolvedValue(3)
    ;(prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      timestamp: new Date(Date.now() - 60_000),
    })

    await hibernateWorkspace("ws-1")

    const row = refusedRow()
    expect(row?.actionType).toBe("SYSTEM")
    expect(mockSendOwnerAlert).not.toHaveBeenCalled()
  })

  it("backoff window: attempt skipped entirely (no sync call, no ledger)", async () => {
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ws-1",
      containerId: "svc-1",
      hibernationRefusedAt: new Date(Date.now() - 30_000),
      containerState: {
        runtimeStateUpdatedAt: new Date(),
        runtimeStateSnapshot: null,
        heartbeatInterval: null,
        heartbeatCronExpressions: null,
      },
    } as never)
    ;(prismaMock.activityLog.count as ReturnType<typeof vi.fn>).mockResolvedValue(1)

    const result = await hibernateWorkspace("ws-1")

    expect(result).toEqual({ hibernated: false, refused: true, reason: "refusal-backoff" })
    expect(mockSyncThenDestroy).not.toHaveBeenCalled()
    expect(prismaMock.activityLog.create).not.toHaveBeenCalled()
    expect(mockSendOwnerAlert).not.toHaveBeenCalled()
  })

  it("resolve-message: success after a paged episode sends back-to-normal ONCE", async () => {
    mockSyncThenDestroy.mockResolvedValue({ destroyed: true })
    ;(prismaMock.$transaction as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(prismaMock.deployment.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 })
    ;(prismaMock.agent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    // Alert-pushed row exists; no resolve row since.
    ;(prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ timestamp: new Date(Date.now() - 10 * 60_000) })
      .mockResolvedValueOnce(null)
    mockSendOwnerAlert.mockResolvedValue({ sent: true, channel: "telegram" })

    const result = await hibernateWorkspace("ws-1")
    expect(result).toEqual({ hibernated: true })
    expect(mockSendOwnerAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKey: "hibernation-refuse-unsafe",
        title: expect.stringContaining("back to normal"),
      }),
    )
    const resolved = (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0].data)
      .find((d) => String(d.metadata).includes("hibernation_refusal_resolved"))
    expect(resolved).toBeTruthy()
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

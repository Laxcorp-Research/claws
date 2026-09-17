import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockDeploy = vi.fn()
vi.mock("@/lib/openclaw/deployer", () => ({
  deployToCloud: (...args: unknown[]) => mockDeploy(...args),
  syncThenRemoveDeployment: vi.fn(),
  getGatewayConnectionInfo: vi.fn(),
}))
vi.mock("@/lib/healing/mission-resume", () => ({
  maybeResumeInterruptedMission: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/openclaw/chat-send-hold", () => ({
  flushHeldChatSends: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/alerts/customer-nudge", () => ({
  sendCustomerNudge: vi.fn().mockResolvedValue({ sent: false, channel: "skipped" }),
}))

import { wakeWorkspace, WAKEABLE_WORKSPACE_STATUSES } from "@/lib/hibernation/manager"

const WS = "ws-late-wake"
const cron = JSON.stringify([
  { schedule: { kind: "cron", expr: "0 12,16,20 * * *", tz: "UTC" } },
])

const ACTIVE_OWNER = {
  trialUsed: true,
  trialStartedAt: new Date("2026-07-01T00:00:00.000Z"),
  trialEndsAt: new Date("2099-01-01T00:00:00.000Z"),
  hasActiveSubscription: false,
}

describe("wakeWorkspace - late-wake semantics (P2.3)", () => {
  beforeEach(() => {
    mockDeploy.mockReset()
    mockDeploy.mockResolvedValue({
      deploymentId: "dep-1",
      containerId: "svc-1",
      gatewayToken: "t",
    })
    ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({} as never)
    ;(prismaMock.containerState.update as ReturnType<typeof vi.fn>).mockResolvedValue(
      {} as never,
    )
    ;(prismaMock.containerState.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 1,
    } as never)
    ;(prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({} as never)
    ;(prismaMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (ops: Promise<unknown>[]) => Promise.all(ops),
    )
  })

  it("past-due hint → sets heartbeatMissedAt and rolls nextHeartbeatAt forward", async () => {
    const pastHint = new Date("2026-07-20T12:00:00.000Z")
    // Wake at 12:10 → next of 12/16/20 from that anchor is 16:00Z
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-20T12:10:00.000Z"))

    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: WS,
      status: "HIBERNATED",
      user: ACTIVE_OWNER,
      containerState: {
        nextHeartbeatAt: pastHint,
        heartbeatCronExpressions: cron,
        heartbeatInterval: null,
        avgWakeDurationMs: 44_448,
        runtimeStateSnapshot: null,
      },
    })
    ;(prismaMock.containerState.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      heartbeatCronExpressions: cron,
      heartbeatInterval: null,
      avgWakeDurationMs: 44_448,
    })

    await wakeWorkspace(WS)

    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: WS },
        data: { heartbeatMissedAt: new Date("2026-07-20T12:10:00.000Z") },
      }),
    )
    expect(prismaMock.containerState.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: WS },
        data: expect.objectContaining({
          nextHeartbeatAt: new Date("2026-07-20T16:00:00.000Z"),
        }),
      }),
    )
    expect(prismaMock.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actionType: "ERROR",
          action: "Heartbeat missed",
          metadata: expect.stringContaining("heartbeat_late_wake"),
        }),
      }),
    )
    expect(mockDeploy).toHaveBeenCalledWith(WS, {
      forbidCreate: true,
      preserveHibernationOnFailure: true,
    })

    vi.useRealTimers()
  })

  it("MUTATION: create-on-wake restored → fail (must pass forbidCreate)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/hibernation/manager.ts"),
      "utf8",
    )
    // Fly cutover: a normal wake still NEVER creates. The ONLY exception is
    // an armed migrate-on-wake (migration.migrated), whose detach lives in
    // src/lib/fly/migrate-on-wake.ts. A bare `forbidCreate: false` (or a
    // dropped option) restores create-on-wake and must fail here.
    expect(src).toContain("forbidCreate: !migration.migrated")
    expect(src).not.toContain("forbidCreate: false")
    expect(src).toContain("preserveHibernationOnFailure: true")
    expect(src).toContain("WAKEABLE_WORKSPACE_STATUSES")
    expect(src).not.toMatch(/await deployToCloud\(workspaceId\)\s*$/m)
  })

  it("MUTATION: no roll on late wake → stranded (hint stays past-due)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/hibernation/manager.ts"),
      "utf8",
    )
    expect(src).toContain("computeNextHeartbeatAt")
    expect(src).toContain("heartbeatMissedAt")
    expect(src).toContain("isPastDueHint")
    expect(src).toContain("rolledHint")
    expect(src).toContain("heartbeat_late_wake")
  })

  it("future hint → does not set miss or roll", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-20T15:56:00.000Z"))

    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: WS,
      status: "HIBERNATED",
      user: ACTIVE_OWNER,
      containerState: {
        nextHeartbeatAt: new Date("2026-07-20T16:00:00.000Z"),
        heartbeatCronExpressions: cron,
        heartbeatInterval: null,
        avgWakeDurationMs: 44_448,
        runtimeStateSnapshot: null,
      },
    })
    ;(prismaMock.containerState.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      heartbeatCronExpressions: cron,
      heartbeatInterval: null,
      avgWakeDurationMs: 44_448,
    })

    await wakeWorkspace(WS)

    const workspaceUpdates = (
      prismaMock.workspace.update as ReturnType<typeof vi.fn>
    ).mock.calls.map((c) => c[0] as { data?: Record<string, unknown> })
    expect(
      workspaceUpdates.some((u) => u.data && "heartbeatMissedAt" in u.data),
    ).toBe(false)

    const stateUpdates = (
      prismaMock.containerState.update as ReturnType<typeof vi.fn>
    ).mock.calls.map((c) => c[0] as { data?: Record<string, unknown> })
    const successState = stateUpdates.find(
      (u) => u.data && "lastWakeDurationMs" in (u.data ?? {}),
    )
    expect(successState?.data).not.toHaveProperty("nextHeartbeatAt")

    vi.useRealTimers()
  })

  it("expired trial → STOPPED terminalize, no deployToCloud", async () => {
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: WS,
      status: "HIBERNATED",
      user: {
        ...ACTIVE_OWNER,
        trialEndsAt: new Date("2020-01-01T00:00:00.000Z"),
      },
      containerState: {
        nextHeartbeatAt: new Date("2026-07-20T16:00:00.000Z"),
        heartbeatCronExpressions: cron,
        heartbeatInterval: null,
        avgWakeDurationMs: 44_448,
        runtimeStateSnapshot: null,
      },
    })

    await wakeWorkspace(WS)

    expect(mockDeploy).not.toHaveBeenCalled()
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: WS },
        data: { status: "STOPPED" },
      }),
    )
  })

  it("ERROR status is wakeable (failed wake stays in scheduler)", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-20T12:10:00.000Z"))
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: WS,
      status: "ERROR",
      user: ACTIVE_OWNER,
      containerState: {
        nextHeartbeatAt: new Date("2026-07-20T12:00:00.000Z"),
        heartbeatCronExpressions: cron,
        heartbeatInterval: null,
        avgWakeDurationMs: 44_448,
        runtimeStateSnapshot: null,
      },
    })
    ;(prismaMock.containerState.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      heartbeatCronExpressions: cron,
      heartbeatInterval: null,
      avgWakeDurationMs: 44_448,
    })

    await wakeWorkspace(WS)
    expect(mockDeploy).toHaveBeenCalled()
    expect(WAKEABLE_WORKSPACE_STATUSES).toContain("ERROR")
    vi.useRealTimers()
  })

  it("wake deploy failure restores HIBERNATED and rethrows", async () => {
    mockDeploy.mockRejectedValue(new Error("domain cap"))
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: WS,
      status: "HIBERNATED",
      user: ACTIVE_OWNER,
      containerState: {
        nextHeartbeatAt: new Date("2026-07-20T16:00:00.000Z"),
        heartbeatCronExpressions: cron,
        heartbeatInterval: null,
        avgWakeDurationMs: 44_448,
        runtimeStateSnapshot: null,
      },
    })

    await expect(wakeWorkspace(WS)).rejects.toThrow("domain cap")
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "HIBERNATED" },
      }),
    )
  })
})

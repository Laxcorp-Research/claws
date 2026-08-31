import { describe, expect, it, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const mockTrySyncNow = vi.hoisted(() => vi.fn())
vi.mock("@/lib/openclaw/sync-now", () => ({
  DEFAULT_SYNC_TIMEOUT_MS: 18_000,
  trySyncNow: (...args: unknown[]) => mockTrySyncNow(...args),
}))

const mockLedger = vi.hoisted(() => vi.fn())
vi.mock("@/lib/healing/ledger", () => ({
  ledgerHealAttempt: (...args: unknown[]) => mockLedger(...args),
}))

import {
  clearParkedStaleSyncFlags,
  decideStaleSyncHeal,
  healRunningStaleSync,
  isParkedForStaleSync,
} from "@/lib/healing/stale-sync"

describe("decideStaleSyncHeal", () => {
  it("parked + flag → silent clear", () => {
    expect(decideStaleSyncHeal({ parked: true, flagSet: true, consecutive: 4, retries: 3 }))
      .toEqual({ action: "clear" })
  })

  it("running retries before alert; exhaust at 2+retries", () => {
    expect(decideStaleSyncHeal({ parked: false, flagSet: true, consecutive: 2, retries: 3 }))
      .toEqual({ action: "retry" })
    expect(decideStaleSyncHeal({ parked: false, flagSet: true, consecutive: 4, retries: 3 }))
      .toEqual({ action: "retry" })
    expect(decideStaleSyncHeal({ parked: false, flagSet: true, consecutive: 5, retries: 3 }))
      .toEqual({ action: "alert" })
  })

  it("no flag → noop", () => {
    expect(decideStaleSyncHeal({ parked: false, flagSet: false, consecutive: 1, retries: 3 }))
      .toEqual({ action: "noop" })
  })
})

describe("isParkedForStaleSync", () => {
  it("hibernated / queued / stopped are parked; running is not", () => {
    expect(isParkedForStaleSync("HIBERNATED")).toBe(true)
    expect(isParkedForStaleSync("PROVISIONING_QUEUED")).toBe(true)
    expect(isParkedForStaleSync("STOPPED")).toBe(true)
    expect(isParkedForStaleSync("RUNNING")).toBe(false)
  })
})

describe("clearParkedStaleSyncFlags", () => {
  beforeEach(() => {
    mockLedger.mockReset()
    mockLedger.mockResolvedValue(undefined)
  })

  it("MUTATION: filters by returned row status (RUNNING rows must not clear)", async () => {
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "ws-run", status: "RUNNING" },
      { id: "ws-hib", status: "HIBERNATED" },
    ])
    ;(prismaMock.workspace.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 })

    const n = await clearParkedStaleSyncFlags()
    expect(n).toBe(1)
    expect(prismaMock.workspace.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["ws-hib"] } },
      data: { stateSyncStaleDetectedAt: null, stateSyncStaleConsecutive: 0 },
    })
    expect(mockLedger).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-hib", condition: "state-sync-stale", outcome: "cleared" }),
    )
    expect(mockLedger).not.toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-run" }),
    )
  })
})

describe("healRunningStaleSync", () => {
  beforeEach(() => {
    mockLedger.mockReset()
    mockLedger.mockResolvedValue(undefined)
    mockTrySyncNow.mockReset()
  })

  it("trySyncNow success → healed + cleared, no alert", async () => {
    mockTrySyncNow.mockResolvedValue({ synced: true })
    const result = await healRunningStaleSync({
      workspaceId: "ws-1",
      containerHost: "claw.up.railway.app",
      consecutive: 2,
    })
    expect(result).toEqual({ cleared: true, alert: false, synced: true })
    expect(mockLedger).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "healed" }),
    )
  })

  it("trySyncNow fail before exhaust → failed, no alert", async () => {
    mockTrySyncNow.mockResolvedValue({ synced: false, reason: "timeout" })
    const result = await healRunningStaleSync({
      workspaceId: "ws-1",
      containerHost: "claw.up.railway.app",
      consecutive: 3,
    })
    expect(result).toEqual({ cleared: false, alert: false, synced: false })
    expect(mockLedger).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failed", detail: "timeout" }),
    )
  })

  it("retries exhausted → alert, no further sync", async () => {
    const result = await healRunningStaleSync({
      workspaceId: "ws-1",
      containerHost: "claw.up.railway.app",
      consecutive: 5,
    })
    expect(result.alert).toBe(true)
    expect(mockTrySyncNow).not.toHaveBeenCalled()
    expect(mockLedger).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "exhausted" }),
    )
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockOwnerAlert = vi.fn()
vi.mock("@/lib/alerts/owner-alert", () => ({
  sendOwnerAlert: (...args: unknown[]) => mockOwnerAlert(...args),
}))

const mockLedger = vi.fn()
vi.mock("@/lib/healing/ledger", () => ({
  ledgerHealAttempt: (...args: unknown[]) => mockLedger(...args),
}))

import {
  isAfterDigestMissWatch,
  watchDigestMissed,
} from "@/lib/digest/digest-missed"

describe("isAfterDigestMissWatch", () => {
  it("is false before 06:10 UTC and true at/after", () => {
    expect(isAfterDigestMissWatch(new Date("2026-09-09T06:09:59.000Z"))).toBe(false)
    expect(isAfterDigestMissWatch(new Date("2026-09-09T06:10:00.000Z"))).toBe(true)
  })
})

describe("watchDigestMissed", () => {
  beforeEach(() => {
    mockOwnerAlert.mockReset().mockResolvedValue({ sent: true, channel: "email" })
    mockLedger.mockReset().mockResolvedValue(undefined)
  })

  it("does not alert before 06:10 UTC", async () => {
    const result = await watchDigestMissed(new Date("2026-09-09T06:00:00.000Z"))
    expect(result).toEqual({ alerted: false, reason: "before-watch" })
    expect(prismaMock.workspace.count).not.toHaveBeenCalled()
    expect(mockOwnerAlert).not.toHaveBeenCalled()
  })

  it("alerts when candidates exist and no delivered digest today", async () => {
    ;(prismaMock.workspace.count as ReturnType<typeof vi.fn>).mockResolvedValue(3)
    ;(prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    ;(prismaMock.workspace.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ws-canary",
    })

    const result = await watchDigestMissed(new Date("2026-09-09T06:12:00.000Z"))
    expect(result.alerted).toBe(true)
    expect(mockOwnerAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKey: "digest-missed",
        workspaceId: "ws-canary",
      }),
    )
    expect(mockLedger).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-canary",
        condition: "digest-missed",
        outcome: "failed",
      }),
    )
  })

  it("does not alert when a delivered digest exists", async () => {
    ;(prismaMock.workspace.count as ReturnType<typeof vi.fn>).mockResolvedValue(1)
    ;(prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "digest-1",
    })

    const result = await watchDigestMissed(new Date("2026-09-09T07:00:00.000Z"))
    expect(result).toEqual({ alerted: false, reason: "delivered" })
    expect(mockOwnerAlert).not.toHaveBeenCalled()
  })

  it("dedups same UTC day via digest-missed condition ledger", async () => {
    ;(prismaMock.workspace.count as ReturnType<typeof vi.fn>).mockResolvedValue(1)
    ;(prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "already" })

    const result = await watchDigestMissed(new Date("2026-09-09T08:00:00.000Z"))
    expect(result).toEqual({ alerted: false, reason: "already-alerted" })
    expect(mockOwnerAlert).not.toHaveBeenCalled()
  })

  it("MUTATION: must call sendOwnerAlert with digest-missed", async () => {
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const src = readFileSync(join(process.cwd(), "src/lib/digest/digest-missed.ts"), "utf8")
    expect(src).toContain('alertKey: "digest-missed"')
    expect(src).toContain("sendOwnerAlert")
  })
})

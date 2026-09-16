import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockSendOwnerAlert = vi.fn()
vi.mock("@/lib/alerts/owner-alert", () => ({
  sendOwnerAlert: (...args: unknown[]) => mockSendOwnerAlert(...args),
}))

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  isStaleUnsoaked,
  markSoakGreen,
  pingStaleCandidates,
  shouldStalePing,
} from "@/lib/openclaw/runtime-autoupdate"
import { STALE_CANDIDATE_MS } from "@/lib/openclaw/runtime-bump"

const NOW = new Date("2026-09-12T08:00:00Z")

describe("runtime autoupdate lane", () => {
  beforeEach(() => {
    mockSendOwnerAlert.mockReset()
    mockSendOwnerAlert.mockResolvedValue({ sent: true, channel: "email" })
    ;(prismaMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (ops: Promise<unknown>[]) => Promise.all(ops),
    )
  })

  it("isStaleUnsoaked is true after 14d, false when superseded or soak green or stable", () => {
    const released = new Date(NOW.getTime() - STALE_CANDIDATE_MS)
    expect(
      isStaleUnsoaked(
        { isStable: false, supersededAt: null, soakGreenAt: null, releasedAt: released },
        NOW,
      ),
    ).toBe(true)
    expect(
      isStaleUnsoaked(
        {
          isStable: false,
          supersededAt: NOW,
          soakGreenAt: null,
          releasedAt: released,
        },
        NOW,
      ),
    ).toBe(false)
    expect(
      isStaleUnsoaked(
        {
          isStable: false,
          supersededAt: null,
          soakGreenAt: NOW,
          releasedAt: released,
        },
        NOW,
      ),
    ).toBe(false)
    expect(shouldStalePing({ lastStalePingAt: NOW }, NOW)).toBe(false)
    expect(shouldStalePing({ lastStalePingAt: null }, NOW)).toBe(true)
  })

  it("pingStaleCandidates alerts and stamps lastStalePingAt (never silence)", async () => {
    ;(prismaMock.openClawVersion.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "ver-stale",
        version: "2026.8.1",
        releasedAt: new Date(NOW.getTime() - STALE_CANDIDATE_MS - 1000),
        lastStalePingAt: null,
        isStable: false,
        supersededAt: null,
        soakGreenAt: null,
      },
    ])
    ;(prismaMock.openClawVersion.update as ReturnType<typeof vi.fn>).mockResolvedValue({})

    const result = await pingStaleCandidates(NOW)
    expect(result.pinged).toEqual(["2026.8.1"])
    expect(mockSendOwnerAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKey: "runtime-candidate-stale",
        title: expect.stringContaining("2026.8.1"),
      }),
    )
    expect(prismaMock.openClawVersion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ver-stale" },
        data: { lastStalePingAt: NOW },
      }),
    )
  })

  it("markSoakGreen on date-tuple 9.4 does not pin isStable (founder ACK)", async () => {
    ;(prismaMock.openClawVersion.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ver-94",
      version: "2026.9.4",
      buildSourceTag: "v2026.9.4",
      isStable: false,
    })
    ;(prismaMock.openClawVersion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      version: "2026.5.22-18",
      buildSourceTag: "v2026.5.22",
    })
    ;(prismaMock.openClawVersion.update as ReturnType<typeof vi.fn>).mockResolvedValue({})

    const result = await markSoakGreen("2026.9.4", NOW)
    expect(result).toEqual({
      bump: "date-tuple",
      autoPromoted: false,
      founderAckRequired: true,
    })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    const updates = (prismaMock.openClawVersion.update as ReturnType<typeof vi.fn>).mock.calls
    expect(
      updates.some((call) => {
        const args = call[0] as { data?: { soakGreenAt?: Date } }
        return args.data?.soakGreenAt instanceof Date
      }),
    ).toBe(true)
  })

  it("markSoakGreen on overlay -N pins isStable", async () => {
    ;(prismaMock.openClawVersion.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ver-19",
      version: "2026.5.22-19",
      buildSourceTag: "v2026.5.22",
      isStable: false,
    })
    ;(prismaMock.openClawVersion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      version: "2026.5.22-18",
      buildSourceTag: "v2026.5.22",
    })
    ;(prismaMock.openClawVersion.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
    ;(prismaMock.openClawVersion.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 1,
    })

    const result = await markSoakGreen("2026.5.22-19", NOW)
    expect(result.autoPromoted).toBe(true)
    expect(result.founderAckRequired).toBe(false)
    expect(prismaMock.$transaction).toHaveBeenCalled()
  })
})

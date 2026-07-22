// Hibernation cron: sleep-side budget guard + wake after() fan-out.
// Wakes must NOT be awaited in the tick body (WAKE_AFTER_FANOUT_ASSERT).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockHibernate = vi.fn()
const mockWake = vi.fn()
vi.mock("@/lib/hibernation/manager", () => ({
  hibernateWorkspace: (...args: unknown[]) => mockHibernate(...args),
  wakeWorkspace: (...args: unknown[]) => mockWake(...args),
}))

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const afterCallbacks: Array<() => unknown> = []
const mockAfter = vi.fn((cb: () => unknown) => {
  afterCallbacks.push(cb)
})
vi.mock("next/server", async (orig) => {
  const actual = await orig<typeof import("next/server")>()
  return { ...actual, after: (cb: () => unknown) => mockAfter(cb) }
})

import { GET } from "@/app/api/cron/hibernation/route"

const CRON_SECRET = "test-cron-secret"
const ROUTE_SRC = join(process.cwd(), "src/app/api/cron/hibernation/route.ts")

function candidate(workspaceId: string) {
  return { workspaceId, workspace: { id: workspaceId, containerId: `svc-${workspaceId}` } }
}

async function callCron() {
  const req = createMockRequest("http://localhost:3000/api/cron/hibernation", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  })
  return GET(req)
}

async function flushAfter() {
  const cbs = [...afterCallbacks]
  afterCallbacks.length = 0
  for (const cb of cbs) {
    await cb()
  }
}

let prevCronSecret: string | undefined
let nowSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  mockHibernate.mockReset()
  mockWake.mockReset()
  mockAfter.mockClear()
  afterCallbacks.length = 0
  mockHibernate.mockResolvedValue({ hibernated: true })
  mockWake.mockResolvedValue(undefined)
  prevCronSecret = process.env.CRON_SECRET
  process.env.CRON_SECRET = CRON_SECRET
  delete process.env.HIBERNATION_ENABLED
})

afterEach(() => {
  nowSpy?.mockRestore()
  if (prevCronSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = prevCronSecret
})

describe("hibernation cron — budget guard (sleep inline)", () => {
  it("forwards the 10s sync timeout and flips skipSync once the 300s cutoff is crossed", async () => {
    ;(prismaMock.containerState.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([candidate("a"), candidate("b"), candidate("c")])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    // Cutoff = 300_000 - 10_000 - 8_000 = 282_000ms
    let fakeNow = 1_000_000
    nowSpy = vi.spyOn(Date, "now").mockImplementation(() => fakeNow)
    mockHibernate.mockImplementation(async () => {
      fakeNow += 150_000
      return { hibernated: true }
    })

    const res = await callCron()
    expect(res.status).toBe(200)

    expect(mockHibernate).toHaveBeenCalledTimes(3)
    expect(mockHibernate).toHaveBeenNthCalledWith(1, "a", {
      syncTimeoutMs: 10_000,
      skipSync: false,
    })
    expect(mockHibernate).toHaveBeenNthCalledWith(2, "b", {
      syncTimeoutMs: 10_000,
      skipSync: false,
    })
    expect(mockHibernate).toHaveBeenNthCalledWith(3, "c", {
      syncTimeoutMs: 10_000,
      skipSync: true,
    })

    const json = await res.json()
    expect(json.data.hibernated).toBe(3)
    expect(json.data.syncSkippedForBudget).toBe(1)
  })

  it("syncs all candidates (skipSync=false) when well within budget", async () => {
    ;(prismaMock.containerState.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([candidate("a"), candidate("b")])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    let fakeNow = 5_000_000
    nowSpy = vi.spyOn(Date, "now").mockImplementation(() => fakeNow)
    mockHibernate.mockImplementation(async () => {
      fakeNow += 100
      return { hibernated: true }
    })

    const res = await callCron()
    const json = await res.json()

    expect(mockHibernate).toHaveBeenNthCalledWith(1, "a", {
      syncTimeoutMs: 10_000,
      skipSync: false,
    })
    expect(mockHibernate).toHaveBeenNthCalledWith(2, "b", {
      syncTimeoutMs: 10_000,
      skipSync: false,
    })
    expect(json.data.syncSkippedForBudget).toBe(0)
  })

  it("returns 401 on a bad cron secret (and does not hibernate)", async () => {
    const req = createMockRequest("http://localhost:3000/api/cron/hibernation", {
      headers: { authorization: "Bearer wrong" },
    })
    const res = await GET(req)
    expect(res.status).toBe(401)
    expect(mockHibernate).not.toHaveBeenCalled()
  })
})

describe("hibernation cron — wake after() fan-out", () => {
  it("past-due hint schedules wake via after() (not awaited in tick)", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-20T12:10:00.000Z"))

    ;(prismaMock.containerState.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          workspaceId: "past-due",
          nextHeartbeatAt: new Date("2026-07-20T12:00:00.000Z"),
          avgWakeDurationMs: 44_448,
        },
      ])
      .mockResolvedValueOnce([])

    const res = await callCron()
    expect(res.status).toBe(200)
    expect(mockWake).not.toHaveBeenCalled()
    expect(mockAfter).toHaveBeenCalledTimes(1)

    const json = await res.json()
    expect(json.data.woke).toBe(1)
    expect(json.data.wakeExecution).toBe("after-fanout")
    expect(json.data.wakeEligibility).toEqual([
      expect.objectContaining({
        workspaceId: "past-due",
        eligible: true,
        pastDue: true,
      }),
    ])

    await flushAfter()
    expect(mockWake).toHaveBeenCalledWith("past-due")

    vi.useRealTimers()
  })

  it("tick duration bounded with N=5 pending wakes (mutation: inline await → fail)", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-20T12:10:00.000Z"))

    const five = Array.from({ length: 5 }, (_, i) => ({
      workspaceId: `w${i}`,
      nextHeartbeatAt: new Date("2026-07-20T12:00:00.000Z"),
      avgWakeDurationMs: 60_000,
    }))

    ;(prismaMock.containerState.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(five)
      .mockResolvedValueOnce([])

    // If wakes were awaited inline, each 5s delay would push the tick past 20s.
    mockWake.mockImplementation(
      () => new Promise((r) => setTimeout(r, 5_000)),
    )

    const t0 = performance.now()
    const res = await callCron()
    const elapsedMs = performance.now() - t0
    expect(res.status).toBe(200)
    expect(elapsedMs).toBeLessThan(500)
    expect(mockWake).not.toHaveBeenCalled()
    expect(mockAfter).toHaveBeenCalledTimes(5)
    const json = await res.json()
    expect(json.data.woke).toBe(5)
    expect(json.data.wakeEligibility).toHaveLength(5)

    const src = readFileSync(ROUTE_SRC, "utf8")
    expect(src).toContain("WAKE_AFTER_FANOUT_ASSERT")
    expect(src).toContain("scheduleWake")
    // Main GET path must not await wakeWorkspace (only scheduleWake → after does).
    const getBody = src.slice(src.indexOf("export async function GET"))
    expect(getBody).not.toMatch(/await\s+wakeWorkspace\s*\(/)

    vi.useRealTimers()
  })

  it("per-wake failure isolation: one throw does not kill siblings", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-20T12:10:00.000Z"))

    const three = ["ok-a", "boom", "ok-b"].map((id) => ({
      workspaceId: id,
      nextHeartbeatAt: new Date("2026-07-20T12:00:00.000Z"),
      avgWakeDurationMs: 40_000,
    }))

    ;(prismaMock.containerState.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(three)
      .mockResolvedValueOnce([])

    mockWake.mockImplementation(async (id: string) => {
      if (id === "boom") throw new Error("wake exploded")
    })

    const res = await callCron()
    expect(res.status).toBe(200)
    expect(mockAfter).toHaveBeenCalledTimes(3)

    await flushAfter()
    expect(mockWake).toHaveBeenCalledTimes(3)
    expect(mockWake).toHaveBeenCalledWith("ok-a")
    expect(mockWake).toHaveBeenCalledWith("boom")
    expect(mockWake).toHaveBeenCalledWith("ok-b")

    vi.useRealTimers()
  })

  it("eligibility observability lists ineligible candidates (not silent skip)", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-20T15:50:00.000Z"))

    ;(prismaMock.containerState.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          workspaceId: "early",
          nextHeartbeatAt: new Date("2026-07-20T16:00:00.000Z"),
          avgWakeDurationMs: 44_448,
        },
      ])
      .mockResolvedValueOnce([])

    const res = await callCron()
    const json = await res.json()
    expect(json.data.woke).toBe(0)
    expect(json.data.wakeEligibility).toHaveLength(1)
    expect(json.data.wakeEligibility[0]).toMatchObject({
      workspaceId: "early",
      eligible: false,
      pastDue: false,
      deadline: "2026-07-20T15:52:00.000Z",
      leadMs: 8 * 60 * 1000,
    })
    expect(mockAfter).not.toHaveBeenCalled()
    expect(mockWake).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it("MUTATION: maxDuration must be 300 (restore 55 → fail)", () => {
    const src = readFileSync(ROUTE_SRC, "utf8")
    expect(src).toMatch(/export const maxDuration = 300/)
    expect(src).not.toMatch(/export const maxDuration = 55/)
  })
})

describe("hibernation cron — warmIdle honesty (P1.1)", () => {
  it("null stamp + fresh channelsConnectedAt is protected (predicate requires connected>24h)", async () => {
    ;(prismaMock.containerState.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const res = await callCron()
    expect(res.status).toBe(200)
    expect(mockHibernate).not.toHaveBeenCalled()

    const warmCall = (prismaMock.containerState.findMany as ReturnType<typeof vi.fn>).mock
      .calls[1][0]
    expect(warmCall.where.containerPhase).toBe("WARM")
    expect(warmCall.where.AND).toBeDefined()
    expect(JSON.stringify(warmCall.where)).toContain("channelsConnectedAt")
    expect(JSON.stringify(warmCall.where.AND)).toContain('"lastChannelMessageAt":null')
    expect(JSON.stringify(warmCall.where.AND)).toContain("channelsConnectedAt")
  })

  it("25h-old lastChannelMessageAt WARM claw IS hibernated", async () => {
    ;(prismaMock.containerState.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([candidate("warm-25h")])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    mockHibernate.mockResolvedValue({ hibernated: true })
    const res = await callCron()
    expect(res.status).toBe(200)
    expect(mockHibernate).toHaveBeenCalledWith("warm-25h", expect.any(Object))
  })
})

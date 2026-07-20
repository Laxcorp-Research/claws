// PR-2: hibernation cron budget guard. Each hibernate now routes through
// syncThenDestroy with a 10s sync budget. To avoid a sync being killed
// mid-write by the 55s function cap, the cron stops starting NEW syncs once
// too little of the budget remains (skipSync=true) and bare-destroys the rest.
// These tests lock that the cron forwards the 10s timeout and flips skipSync
// at the cutoff.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
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

import { GET } from "@/app/api/cron/hibernation/route"

const CRON_SECRET = "test-cron-secret"

function candidate(workspaceId: string) {
  return { workspaceId, workspace: { id: workspaceId, containerId: `svc-${workspaceId}` } }
}

async function callCron() {
  const req = createMockRequest("http://localhost:3000/api/cron/hibernation", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  })
  return GET(req)
}

let prevCronSecret: string | undefined
let nowSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  mockHibernate.mockReset()
  mockWake.mockReset()
  // P3: hibernateWorkspace returns { hibernated: true|false }
  mockHibernate.mockResolvedValue({ hibernated: true })
  prevCronSecret = process.env.CRON_SECRET
  process.env.CRON_SECRET = CRON_SECRET
  delete process.env.HIBERNATION_ENABLED
})

afterEach(() => {
  nowSpy?.mockRestore()
  if (prevCronSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = prevCronSecret
})

describe("hibernation cron — budget guard", () => {
  it("forwards the 10s sync timeout and flips skipSync once the 55s cutoff is crossed", async () => {
    // 3 hibernate candidates; runningIdle, then warmIdle/wake/stuck empty.
    ;(prismaMock.containerState.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([candidate("a"), candidate("b"), candidate("c")]) // runningIdle
      .mockResolvedValueOnce([]) // warmIdle
      .mockResolvedValueOnce([]) // wakeCandidates
      .mockResolvedValueOnce([]) // stuckWaking

    // Deterministic clock: start at T0; each hibernate consumes 20s. Cutoff is
    // 55_000 - 10_000(sync) - 8_000(margin) = 37_000ms.
    let fakeNow = 1_000_000
    nowSpy = vi.spyOn(Date, "now").mockImplementation(() => fakeNow)
    mockHibernate.mockImplementation(async () => {
      fakeNow += 20_000
      return { hibernated: true }
    })

    const res = await callCron()
    expect(res.status).toBe(200)

    expect(mockHibernate).toHaveBeenCalledTimes(3)
    // a @ elapsed 0  → sync; b @ elapsed 20s → sync; c @ elapsed 40s → skip
    expect(mockHibernate).toHaveBeenNthCalledWith(1, "a", { syncTimeoutMs: 10_000, skipSync: false })
    expect(mockHibernate).toHaveBeenNthCalledWith(2, "b", { syncTimeoutMs: 10_000, skipSync: false })
    expect(mockHibernate).toHaveBeenNthCalledWith(3, "c", { syncTimeoutMs: 10_000, skipSync: true })

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

    // Clock barely advances → never crosses the cutoff.
    let fakeNow = 5_000_000
    nowSpy = vi.spyOn(Date, "now").mockImplementation(() => fakeNow)
    mockHibernate.mockImplementation(async () => {
      fakeNow += 100
      return { hibernated: true }
    })

    const res = await callCron()
    const json = await res.json()

    expect(mockHibernate).toHaveBeenNthCalledWith(1, "a", { syncTimeoutMs: 10_000, skipSync: false })
    expect(mockHibernate).toHaveBeenNthCalledWith(2, "b", { syncTimeoutMs: 10_000, skipSync: false })
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

describe("hibernation cron — warmIdle honesty (P1.1)", () => {
  it("null stamp + fresh channelsConnectedAt is protected (predicate requires connected>24h)", async () => {
    ;(prismaMock.containerState.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([]) // runningIdle
      .mockResolvedValueOnce([]) // warmIdle — empty for fresh-null
      .mockResolvedValueOnce([]) // wake
      .mockResolvedValueOnce([]) // stuck

    const res = await callCron()
    expect(res.status).toBe(200)
    expect(mockHibernate).not.toHaveBeenCalled()

    const warmCall = (prismaMock.containerState.findMany as ReturnType<typeof vi.fn>).mock
      .calls[1][0]
    expect(warmCall.where.containerPhase).toBe("WARM")
    expect(warmCall.where.AND).toBeDefined()
    expect(JSON.stringify(warmCall.where)).toContain("channelsConnectedAt")
    // Null alone is insufficient — must be paired with channelsConnectedAt < cutoff.
    expect(JSON.stringify(warmCall.where.AND)).toContain('"lastChannelMessageAt":null')
    expect(JSON.stringify(warmCall.where.AND)).toContain("channelsConnectedAt")
  })

  it("25h-old lastChannelMessageAt WARM claw IS hibernated", async () => {
    ;(prismaMock.containerState.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([]) // runningIdle
      .mockResolvedValueOnce([candidate("warm-25h")]) // warmIdle
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    mockHibernate.mockResolvedValue(undefined)
    const res = await callCron()
    expect(res.status).toBe(200)
    expect(mockHibernate).toHaveBeenCalledWith("warm-25h", expect.any(Object))
  })
})

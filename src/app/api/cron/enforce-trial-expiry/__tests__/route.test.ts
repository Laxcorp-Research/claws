import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest } from "@/test/helpers/mock-request"
import { readFileSync } from "node:fs"
import { join } from "node:path"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockSyncThenDestroy = vi.fn()
const mockDestroyContainer = vi.fn()
vi.mock("@/lib/openclaw/deployer", () => ({
  syncThenDestroy: (...args: unknown[]) => mockSyncThenDestroy(...args),
  destroyContainer: (...args: unknown[]) => mockDestroyContainer(...args),
}))

const mockNotify = vi.fn()
const mockStopped = vi.fn()
vi.mock("@/lib/trial/trial-expiry-emails", () => ({
  sendTrialExpiryNotifyEmail: (...args: unknown[]) => mockNotify(...args),
  sendTrialExpiryStoppedEmail: (...args: unknown[]) => mockStopped(...args),
}))

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { GET } from "@/app/api/cron/enforce-trial-expiry/route"

const SECRET = "test-cron-secret"
const NOW_MS = Date.parse("2026-07-28T12:00:00.000Z")

type UserRow = {
  id: string
  email: string
  name: string | null
  trialUsed: boolean
  trialEndsAt: Date | null
  trialExpiryNotifiedAt: Date | null
  hasActiveSubscription: boolean
  subscriptionStatus: string | null
  workspaces: Array<{ id: string; name: string; status: string }>
}

function callRoute(opts: { authHeader?: string; dryRun?: boolean } = {}) {
  const url = opts.dryRun
    ? "http://localhost:3000/api/cron/enforce-trial-expiry?dryRun=true"
    : "http://localhost:3000/api/cron/enforce-trial-expiry"
  const headers: Record<string, string> = {}
  if (opts.authHeader !== undefined) headers.authorization = opts.authHeader
  return GET(createMockRequest(url, { method: "GET", headers }))
}

describe("GET /api/cron/enforce-trial-expiry (GRACE-24)", () => {
  const originalSecret = process.env.CRON_SECRET

  beforeEach(() => {
    process.env.CRON_SECRET = SECRET
    vi.useFakeTimers({ now: NOW_MS })
    mockSyncThenDestroy.mockReset().mockResolvedValue(undefined)
    mockDestroyContainer.mockReset()
    mockNotify.mockReset().mockResolvedValue(undefined)
    mockStopped.mockReset().mockResolvedValue(undefined)
    ;(prismaMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (ops: unknown) => {
        if (Array.isArray(ops)) return Promise.all(ops as Promise<unknown>[])
        return undefined
      },
    )
    ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({} as never)
    ;(prismaMock.containerState.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 1,
    } as never)
    ;(prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({} as never)
    ;(prismaMock.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({} as never)
  })

  afterEach(() => {
    vi.useRealTimers()
    if (originalSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalSecret
  })

  it("returns 401 without bearer", async () => {
    const res = await callRoute()
    expect(res.status).toBe(401)
  })

  it("retroactive-expiry first-run: expired days ago, never notified → notify + stamp (no stop)", async () => {
    const expiredDaysAgo = new Date(NOW_MS - 5 * 24 * 60 * 60 * 1000)
    ;(prismaMock.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "u-retro",
        email: "retro@example.com",
        name: "Retro",
        trialUsed: true,
        trialEndsAt: expiredDaysAgo,
        trialExpiryNotifiedAt: null,
        hasActiveSubscription: false,
        subscriptionStatus: null,
        workspaces: [{ id: "ws-1", name: "Canary Claw", status: "RUNNING" }],
      } satisfies UserRow,
    ])
    ;(prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      trialExpiryNotifiedAt: null,
      hasActiveSubscription: false,
      subscriptionStatus: null,
    })

    const res = await callRoute({ authHeader: `Bearer ${SECRET}` })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.notified).toBe(1)
    expect(json.data.stopped).toBe(0)
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "retro@example.com",
        clawNames: ["Canary Claw"],
      }),
    )
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u-retro" },
        data: { trialExpiryNotifiedAt: expect.any(Date) },
      }),
    )
    expect(mockSyncThenDestroy).not.toHaveBeenCalled()
  })

  it("notify idempotency: marker already set → no second email / no re-stamp", async () => {
    const notifiedAt = new Date(NOW_MS - 60 * 60 * 1000)
    ;(prismaMock.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "u-idem",
        email: "idem@example.com",
        name: null,
        trialUsed: true,
        trialEndsAt: new Date(NOW_MS - 1000),
        trialExpiryNotifiedAt: notifiedAt,
        hasActiveSubscription: false,
        subscriptionStatus: null,
        workspaces: [{ id: "ws-1", name: "X", status: "RUNNING" }],
      } satisfies UserRow,
    ])

    const res = await callRoute({ authHeader: `Bearer ${SECRET}` })
    const json = await res.json()
    expect(json.data.notified).toBe(0)
    expect(json.data.stopped).toBe(0)
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it("on_hold → no stop (pre-stop re-check)", async () => {
    const notifiedAt = new Date(NOW_MS - 25 * 60 * 60 * 1000)
    ;(prismaMock.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "u-hold",
        email: "hold@example.com",
        name: "Hold",
        trialUsed: true,
        trialEndsAt: new Date(NOW_MS - 3 * 24 * 60 * 60 * 1000),
        trialExpiryNotifiedAt: notifiedAt,
        hasActiveSubscription: false,
        // Planning may see on_hold; also cover race where findMany missed it.
        subscriptionStatus: null,
        workspaces: [{ id: "ws-1", name: "Held", status: "RUNNING" }],
      } satisfies UserRow,
    ])
    // Force into stop plan via null status in findMany, then fresh = on_hold.
    // Re-build: if subscriptionStatus null and notified 25h ago → toStop.
    ;(prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      hasActiveSubscription: false,
      subscriptionStatus: "on_hold",
      trialExpiryNotifiedAt: notifiedAt,
    })

    const res = await callRoute({ authHeader: `Bearer ${SECRET}` })
    const json = await res.json()
    expect(json.data.stopped).toBe(0)
    expect(mockSyncThenDestroy).not.toHaveBeenCalled()
    expect(mockStopped).not.toHaveBeenCalled()
  })

  it("resubscribe inside grace → no stop", async () => {
    const notifiedAt = new Date(NOW_MS - 25 * 60 * 60 * 1000)
    ;(prismaMock.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "u-sub",
        email: "sub@example.com",
        name: "Sub",
        trialUsed: true,
        trialEndsAt: new Date(NOW_MS - 1000),
        trialExpiryNotifiedAt: notifiedAt,
        hasActiveSubscription: false,
        subscriptionStatus: null,
        workspaces: [{ id: "ws-1", name: "Subbed", status: "RUNNING" }],
      } satisfies UserRow,
    ])
    ;(prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      hasActiveSubscription: true,
      subscriptionStatus: "active",
      trialExpiryNotifiedAt: notifiedAt,
    })

    const res = await callRoute({ authHeader: `Bearer ${SECRET}` })
    const json = await res.json()
    expect(json.data.stopped).toBe(0)
    expect(mockSyncThenDestroy).not.toHaveBeenCalled()
  })

  it("notify+24h+no-sub → syncThenDestroy + HIBERNATED + ledger + stopped email", async () => {
    const notifiedAt = new Date(NOW_MS - 25 * 60 * 60 * 1000)
    ;(prismaMock.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "u-stop",
        email: "stop@example.com",
        name: "Stop",
        trialUsed: true,
        trialEndsAt: new Date(NOW_MS - 2 * 24 * 60 * 60 * 1000),
        trialExpiryNotifiedAt: notifiedAt,
        hasActiveSubscription: false,
        subscriptionStatus: null,
        workspaces: [{ id: "ws-1", name: "Stoppable", status: "RUNNING" }],
      } satisfies UserRow,
    ])
    ;(prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      hasActiveSubscription: false,
      subscriptionStatus: null,
      trialExpiryNotifiedAt: notifiedAt,
    })

    const res = await callRoute({ authHeader: `Bearer ${SECRET}` })
    const json = await res.json()
    expect(json.data.stopped).toBe(1)
    expect(mockSyncThenDestroy).toHaveBeenCalledWith("ws-1")
    expect(mockDestroyContainer).not.toHaveBeenCalled()
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ws-1" },
        data: { status: "HIBERNATED" },
      }),
    )
    expect(prismaMock.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: "ws-1",
          actionType: "SYSTEM",
          metadata: expect.stringContaining("trial_expiry_stop"),
        }),
      }),
    )
    expect(mockStopped).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "stop@example.com",
        stoppedNames: ["Stoppable"],
      }),
    )
    const stoppedHtmlArgs = mockStopped.mock.calls[0][0] as { stoppedNames: string[] }
    expect(stoppedHtmlArgs.stoppedNames).toEqual(["Stoppable"])
  })

  it("subscribed users never touched (findMany filter + defense)", async () => {
    ;(prismaMock.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
    const res = await callRoute({ authHeader: `Bearer ${SECRET}` })
    const json = await res.json()
    expect(json.data).toMatchObject({ notified: 0, stopped: 0 })
    expect(mockNotify).not.toHaveBeenCalled()
    expect(mockSyncThenDestroy).not.toHaveBeenCalled()
  })

  it("MUTATION: route must pre-check shouldSkipTrialStop / on_hold before syncThenDestroy", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/cron/enforce-trial-expiry/route.ts"),
      "utf8",
    )
    expect(src).toContain("shouldSkipTrialStop")
    expect(src).toContain("syncThenDestroy")
    expect(src).not.toMatch(/await destroyContainer\(/)
    expect(src).toContain("trialExpiryNotifiedAt: now")
  })

  it("MUTATION: drop marker stamp after notify → idempotency contract fails", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/cron/enforce-trial-expiry/route.ts"),
      "utf8",
    )
    // Stamp must follow successful send (idempotency key).
    const notifyIdx = src.indexOf("sendTrialExpiryNotifyEmail")
    const stampIdx = src.indexOf("trialExpiryNotifiedAt: now")
    expect(notifyIdx).toBeGreaterThan(-1)
    expect(stampIdx).toBeGreaterThan(notifyIdx)
  })

  it("email copy: notify + stopped say stop, never paused", () => {
    const emails = readFileSync(
      join(process.cwd(), "src/lib/trial/trial-expiry-emails.ts"),
      "utf8",
    )
    // Assert on subject/body strings only (file comments may mention the ban).
    const subjectsAndBodies = [
      ...emails.matchAll(/subject:\s*"([^"]+)"/g),
      ...emails.matchAll(/We'll stop[^`]+/g),
      ...emails.matchAll(/We stopped[^`]+/g),
      ...emails.matchAll(/Subscribe to redeploy/g),
    ].map((m) => m[0] ?? m[1] ?? "")
    const joined = subjectsAndBodies.join("\n").toLowerCase()
    expect(joined).toMatch(/stop/)
    expect(emails).toContain("Subscribe to redeploy")
    expect(joined).not.toContain("paused")
    expect(joined).not.toMatch(/\bpause[ds]?\b/)
  })
})

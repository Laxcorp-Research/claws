import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockDestroyContainer = vi.fn()
vi.mock("@/lib/openclaw/deployer", () => ({
  destroyContainer: (...args: unknown[]) => mockDestroyContainer(...args),
}))

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { GET } from "@/app/api/cron/enforce-trial-expiry/route"

const SECRET = "test-cron-secret"

type UserRow = {
  id: string
  trialUsed: boolean
  trialEndsAt: Date | null
  hasActiveSubscription: boolean
  workspaces: Array<{ id: string; status: string; containerId: string | null }>
}

function callRoute(opts: { authHeader?: string; dryRun?: boolean } = {}) {
  const url = opts.dryRun
    ? "http://localhost:3000/api/cron/enforce-trial-expiry?dryRun=true"
    : "http://localhost:3000/api/cron/enforce-trial-expiry"
  const headers: Record<string, string> = {}
  if (opts.authHeader !== undefined) headers["authorization"] = opts.authHeader
  const req = createMockRequest(url, { method: "GET", headers })
  return GET(req)
}

function mockUsers(users: UserRow[]) {
  ;(prismaMock.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(users)
}

function mockFreshSubscriptionCheck(hasActiveSubscription: boolean) {
  ;(prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    hasActiveSubscription,
  })
}

describe("GET /api/cron/enforce-trial-expiry", () => {
  const originalSecret = process.env.CRON_SECRET

  beforeEach(() => {
    process.env.CRON_SECRET = SECRET
    mockDestroyContainer.mockReset()
  })

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalSecret
  })

  it("returns 401 when no Authorization header", async () => {
    const res = await callRoute()
    expect(res.status).toBe(401)
    expect(mockDestroyContainer).not.toHaveBeenCalled()
  })

  it("returns 401 with wrong bearer token", async () => {
    const res = await callRoute({ authHeader: "Bearer wrong-token" })
    expect(res.status).toBe(401)
    expect(mockDestroyContainer).not.toHaveBeenCalled()
  })

  it("returns 401 when CRON_SECRET env is unset (matches existing crons)", async () => {
    delete process.env.CRON_SECRET
    const res = await callRoute({ authHeader: "Bearer anything" })
    expect(res.status).toBe(401)
    expect(mockDestroyContainer).not.toHaveBeenCalled()
  })

  it("dry run returns plan and does NOT call destroyContainer", async () => {
    mockUsers([
      {
        id: "u1",
        trialUsed: true,
        trialEndsAt: new Date(Date.now() - 1000),
        hasActiveSubscription: false,
        workspaces: [{ id: "ws1", status: "RUNNING", containerId: "c1" }],
      },
    ])

    const res = await callRoute({ authHeader: `Bearer ${SECRET}`, dryRun: true })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.dryRun).toBe(true)
    expect(json.data.candidatesScanned).toBe(1)
    expect(json.data.plan.toStop).toEqual([
      { userId: "u1", workspaceId: "ws1", containerId: "c1" },
    ])
    expect(mockDestroyContainer).not.toHaveBeenCalled()
  })

  it("happy path: stops all workspaces, returns { stopped: 2, errors: 0 }", async () => {
    mockUsers([
      {
        id: "u1",
        trialUsed: true,
        trialEndsAt: new Date(Date.now() - 1000),
        hasActiveSubscription: false,
        workspaces: [
          { id: "ws1", status: "RUNNING", containerId: "c1" },
          { id: "ws2", status: "RUNNING", containerId: "c2" },
        ],
      },
    ])
    mockFreshSubscriptionCheck(false)
    mockDestroyContainer.mockResolvedValue(undefined)

    const res = await callRoute({ authHeader: `Bearer ${SECRET}` })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toEqual({
      candidatesScanned: 1,
      stopped: 2,
      errors: 0,
    })
    expect(mockDestroyContainer).toHaveBeenCalledTimes(2)
    expect(mockDestroyContainer).toHaveBeenNthCalledWith(1, "ws1")
    expect(mockDestroyContainer).toHaveBeenNthCalledWith(2, "ws2")
  })

  it("partial failure: second destroyContainer throws, returns { stopped: 1, errors: 1 }", async () => {
    mockUsers([
      {
        id: "u1",
        trialUsed: true,
        trialEndsAt: new Date(Date.now() - 1000),
        hasActiveSubscription: false,
        workspaces: [
          { id: "ws1", status: "RUNNING", containerId: "c1" },
          { id: "ws2", status: "RUNNING", containerId: "c2" },
        ],
      },
    ])
    mockFreshSubscriptionCheck(false)
    mockDestroyContainer
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Railway API 500"))

    const res = await callRoute({ authHeader: `Bearer ${SECRET}` })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toEqual({
      candidatesScanned: 1,
      stopped: 1,
      errors: 1,
    })
    expect(mockDestroyContainer).toHaveBeenCalledTimes(2)
  })

  it("race: user subscribes between planning and execution → workspace skipped, destroyContainer NOT called", async () => {
    mockUsers([
      {
        id: "u1",
        trialUsed: true,
        trialEndsAt: new Date(Date.now() - 1000),
        hasActiveSubscription: false,
        workspaces: [{ id: "ws1", status: "RUNNING", containerId: "c1" }],
      },
    ])
    mockFreshSubscriptionCheck(true)

    const res = await callRoute({ authHeader: `Bearer ${SECRET}` })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.stopped).toBe(0)
    expect(json.data.errors).toBe(0)
    expect(json.data.candidatesScanned).toBe(1)
    expect(mockDestroyContainer).not.toHaveBeenCalled()
  })
})

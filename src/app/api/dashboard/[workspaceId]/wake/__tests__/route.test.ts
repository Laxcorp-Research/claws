import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { parseResponse } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({
  prisma: prismaMock,
}))

vi.mock("@/lib/api/auth", () => ({
  getSessionUser: vi.fn().mockResolvedValue({
    id: "user-1",
    email: "test@example.com",
    name: "Test User",
  }),
}))

vi.mock("@/lib/logger", () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

// after() captures (does not run) the callback so we can assert the response
// returns WITHOUT waiting on wakeWorkspace - mutation: bare promise → fail.
const mockAfter = vi.fn()
vi.mock("next/server", async (orig) => {
  const actual = await orig<typeof import("next/server")>()
  return { ...actual, after: (cb: () => unknown) => mockAfter(cb) }
})

const mockWakeWorkspace = vi.fn()
vi.mock("@/lib/hibernation/manager", () => ({
  wakeWorkspace: (...args: unknown[]) => mockWakeWorkspace(...args),
}))

import { POST } from "@/app/api/dashboard/[workspaceId]/wake/route"
import { getSessionUser } from "@/lib/api/auth"

const WS = "ws-hibernated-1"

function params(workspaceId: string) {
  return { params: Promise.resolve({ workspaceId }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "user-1",
    email: "test@example.com",
    name: "Test User",
  })
  mockWakeWorkspace.mockResolvedValue(undefined)
  ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: WS,
    userId: "user-1",
    status: "HIBERNATED",
    containerState: { workspaceId: WS, containerPhase: "HIBERNATED" },
    user: {
      trialUsed: true,
      trialStartedAt: new Date("2026-07-01T00:00:00.000Z"),
      trialEndsAt: new Date("2099-01-01T00:00:00.000Z"),
      hasActiveSubscription: false,
    },
  })
  ;(prismaMock.$transaction as ReturnType<typeof vi.fn>).mockResolvedValue([{}, {}])
  ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
  ;(prismaMock.containerState.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
})

describe("POST /api/dashboard/[workspaceId]/wake", () => {
  it("schedules wakeWorkspace via after() (mutation: bare promise → fail) and returns WAKING without awaiting wake", async () => {
    let resolveWake: (() => void) | undefined
    const wakeGate = new Promise<void>((resolve) => {
      resolveWake = resolve
    })
    mockWakeWorkspace.mockReturnValue(wakeGate)

    const started = Date.now()
    const res = await POST({} as never, params(WS))
    const elapsedMs = Date.now() - started
    const { status, data } = await parseResponse(res)

    expect(status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.status).toBe("WAKING")
    // Fast return: must not wait on the unresolved wake promise.
    expect(elapsedMs).toBeLessThan(500)
    expect(mockAfter).toHaveBeenCalledTimes(1)
    expect(mockWakeWorkspace).not.toHaveBeenCalled()

    // Run captured after() work; resolve the gate so the promise can settle.
    const afterRun = (mockAfter.mock.calls[0][0] as () => Promise<void>)()
    expect(mockWakeWorkspace).toHaveBeenCalledWith(WS)
    resolveWake?.()
    await afterRun
  })

  it("returns 400 when workspace is not HIBERNATED", async () => {
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: WS,
      userId: "user-1",
      status: "RUNNING",
      containerState: null,
      user: {
        trialUsed: true,
        trialStartedAt: new Date("2026-07-01T00:00:00.000Z"),
        trialEndsAt: new Date("2099-01-01T00:00:00.000Z"),
        hasActiveSubscription: false,
      },
    })

    const res = await POST({} as never, params(WS))
    expect(res.status).toBe(400)
    expect(mockAfter).not.toHaveBeenCalled()
    expect(mockWakeWorkspace).not.toHaveBeenCalled()
  })

  it("returns 402 when trial expired and no subscription (no after/wake)", async () => {
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: WS,
      userId: "user-1",
      status: "HIBERNATED",
      containerState: { workspaceId: WS, containerPhase: "HIBERNATED" },
      user: {
        trialUsed: true,
        trialStartedAt: new Date("2026-07-01T00:00:00.000Z"),
        trialEndsAt: new Date("2020-01-01T00:00:00.000Z"),
        hasActiveSubscription: false,
      },
    })

    const res = await POST({} as never, params(WS))
    expect(res.status).toBe(402)
    expect(mockAfter).not.toHaveBeenCalled()
    expect(mockWakeWorkspace).not.toHaveBeenCalled()
  })

  it("returns 401 when unauthenticated", async () => {
    ;(getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    const res = await POST({} as never, params(WS))
    expect(res.status).toBe(401)
    expect(mockAfter).not.toHaveBeenCalled()
  })
})

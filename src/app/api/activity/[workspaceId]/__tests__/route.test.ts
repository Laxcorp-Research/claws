import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockGetSessionUser = vi.fn()
vi.mock("@/lib/api/auth", () => ({ getSessionUser: () => mockGetSessionUser() }))

const mockVerifyOwnership = vi.fn()
vi.mock("@/lib/api/ownership", () => ({
  verifyWorkspaceOwnership: (...args: unknown[]) => mockVerifyOwnership(...args),
}))

const mockDestroyContainer = vi.fn()
vi.mock("@/lib/openclaw/deployer", () => ({
  destroyContainer: (...args: unknown[]) => mockDestroyContainer(...args),
}))

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { GET } from "@/app/api/activity/[workspaceId]/route"

function setupSaneDefaults() {
  // All the prisma calls the handler makes post-branch — return empty/zero.
  ;(prismaMock.agent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(prismaMock.activityLog.count as ReturnType<typeof vi.fn>).mockResolvedValue(0)
  ;(prismaMock.activityLog.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
    _sum: { apiCost: null },
  })
  ;(prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(prismaMock.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue([])
}

async function callRoute(workspaceId = "ws-1") {
  const req = createMockRequest(
    `http://localhost:3000/api/activity/${workspaceId}`,
    { method: "GET" },
  )
  return GET(req, { params: Promise.resolve({ workspaceId }) })
}

describe("GET /api/activity/[workspaceId] — trial-expiry side effect", () => {
  beforeEach(() => {
    mockDestroyContainer.mockReset()
    mockDestroyContainer.mockResolvedValue(undefined)
    mockGetSessionUser.mockReset()
    mockVerifyOwnership.mockReset()
    setupSaneDefaults()
  })

  it("calls destroyContainer when expired-trial user loads dashboard for RUNNING workspace", async () => {
    mockGetSessionUser.mockResolvedValue({ id: "user-1" })
    mockVerifyOwnership.mockResolvedValue({
      error: null,
      workspace: { id: "ws-1", status: "RUNNING" },
    })
    ;(prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      trialUsed: true,
      trialEndsAt: new Date(Date.now() - 86_400_000), // expired 1 day ago
      hasActiveSubscription: false,
      apiKeySource: "PLATFORM_CREDIT",
    })

    await callRoute("ws-1")

    expect(mockDestroyContainer).toHaveBeenCalledWith("ws-1")
  })

  it("does NOT call destroyContainer when trial is still active", async () => {
    mockGetSessionUser.mockResolvedValue({ id: "user-1" })
    mockVerifyOwnership.mockResolvedValue({
      error: null,
      workspace: { id: "ws-1", status: "RUNNING" },
    })
    ;(prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      trialUsed: true,
      trialEndsAt: new Date(Date.now() + 86_400_000), // 1 day in future
      hasActiveSubscription: false,
      apiKeySource: "PLATFORM_CREDIT",
    })

    await callRoute("ws-1")

    expect(mockDestroyContainer).not.toHaveBeenCalled()
  })

  it("does NOT call destroyContainer when user has active subscription (even post-expiry)", async () => {
    mockGetSessionUser.mockResolvedValue({ id: "user-1" })
    mockVerifyOwnership.mockResolvedValue({
      error: null,
      workspace: { id: "ws-1", status: "RUNNING" },
    })
    ;(prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      trialUsed: true,
      trialEndsAt: new Date(Date.now() - 86_400_000),
      hasActiveSubscription: true,
      apiKeySource: "PLATFORM_CREDIT",
    })

    await callRoute("ws-1")

    expect(mockDestroyContainer).not.toHaveBeenCalled()
  })

  it("does NOT call destroyContainer when workspace is not RUNNING (already stopped somehow)", async () => {
    mockGetSessionUser.mockResolvedValue({ id: "user-1" })
    mockVerifyOwnership.mockResolvedValue({
      error: null,
      workspace: { id: "ws-1", status: "STOPPED" },
    })
    ;(prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      trialUsed: true,
      trialEndsAt: new Date(Date.now() - 86_400_000),
      hasActiveSubscription: false,
      apiKeySource: "PLATFORM_CREDIT",
    })

    await callRoute("ws-1")

    expect(mockDestroyContainer).not.toHaveBeenCalled()
  })

  it("sets in-memory workspace.status to STOPPED after destroying (tracks destroyContainer semantic)", async () => {
    mockGetSessionUser.mockResolvedValue({ id: "user-1" })
    const workspaceFixture = { id: "ws-1", status: "RUNNING" }
    mockVerifyOwnership.mockResolvedValue({ error: null, workspace: workspaceFixture })
    ;(prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      trialUsed: true,
      trialEndsAt: new Date(Date.now() - 86_400_000),
      hasActiveSubscription: false,
      apiKeySource: "PLATFORM_CREDIT",
    })

    await callRoute("ws-1")

    // workspace! mutation matches what destroyContainer wrote to DB.
    expect(workspaceFixture.status).toBe("STOPPED")
  })
})

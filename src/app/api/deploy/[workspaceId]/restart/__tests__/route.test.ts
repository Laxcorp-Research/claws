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

const mockRestartContainer = vi.fn()
vi.mock("@/lib/openclaw/deployer", () => ({
  restartContainer: (...args: unknown[]) => mockRestartContainer(...args),
}))

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { POST } from "@/app/api/deploy/[workspaceId]/restart/route"

async function callRoute(workspaceId = "ws-1") {
  const req = createMockRequest(
    `http://localhost:3000/api/deploy/${workspaceId}/restart`,
    { method: "POST" },
  )
  return POST(req, { params: Promise.resolve({ workspaceId }) })
}

function mockOwnerEligible() {
  ;(prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
    trialUsed: false,
    trialStartedAt: null,
    trialEndsAt: null,
    hasActiveSubscription: true,
  })
}

describe("POST /api/deploy/[workspaceId]/restart - preconditions", () => {
  beforeEach(() => {
    mockRestartContainer.mockReset()
    mockRestartContainer.mockResolvedValue(undefined)
    mockGetSessionUser.mockReset()
    mockVerifyOwnership.mockReset()
  })

  it("returns 401 when not authenticated", async () => {
    mockGetSessionUser.mockResolvedValue(null)
    const res = await callRoute()
    expect(res.status).toBe(401)
  })

  it("returns 404 when workspace not found", async () => {
    mockGetSessionUser.mockResolvedValue({ id: "user-1" })
    mockVerifyOwnership.mockResolvedValue({ error: "NOT_FOUND", workspace: null })
    const res = await callRoute()
    expect(res.status).toBe(404)
  })

  it("returns 403 when user doesn't own workspace", async () => {
    mockGetSessionUser.mockResolvedValue({ id: "user-1" })
    mockVerifyOwnership.mockResolvedValue({ error: "FORBIDDEN", workspace: null })
    const res = await callRoute()
    expect(res.status).toBe(403)
  })

  it("returns 400 WORKSPACE_NOT_RESTARTABLE when containerId is null", async () => {
    mockGetSessionUser.mockResolvedValue({ id: "user-1" })
    mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: "ws-1" } })
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      containerId: null,
      status: "STOPPED",
    })

    const res = await callRoute()
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe("WORKSPACE_NOT_RESTARTABLE")
    expect(mockRestartContainer).not.toHaveBeenCalled()
  })

  it("returns 400 WORKSPACE_NOT_RESTARTABLE when status is STOPPED (has containerId)", async () => {
    mockGetSessionUser.mockResolvedValue({ id: "user-1" })
    mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: "ws-1" } })
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      containerId: "svc-abc",
      status: "STOPPED",
    })

    const res = await callRoute()
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe("WORKSPACE_NOT_RESTARTABLE")
    expect(mockRestartContainer).not.toHaveBeenCalled()
  })

  it("returns 400 WORKSPACE_NOT_RESTARTABLE for HIBERNATED status", async () => {
    mockGetSessionUser.mockResolvedValue({ id: "user-1" })
    mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: "ws-1" } })
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      containerId: "svc-abc",
      status: "HIBERNATED",
    })

    const res = await callRoute()
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe("WORKSPACE_NOT_RESTARTABLE")
  })

  it("returns 400 WORKSPACE_NOT_RESTARTABLE for DEPLOYING status", async () => {
    mockGetSessionUser.mockResolvedValue({ id: "user-1" })
    mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: "ws-1" } })
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      containerId: "svc-abc",
      status: "DEPLOYING",
    })

    const res = await callRoute()
    expect(res.status).toBe(400)
  })

  it("calls restartContainer for RUNNING + containerId workspace", async () => {
    mockGetSessionUser.mockResolvedValue({ id: "user-1" })
    mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: "ws-1" } })
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      containerId: "svc-abc",
      status: "RUNNING",
    })
    mockOwnerEligible()

    const res = await callRoute()
    expect(res.status).toBe(200)
    expect(mockRestartContainer).toHaveBeenCalledWith("ws-1")
  })

  it("calls restartContainer for ERROR + containerId workspace (recovery)", async () => {
    mockGetSessionUser.mockResolvedValue({ id: "user-1" })
    mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: "ws-1" } })
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      containerId: "svc-abc",
      status: "ERROR",
    })
    mockOwnerEligible()

    const res = await callRoute()
    expect(res.status).toBe(200)
    expect(mockRestartContainer).toHaveBeenCalledWith("ws-1")
  })

  it("returns 402 when trial expired + no subscription (even for RUNNING workspace)", async () => {
    mockGetSessionUser.mockResolvedValue({ id: "user-1" })
    mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: "ws-1" } })
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      containerId: "svc-abc",
      status: "RUNNING",
    })
    ;(prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      trialUsed: true,
      trialStartedAt: new Date(Date.now() - 5 * 86_400_000),
      trialEndsAt: new Date(Date.now() - 2 * 86_400_000),
      hasActiveSubscription: false,
    })

    const res = await callRoute()
    expect(res.status).toBe(402)
    expect(mockRestartContainer).not.toHaveBeenCalled()
  })
})

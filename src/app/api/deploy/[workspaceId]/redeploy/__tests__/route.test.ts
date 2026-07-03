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

const mockDeployToCloud = vi.fn()
vi.mock("@/lib/openclaw/deployer", () => ({
  deployToCloud: (...args: unknown[]) => mockDeployToCloud(...args),
}))

import { POST } from "@/app/api/deploy/[workspaceId]/redeploy/route"

async function callRoute(workspaceId = "ws-1") {
  const req = createMockRequest(
    `http://localhost:3000/api/deploy/${workspaceId}/redeploy`,
    { method: "POST" },
  )
  return POST(req, { params: Promise.resolve({ workspaceId }) })
}

function mockOwnedWorkspace(row: { containerId: string | null; status: string }) {
  mockGetSessionUser.mockResolvedValue({ id: "user-1" })
  mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: "ws-1" } })
  ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(row)
  ;(prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
    trialUsed: false,
    trialStartedAt: null,
    trialEndsAt: null,
    hasActiveSubscription: true,
  })
  mockDeployToCloud.mockResolvedValue({ deploymentId: "dep-1", containerId: "svc-1" })
}

describe("POST /api/deploy/[workspaceId]/redeploy", () => {
  beforeEach(() => {
    mockGetSessionUser.mockReset()
    mockVerifyOwnership.mockReset()
    mockDeployToCloud.mockReset()
  })

  it("returns 401 when not authenticated", async () => {
    mockGetSessionUser.mockResolvedValue(null)
    const res = await callRoute()
    expect(res.status).toBe(401)
  })

  it("recovers ERROR + containerId=null by falling through to deployToCloud", async () => {
    mockOwnedWorkspace({ containerId: null, status: "ERROR" })

    const res = await callRoute()

    expect(res.status).toBe(200)
    expect(mockDeployToCloud).toHaveBeenCalledWith("ws-1")
    const json = await res.json()
    expect(json.data.containerId).toBe("svc-1")
  })

  it("recovers STOPPED + containerId=null by falling through to deployToCloud", async () => {
    mockOwnedWorkspace({ containerId: null, status: "STOPPED" })

    const res = await callRoute()

    expect(res.status).toBe(200)
    expect(mockDeployToCloud).toHaveBeenCalledWith("ws-1")
  })

  it("keeps setup states invalid with a clear error body", async () => {
    mockOwnedWorkspace({ containerId: null, status: "DRAFT" })

    const res = await callRoute()

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe("SETUP_REQUIRED")
    expect(json.error.message).toContain("Finish setup before deploying")
    expect(mockDeployToCloud).not.toHaveBeenCalled()
  })

  it("returns a clear busy-state error instead of starting a second deploy", async () => {
    mockOwnedWorkspace({ containerId: "svc-1", status: "DEPLOYING" })

    const res = await callRoute()

    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error.code).toBe("WORKSPACE_BUSY")
    expect(json.error.message).toContain("Wait for the current operation to finish")
    expect(mockDeployToCloud).not.toHaveBeenCalled()
  })

  it("still redeploys a RUNNING workspace with an existing service", async () => {
    mockOwnedWorkspace({ containerId: "svc-1", status: "RUNNING" })

    const res = await callRoute()

    expect(res.status).toBe(200)
    expect(mockDeployToCloud).toHaveBeenCalledWith("ws-1")
  })
})

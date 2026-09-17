import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest, parseResponse } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

vi.mock("@/lib/api/auth", () => ({
  getSessionUser: vi.fn().mockResolvedValue({
    id: "user-test-123",
    email: "test@example.com",
  }),
}))

vi.mock("@/lib/api/ownership", () => ({
  verifyWorkspaceOwnership: vi.fn().mockResolvedValue({ workspace: { id: "ws-1" }, error: null }),
}))

const mockDestroyContainer = vi.fn()
vi.mock("@/lib/openclaw/deployer", () => ({
  destroyContainer: (...args: unknown[]) => mockDestroyContainer(...args),
}))
vi.mock("@/lib/healing/spend-limit", () => ({
  maybeResolveSpendLimitAfterLimitChange: vi.fn().mockResolvedValue(undefined),
}))

import { DELETE, PATCH } from "@/app/api/workspaces/[id]/route"

describe("PATCH /api/workspaces/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDestroyContainer.mockReset().mockResolvedValue(undefined)
    ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ws-1",
      alwaysOn: true,
    })
    ;(prismaMock.workspace.delete as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "ws-1" })
  })

  // PR-C #10: alwaysOn allowlisted for the dashboard "never hibernate" toggle.
  it("allows updating alwaysOn", async () => {
    const req = createMockRequest("http://localhost:3000/api/workspaces/ws-1", {
      method: "PATCH",
      body: { alwaysOn: true },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: "ws-1" }) })
    const { status, data } = await parseResponse(res)

    expect(status).toBe(200)
    expect(data.success).toBe(true)
    expect(prismaMock.workspace.update).toHaveBeenCalledWith({
      where: { id: "ws-1" },
      data: { alwaysOn: true },
    })
  })

  it("allows disabling alwaysOn", async () => {
    const req = createMockRequest("http://localhost:3000/api/workspaces/ws-1", {
      method: "PATCH",
      body: { alwaysOn: false },
    })
    await PATCH(req, { params: Promise.resolve({ id: "ws-1" }) })

    expect(prismaMock.workspace.update).toHaveBeenCalledWith({
      where: { id: "ws-1" },
      data: { alwaysOn: false },
    })
  })

  // MUTATION: dropping "alwaysOn" from the PATCH allowlist would silently no-op
  // this call - the toggle would then always regress to false on next load.
  it("MUTATION: does not silently drop alwaysOn from the update payload", async () => {
    const req = createMockRequest("http://localhost:3000/api/workspaces/ws-1", {
      method: "PATCH",
      body: { alwaysOn: true, name: "unrelated no-op" },
    })
    await PATCH(req, { params: Promise.resolve({ id: "ws-1" }) })

    const call = (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.data).toHaveProperty("alwaysOn", true)
  })

  it("ignores keys outside the allowlist", async () => {
    const req = createMockRequest("http://localhost:3000/api/workspaces/ws-1", {
      method: "PATCH",
      body: { alwaysOn: true, containerId: "should-not-update" },
    })
    await PATCH(req, { params: Promise.resolve({ id: "ws-1" }) })

    const call = (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.data).not.toHaveProperty("containerId")
  })

  it("ignores candidateRuntimeSoak from dashboard PATCH (admin soak route only)", async () => {
    const req = createMockRequest("http://localhost:3000/api/workspaces/ws-1", {
      method: "PATCH",
      body: { candidateRuntimeSoak: true, alwaysOn: false },
    })
    await PATCH(req, { params: Promise.resolve({ id: "ws-1" }) })

    const call = (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.data).not.toHaveProperty("candidateRuntimeSoak")
    expect(call.data).toHaveProperty("alwaysOn", false)
  })

  // Legal §8: every Ask-before-acting -> Autonomous flip is stored as a
  // ConsentRecord, server-side (a bypassed client dialog still leaves
  // evidence). MUTATION: removing the knob-write consent fails these.
  describe("autonomous-mode consent (AUTONOMOUS_MODE_S8)", () => {
    it("APPROVAL_REQUIRED -> AUTO_PROCEED flip writes the consent row", async () => {
      ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        deliveryMode: "APPROVAL_REQUIRED",
      })
      ;(prismaMock.consentRecord.create as ReturnType<typeof vi.fn>).mockResolvedValue({})

      const req = createMockRequest("http://localhost:3000/api/workspaces/ws-1", {
        method: "PATCH",
        body: { deliveryMode: "AUTO_PROCEED" },
      })
      const res = await PATCH(req, { params: Promise.resolve({ id: "ws-1" }) })
      const { status } = await parseResponse(res)

      expect(status).toBe(200)
      expect(prismaMock.consentRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user-test-123",
          kind: "AUTONOMOUS_MODE_S8",
          workspaceId: "ws-1",
          source: "knob-write",
          version: expect.stringMatching(/^\d{4}-\d{2}$/),
        }),
      })
    })

    it("already-AUTO_PROCEED write is not a flip - no duplicate consent row", async () => {
      ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        deliveryMode: "AUTO_PROCEED",
      })

      const req = createMockRequest("http://localhost:3000/api/workspaces/ws-1", {
        method: "PATCH",
        body: { deliveryMode: "AUTO_PROCEED" },
      })
      await PATCH(req, { params: Promise.resolve({ id: "ws-1" }) })

      expect(prismaMock.consentRecord.create).not.toHaveBeenCalled()
    })

    it("switching back to APPROVAL_REQUIRED writes nothing (consent is for autonomy only)", async () => {
      const req = createMockRequest("http://localhost:3000/api/workspaces/ws-1", {
        method: "PATCH",
        body: { deliveryMode: "APPROVAL_REQUIRED" },
      })
      await PATCH(req, { params: Promise.resolve({ id: "ws-1" }) })

      expect(prismaMock.workspace.findUnique).not.toHaveBeenCalled()
      expect(prismaMock.consentRecord.create).not.toHaveBeenCalled()
    })
  })
})

describe("DELETE /api/workspaces/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDestroyContainer.mockReset().mockResolvedValue(undefined)
    ;(prismaMock.workspace.delete as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "ws-1" })
  })

  it("serviceDeletes (destroyContainer) before deleting the workspace row", async () => {
    const req = createMockRequest("http://localhost:3000/api/workspaces/ws-1", {
      method: "DELETE",
    })
    const res = await DELETE(req, { params: Promise.resolve({ id: "ws-1" }) })
    const { status, data } = await parseResponse(res)

    expect(status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data).toEqual({ deleted: true })
    expect(mockDestroyContainer).toHaveBeenCalledWith("ws-1")
    expect(prismaMock.workspace.delete).toHaveBeenCalledWith({ where: { id: "ws-1" } })
    expect(mockDestroyContainer.mock.invocationCallOrder[0]).toBeLessThan(
      (prismaMock.workspace.delete as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
    )
  })
})

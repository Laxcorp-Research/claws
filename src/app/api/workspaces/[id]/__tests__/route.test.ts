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

import { PATCH } from "@/app/api/workspaces/[id]/route"

describe("PATCH /api/workspaces/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ws-1",
      alwaysOn: true,
    })
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
  // this call — the toggle would then always regress to false on next load.
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
})

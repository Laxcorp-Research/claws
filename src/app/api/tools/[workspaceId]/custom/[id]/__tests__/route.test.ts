import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest, parseResponse } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/api/auth", () => ({
  getSessionUser: vi.fn().mockResolvedValue({ id: "user-1", email: "test@example.com" }),
}))

const mockVerifyWorkspaceOwnership = vi.fn()
vi.mock("@/lib/api/ownership", () => ({
  verifyWorkspaceOwnership: (...args: unknown[]) => mockVerifyWorkspaceOwnership(...args),
}))

import { DELETE } from "@/app/api/tools/[workspaceId]/custom/[id]/route"

function req() {
  return createMockRequest("http://localhost:3000/api/tools/ws-1/custom/cust-1", { method: "DELETE" })
}

describe("DELETE /api/tools/[workspaceId]/custom/[id]", () => {
  beforeEach(() => {
    mockVerifyWorkspaceOwnership.mockResolvedValue({ error: null })
  })

  it("deletes the custom API row when the user owns the workspace", async () => {
    ;(prismaMock.customToolConnection.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "cust-1",
      workspaceId: "ws-1",
    })
    ;(prismaMock.customToolConnection.delete as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "cust-1" })

    const res = await DELETE(req(), { params: Promise.resolve({ workspaceId: "ws-1", id: "cust-1" }) })
    const { status, data } = await parseResponse(res)

    expect(status).toBe(200)
    expect(data.success).toBe(true)
    expect(prismaMock.customToolConnection.findFirst).toHaveBeenCalledWith({
      where: { id: "cust-1", workspaceId: "ws-1" },
    })
    expect(prismaMock.customToolConnection.delete).toHaveBeenCalledWith({ where: { id: "cust-1" } })
  })

  it("does not delete a custom API row from another workspace", async () => {
    ;(prismaMock.customToolConnection.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    const res = await DELETE(req(), { params: Promise.resolve({ workspaceId: "ws-1", id: "cust-1" }) })
    const { status } = await parseResponse(res)

    expect(status).toBe(404)
    expect(prismaMock.customToolConnection.delete).not.toHaveBeenCalled()
  })
})

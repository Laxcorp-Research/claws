/**
 * PATCH /api/agents/[workspaceId]/[id] - thinkingDefault contract:
 * accepts a valid OpenClaw level or null, rejects anything else with 400.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockGetSessionUser = vi.fn()
vi.mock("@/lib/api/auth", () => ({ getSessionUser: () => mockGetSessionUser() }))

const mockVerifyOwnership = vi.fn()
vi.mock("@/lib/api/ownership", () => ({
  verifyWorkspaceOwnership: (...args: unknown[]) => mockVerifyOwnership(...args),
}))

import { PATCH } from "@/app/api/agents/[workspaceId]/[id]/route"

const params = { params: Promise.resolve({ workspaceId: "ws-1", id: "agent-1" }) }

function patchReq(body: Record<string, unknown>) {
  return createMockRequest("http://localhost:3000/api/agents/ws-1/agent-1", {
    method: "PATCH",
    body,
  })
}

describe("PATCH /api/agents thinkingDefault validation", () => {
  beforeEach(() => {
    mockGetSessionUser.mockReset()
    mockVerifyOwnership.mockReset()
    mockGetSessionUser.mockResolvedValue({ id: "user-1" })
    mockVerifyOwnership.mockResolvedValue({ error: null })
    ;(prismaMock.agent.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "agent-1",
      thinkingDefault: "high",
    })
  })

  it("persists a valid level", async () => {
    const res = await PATCH(patchReq({ thinkingDefault: "high" }), params)
    expect(res.status).toBe(200)
    expect(prismaMock.agent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ thinkingDefault: "high" }),
      }),
    )
  })

  it("persists null (clears back to runtime default)", async () => {
    const res = await PATCH(patchReq({ thinkingDefault: null }), params)
    expect(res.status).toBe(200)
    expect(prismaMock.agent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ thinkingDefault: null }),
      }),
    )
  })

  it("rejects an unknown level with 400 and never writes", async () => {
    const res = await PATCH(patchReq({ thinkingDefault: "turbo" }), params)
    expect(res.status).toBe(400)
    expect(prismaMock.agent.update).not.toHaveBeenCalled()
  })
})

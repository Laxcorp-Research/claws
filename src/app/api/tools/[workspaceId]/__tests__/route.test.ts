import { describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest, parseResponse } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/api/auth", () => ({
  getSessionUser: vi.fn().mockResolvedValue({ id: "user-test-1" }),
}))
vi.mock("@/lib/api/ownership", () => ({
  verifyWorkspaceOwnership: vi.fn().mockResolvedValue({ error: null }),
}))
vi.mock("@/lib/logger", () => ({
  log: { toolEvent: vi.fn() },
}))

import { POST } from "@/app/api/tools/[workspaceId]/route"

describe("POST /api/tools/[workspaceId] no_auth", () => {
  it("creates a CONNECTED accountless OAUTH_COMPOSIO ToolConnection for no_auth tools", async () => {
    ;(prismaMock.toolConnection.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "tc-no-auth",
      toolSlug: "hackernews",
      displayName: "Hacker News",
      connectionType: "NO_AUTH",
      keyHint: null,
      status: "CONNECTED",
      lastError: null,
      createdAt: new Date(),
    })

    const req = createMockRequest("http://localhost:3000/api/tools/ws-1", {
      method: "POST",
      body: {
        toolSlug: "hackernews",
        displayName: "Hacker News",
        connectionType: "NO_AUTH",
      },
    })
    const res = await POST(req, { params: Promise.resolve({ workspaceId: "ws-1" }) })
    const { status, data } = await parseResponse(res)

    expect(status).toBe(201)
    expect(data.data.status).toBe("CONNECTED")
    expect(prismaMock.toolConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          workspaceId: "ws-1",
          toolSlug: "hackernews",
          connectionType: "NO_AUTH",
          status: "CONNECTED",
          composioConnectionId: null,
          composioEntityId: null,
          lastError: null,
        }),
      }),
    )
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest, parseResponse } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/api/auth", () => ({
  getSessionUser: vi.fn().mockResolvedValue({ id: "user-1", email: "u@test.com" }),
}))
vi.mock("@/lib/api/ownership", () => ({
  verifyWorkspaceOwnership: vi.fn().mockResolvedValue({ error: null, workspace: { id: "ws-1", userId: "user-1" } }),
}))
vi.mock("@/lib/openclaw/deployer", () => ({
  getGatewayConnectionInfo: vi.fn().mockResolvedValue({ wsUrl: "wss://claw.test", token: "gateway-token" }),
}))

import { GET, __setConversationDetailDepsForTests } from "@/app/api/workspaces/[id]/conversations/[sessionKey]/route"
import { getSessionUser } from "@/lib/api/auth"
import { getGatewayConnectionInfo } from "@/lib/openclaw/deployer"

const params = (id = "ws-1", sessionKey = "agent:dev-commander:main") => ({
  params: Promise.resolve({ id, sessionKey }),
})
const get = (sessionKey = "agent:dev-commander:main") =>
  GET(
    createMockRequest(`http://localhost/api/workspaces/ws-1/conversations/${encodeURIComponent(sessionKey)}`, { method: "GET" }),
    params("ws-1", sessionKey),
  )

beforeEach(() => {
  vi.clearAllMocks()
  __setConversationDetailDepsForTests(null)
  ;(getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "user-1", email: "u@test.com" })
  ;(getGatewayConnectionInfo as ReturnType<typeof vi.fn>).mockResolvedValue({ wsUrl: "wss://claw.test", token: "gateway-token" })
  ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
    status: "RUNNING",
    containerHost: "claw.test",
    gatewayToken: "enc-gateway-token",
  } as never)
})

describe("GET /api/workspaces/[id]/conversations/[sessionKey]", () => {
  it("401 when unauthenticated", async () => {
    ;(getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)

    expect((await get()).status).toBe(401)
    expect(prismaMock.workspace.findUniqueOrThrow).not.toHaveBeenCalled()
  })

  it("normalizes a captured gateway history payload shape to role/content/at only", async () => {
    __setConversationDetailDepsForTests({
      history: vi.fn().mockResolvedValue({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "List three repo-hygiene checks" }],
            timestamp: 1781099138123,
            senderLabel: "gateway-client",
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "# Weekly Repo-Hygiene Checks" }],
            api: "anthropic-messages",
            provider: "anthropic",
            model: "claude-haiku-4-5-20251001",
            usage: { cost: { total: 0.02593875 } },
            stopReason: "stop",
            timestamp: "2026-06-10T12:25:40.000Z",
          },
        ],
      }),
    })

    const { status, data } = await parseResponse(await get())

    expect(status).toBe(200)
    expect(data.data).toEqual({
      available: true,
      sessionKey: "agent:dev-commander:main",
      messages: [
        {
          role: "user",
          content: "List three repo-hygiene checks",
          at: "2026-06-10T13:45:38.123Z",
        },
        {
          role: "assistant",
          content: "# Weekly Repo-Hygiene Checks",
          at: "2026-06-10T12:25:40.000Z",
        },
      ],
    })
    expect(JSON.stringify(data.data)).not.toContain("anthropic")
    expect(JSON.stringify(data.data)).not.toContain("gateway-client")
  })

  it("returns available:false when a running workspace cannot read gateway history", async () => {
    __setConversationDetailDepsForTests({
      history: vi.fn().mockResolvedValue(null),
    })

    const { status, data } = await parseResponse(await get())

    expect(status).toBe(200)
    expect(data.data).toEqual({ available: false, reason: "unreachable", messages: [] })
  })
})

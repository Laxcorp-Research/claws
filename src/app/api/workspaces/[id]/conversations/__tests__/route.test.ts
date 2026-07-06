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
vi.mock("@/lib/openclaw/device-identity", () => ({
  decryptDeviceIdentity: vi.fn().mockReturnValue({
    deviceId: "device-1",
    publicKeyRawB64u: "pub",
    privateKeyPem: "pem",
    publicKeyPem: "pub-pem",
  }),
  encryptDeviceIdentity: vi.fn().mockReturnValue("enc-device"),
  generateDeviceIdentity: vi.fn().mockReturnValue({
    deviceId: "device-new",
    publicKeyRawB64u: "pub-new",
    privateKeyPem: "pem-new",
    publicKeyPem: "pub-pem-new",
  }),
}))

import { GET, __setConversationRouteDepsForTests } from "@/app/api/workspaces/[id]/conversations/route"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { getGatewayConnectionInfo } from "@/lib/openclaw/deployer"

const params = (id = "ws-1") => ({ params: Promise.resolve({ id }) })
const get = (id = "ws-1") =>
  GET(createMockRequest(`http://localhost/api/workspaces/${id}/conversations`, { method: "GET" }), params(id))

function runningWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    status: "RUNNING",
    containerHost: "claw.test",
    gatewayToken: "enc-gateway-token",
    chatDeviceKeyEncrypted: "enc-device-key",
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  __setConversationRouteDepsForTests(null)
  ;(getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "user-1", email: "u@test.com" })
  ;(verifyWorkspaceOwnership as ReturnType<typeof vi.fn>).mockResolvedValue({
    error: null,
    workspace: { id: "ws-1", userId: "user-1" },
  })
  ;(getGatewayConnectionInfo as ReturnType<typeof vi.fn>).mockResolvedValue({ wsUrl: "wss://claw.test", token: "gateway-token" })
  ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(runningWorkspace() as never)
})

describe("GET /api/workspaces/[id]/conversations", () => {
  it("401 when unauthenticated", async () => {
    ;(getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)

    expect((await get()).status).toBe(401)
    expect(prismaMock.workspace.findUniqueOrThrow).not.toHaveBeenCalled()
  })

  it("404 / 403 from ownership", async () => {
    ;(verifyWorkspaceOwnership as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ error: "NOT_FOUND", workspace: null })
    expect((await get()).status).toBe(404)

    ;(verifyWorkspaceOwnership as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ error: "FORBIDDEN", workspace: null })
    expect((await get()).status).toBe(403)
  })

  it("returns available:false rather than fabricating an empty available list when the gateway read fails", async () => {
    __setConversationRouteDepsForTests({
      list: vi.fn().mockRejectedValue(new Error("gateway down")),
    })

    const { status, data } = await parseResponse(await get())

    expect(status).toBe(200)
    expect(data.data).toEqual({ available: false, reason: "unreachable", conversations: [] })
  })

  it("returns unavailable for stopped workspaces without contacting the gateway", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      runningWorkspace({ status: "STOPPED" }) as never,
    )
    const list = vi.fn()
    __setConversationRouteDepsForTests({ list })

    const { status, data } = await parseResponse(await get())

    expect(status).toBe(200)
    expect(data.data).toEqual({ available: false, reason: "not_running", conversations: [] })
    expect(list).not.toHaveBeenCalled()
  })

  it("maps gateway sessions to sanitized summaries", async () => {
    const list = vi.fn().mockResolvedValue({
      sessions: [
        {
          sessionKey: "agent:dev-commander:main",
          deliveryContext: { channel: "telegram" },
          lastActivityAt: "2026-07-06T10:00:00.000Z",
          messageCount: 4,
          metadata: { rawSecret: "must-not-leak" },
        },
        {
          key: "agent:unknown:main",
          channelId: "1227037949",
          updatedAt: "2026-07-06T10:05:00.000Z",
        },
      ],
    })
    __setConversationRouteDepsForTests({ list })

    const { status, data } = await parseResponse(await get())

    expect(status).toBe(200)
    expect(data.data).toEqual({
      available: true,
      conversations: [
        {
          sessionKey: "agent:dev-commander:main",
          channelHint: "telegram",
          lastActivityAt: "2026-07-06T10:00:00.000Z",
          messageCount: 4,
        },
        {
          sessionKey: "agent:unknown:main",
          channelHint: "unknown",
          lastActivityAt: "2026-07-06T10:05:00.000Z",
        },
      ],
    })
    expect(JSON.stringify(data.data)).not.toContain("rawSecret")
  })
})

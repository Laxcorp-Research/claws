import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest, parseResponse } from "@/test/helpers/mock-request"
import {
  __clearSnapshotConversationsCacheForTests,
  buildRuntimeStateGzipFixture,
} from "@/lib/openclaw/snapshot-conversations"

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

const NEW_MAIN = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
const OLD_MAIN = "6f484ca3-1111-2222-3333-444444444444"
const AS_OF = new Date("2026-07-11T12:41:00.000Z")

const params = (id = "ws-1", sessionKey = "agent:dev-commander:main") => ({
  params: Promise.resolve({ id, sessionKey }),
})
const get = (sessionKey = "agent:dev-commander:main") =>
  GET(
    createMockRequest(
      `http://localhost/api/workspaces/ws-1/conversations/${encodeURIComponent(sessionKey)}`,
      { method: "GET" },
    ),
    params("ws-1", sessionKey),
  )

beforeEach(() => {
  vi.clearAllMocks()
  __clearSnapshotConversationsCacheForTests()
  __setConversationDetailDepsForTests(null)
  ;(getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "user-1", email: "u@test.com" })
  ;(getGatewayConnectionInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
    wsUrl: "wss://claw.test",
    token: "gateway-token",
  })
  ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
    status: "RUNNING",
    containerHost: "claw.test",
    gatewayToken: "enc-gateway-token",
  } as never)
  ;(prismaMock.containerState.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null as never)
})

describe("GET /api/workspaces/[id]/conversations/[sessionKey]", () => {
  it("401 when unauthenticated", async () => {
    ;(getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)

    expect((await get()).status).toBe(401)
    expect(prismaMock.workspace.findUniqueOrThrow).not.toHaveBeenCalled()
  })

  it("live-path regression: normalizes gateway history to role/content/at only", async () => {
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
      mode: "live",
      sessionKey: "agent:dev-commander:main",
      messages: [
        {
          type: "message",
          role: "user",
          content: "List three repo-hygiene checks",
          at: "2026-06-10T13:45:38.123Z",
        },
        {
          type: "message",
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
    expect(data.data).toEqual({
      available: false,
      reason: "unreachable",
      messages: [],
    })
  })

  it("HIBERNATED serves transcript from snapshot with asOf", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: "HIBERNATED",
      containerHost: null,
      gatewayToken: null,
    } as never)
    const gzip = buildRuntimeStateGzipFixture({
      "agents/dev-commander/sessions/sessions.json": JSON.stringify({
        "agent:dev-commander:main": NEW_MAIN,
      }),
      [`agents/dev-commander/sessions/${NEW_MAIN}.jsonl`]: JSON.stringify({
        role: "user",
        content: "from snapshot",
        timestamp: "2026-07-11T12:42:00.000Z",
      }),
    })
    ;(prismaMock.containerState.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      runtimeStateSnapshot: new Uint8Array(gzip),
      runtimeStateUpdatedAt: AS_OF,
      runtimeStateSizeBytes: 1000,
    } as never)

    const history = vi.fn()
    __setConversationDetailDepsForTests({ history })

    const { data } = await parseResponse(await get("agent:dev-commander:main"))
    expect(history).not.toHaveBeenCalled()
    expect(data.data).toMatchObject({
      available: true,
      mode: "snapshot",
      asOf: AS_OF.toISOString(),
      sessionKey: "agent:dev-commander:main",
    })
    expect(data.data.messages).toEqual([
      expect.objectContaining({ type: "message", role: "user", content: "from snapshot" }),
    ])
  })

  it("live mode serves archived orphaned session from snapshot", async () => {
    const gzip = buildRuntimeStateGzipFixture({
      "agents/dev-commander/sessions/sessions.json": JSON.stringify({
        "agent:dev-commander:main": NEW_MAIN,
      }),
      [`agents/dev-commander/sessions/${NEW_MAIN}.jsonl`]: JSON.stringify({
        role: "user",
        content: "current",
        timestamp: "2026-07-11T12:42:00.000Z",
      }),
      [`agents/dev-commander/sessions/${OLD_MAIN}.jsonl`]: JSON.stringify({
        role: "user",
        content: "Jul 8 orphaned",
        timestamp: "2026-07-08T06:30:00.000Z",
      }),
    })
    ;(prismaMock.containerState.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      runtimeStateSnapshot: new Uint8Array(gzip),
      runtimeStateUpdatedAt: AS_OF,
      runtimeStateSizeBytes: 1000,
    } as never)

    const history = vi.fn()
    __setConversationDetailDepsForTests({ history })

    const { data } = await parseResponse(await get(`orphaned:${OLD_MAIN}`))
    expect(history).not.toHaveBeenCalled()
    expect(data.data).toMatchObject({
      available: true,
      mode: "snapshot",
      asOf: AS_OF.toISOString(),
    })
    expect(data.data.messages).toEqual([
      expect.objectContaining({ content: "Jul 8 orphaned" }),
    ])
  })
})

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
import { SNAPSHOT_UNCOMPRESSED_CEILING_BYTES } from "@/lib/openclaw/snapshot-conversations"

const OLD_MAIN = "6f484ca3-1111-2222-3333-444444444444"
const NEW_MAIN = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
const AS_OF = new Date("2026-07-11T12:41:00.000Z")

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

function mockNoSnapshot() {
  ;(prismaMock.containerState.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null as never)
}

function mockSnapshot(gzip: Buffer, sizeBytes?: number) {
  ;(prismaMock.containerState.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    runtimeStateSnapshot: new Uint8Array(gzip),
    runtimeStateUpdatedAt: AS_OF,
    runtimeStateSizeBytes: sizeBytes ?? gzip.length,
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  __clearSnapshotConversationsCacheForTests()
  __setConversationRouteDepsForTests(null)
  ;(getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "user-1", email: "u@test.com" })
  ;(verifyWorkspaceOwnership as ReturnType<typeof vi.fn>).mockResolvedValue({
    error: null,
    workspace: { id: "ws-1", userId: "user-1" },
  })
  ;(getGatewayConnectionInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
    wsUrl: "wss://claw.test",
    token: "gateway-token",
  })
  ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
    runningWorkspace() as never,
  )
  mockNoSnapshot()
})

describe("GET /api/workspaces/[id]/conversations", () => {
  it("401 when unauthenticated", async () => {
    ;(getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)

    expect((await get()).status).toBe(401)
    expect(prismaMock.workspace.findUniqueOrThrow).not.toHaveBeenCalled()
  })

  it("404 / 403 from ownership", async () => {
    ;(verifyWorkspaceOwnership as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      error: "NOT_FOUND",
      workspace: null,
    })
    expect((await get()).status).toBe(404)

    ;(verifyWorkspaceOwnership as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      error: "FORBIDDEN",
      workspace: null,
    })
    expect((await get()).status).toBe(403)
  })

  it("returns available:false rather than fabricating an empty available list when the gateway read fails", async () => {
    __setConversationRouteDepsForTests({
      list: vi.fn().mockRejectedValue(new Error("gateway down")),
    })

    const { status, data } = await parseResponse(await get())

    expect(status).toBe(200)
    expect(data.data).toEqual({
      available: false,
      reason: "unreachable",
      conversations: [],
      archived: [],
    })
  })

  it("live-path regression: maps gateway sessions to sanitized summaries with archived:[]", async () => {
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
          sessionKey: "agent:dev-commander:subagent:critic:7f2b",
          deliveryContext: { channel: "telegram" },
          lastActivityAt: "2026-07-06T10:03:00.000Z",
          messageCount: 1,
        },
        {
          key: "telegram:1227037949",
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
      mode: "live",
      conversations: [
        {
          sessionKey: "agent:dev-commander:main",
          channelHint: "telegram",
          lastActivityAt: "2026-07-06T10:00:00.000Z",
          messageCount: 4,
        },
        {
          sessionKey: "telegram:1227037949",
          channelHint: "telegram",
          lastActivityAt: "2026-07-06T10:05:00.000Z",
        },
      ],
      archived: [],
    })
    expect(JSON.stringify(data.data)).not.toContain("rawSecret")
    expect(JSON.stringify(data.data)).not.toContain(":subagent:")
  })

  it("stopped without snapshot remains not_running and does not contact the gateway", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      runningWorkspace({ status: "STOPPED" }) as never,
    )
    const list = vi.fn()
    __setConversationRouteDepsForTests({ list })

    const { status, data } = await parseResponse(await get())

    expect(status).toBe(200)
    expect(data.data).toEqual({
      available: false,
      reason: "not_running",
      conversations: [],
      archived: [],
    })
    expect(list).not.toHaveBeenCalled()
  })

  it("HIBERNATED with snapshot serves read-only transcripts + asOf + archived rotated-main", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      runningWorkspace({ status: "HIBERNATED", containerHost: null, gatewayToken: null }) as never,
    )
    const gzip = buildRuntimeStateGzipFixture({
      "agents/dev-commander/sessions/sessions.json": JSON.stringify({
        "agent:dev-commander:main": NEW_MAIN,
      }),
      [`agents/dev-commander/sessions/${NEW_MAIN}.jsonl`]: JSON.stringify({
        role: "user",
        content: "current",
        timestamp: "2026-07-11T12:42:00.000Z",
      }),
      [`agents/dev-commander/sessions/${OLD_MAIN}.jsonl`]: [
        JSON.stringify({
          role: "user",
          content: "Jul 8 pre-rotation",
          timestamp: "2026-07-08T06:30:00.000Z",
        }),
      ].join("\n"),
    })
    mockSnapshot(gzip)
    const list = vi.fn()
    __setConversationRouteDepsForTests({ list })

    const { status, data } = await parseResponse(await get())

    expect(status).toBe(200)
    expect(list).not.toHaveBeenCalled()
    expect(data.data.available).toBe(true)
    expect(data.data.mode).toBe("snapshot")
    expect(data.data.asOf).toBe(AS_OF.toISOString())
    expect(data.data.conversations).toEqual([
      expect.objectContaining({
        sessionKey: "agent:dev-commander:main",
        messageCount: 1,
      }),
    ])
    expect(data.data.archived).toEqual([
      expect.objectContaining({
        sessionKey: `orphaned:${OLD_MAIN}`,
        reason: "rotated-main",
        messageCount: 1,
      }),
    ])
  })

  it("WAKING with snapshot serves snapshot mode (not not_running)", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      runningWorkspace({ status: "WAKING" }) as never,
    )
    const gzip = buildRuntimeStateGzipFixture({
      "agents/a/sessions/sessions.json": JSON.stringify({ "agent:a:main": NEW_MAIN }),
      [`agents/a/sessions/${NEW_MAIN}.jsonl`]: JSON.stringify({
        role: "user",
        content: "hi",
        timestamp: "2026-07-11T00:00:00.000Z",
      }),
    })
    mockSnapshot(gzip)

    const { data } = await parseResponse(await get())
    expect(data.data).toMatchObject({
      available: true,
      mode: "snapshot",
      asOf: AS_OF.toISOString(),
    })
  })

  it("size ceiling returns honest too large - wake to view payload", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      runningWorkspace({ status: "STOPPED" }) as never,
    )
    const gzip = buildRuntimeStateGzipFixture(
      { "agents/a/sessions/sessions.json": "{}" },
      SNAPSHOT_UNCOMPRESSED_CEILING_BYTES + 1,
    )
    mockSnapshot(gzip, SNAPSHOT_UNCOMPRESSED_CEILING_BYTES + 1)

    const { data } = await parseResponse(await get())
    expect(data.data).toEqual({
      available: false,
      reason: "too_large",
      message: "too large - wake to view",
      asOf: AS_OF.toISOString(),
      conversations: [],
      archived: [],
    })
  })

  it("live mode includes archived from snapshot when present", async () => {
    const gzip = buildRuntimeStateGzipFixture({
      "agents/dev-commander/sessions/sessions.json": JSON.stringify({
        "agent:dev-commander:main": NEW_MAIN,
      }),
      [`agents/dev-commander/sessions/${NEW_MAIN}.jsonl`]: JSON.stringify({
        role: "user",
        content: "live-indexed",
        timestamp: "2026-07-11T12:42:00.000Z",
      }),
      [`agents/dev-commander/sessions/${OLD_MAIN}.jsonl`]: JSON.stringify({
        role: "user",
        content: "orphan",
        timestamp: "2026-07-08T06:30:00.000Z",
      }),
    })
    mockSnapshot(gzip)
    __setConversationRouteDepsForTests({
      list: vi.fn().mockResolvedValue({
        sessions: [{ sessionKey: "agent:dev-commander:main", lastActivityAt: "2026-07-11T12:42:00.000Z" }],
      }),
    })

    const { data } = await parseResponse(await get())
    expect(data.data.mode).toBe("live")
    expect(data.data.archived).toEqual([
      expect.objectContaining({ sessionKey: `orphaned:${OLD_MAIN}`, reason: "rotated-main" }),
    ])
  })
})

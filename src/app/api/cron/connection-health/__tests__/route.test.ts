import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/alerts/customer-nudge", () => ({
  sendCustomerNudge: vi.fn().mockResolvedValue({ sent: true, channel: "telegram" }),
}))
vi.mock("@/lib/artifacts/pending-approvals", () => ({
  nudgeStaleWebChatPendingApprovals: vi.fn().mockResolvedValue({
    scanned: 0,
    nudged: 0,
    skippedChannel: 0,
  }),
}))

const mockConnectedAccountsGet = vi.fn()
const mockSessionRetrieve = vi.fn()
const mockValidateToolKey = vi.fn()
const mockDecrypt = vi.fn((value: string) => value)
let composioEnabled = true

vi.mock("@/lib/composio", () => ({
  getComposio: () => (
    composioEnabled
      ? {
          connectedAccounts: { get: mockConnectedAccountsGet },
          client: { toolRouter: { session: { retrieve: mockSessionRetrieve } } },
        }
      : null
  ),
}))
vi.mock("@/lib/encryption", () => ({
  decrypt: (value: string) => mockDecrypt(value),
}))
vi.mock("@/lib/tools/validators", () => {
  const implemented = ["tavily", "binance", "twilio"] as const
  return {
    IMPLEMENTED_SLUGS: implemented,
    hasValidator: (toolSlug: string) => implemented.includes(toolSlug as never),
    validateToolKey: (...args: unknown[]) => mockValidateToolKey(...args),
  }
})

import { GET, __internal } from "@/app/api/cron/connection-health/route"

const CRON_SECRET = "test-cron-secret"

function makeReq(opts: { auth?: string } = {}) {
  const headers: Record<string, string> = {}
  if (opts.auth !== undefined) headers.authorization = opts.auth
  return createMockRequest("http://localhost:3000/api/cron/connection-health", {
    method: "GET",
    headers,
  })
}

function connectedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "tc-1",
    workspaceId: "ws-1",
    toolSlug: "hubspot",
    connectionType: "OAUTH_COMPOSIO",
    composioConnectionId: "ca_hubspot_1",
    ...overrides,
  }
}

function nativeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "tc-native-1",
    workspaceId: "ws-native-1",
    toolSlug: "tavily",
    connectionType: "API_KEY",
    encryptedCredentials: JSON.stringify({ TAVILY_API_KEY: "tvly-test" }),
    ...overrides,
  }
}

function workspaceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ws-mcp-1",
    composioToolRouterSessionId: "trs_live_1",
    ...overrides,
  }
}

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET
  composioEnabled = true
  mockConnectedAccountsGet.mockReset()
  mockSessionRetrieve.mockReset()
  mockValidateToolKey.mockReset()
  mockDecrypt.mockClear()
  mockDecrypt.mockImplementation((value: string) => value)
  ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
})

describe("connection-health status mapping", () => {
  it("maps ACTIVE to healthy metadata only", () => {
    expect(__internal.mapConnectedAccountStatus("ACTIVE")).toEqual({
      kind: "healthy",
      result: "HEALTHY",
    })
  })

  it.each([
    ["INITIATED", "ERROR"],
    ["EXPIRED", "EXPIRED"],
    ["REVOKED", "REVOKED"],
    ["FAILED", "ERROR"],
    ["INACTIVE", "ERROR"],
  ] as const)("maps Composio %s to DB status %s", (raw, status) => {
    expect(__internal.mapConnectedAccountStatus(raw)).toEqual({
      kind: "dead",
      result: raw,
      status,
    })
  })
})

describe("GET /api/cron/connection-health", () => {
  it("rejects missing cron auth", async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it("skips Composio-backed sweeps when COMPOSIO_API_KEY is unavailable but still runs native API-key sweep", async () => {
    composioEnabled = false
    ;(prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])

    const res = await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }))
    expect(res.status).toBe(200)
    expect(prismaMock.toolConnection.findMany).toHaveBeenCalledOnce()
    expect(prismaMock.workspace.findMany).not.toHaveBeenCalled()
  })

  it("scopes to CONNECTED Composio rows on RUNNING or PAUSED workspaces", async () => {
    ;(prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])

    await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }))

    const call = (prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.where).toEqual({
      composioConnectionId: { not: null },
      status: "CONNECTED",
      workspace: { status: { in: ["RUNNING", "PAUSED"] } },
    })
    expect(call.take).toBe(__internal.CONNECTION_HEALTH_BATCH_LIMIT)
  })

  it("MUTATION-anchored: native API-key query applies 20h recheck gate, cap 10, and oldest-checked ordering", async () => {
    composioEnabled = false
    ;(prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])

    await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }))

    const call = (prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.where).toMatchObject({
      connectionType: "API_KEY",
      status: "CONNECTED",
      encryptedCredentials: { not: null },
      toolSlug: { in: ["tavily", "binance", "twilio"] },
      workspace: { status: { in: ["RUNNING", "PAUSED"] } },
    })
    expect(call.where.OR[0]).toEqual({ lastConnectionCheckAt: null })
    expect(call.where.OR[1].lastConnectionCheckAt.lt).toBeInstanceOf(Date)
    expect(call.take).toBe(__internal.NATIVE_API_KEY_BATCH_LIMIT)
    expect(call.orderBy).toEqual([
      { lastConnectionCheckAt: { sort: "asc", nulls: "first" } },
      { updatedAt: "asc" },
    ])
  })

  it("ACTIVE writes HEALTHY check metadata and leaves status untouched", async () => {
    ;(prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([connectedRow()])
    mockConnectedAccountsGet.mockResolvedValue({ status: "ACTIVE" })

    await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }))

    const update = (prismaMock.toolConnection.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(update.where).toEqual({ id: "tc-1" })
    expect(update.data.lastConnectionCheckResult).toBe("HEALTHY")
    expect(update.data.status).toBeUndefined()
  })

  it("EXPIRED flips status and writes dead-state metadata", async () => {
    ;(prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([connectedRow()])
    mockConnectedAccountsGet.mockResolvedValue({ status: "EXPIRED" })

    await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }))

    const update = (prismaMock.toolConnection.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(update.data.status).toBe("EXPIRED")
    expect(update.data.lastConnectionCheckResult).toBe("EXPIRED")
    expect(update.data.lastError).toContain("EXPIRED")
  })

  it("MUTATION-anchored outage guard: SDK throw writes UNREACHABLE only and does not flip status", async () => {
    ;(prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([connectedRow()])
    mockConnectedAccountsGet.mockRejectedValue(new Error("Composio 429 rate limited"))

    await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }))

    const update = (prismaMock.toolConnection.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(update.data.lastConnectionCheckResult).toBe("UNREACHABLE")
    // Deliberately guards the R1 false-positive case: Composio outage must not
    // make users reconnect healthy provider grants.
    expect(update.data.status).toBeUndefined()
  })

  it("native API-key healthy validator writes HEALTHY metadata and leaves status untouched", async () => {
    composioEnabled = false
    ;(prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([nativeRow()])
    mockValidateToolKey.mockResolvedValue({ valid: true })

    const res = await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }))
    expect(res.status).toBe(200)

    expect(mockValidateToolKey).toHaveBeenCalledWith("tavily", { TAVILY_API_KEY: "tvly-test" })
    const update = (prismaMock.toolConnection.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(update.where).toEqual({ id: "tc-native-1" })
    expect(update.data.lastConnectionCheckResult).toBe("HEALTHY")
    expect(update.data.lastError).toBeNull()
    expect(update.data.status).toBeUndefined()
  })

  it("native API-key explicit invalid result flips status to EXPIRED and writes R1 check metadata", async () => {
    composioEnabled = false
    ;(prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([nativeRow()])
    mockValidateToolKey.mockResolvedValue({ valid: false, error: "Invalid Tavily API key" })

    const res = await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }))
    expect(res.status).toBe(200)

    const update = (prismaMock.toolConnection.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(update.data.status).toBe("EXPIRED")
    expect(update.data.lastConnectionCheckResult).toBe("EXPIRED")
    expect(update.data.lastError).toBe("Invalid Tavily API key")
  })

  it("native API-key validator warning writes UNREACHABLE metadata only", async () => {
    composioEnabled = false
    ;(prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([nativeRow()])
    mockValidateToolKey.mockResolvedValue({ valid: true, warning: "Provider rate-limited the check" })

    const res = await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }))
    expect(res.status).toBe(200)

    const update = (prismaMock.toolConnection.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(update.data.lastConnectionCheckResult).toBe("UNREACHABLE")
    expect(update.data.status).toBeUndefined()
  })

  it("MUTATION-anchored native outage guard: validator throw writes UNREACHABLE only and does not flip status", async () => {
    composioEnabled = false
    ;(prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([nativeRow()])
    mockValidateToolKey.mockRejectedValue(new Error("fetch failed"))

    const res = await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }))
    expect(res.status).toBe(200)

    const update = (prismaMock.toolConnection.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(update.data.lastConnectionCheckResult).toBe("UNREACHABLE")
    expect(update.data.status).toBeUndefined()
  })

  it("defensively skips native API-key rows when no validator exists", async () => {
    composioEnabled = false
    ;(prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      nativeRow({ toolSlug: "mailgun" }),
    ])

    const res = await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }))
    const body = await res.json()

    expect(body.data.nativeApiKeys.skippedNoValidator).toBe(1)
    expect(mockValidateToolKey).not.toHaveBeenCalled()
    expect(prismaMock.toolConnection.update).not.toHaveBeenCalled()
  })

  it("retrieve-dead marks the Tool Router session DEAD", async () => {
    ;(prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([workspaceRow()])
    const notFound = new Error("session not found")
    ;(notFound as Error & { status?: number }).status = 404
    mockSessionRetrieve.mockRejectedValue(notFound)

    await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }))

    const update = (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(update.where).toEqual({ id: "ws-mcp-1" })
    expect(update.data.mcpSessionHealthStatus).toBe("DEAD")
    expect(update.data.mcpSessionLastError).toContain("session not found")
  })

  it("MUTATION-anchored session outage guard: retrieve throw writes UNREACHABLE, not DEAD", async () => {
    ;(prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([workspaceRow()])
    const outage = new Error("Composio 500")
    ;(outage as Error & { status?: number }).status = 500
    mockSessionRetrieve.mockRejectedValue(outage)

    await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }))

    const update = (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(update.data.mcpSessionHealthStatus).toBe("UNREACHABLE")
    expect(update.data.mcpSessionHealthStatus).not.toBe("DEAD")
  })

  it("caps Tool Router session checks at 25 and requests oldest-checked first", async () => {
    ;(prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
    const eligible = Array.from({ length: 26 }, (_, i) => workspaceRow({
      id: `ws-mcp-${i + 1}`,
      composioToolRouterSessionId: `trs_${i + 1}`,
    }))
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockImplementation((args: { take?: number }) => {
      return Promise.resolve(eligible.slice(0, args.take ?? eligible.length))
    })
    mockSessionRetrieve.mockResolvedValue({ session_id: "trs_ok" })

    await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }))

    const findCall = (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(findCall.take).toBe(__internal.MCP_SESSION_HEALTH_BATCH_LIMIT)
    expect(findCall.orderBy).toEqual([
      { mcpSessionCheckedAt: { sort: "asc", nulls: "first" } },
      { updatedAt: "asc" },
    ])
    expect(mockSessionRetrieve).toHaveBeenCalledTimes(25)
    expect(prismaMock.workspace.update).toHaveBeenCalledTimes(25)
  })
})

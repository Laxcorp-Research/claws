import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const mockConnectedAccountsGet = vi.fn()
const mockSessionRetrieve = vi.fn()
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

  it("cleanly no-ops when COMPOSIO_API_KEY is unavailable", async () => {
    composioEnabled = false
    const res = await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }))
    expect(res.status).toBe(200)
    expect(prismaMock.toolConnection.findMany).not.toHaveBeenCalled()
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

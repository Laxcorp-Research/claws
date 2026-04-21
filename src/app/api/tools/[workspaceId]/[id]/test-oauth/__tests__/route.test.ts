// PR #5 — tests for POST /api/tools/[workspaceId]/[id]/test-oauth.
//
// Covers the classification paths the route branches on, plus the DB
// transition contract (EXPIRED is the ONLY status the route writes on
// its own — every other outcome leaves the row alone).
//
// Composio SDK is mocked. Prisma is the shared prismaMock. Auth +
// ownership are stubbed via vi.mock the same way the workspaces route
// test does it (see src/app/api/workspaces/__tests__/route.test.ts).

import { describe, it, expect, vi, beforeEach } from "vitest"
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
  verifyWorkspaceOwnership: vi.fn().mockResolvedValue({ error: null }),
}))

// Composio SDK mock — we control what tools.retrieve + tools.execute do
// per-test via the exported handles below.
const mockToolsRetrieve = vi.fn()
const mockToolsExecute = vi.fn()

vi.mock("@/lib/composio", () => ({
  getComposio: () => ({
    tools: { execute: mockToolsExecute },
    getClient: () => ({ tools: { retrieve: mockToolsRetrieve } }),
  }),
  getComposioUserId: (id: string) => `claws_${id}`,
}))

import { POST } from "@/app/api/tools/[workspaceId]/[id]/test-oauth/route"

const WORKSPACE_ID = "ws-1"
const CONN_ID = "conn-1"
const COMPOSIO_CONN_ID = "ca_test1234567890"

function baseOAuthConnection(overrides: Record<string, unknown> = {}) {
  return {
    id: CONN_ID,
    workspaceId: WORKSPACE_ID,
    toolSlug: "gmail",
    connectionType: "OAUTH_COMPOSIO",
    displayName: "Gmail",
    status: "CONNECTED",
    encryptedApiKey: null,
    encryptedCredentials: null,
    keyHint: null,
    composioConnectionId: COMPOSIO_CONN_ID,
    composioEntityId: "claws_user-test-123",
    lastTestedAt: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

async function callRoute(workspaceId = WORKSPACE_ID, id = CONN_ID) {
  const req = createMockRequest(
    `http://localhost:3000/api/tools/${workspaceId}/${id}/test-oauth`,
    { method: "POST" },
  )
  const res = await POST(req, { params: Promise.resolve({ workspaceId, id }) })
  return parseResponse(res)
}

beforeEach(() => {
  mockToolsRetrieve.mockReset()
  mockToolsExecute.mockReset()
  mockToolsRetrieve.mockResolvedValue({ available_versions: ["20260420_00"] })
})

describe("POST /api/tools/[workspaceId]/[id]/test-oauth — auth & validation", () => {
  it("returns 401 when not authenticated", async () => {
    const { getSessionUser } = await import("@/lib/api/auth")
    ;(getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    const { status } = await callRoute()
    expect(status).toBe(401)
  })

  it("returns 404 when the connection doesn't exist", async () => {
    ;(prismaMock.toolConnection.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const { status } = await callRoute()
    expect(status).toBe(404)
  })

  it("rejects API_KEY connections (they use /test, not /test-oauth)", async () => {
    ;(prismaMock.toolConnection.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      baseOAuthConnection({ connectionType: "API_KEY" }),
    )
    const { status, data } = await callRoute()
    expect(status).toBe(400)
    expect(data.error?.message).toMatch(/API-key connections.*tested via \/test/i)
  })

  it("rejects when composioConnectionId is missing", async () => {
    ;(prismaMock.toolConnection.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      baseOAuthConnection({ composioConnectionId: null }),
    )
    const { status } = await callRoute()
    expect(status).toBe(400)
  })

  it("returns TOOL_TEST_UNSUPPORTED for Asana (GH #41)", async () => {
    ;(prismaMock.toolConnection.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      baseOAuthConnection({ toolSlug: "asana" }),
    )
    const { status, data } = await callRoute()
    expect(status).toBe(400)
    expect(data.error?.code).toBe("TOOL_TEST_UNSUPPORTED")
    // The tooltip copy that will also appear on the disabled button.
    expect(data.error?.message).toMatch(/not yet supported/i)
    // Asana should never reach the Composio layer.
    expect(mockToolsRetrieve).not.toHaveBeenCalled()
    expect(mockToolsExecute).not.toHaveBeenCalled()
  })

  it("returns TOOL_TEST_NOT_REGISTERED for a toolkit with no cheap-op", async () => {
    ;(prismaMock.toolConnection.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      baseOAuthConnection({ toolSlug: "unknown_toolkit_slug" }),
    )
    const { status, data } = await callRoute()
    expect(status).toBe(400)
    expect(data.error?.code).toBe("TOOL_TEST_NOT_REGISTERED")
  })
})

describe("POST /api/tools/[workspaceId]/[id]/test-oauth — probe outcomes", () => {
  beforeEach(() => {
    ;(prismaMock.toolConnection.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      baseOAuthConnection(),
    )
    ;(prismaMock.toolConnection.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: CONN_ID,
      status: "CONNECTED",
    })
  })

  it("returns working + updates lastTestedAt when successful:true comes back", async () => {
    mockToolsExecute.mockResolvedValue({ successful: true, data: {}, error: null })

    const { status, data } = await callRoute()

    expect(status).toBe(200)
    expect(data.data.ok).toBe(true)
    expect(data.data.state).toBe("working")
    // lastTestedAt updated, but NO status change
    expect(prismaMock.toolConnection.update).toHaveBeenCalledWith({
      where: { id: CONN_ID },
      data: { lastTestedAt: expect.any(Date), lastError: null },
    })
  })

  it("returns expired + writes DB EXPIRED when Composio resolves with HTTP 401 error", async () => {
    mockToolsExecute.mockResolvedValue({
      successful: false,
      error: "HTTP 401: Request had invalid authentication credentials.",
      data: { status_code: 401 },
    })

    const { status, data } = await callRoute()

    expect(status).toBe(200)
    expect(data.data.ok).toBe(false)
    expect(data.data.state).toBe("expired")
    expect(prismaMock.toolConnection.update).toHaveBeenCalledWith({
      where: { id: CONN_ID },
      data: {
        status: "EXPIRED",
        lastTestedAt: expect.any(Date),
        lastError: expect.stringMatching(/EXPIRED.*revoked/i),
      },
    })
  })

  it("returns expired + writes DB EXPIRED when Composio THROWS with 401 in nested cause", async () => {
    // This is the shape the 500-validate probe observed for whoami-style
    // ops: SDK throws, real 401 lives in err.cause.
    mockToolsExecute.mockRejectedValue(
      Object.assign(new Error("Error executing the tool GMAIL_GET_PROFILE"), {
        cause: { error: "HTTP 401: Request had invalid authentication credentials." },
      }),
    )

    const { data } = await callRoute()

    expect(data.data.state).toBe("expired")
    expect(prismaMock.toolConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "EXPIRED" }),
      }),
    )
  })

  it("returns error WITHOUT DB write on toolkit_mismatch", async () => {
    // toolkit_mismatch shouldn't happen in production (the route looks up
    // by toolkit), but if it does, we MUST NOT write EXPIRED — that would
    // lie to the user about their connection health.
    mockToolsExecute.mockRejectedValue(
      Object.assign(new Error("Error executing the tool GMAIL_GET_PROFILE"), {
        response: { error: "No connected account found for toolkit foo" },
      }),
    )

    const { data } = await callRoute()

    expect(data.data.ok).toBe(false)
    expect(data.data.state).toBe("error")
    // CRITICAL: DB write must NOT fire on toolkit_mismatch
    const updateCalls = (prismaMock.toolConnection.update as ReturnType<typeof vi.fn>).mock.calls
    const statusChanges = updateCalls.filter((call) => call[0].data.status)
    expect(statusChanges).toHaveLength(0)
  })

  it("returns error WITHOUT DB write when the probe times out", async () => {
    // Simulate a hang: tools.execute never resolves within the 5s budget.
    // We fake this by making it resolve after 6s while the route's timer
    // wins. Using real timers here because the route uses setTimeout
    // directly; faking would require more plumbing and the test runs fast
    // enough with a tiny PROMISE_DELAY constant.
    mockToolsExecute.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ successful: true }), 6_000)),
    )

    // To keep the test fast, we lean on vitest's timer control.
    vi.useFakeTimers()
    const callPromise = callRoute()
    await vi.advanceTimersByTimeAsync(5_500)
    const { data } = await callPromise
    vi.useRealTimers()

    expect(data.data.ok).toBe(false)
    expect(data.data.state).toBe("error")
    const updateCalls = (prismaMock.toolConnection.update as ReturnType<typeof vi.fn>).mock.calls
    const statusChanges = updateCalls.filter((call) => call[0].data.status)
    expect(statusChanges).toHaveLength(0)
  })

  it("returns error + message when version resolution fails", async () => {
    mockToolsRetrieve.mockRejectedValueOnce(new Error("version API down"))

    const { data } = await callRoute()

    expect(data.data.ok).toBe(false)
    expect(data.data.state).toBe("error")
    expect(data.data.message).toMatch(/resolve tool version/i)
    // And tools.execute should never have been called.
    expect(mockToolsExecute).not.toHaveBeenCalled()
    // DB must NOT change on version resolve failure.
    const updateCalls = (prismaMock.toolConnection.update as ReturnType<typeof vi.fn>).mock.calls
    const statusChanges = updateCalls.filter((call) => call[0].data.status)
    expect(statusChanges).toHaveLength(0)
  })
})

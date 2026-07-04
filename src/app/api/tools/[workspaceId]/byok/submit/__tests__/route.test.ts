// PR2.9 — integration tests for POST /api/tools/[ws]/byok/submit.
//
// Coverage targets:
//   - Auth-guard: 401 when unauthenticated, 403/404 on workspace ownership fail
//   - Validation: rejects empty toolSlug / apiKey
//   - Wrong-toolkit guard: 400 if toolkit isn't BYOK-eligible (managed-OAuth)
//   - Happy path: creates ToolConnection with status CONNECTED, returns 200
//   - Security: user-supplied apiKey never appears in any log call

import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest, parseResponse } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/api/auth", () => ({
  getSessionUser: vi.fn().mockResolvedValue({
    id: "user-test-1",
    email: "test@example.com",
  }),
}))
vi.mock("@/lib/api/ownership", () => ({
  verifyWorkspaceOwnership: vi.fn().mockResolvedValue({ error: null }),
}))

// `vi.mock` is hoisted above any const declarations at the top level,
// so the mock factory cannot reference module-scoped `vi.fn()` vars
// directly. `vi.hoisted` co-elevates the spy declarations so the factory
// can read them. Same pattern used in other route tests in this repo.
const { logInfo, logError, logWarn, logToolEvent } = vi.hoisted(() => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logToolEvent: vi.fn(),
}))
vi.mock("@/lib/logger", () => ({
  log: {
    info: logInfo,
    error: logError,
    warn: logWarn,
    toolEvent: logToolEvent,
  },
}))

vi.mock("@composio/core", () => ({
  AuthScheme: {
    APIKey: (params: { api_key?: string }) => ({
      __scheme: "API_KEY" as const,
      api_key: params.api_key,
    }),
    BearerToken: (params: { token: string }) => ({
      __scheme: "BEARER_TOKEN" as const,
      token: params.token,
    }),
    Basic: (params: { username: string; password: string }) => ({
      __scheme: "BASIC" as const,
      username: params.username,
      password: params.password,
    }),
  },
}))

const mockToolkitsGet = vi.fn()
const mockAuthConfigsList = vi.fn()
const mockAuthConfigsCreate = vi.fn()
const mockConnectedAccountsInitiate = vi.fn()

vi.mock("@/lib/composio", () => ({
  getComposio: () => ({
    toolkits: { get: mockToolkitsGet },
    authConfigs: { list: mockAuthConfigsList, create: mockAuthConfigsCreate },
    connectedAccounts: { initiate: mockConnectedAccountsInitiate },
  }),
  getComposioUserId: (id: string) => `claws_${id}`,
}))

import { POST } from "@/app/api/tools/[workspaceId]/byok/submit/route"

const WORKSPACE_ID = "ws-test-1"

async function callRoute(body: unknown) {
  const req = createMockRequest(
    `http://localhost:3000/api/tools/${WORKSPACE_ID}/byok/submit`,
    { method: "POST", body },
  )
  const res = await POST(req, { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) })
  return parseResponse(res)
}

beforeEach(() => {
  mockToolkitsGet.mockReset()
  mockAuthConfigsList.mockReset()
  mockAuthConfigsCreate.mockReset()
  mockConnectedAccountsInitiate.mockReset()
  logInfo.mockReset()
  logError.mockReset()
  logWarn.mockReset()
  logToolEvent.mockReset()

  ;(prismaMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
    async (cb: (tx: typeof prismaMock) => Promise<unknown>) => cb(prismaMock),
  )
  ;(prismaMock.toolConnection.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "tc-byok-1",
    toolSlug: "typefully",
    status: "CONNECTED",
  })
})

describe("POST /api/tools/[workspaceId]/byok/submit", () => {
  it("returns 400 when toolSlug is missing", async () => {
    const { status } = await callRoute({ apiKey: "some-key" })
    expect(status).toBe(400)
    expect(mockConnectedAccountsInitiate).not.toHaveBeenCalled()
  })

  it("returns 400 when apiKey is missing or blank", async () => {
    const { status: blank } = await callRoute({ toolSlug: "typefully", apiKey: "  " })
    expect(blank).toBe(400)
    const { status: missing } = await callRoute({ toolSlug: "typefully" })
    expect(missing).toBe(400)
    expect(mockConnectedAccountsInitiate).not.toHaveBeenCalled()
  })

  it("returns 400 BYOK_NOT_SUPPORTED_FOR_TOOLKIT for managed-OAuth toolkits", async () => {
    // Defense: malicious client POSTing for a managed-OAuth slug (gmail)
    // would otherwise create a junk connection that 401s at execute time.
    mockToolkitsGet.mockResolvedValue({
      slug: "gmail",
      name: "Gmail",
      composioManagedAuthSchemes: ["OAUTH2"],
      authConfigDetails: [{ mode: "OAUTH2" }],
    })

    const { status, data } = await callRoute({ toolSlug: "gmail", apiKey: "x" })
    expect(status).toBe(400)
    expect(data.error.code).toBe("BYOK_NOT_SUPPORTED_FOR_TOOLKIT")
    expect(mockConnectedAccountsInitiate).not.toHaveBeenCalled()
  })

  it("happy path: creates CONNECTED ToolConnection row + returns 200", async () => {
    mockToolkitsGet.mockResolvedValue({
      slug: "typefully",
      name: "Typefully",
      composioManagedAuthSchemes: [],
      authConfigDetails: [{ mode: "API_KEY" }],
    })
    mockAuthConfigsList.mockResolvedValue({
      items: [{ id: "ac_byok_typefully", isComposioManaged: false }],
    })
    mockConnectedAccountsInitiate.mockResolvedValue({
      id: "ca_user_byok_typefully",
      status: "ACTIVE",
      redirectUrl: null,
    })

    const { status, data } = await callRoute({
      toolSlug: "typefully",
      apiKey: "user-supplied-key",
    })
    expect(status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.connection.status).toBe("CONNECTED")

    expect(prismaMock.toolConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId_toolSlug: { workspaceId: WORKSPACE_ID, toolSlug: "typefully" } },
        create: expect.objectContaining({
          connectionType: "OAUTH_COMPOSIO",
          composioConnectionId: "ca_user_byok_typefully",
          composioEntityId: "claws_user-test-1",
          status: "CONNECTED",
        }),
      }),
    )
  })

  it("BEARER live toolkit creates a BEARER_TOKEN connected account and stores OAUTH_COMPOSIO row", async () => {
    mockToolkitsGet.mockResolvedValue({
      slug: "bearer-tool",
      name: "Bearer Tool",
      composioManagedAuthSchemes: [],
      authConfigDetails: [{ mode: "BEARER_TOKEN" }],
    })
    mockAuthConfigsList.mockResolvedValue({
      items: [{ id: "ac_byok_bearer", isComposioManaged: false, authScheme: "BEARER_TOKEN" }],
    })
    mockConnectedAccountsInitiate.mockResolvedValue({
      id: "ca_user_byok_bearer",
      status: "ACTIVE",
      redirectUrl: null,
    })

    const { status } = await callRoute({
      toolSlug: "bearer-tool",
      credentials: { BEARER_TOOL_BEARER_TOKEN: "bearer-real-token" },
    })
    expect(status).toBe(200)
    expect(mockConnectedAccountsInitiate).toHaveBeenCalledWith(
      "claws_user-test-1",
      "ac_byok_bearer",
      { config: { __scheme: "BEARER_TOKEN", token: "bearer-real-token" } },
    )
    expect(prismaMock.toolConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          toolSlug: "bearer-tool",
          connectionType: "OAUTH_COMPOSIO",
          composioConnectionId: "ca_user_byok_bearer",
          status: "CONNECTED",
        }),
      }),
    )
  })

  it("user-supplied API key is NEVER logged (route-level security tripwire)", async () => {
    mockToolkitsGet.mockResolvedValue({
      slug: "typefully",
      name: "Typefully",
      composioManagedAuthSchemes: [],
      authConfigDetails: [{ mode: "API_KEY" }],
    })
    mockAuthConfigsList.mockResolvedValue({
      items: [{ id: "ac_byok_typefully", isComposioManaged: false }],
    })
    mockConnectedAccountsInitiate.mockResolvedValue({
      id: "ca_user_byok_typefully",
      status: "ACTIVE",
      redirectUrl: null,
    })

    const SENSITIVE_KEY = "route-test-secret-key-XYZ"
    await callRoute({ toolSlug: "typefully", apiKey: SENSITIVE_KEY })

    const allLogArgs = [
      ...logInfo.mock.calls,
      ...logError.mock.calls,
      ...logWarn.mock.calls,
      ...logToolEvent.mock.calls,
    ].map((args) => JSON.stringify(args))
    expect(allLogArgs.join("\n")).not.toContain(SENSITIVE_KEY)
  })

  it("returns 401 when unauthenticated", async () => {
    const { getSessionUser } = await import("@/lib/api/auth")
    ;(getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    const { status } = await callRoute({ toolSlug: "typefully", apiKey: "x" })
    expect(status).toBe(401)
  })
})

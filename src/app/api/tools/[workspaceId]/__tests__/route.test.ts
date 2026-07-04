import { beforeEach, describe, expect, it, vi } from "vitest"
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
  log: { toolEvent: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/encryption", () => ({
  encrypt: vi.fn((value: string) => `enc:${value}`),
  generateKeyHint: vi.fn((value: string) => `${value.slice(0, 4)}...`),
}))
const mockValidateToolKey = vi.fn()
vi.mock("@/lib/tools/validators", () => ({
  validateToolKey: (...args: unknown[]) => mockValidateToolKey(...args),
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
const mockConnectedAccountsInitiate = vi.fn()
vi.mock("@/lib/composio", () => ({
  getComposio: () => ({
    toolkits: { get: mockToolkitsGet },
    authConfigs: { list: mockAuthConfigsList, create: vi.fn() },
    connectedAccounts: { initiate: mockConnectedAccountsInitiate },
  }),
  getComposioUserId: (id: string) => `claws_${id}`,
}))

import { POST } from "@/app/api/tools/[workspaceId]/route"

beforeEach(() => {
  mockValidateToolKey.mockReset()
  mockToolkitsGet.mockReset()
  mockAuthConfigsList.mockReset()
  mockConnectedAccountsInitiate.mockReset()
  ;(prismaMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
    async (cb: (tx: typeof prismaMock) => Promise<unknown>) => cb(prismaMock),
  )
})

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

describe("POST /api/tools/[workspaceId] API_KEY B3 routing", () => {
  it("routes uncurated static API_KEY connects through BYOK broker and writes OAUTH_COMPOSIO connection id", async () => {
    ;(prismaMock.skill.count as ReturnType<typeof vi.fn>).mockResolvedValue(0)
    mockToolkitsGet.mockResolvedValue({
      slug: "serp_api",
      name: "SerpAPI",
      composioManagedAuthSchemes: [],
      authConfigDetails: [{ mode: "API_KEY" }],
    })
    mockAuthConfigsList.mockResolvedValue({
      items: [{ id: "ac_byok_serp", isComposioManaged: false, authScheme: "API_KEY" }],
    })
    mockConnectedAccountsInitiate.mockResolvedValue({
      id: "ca_serp_byok",
      status: "ACTIVE",
    })
    ;(prismaMock.toolConnection.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "tc-serp",
      toolSlug: "serp_api",
      displayName: "SerpAPI",
      connectionType: "OAUTH_COMPOSIO",
      keyHint: null,
      status: "CONNECTED",
      lastError: null,
      createdAt: new Date(),
    })

    const req = createMockRequest("http://localhost:3000/api/tools/ws-1", {
      method: "POST",
      body: {
        toolSlug: "serp_api",
        displayName: "SerpAPI",
        connectionType: "API_KEY",
        credentials: { SERPAPI_API_KEY: "serp-real-key" },
      },
    })
    const res = await POST(req, { params: Promise.resolve({ workspaceId: "ws-1" }) })
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    expect(mockValidateToolKey).not.toHaveBeenCalled()
    expect(mockConnectedAccountsInitiate).toHaveBeenCalledWith(
      "claws_user-test-1",
      "ac_byok_serp",
      { config: { __scheme: "API_KEY", api_key: "serp-real-key" } },
    )
    expect(prismaMock.toolConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          connectionType: "OAUTH_COMPOSIO",
          encryptedCredentials: null,
          composioConnectionId: "ca_serp_byok",
          composioEntityId: "claws_user-test-1",
          status: "CONNECTED",
        }),
      }),
    )
  })

  it("keeps curated static API_KEY connects local when a compatible Skill exists", async () => {
    ;(prismaMock.skill.count as ReturnType<typeof vi.fn>).mockResolvedValue(1)
    mockValidateToolKey.mockResolvedValue({ valid: true })
    ;(prismaMock.toolConnection.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "tc-tavily",
      toolSlug: "tavily",
      displayName: "Tavily",
      connectionType: "API_KEY",
      keyHint: "tvly...",
      status: "CONNECTED",
      lastError: null,
      createdAt: new Date(),
    })

    const req = createMockRequest("http://localhost:3000/api/tools/ws-1", {
      method: "POST",
      body: {
        toolSlug: "tavily",
        displayName: "Tavily",
        connectionType: "API_KEY",
        credentials: { TAVILY_API_KEY: "tvly-real-key" },
      },
    })
    const res = await POST(req, { params: Promise.resolve({ workspaceId: "ws-1" }) })
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    expect(mockConnectedAccountsInitiate).not.toHaveBeenCalled()
    expect(mockValidateToolKey).toHaveBeenCalledWith("tavily", { TAVILY_API_KEY: "tvly-real-key" })
    expect(prismaMock.toolConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          connectionType: "API_KEY",
          encryptedCredentials: 'enc:{"TAVILY_API_KEY":"tvly-real-key"}',
          status: "CONNECTED",
        }),
      }),
    )
  })
})

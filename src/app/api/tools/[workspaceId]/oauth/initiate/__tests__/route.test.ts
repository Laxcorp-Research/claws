// PR2.8a-fix1 Task 9 — integration tests for POST /api/tools/[ws]/oauth/initiate.
//
// Coverage targets (locked, regress on change):
//   - YELLOW toolkit (outlook): first request hits ensureAuthConfigForToolkit,
//     SDK creates the auth config, route returns 200 with OAuth redirect URL.
//   - GREEN toolkit (gmail): existing config short-circuits — no SDK create,
//     route returns 200.
//   - RED-state toolkit at runtime: composioManagedAuthSchemes is empty;
//     ensureAuthConfigForToolkit throws ComposioToolkitRequiresCustomOAuthError;
//     route returns 422 with code COMPOSIO_TOOLKIT_REQUIRES_CUSTOM_OAUTH.

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
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Composio SDK mock — drives the ensureAuthConfigForToolkit helper indirectly.
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

import { POST } from "@/app/api/tools/[workspaceId]/oauth/initiate/route"

const WORKSPACE_ID = "ws-1"

async function callRoute(toolSlug: string) {
  const req = createMockRequest(
    `http://localhost:3000/api/tools/${WORKSPACE_ID}/oauth/initiate`,
    { method: "POST", body: { toolSlug } },
  )
  const res = await POST(req, {
    params: Promise.resolve({ workspaceId: WORKSPACE_ID }),
  })
  return parseResponse(res)
}

beforeEach(() => {
  mockToolkitsGet.mockReset()
  mockAuthConfigsList.mockReset()
  mockAuthConfigsCreate.mockReset()
  mockConnectedAccountsInitiate.mockReset()

  // The advisory-lock raw query path runs through prisma.$transaction inside
  // the helper. Mock it here so the helper's tx.$queryRaw calls land on
  // prismaMock's $queryRaw, which we configure per-test.
  ;(prismaMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
    async (cb: (tx: typeof prismaMock) => Promise<unknown>) => cb(prismaMock),
  )
  ;(prismaMock.toolConnection.upsert as ReturnType<typeof vi.fn>).mockResolvedValue(
    { id: "tc-1" },
  )
})

describe("POST /api/tools/[workspaceId]/oauth/initiate", () => {
  it("YELLOW toolkit (outlook): triggers SDK create and returns 200 with OAuth redirect URL", async () => {
    mockToolkitsGet.mockResolvedValue({
      slug: "outlook",
      name: "Outlook",
      composioManagedAuthSchemes: ["OAUTH2"],
    })
    // Initial list (step 3): empty. In-lock list (step 4): also empty.
    mockAuthConfigsList
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] })
    mockAuthConfigsCreate.mockResolvedValue({ id: "ac_outlook_new" })
    ;(prismaMock.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ pg_try_advisory_lock: true }])
      .mockResolvedValueOnce([{ pg_advisory_unlock: true }])
    mockConnectedAccountsInitiate.mockResolvedValue({
      id: "conn_outlook_1",
      redirectUrl: "https://composio/consent/outlook",
    })

    const { status, data } = await callRoute("outlook")
    expect(status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.redirectUrl).toBe("https://composio/consent/outlook")
    expect(mockAuthConfigsCreate).toHaveBeenCalledTimes(1)
    expect(mockAuthConfigsCreate).toHaveBeenCalledWith("outlook", {
      type: "use_composio_managed_auth",
      name: "Outlook (Claws)",
    })
    expect(mockConnectedAccountsInitiate).toHaveBeenCalledWith(
      "claws_user-test-123",
      "ac_outlook_new",
      expect.objectContaining({ allowMultiple: true }),
    )
  })

  it("GREEN toolkit (gmail): existing auth config short-circuits, no SDK create, returns 200", async () => {
    mockToolkitsGet.mockResolvedValue({
      slug: "gmail",
      name: "Gmail",
      composioManagedAuthSchemes: ["OAUTH2"],
    })
    mockAuthConfigsList.mockResolvedValueOnce({
      items: [{ id: "ac_gmail_existing" }],
    })
    mockConnectedAccountsInitiate.mockResolvedValue({
      id: "conn_gmail_1",
      redirectUrl: "https://composio/consent/gmail",
    })

    const { status, data } = await callRoute("gmail")
    expect(status).toBe(200)
    expect(data.success).toBe(true)
    // Idempotency: existing config is reused.
    expect(mockAuthConfigsCreate).not.toHaveBeenCalled()
    expect(mockConnectedAccountsInitiate).toHaveBeenCalledWith(
      "claws_user-test-123",
      "ac_gmail_existing",
      expect.any(Object),
    )
    // No advisory-lock dance on the early-exit path.
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it("RED toolkit (twitter — managed schemes empty): returns 422 with COMPOSIO_TOOLKIT_REQUIRES_CUSTOM_OAUTH", async () => {
    // Even after Task 5's catalog comingSoon flag, the route is still the
    // safety net for direct API hits + races. This test pins that
    // contract: the structural pre-check fires, the route returns 422
    // (not 500), and the create call never happens.
    mockToolkitsGet.mockResolvedValue({
      slug: "twitter",
      name: "Twitter",
      composioManagedAuthSchemes: [],
      authConfigDetails: [
        { mode: "OAUTH2", fields: { authConfigCreation: { required: [] } } },
      ],
    })

    const { status, data } = await callRoute("twitter")
    expect(status).toBe(422)
    expect(data.error.code).toBe("COMPOSIO_TOOLKIT_REQUIRES_CUSTOM_OAUTH")
    expect(data.error.message).toMatch(/setup/i)
    expect(mockAuthConfigsCreate).not.toHaveBeenCalled()
    expect(mockConnectedAccountsInitiate).not.toHaveBeenCalled()
  })
})

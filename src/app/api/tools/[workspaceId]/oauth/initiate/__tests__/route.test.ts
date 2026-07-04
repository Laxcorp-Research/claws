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

  it("RED toolkit (twitter — managed schemes empty + no API_KEY): returns 422 with COMPOSIO_TOOLKIT_REQUIRES_CUSTOM_OAUTH", async () => {
    // PR2.9 update: this branch fires only for toolkits with NEITHER
    // managed-OAuth NOR API_KEY mode. With API_KEY present, BYOK fires
    // instead — see the test below.
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

  it("BYOK toolkit (typefully — API_KEY-only): returns mode:byok + apiKeyForm, no OAuth init, no DB write", async () => {
    // PR2.9: the initiate route now branches three ways. BYOK toolkits
    // get an apiKeyForm payload and do NOT trigger composio.authConfigs
    // .create OR connectedAccounts.initiate at this stage — those happen
    // in the /byok/submit route AFTER the user supplies their key.
    mockToolkitsGet.mockResolvedValue({
      slug: "typefully",
      name: "Typefully",
      composioManagedAuthSchemes: [],
      authConfigDetails: [{ mode: "API_KEY" }],
    })

    const { status, data } = await callRoute("typefully")
    expect(status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.mode).toBe("byok")
    expect(data.data.apiKeyForm).toBeTruthy()
    expect(data.data.apiKeyForm.toolSlug).toBe("typefully")
    expect(data.data.apiKeyForm.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ required: true, primary: true }),
      ]),
    )
    // Critical: BYOK detection does NOT create any auth config or
    // connection at initiate time. Both must remain virgin.
    expect(mockAuthConfigsCreate).not.toHaveBeenCalled()
    expect(mockConnectedAccountsInitiate).not.toHaveBeenCalled()
    // And no toolConnection row written either — that comes from /byok/submit.
    expect(prismaMock.toolConnection.upsert).not.toHaveBeenCalled()
  })

  it("BEARER live toolkit returns mode:byok with a bearer-token field", async () => {
    mockToolkitsGet.mockResolvedValue({
      slug: "bearer-tool",
      name: "Bearer Tool",
      composioManagedAuthSchemes: [],
      authConfigDetails: [{ mode: "BEARER_TOKEN" }],
    })

    const { status, data } = await callRoute("bearer-tool")
    expect(status).toBe(200)
    expect(data.data.mode).toBe("byok")
    expect(data.data.apiKeyForm.authScheme).toBe("BEARER_TOKEN")
    expect(data.data.apiKeyForm.fields).toEqual([
      expect.objectContaining({
        envVar: "BEARER_TOOL_BEARER_TOKEN",
        label: "Bearer Token",
        required: true,
        primary: true,
      }),
    ])
    expect(mockConnectedAccountsInitiate).not.toHaveBeenCalled()
  })

  it("live-catalog BYOK toolkit returns toolkit display name for the connect modal, not raw slug", async () => {
    mockToolkitsGet.mockResolvedValue({
      slug: "builtwith",
      name: "BuiltWith",
      composioManagedAuthSchemes: [],
      authConfigDetails: [{ mode: "API_KEY" }],
    })

    const { status, data } = await callRoute("builtwith")
    expect(status).toBe(200)
    expect(data.data.apiKeyForm.displayName).toBe("BuiltWith")
    expect(data.data.apiKeyForm.displayName).not.toBe("builtwith")
  })

  it("live-catalog BYOK toolkit title-cases slug when Composio returns no name", async () => {
    mockToolkitsGet.mockResolvedValue({
      slug: "twelve_data",
      name: "",
      composioManagedAuthSchemes: [],
      authConfigDetails: [{ mode: "API_KEY" }],
    })

    const { status, data } = await callRoute("twelve_data")
    expect(status).toBe(200)
    expect(data.data.apiKeyForm.displayName).toBe("Twelve Data")
  })

  it("BASIC live toolkit returns mode:byok with username + password fields for the modal", async () => {
    mockToolkitsGet.mockResolvedValue({
      slug: "basic-tool",
      name: "Basic Tool",
      composioManagedAuthSchemes: [],
      authConfigDetails: [{ mode: "BASIC" }],
    })

    const { status, data } = await callRoute("basic-tool")
    expect(status).toBe(200)
    expect(data.data.mode).toBe("byok")
    expect(data.data.apiKeyForm.authScheme).toBe("BASIC")
    expect(data.data.apiKeyForm.fields).toEqual([
      expect.objectContaining({
        envVar: "BASIC_TOOL_BASIC_USERNAME",
        label: "Username",
        required: true,
        primary: true,
      }),
      expect.objectContaining({
        envVar: "BASIC_TOOL_BASIC_PASSWORD",
        label: "Password",
        required: true,
        primary: false,
      }),
    ])
    expect(mockConnectedAccountsInitiate).not.toHaveBeenCalled()
  })

  it("S2S_OAUTH2-only toolkit (bitwarden) remains custom setup / coming-soon", async () => {
    mockToolkitsGet.mockResolvedValue({
      slug: "bitwarden",
      name: "Bitwarden",
      composioManagedAuthSchemes: [],
      authConfigDetails: [{ mode: "S2S_OAUTH2", name: "bitwarden_service_account" }],
    })

    const { status, data } = await callRoute("bitwarden")
    expect(status).toBe(422)
    expect(data.error.code).toBe("COMPOSIO_TOOLKIT_REQUIRES_CUSTOM_OAUTH")
    expect(mockConnectedAccountsInitiate).not.toHaveBeenCalled()
  })

  it("dual-mode BYOK toolkit (shopify — OAUTH2 + API_KEY, no managed): BYOK takes precedence", async () => {
    // PR2.9 design decision (Option 1, data-grounded): for the 6 dual-mode
    // RED-2 toolkits (shopify, lever, metaads, pipedrive, webflow,
    // follow_up_boss), BYOK is the shipping path. Custom OAuth
    // registration becomes optional, not required.
    mockToolkitsGet.mockResolvedValue({
      slug: "shopify",
      name: "Shopify",
      composioManagedAuthSchemes: [],
      authConfigDetails: [{ mode: "OAUTH2" }, { mode: "API_KEY" }],
    })

    const { status, data } = await callRoute("shopify")
    expect(status).toBe(200)
    expect(data.data.mode).toBe("byok")
  })
})

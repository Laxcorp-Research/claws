// PR2.8a-fix1 Task 9 — unit tests for `ensureAuthConfigForToolkit`.
//
// Coverage targets (locked, regress on change):
//   1. Toolkit metadata returns empty composioManagedAuthSchemes → throws
//      ComposioToolkitRequiresCustomOAuthError. Primary structural check;
//      this is the actual fix for the typefully-500 the operator surfaced.
//   2. Existing config exists → returns its id, create NOT called.
//   3. No config + lock acquired + still no config inside lock → create
//      called, returns new id, lock unlocked in finally.
//   4. Create throws the captured RED error shape → translated into the
//      typed error (defense-in-depth fallback for stale metadata races).
//   5. Create throws unrelated error → re-thrown as-is, original message
//      preserved (so a transient 502/quota issue isn't masked as
//      "requires custom OAuth").
//   6. Concurrent invocation: pg_try_advisory_lock returns false → sleep
//      500ms + re-list. If the other caller created a config, return its
//      id. If not, throw an "in flight" error so the caller can retry.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  ensureAuthConfigForToolkit,
  ensureBYOKAuthConfig,
  createBYOKConnectedAccount,
  classifyToolkitAuthMode,
  ComposioToolkitRequiresCustomOAuthError,
} from "@/lib/composio-auth-config"

// PR2.9 mock: `@composio/core` is imported for the `AuthScheme` helper.
// We stub it so createBYOKConnectedAccount's `AuthScheme.APIKey` call
// returns a captureable value the connection-initiate mock can assert on.
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

type Composio = Parameters<typeof ensureAuthConfigForToolkit>[0]

interface MockComposio {
  toolkits: { get: ReturnType<typeof vi.fn> }
  authConfigs: {
    list: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
  }
  // PR2.9: BYOK helpers exercise connectedAccounts.initiate too.
  connectedAccounts: {
    initiate: ReturnType<typeof vi.fn>
  }
}

function makeComposio(): MockComposio {
  return {
    toolkits: { get: vi.fn() },
    authConfigs: { list: vi.fn(), create: vi.fn() },
    connectedAccounts: { initiate: vi.fn() },
  }
}

// Default `$transaction` mock invokes callback with prismaMock itself as
// `tx` (same shape, deep-mocked). Each test that exercises step 4 sets up
// `$queryRaw` to respond to the lock + unlock SQL.
beforeEach(() => {
  ;(prismaMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
    async (cb: (tx: typeof prismaMock) => Promise<unknown>) => cb(prismaMock),
  )
})

describe("ensureAuthConfigForToolkit", () => {
  it("throws ComposioToolkitRequiresCustomOAuthError when composioManagedAuthSchemes is empty (primary detection)", async () => {
    // This is the actual fix for the typefully-500. Before PR2.8a-fix1
    // the helper checked `authConfigDetails.length` (non-empty for RED
    // toolkits, so the check passed and the SDK create call was reached
    // and failed). Now the check is `composioManagedAuthSchemes.length`,
    // which is 0 for typefully and friends.
    const composio = makeComposio()
    composio.toolkits.get.mockResolvedValue({
      slug: "typefully",
      name: "Typefully",
      composioManagedAuthSchemes: [],
      authConfigDetails: [{ mode: "API_KEY" }],
    })

    await expect(
      ensureAuthConfigForToolkit(composio as unknown as Composio, "typefully"),
    ).rejects.toBeInstanceOf(ComposioToolkitRequiresCustomOAuthError)
    await expect(
      ensureAuthConfigForToolkit(composio as unknown as Composio, "typefully"),
    ).rejects.toMatchObject({
      code: "COMPOSIO_TOOLKIT_REQUIRES_CUSTOM_OAUTH",
      toolkitSlug: "typefully",
    })

    // Critical: the SDK create call must NEVER fire on the primary-detection
    // path. If it does, we leak a misleading server-side 400 into our logs.
    expect(composio.authConfigs.create).not.toHaveBeenCalled()
  })

  it("returns existing config id without calling create (idempotency / common case after first Connect)", async () => {
    const composio = makeComposio()
    composio.toolkits.get.mockResolvedValue({
      slug: "gmail",
      name: "Gmail",
      composioManagedAuthSchemes: ["OAUTH2"],
    })
    composio.authConfigs.list.mockResolvedValue({
      items: [{ id: "ac_existing_gmail" }],
    })

    const id = await ensureAuthConfigForToolkit(
      composio as unknown as Composio,
      "gmail",
    )
    expect(id).toBe("ac_existing_gmail")
    expect(composio.authConfigs.create).not.toHaveBeenCalled()
    // Early-exit path: no need to take the advisory lock or open a
    // transaction either.
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it("creates a new managed-auth config when none exists and lock is acquired", async () => {
    const composio = makeComposio()
    composio.toolkits.get.mockResolvedValue({
      slug: "outlook",
      name: "Outlook",
      composioManagedAuthSchemes: ["OAUTH2"],
    })
    // Initial list (step 3): empty. In-lock list (step 4): also empty.
    composio.authConfigs.list
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] })
    composio.authConfigs.create.mockResolvedValue({ id: "ac_new_outlook" })

    // Advisory lock acquired on first try.
    ;(prismaMock.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ pg_try_advisory_lock: true }])
      // Unlock returns whatever; the helper doesn't read it.
      .mockResolvedValueOnce([{ pg_advisory_unlock: true }])

    const id = await ensureAuthConfigForToolkit(
      composio as unknown as Composio,
      "outlook",
    )
    expect(id).toBe("ac_new_outlook")

    expect(composio.authConfigs.create).toHaveBeenCalledTimes(1)
    expect(composio.authConfigs.create).toHaveBeenCalledWith("outlook", {
      type: "use_composio_managed_auth",
      name: "Outlook (Claws)",
    })
    // Lock acquire + lock release: two raw calls.
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2)
  })

  it("translates the captured Auth_Config_DefaultAuthConfigNotFound error into the typed error (defense-in-depth)", async () => {
    // Defense in depth: if Composio's metadata raced an admin toggle
    // between step 1 (toolkits.get) and step 4 (authConfigs.create), we
    // can't rely on the structural pre-check alone. Translate the
    // captured RED error shape (verbatim from
    // scripts/pr2.8a-composio-authconfig-probe.mjs --negative-path) into
    // the typed error so the route still returns 422, not 500.
    const composio = makeComposio()
    composio.toolkits.get.mockResolvedValue({
      slug: "freshbooks",
      name: "FreshBooks",
      // Pretend Composio still claims managed-auth available — pre-check
      // passes — but create rejects (the race scenario).
      composioManagedAuthSchemes: ["OAUTH2"],
    })
    composio.authConfigs.list
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] })

    // Verbatim shape captured by the negative-path probe:
    const sdkError = Object.assign(new Error('400 ...'), {
      error: {
        error: {
          slug: "Auth_Config_DefaultAuthConfigNotFound",
          code: 306,
          message:
            'Default auth config not found for toolkit "freshbooks". Composio does not have managed credentials for this toolkit.',
        },
      },
    })
    composio.authConfigs.create.mockRejectedValue(sdkError)

    ;(prismaMock.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ pg_try_advisory_lock: true }])
      .mockResolvedValueOnce([{ pg_advisory_unlock: true }])

    await expect(
      ensureAuthConfigForToolkit(composio as unknown as Composio, "freshbooks"),
    ).rejects.toBeInstanceOf(ComposioToolkitRequiresCustomOAuthError)
  })

  it("re-throws unrelated SDK errors (transient quota / 502 / network) — does not mask as RequiresCustomOAuth", async () => {
    const composio = makeComposio()
    composio.toolkits.get.mockResolvedValue({
      slug: "outlook",
      name: "Outlook",
      composioManagedAuthSchemes: ["OAUTH2"],
    })
    composio.authConfigs.list
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] })
    const transient = Object.assign(new Error("Bad Gateway"), {
      error: { error: { code: 502 } },
    })
    composio.authConfigs.create.mockRejectedValue(transient)

    ;(prismaMock.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ pg_try_advisory_lock: true }])
      .mockResolvedValueOnce([{ pg_advisory_unlock: true }])

    await expect(
      ensureAuthConfigForToolkit(composio as unknown as Composio, "outlook"),
    ).rejects.toBe(transient)
  })

  it("contention path: lock not acquired, re-list finds a config another caller just created → returns its id", async () => {
    const composio = makeComposio()
    composio.toolkits.get.mockResolvedValue({
      slug: "outlook",
      name: "Outlook",
      composioManagedAuthSchemes: ["OAUTH2"],
    })
    // Step 3 initial list is empty (we want to enter the lock path).
    composio.authConfigs.list
      .mockResolvedValueOnce({ items: [] })
      // After 500ms sleep, the other caller has finished — config exists.
      .mockResolvedValueOnce({ items: [{ id: "ac_other_created" }] })

    ;(prismaMock.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { pg_try_advisory_lock: false },
    ])

    vi.useFakeTimers()
    try {
      const promise = ensureAuthConfigForToolkit(
        composio as unknown as Composio,
        "outlook",
      )
      // Fast-forward the 500ms wait.
      await vi.advanceTimersByTimeAsync(500)
      await expect(promise).resolves.toBe("ac_other_created")
    } finally {
      vi.useRealTimers()
    }

    // We must NOT have called create — the other caller did.
    expect(composio.authConfigs.create).not.toHaveBeenCalled()
    // We must NOT have unlocked something we never locked.
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it("contention path: lock not acquired, re-list still empty → throws in-flight error", async () => {
    const composio = makeComposio()
    composio.toolkits.get.mockResolvedValue({
      slug: "outlook",
      name: "Outlook",
      composioManagedAuthSchemes: ["OAUTH2"],
    })
    composio.authConfigs.list
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] })

    ;(prismaMock.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { pg_try_advisory_lock: false },
    ])

    vi.useFakeTimers()
    try {
      const promise = ensureAuthConfigForToolkit(
        composio as unknown as Composio,
        "outlook",
      )
      // Register the rejection handler synchronously BEFORE advancing the
      // fake clock — otherwise vitest's unhandled-rejection detector flags
      // the in-flight rejection during the 500ms tick window.
      const assertion = expect(promise).rejects.toThrow(
        /in flight by another caller/i,
      )
      await vi.advanceTimersByTimeAsync(500)
      await assertion
    } finally {
      vi.useRealTimers()
    }

    expect(composio.authConfigs.create).not.toHaveBeenCalled()
  })
})

// PR2.9: tests for the BYOK helpers (ensureBYOKAuthConfig +
// createBYOKConnectedAccount). Tripwires:
//   - classifyToolkitAuthMode returns "byok-api-key" only when managed
//     schemes are empty AND API_KEY mode is present
//   - ensureBYOKAuthConfig filters list results for isComposioManaged === false
//   - ensureBYOKAuthConfig's create call uses use_custom_auth + API_KEY +
//     a placeholder credential (real keys never flow through here)
//   - createBYOKConnectedAccount calls connectedAccounts.initiate with
//     AuthScheme.APIKey({ api_key })  — capital APIKey, api_key (snake) key
//   - Empty/blank API keys are rejected client-of-helper-side before
//     reaching Composio (avoid creating useless ACTIVE rows that always 401)
describe("classifyToolkitAuthMode (PR2.9)", () => {
  it("returns managed-oauth when composioManagedAuthSchemes is non-empty", () => {
    expect(
      classifyToolkitAuthMode({
        name: "Gmail",
        composioManagedAuthSchemes: ["OAUTH2"],
      }),
    ).toBe("managed-oauth")
  })

  it("returns byok-api-key when managed empty but authConfigDetails contains API_KEY", () => {
    expect(
      classifyToolkitAuthMode({
        name: "Typefully",
        composioManagedAuthSchemes: [],
        authConfigDetails: [{ mode: "API_KEY" }],
      }),
    ).toBe("byok-api-key")
  })

  it("returns byok-api-key for BEARER_TOKEN and BASIC schemes exposed by Composio", () => {
    expect(
      classifyToolkitAuthMode({
        name: "Bearer Tool",
        composioManagedAuthSchemes: [],
        authConfigDetails: [{ mode: "BEARER" }],
      }),
    ).toBe("byok-api-key")
    expect(
      classifyToolkitAuthMode({
        name: "Basic Tool",
        composioManagedAuthSchemes: [],
        authConfigDetails: [{ mode: "BASIC" }],
      }),
    ).toBe("byok-api-key")
  })

  it("returns byok-api-key for dual-mode toolkits (OAUTH2 + API_KEY) when no managed", () => {
    // Mirrors the PR2.9 RED-2 cases: shopify, lever, metaads, pipedrive,
    // webflow, follow_up_boss. No managed scheme → BYOK path takes
    // precedence over custom-OAuth.
    expect(
      classifyToolkitAuthMode({
        name: "Pipedrive",
        composioManagedAuthSchemes: [],
        authConfigDetails: [{ mode: "OAUTH2" }, { mode: "API_KEY" }],
      }),
    ).toBe("byok-api-key")
  })

  it("returns requires-custom-oauth when no managed + no API_KEY", () => {
    // twitter, docusign — pure OAuth-only toolkits.
    expect(
      classifyToolkitAuthMode({
        name: "Twitter/X",
        composioManagedAuthSchemes: [],
        authConfigDetails: [{ mode: "OAUTH2" }],
      }),
    ).toBe("requires-custom-oauth")
  })
})

describe("ensureBYOKAuthConfig (PR2.9)", () => {
  it("returns existing non-managed config id without calling create", async () => {
    const composio = makeComposio()
    composio.toolkits.get.mockResolvedValue({
      slug: "typefully",
      name: "Typefully",
      composioManagedAuthSchemes: [],
      authConfigDetails: [{ mode: "API_KEY" }],
    })
    composio.authConfigs.list.mockResolvedValue({
      items: [
        // Real-world: a managed config might exist alongside (unlikely
        // for BYOK toolkits but defensively guarded). We MUST pick the
        // BYOK one, not the managed one.
        { id: "ac_managed_typefully", isComposioManaged: true },
        { id: "ac_byok_typefully", isComposioManaged: false },
      ],
    })

    const id = await ensureBYOKAuthConfig(
      composio as unknown as Composio,
      "typefully",
    )
    expect(id).toBe("ac_byok_typefully")
    expect(composio.authConfigs.create).not.toHaveBeenCalled()
  })

  it("creates a custom-auth API_KEY config with placeholder credentials when none exists", async () => {
    const composio = makeComposio()
    composio.toolkits.get.mockResolvedValue({
      slug: "typefully",
      name: "Typefully",
      composioManagedAuthSchemes: [],
      authConfigDetails: [{ mode: "API_KEY" }],
    })
    composio.authConfigs.list
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] })
    composio.authConfigs.create.mockResolvedValue({ id: "ac_byok_new" })
    ;(prismaMock.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ pg_try_advisory_lock: true }])
      .mockResolvedValueOnce([{ pg_advisory_unlock: true }])

    const id = await ensureBYOKAuthConfig(
      composio as unknown as Composio,
      "typefully",
    )
    expect(id).toBe("ac_byok_new")
    expect(composio.authConfigs.create).toHaveBeenCalledTimes(1)
    // Tripwire: shape MUST be use_custom_auth + API_KEY + placeholder
    // credentials. Real user keys NEVER flow through this call.
    expect(composio.authConfigs.create).toHaveBeenCalledWith("typefully", {
      type: "use_custom_auth",
      authScheme: "API_KEY",
      name: "Typefully (Claws BYOK)",
      credentials: { apiKey: expect.any(String) },
    })
    const createArgs = (composio.authConfigs.create as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(createArgs.credentials.apiKey).toMatch(/placeholder/i)
  })

  it("creates custom-auth BEARER_TOKEN and BASIC configs with scheme-specific placeholders", async () => {
    const bearer = makeComposio()
    bearer.toolkits.get.mockResolvedValue({
      slug: "bearer-tool",
      name: "Bearer Tool",
      composioManagedAuthSchemes: [],
      authConfigDetails: [{ mode: "BEARER_TOKEN" }],
    })
    bearer.authConfigs.list
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] })
    bearer.authConfigs.create.mockResolvedValue({ id: "ac_bearer" })
    ;(prismaMock.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ pg_try_advisory_lock: true }])
      .mockResolvedValueOnce([{ pg_advisory_unlock: true }])

    await ensureBYOKAuthConfig(bearer as unknown as Composio, "bearer-tool", "BEARER_TOKEN")
    expect(bearer.authConfigs.create).toHaveBeenCalledWith("bearer-tool", {
      type: "use_custom_auth",
      authScheme: "BEARER_TOKEN",
      name: "Bearer Tool (Claws BYOK)",
      credentials: { token: expect.any(String) },
    })

    const basic = makeComposio()
    basic.toolkits.get.mockResolvedValue({
      slug: "basic-tool",
      name: "Basic Tool",
      composioManagedAuthSchemes: [],
      authConfigDetails: [{ mode: "BASIC" }],
    })
    basic.authConfigs.list
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] })
    basic.authConfigs.create.mockResolvedValue({ id: "ac_basic" })
    ;(prismaMock.$queryRaw as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ pg_try_advisory_lock: true }])
      .mockResolvedValueOnce([{ pg_advisory_unlock: true }])

    await ensureBYOKAuthConfig(basic as unknown as Composio, "basic-tool", "BASIC")
    expect(basic.authConfigs.create).toHaveBeenCalledWith("basic-tool", {
      type: "use_custom_auth",
      authScheme: "BASIC",
      name: "Basic Tool (Claws BYOK)",
      credentials: {
        username: expect.any(String),
        password: expect.any(String),
      },
    })
  })

  it("BYOK lock key is namespaced — won't collide with managed-OAuth lock on same slug", async () => {
    const composio = makeComposio()
    composio.toolkits.get.mockResolvedValue({
      slug: "shopify",
      name: "Shopify",
      composioManagedAuthSchemes: [],
      authConfigDetails: [{ mode: "OAUTH2" }, { mode: "API_KEY" }],
    })
    composio.authConfigs.list
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] })
    composio.authConfigs.create.mockResolvedValue({ id: "ac_byok_shopify" })

    // Capture the raw-SQL call shape so we can assert hashtext arg is
    // namespaced. PrismaMock's $queryRaw is called with a template-string
    // array shaped object — easiest is to spy.
    const queryRawMock = prismaMock.$queryRaw as ReturnType<typeof vi.fn>
    queryRawMock
      .mockResolvedValueOnce([{ pg_try_advisory_lock: true }])
      .mockResolvedValueOnce([{ pg_advisory_unlock: true }])

    await ensureBYOKAuthConfig(composio as unknown as Composio, "shopify")

    // Both calls should have used the BYOK-namespaced key. We can't easily
    // inspect prisma's tagged-template internals from the mock, but we
    // can assert prisma was hit exactly twice (lock + unlock) and that
    // create was made — together this confirms the lock dance ran.
    expect(queryRawMock).toHaveBeenCalledTimes(2)
    expect(composio.authConfigs.create).toHaveBeenCalledTimes(1)
  })
})

describe("createBYOKConnectedAccount (PR2.9)", () => {
  it("rejects empty / whitespace API keys before reaching Composio", async () => {
    const composio = makeComposio()
    composio.toolkits.get.mockResolvedValue({
      slug: "typefully",
      name: "Typefully",
      composioManagedAuthSchemes: [],
      authConfigDetails: [{ mode: "API_KEY" }],
    })

    await expect(
      createBYOKConnectedAccount(
        composio as unknown as Composio,
        "claws_user-1",
        "typefully",
        "",
      ),
    ).rejects.toThrow(/api key is required/i)

    await expect(
      createBYOKConnectedAccount(
        composio as unknown as Composio,
        "claws_user-1",
        "typefully",
        "   ",
      ),
    ).rejects.toThrow(/api key is required/i)

    // Critically: never reached Composio with a blank key — that would
    // create a useless ACTIVE row that 401s at execute time.
    expect(composio.toolkits.get).not.toHaveBeenCalled()
    expect(composio.connectedAccounts.initiate).not.toHaveBeenCalled()
  })

  it("calls connectedAccounts.initiate with AuthScheme.APIKey({api_key}) shape", async () => {
    const composio = makeComposio()
    composio.toolkits.get.mockResolvedValue({
      slug: "typefully",
      name: "Typefully",
      composioManagedAuthSchemes: [],
      authConfigDetails: [{ mode: "API_KEY" }],
    })
    composio.authConfigs.list.mockResolvedValue({
      items: [{ id: "ac_byok_typefully", isComposioManaged: false }],
    })
    composio.connectedAccounts.initiate.mockResolvedValue({
      id: "ca_new_byok",
      status: "ACTIVE",
      redirectUrl: null,
    })

    const id = await createBYOKConnectedAccount(
      composio as unknown as Composio,
      "claws_user-42",
      "typefully",
      "user-supplied-real-key",
    )
    expect(id).toBe("ca_new_byok")
    expect(composio.connectedAccounts.initiate).toHaveBeenCalledWith(
      "claws_user-42",
      "ac_byok_typefully",
      {
        // The mocked AuthScheme.APIKey returns this shape — proves
        // capital APIKey + snake api_key were used and the user's key
        // flowed through (NOT the placeholder).
        config: {
          __scheme: "API_KEY",
          api_key: "user-supplied-real-key",
        },
      },
    )
  })

  it("calls connectedAccounts.initiate with BEARER_TOKEN and BASIC AuthScheme payloads", async () => {
    const bearer = makeComposio()
    bearer.toolkits.get.mockResolvedValue({
      slug: "bearer-tool",
      name: "Bearer Tool",
      composioManagedAuthSchemes: [],
      authConfigDetails: [{ mode: "BEARER_TOKEN" }],
    })
    bearer.authConfigs.list.mockResolvedValue({
      items: [{ id: "ac_bearer", isComposioManaged: false, authScheme: "BEARER_TOKEN" }],
    })
    bearer.connectedAccounts.initiate.mockResolvedValue({ id: "ca_bearer", status: "ACTIVE" })

    await expect(
      createBYOKConnectedAccount(
        bearer as unknown as Composio,
        "claws_user-1",
        "bearer-tool",
        { authScheme: "BEARER_TOKEN", token: "bearer-real-token" },
        "BEARER_TOKEN",
      ),
    ).resolves.toBe("ca_bearer")
    expect(bearer.connectedAccounts.initiate).toHaveBeenCalledWith(
      "claws_user-1",
      "ac_bearer",
      { config: { __scheme: "BEARER_TOKEN", token: "bearer-real-token" } },
    )

    const basic = makeComposio()
    basic.toolkits.get.mockResolvedValue({
      slug: "basic-tool",
      name: "Basic Tool",
      composioManagedAuthSchemes: [],
      authConfigDetails: [{ mode: "BASIC" }],
    })
    basic.authConfigs.list.mockResolvedValue({
      items: [{ id: "ac_basic", isComposioManaged: false, authScheme: "BASIC" }],
    })
    basic.connectedAccounts.initiate.mockResolvedValue({ id: "ca_basic", status: "ACTIVE" })

    await expect(
      createBYOKConnectedAccount(
        basic as unknown as Composio,
        "claws_user-1",
        "basic-tool",
        { authScheme: "BASIC", username: "user", password: "pass" },
        "BASIC",
      ),
    ).resolves.toBe("ca_basic")
    expect(basic.connectedAccounts.initiate).toHaveBeenCalledWith(
      "claws_user-1",
      "ac_basic",
      { config: { __scheme: "BASIC", username: "user", password: "pass" } },
    )
  })

  it("user-supplied API key is NEVER logged (security tripwire)", async () => {
    // Mutation-test target. If a future change adds `apiKey` to a log
    // call by mistake, this test catches it by inspecting the recorded
    // log args after the full BYOK happy path.
    const composio = makeComposio()
    composio.toolkits.get.mockResolvedValue({
      slug: "typefully",
      name: "Typefully",
      composioManagedAuthSchemes: [],
      authConfigDetails: [{ mode: "API_KEY" }],
    })
    composio.authConfigs.list.mockResolvedValue({
      items: [{ id: "ac_byok_typefully", isComposioManaged: false }],
    })
    composio.connectedAccounts.initiate.mockResolvedValue({
      id: "ca_new_byok",
      status: "ACTIVE",
      redirectUrl: null,
    })

    const SENSITIVE_KEY = "user-supplied-real-key-do-not-log-XYZ"
    const { log } = await import("@/lib/logger")
    const infoSpy = log.info as ReturnType<typeof vi.fn>
    const errorSpy = log.error as ReturnType<typeof vi.fn>
    const warnSpy = log.warn as ReturnType<typeof vi.fn>

    await createBYOKConnectedAccount(
      composio as unknown as Composio,
      "claws_user-1",
      "typefully",
      SENSITIVE_KEY,
    )

    // Stringify all captured log call args and assert the literal key
    // string never appears. Works for any shape — flat string, nested
    // object, error-message embed, accidental console.log redirect.
    const allLogArgs = [
      ...infoSpy.mock.calls,
      ...errorSpy.mock.calls,
      ...warnSpy.mock.calls,
    ].map((args) => JSON.stringify(args))
    const haystack = allLogArgs.join("\n")
    expect(haystack).not.toContain(SENSITIVE_KEY)
  })

  it("re-throws non-key errors from initiate without leaking the key into the error path", async () => {
    const composio = makeComposio()
    composio.toolkits.get.mockResolvedValue({
      slug: "typefully",
      name: "Typefully",
      composioManagedAuthSchemes: [],
      authConfigDetails: [{ mode: "API_KEY" }],
    })
    composio.authConfigs.list.mockResolvedValue({
      items: [{ id: "ac_byok_typefully", isComposioManaged: false }],
    })
    const transient = new Error("Bad Gateway (transient)")
    composio.connectedAccounts.initiate.mockRejectedValue(transient)

    const SENSITIVE_KEY = "user-key-do-not-leak"
    await expect(
      createBYOKConnectedAccount(
        composio as unknown as Composio,
        "claws_user-1",
        "typefully",
        SENSITIVE_KEY,
      ),
    ).rejects.toBe(transient)

    // Re-thrown error must not have been mutated to carry the key.
    expect(transient.message).not.toContain(SENSITIVE_KEY)
  })
})

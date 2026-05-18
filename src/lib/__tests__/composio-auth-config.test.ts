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
  ComposioToolkitRequiresCustomOAuthError,
} from "@/lib/composio-auth-config"

type Composio = Parameters<typeof ensureAuthConfigForToolkit>[0]

interface MockComposio {
  toolkits: { get: ReturnType<typeof vi.fn> }
  authConfigs: {
    list: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
  }
}

function makeComposio(): MockComposio {
  return {
    toolkits: { get: vi.fn() },
    authConfigs: { list: vi.fn(), create: vi.fn() },
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

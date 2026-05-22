import { AuthScheme, type Composio } from "@composio/core"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"

/**
 * Project-level placeholder credential value injected at BYOK auth-config
 * creation time. Composio requires `credentials.apiKey` non-empty when
 * creating a `use_custom_auth + API_KEY` config, but for BYOK the real
 * user keys never live at the config level — they're attached per-user
 * at connection-creation time via `AuthScheme.APIKey({ api_key })`.
 *
 * Visible in the Composio dashboard's auth-config view. The literal
 * string is intentionally human-readable so an operator inspecting the
 * dashboard sees the design intent without having to dig through code.
 *
 * Never sent to the toolkit's API — Composio only uses connection-level
 * creds at execute time. Confirmed by `--byok-probe` against staging
 * (the dummy key submitted at connection-level reached the toolkit;
 * the config-level value did not).
 */
const BYOK_PLACEHOLDER_CREDENTIAL = "placeholder_user_keys_live_at_connection_level"

/**
 * Thrown when a Composio toolkit cannot be auto-configured via managed auth
 * because Composio has no default auth config for it (RED-state toolkits in
 * `scripts/pr2.8a-composio-authconfig-probe.mjs`).
 *
 * Surfaces in the route handler as HTTP 422 + error code
 * `COMPOSIO_TOOLKIT_REQUIRES_CUSTOM_OAUTH` so the wizard can render a yellow
 * "Setup in progress" warning instead of a red error. Operator action:
 * register a custom OAuth/API_KEY config in the Composio dashboard for the
 * named toolkit, then mark the catalog entry `comingSoon: false`.
 */
export class ComposioToolkitRequiresCustomOAuthError extends Error {
  readonly toolkitSlug: string
  readonly code = "COMPOSIO_TOOLKIT_REQUIRES_CUSTOM_OAUTH" as const
  constructor(toolkitSlug: string, message?: string) {
    super(
      message ??
        `Toolkit "${toolkitSlug}" has no Composio-managed auth scheme. ` +
          `Operator must register a custom auth config in the Composio dashboard.`
    )
    this.name = "ComposioToolkitRequiresCustomOAuthError"
    this.toolkitSlug = toolkitSlug
    Object.setPrototypeOf(this, ComposioToolkitRequiresCustomOAuthError.prototype)
  }
}

// Verbatim shape captured by `scripts/pr2.8a-composio-authconfig-probe.mjs
// --negative-path typefully` against staging Composio:
//
//   { constructor.name: "BadRequestError",
//     status: 400,
//     error.error.slug: "Auth_Config_DefaultAuthConfigNotFound",
//     error.error.code: 306,
//     error.error.message: 'Default auth config not found for toolkit "..."' }
//
// Slug is the stable identifier (Composio's API contract); code 306 is a
// fallback in case the slug string ever changes.
function isDefaultAuthConfigNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const e = err as {
    error?: { error?: { slug?: string; code?: number } }
  }
  const slug = e.error?.error?.slug
  const code = e.error?.error?.code
  return slug === "Auth_Config_DefaultAuthConfigNotFound" || code === 306
}

type EnsureAction = "noop" | "created" | "requires_custom_oauth" | "failed"

function logEnsure(args: {
  toolkitSlug: string
  action: EnsureAction
  durationMs: number
  errorCode?: string
}) {
  log.info("composio.authconfig.ensure", args)
}

/**
 * Toolkit-metadata shape we read from `composio.toolkits.get(slug)`.
 *
 * @composio/core@0.6.8's declared `ToolkitRetrieveResponse` doesn't include
 * `composioManagedAuthSchemes` or `authConfigDetails` even though the
 * backend returns them (verified by probe + already used by
 * src/lib/composio-catalog.ts). Type drift between the bundled .d.mts and
 * the live API. Structural cast captures only the fields we read.
 */
export interface ToolkitMetadata {
  name: string
  composioManagedAuthSchemes?: readonly string[]
  authConfigDetails?: ReadonlyArray<{ mode: string }>
}

/**
 * Three-way classification of a toolkit's auth posture based on the
 * `composio.toolkits.get()` response. Routing decision driver:
 *
 *   - `managed-oauth`   → Composio offers default OAuth credentials.
 *                          Use the existing `ensureAuthConfigForToolkit`
 *                          + popup-and-poll OAuth flow.
 *   - `byok-api-key`    → No managed scheme, but the toolkit exposes an
 *                          API_KEY auth mode. The user supplies their own
 *                          key; Composio brokers (PR2.9). Use
 *                          `ensureBYOKAuthConfig` + per-user
 *                          `createBYOKConnectedAccount`.
 *   - `requires-custom-oauth` → No managed scheme AND no API_KEY mode
 *                          (e.g. twitter, docusign). Operator must register
 *                          a custom OAuth app in Composio dashboard first.
 *                          Route returns 422; catalog entry stays
 *                          `comingSoon: true` until operator action.
 */
export type ToolkitAuthMode =
  | "managed-oauth"
  | "byok-api-key"
  | "requires-custom-oauth"

export function classifyToolkitAuthMode(toolkit: ToolkitMetadata): ToolkitAuthMode {
  if (toolkit.composioManagedAuthSchemes?.length) return "managed-oauth"
  const modes = toolkit.authConfigDetails?.map((d) => d.mode) ?? []
  if (modes.includes("API_KEY")) return "byok-api-key"
  return "requires-custom-oauth"
}

/**
 * Fetch toolkit metadata + classify auth mode in one call. Used by the
 * `oauth/initiate` route to decide whether to:
 *   - run managed-OAuth (existing path), OR
 *   - return an apiKeyForm response for BYOK toolkits, OR
 *   - 422 for toolkits requiring operator action.
 *
 * Exported separately so route + helpers share one toolkit.get call per
 * request (avoids duplicate network round-trips).
 */
export async function fetchToolkitWithAuthMode(
  composio: Composio,
  toolkitSlug: string
): Promise<{ toolkit: ToolkitMetadata; mode: ToolkitAuthMode }> {
  const toolkit = (await composio.toolkits.get(toolkitSlug)) as unknown as ToolkitMetadata
  return { toolkit, mode: classifyToolkitAuthMode(toolkit) }
}

/**
 * Idempotent + concurrency-safe lazy auto-create of a Composio managed-auth
 * config for `toolkitSlug`.
 *
 * Returns the auth config id. On call patterns:
 *   - Toolkit metadata says no managed auth scheme → throws
 *     `ComposioToolkitRequiresCustomOAuthError` (no SDK calls beyond the
 *     metadata fetch). Primary detection.
 *   - Existing config → returns its id (no create call).
 *   - No existing config → acquires a Postgres advisory lock keyed on the
 *     toolkit slug, re-checks (handles the lock-acquired-but-someone-else-
 *     just-finished race), creates, releases the lock.
 *   - Lock contention → waits 500ms, re-lists; returns the other caller's
 *     newly-created id if found, else throws an in-flight error so the
 *     caller can retry.
 *   - SDK create rejection with the captured RED error shape → throws
 *     `ComposioToolkitRequiresCustomOAuthError` (defense-in-depth fallback
 *     in case Composio's metadata raced our pre-check).
 *   - Any other SDK error → re-thrown as-is (will surface as 500 to the
 *     caller; original message preserved).
 *
 * Replaces the old `resolveAuthConfigIdForToolkit`, which checked the wrong
 * field (`authConfigDetails`, non-empty for RED toolkits) and swallowed the
 * SDK error message in its catch — the operator's typefully-500 surfaced
 * the latter directly.
 */
export async function ensureAuthConfigForToolkit(
  composio: Composio,
  toolkitSlug: string
): Promise<string> {
  const startedAt = Date.now()

  // 1. Toolkit metadata. The SDK call here is cheap; we need
  //    `composioManagedAuthSchemes` to decide whether managed-auth is even
  //    an option, AND `name` for the create payload. A failure here is
  //    almost always a transport problem; re-throw with logging.
  let toolkit: ToolkitMetadata
  try {
    toolkit = (await composio.toolkits.get(toolkitSlug)) as unknown as ToolkitMetadata
  } catch (err) {
    logEnsure({
      toolkitSlug,
      action: "failed",
      durationMs: Date.now() - startedAt,
      errorCode: "TOOLKIT_GET_FAILED",
    })
    throw err
  }

  // 2. Structural pre-check — the actual fix for the typefully-500. If
  //    Composio offers no managed auth scheme for this toolkit, we cannot
  //    auto-create; throw the typed error and let the route handler return
  //    422.
  if (!toolkit.composioManagedAuthSchemes?.length) {
    logEnsure({
      toolkitSlug,
      action: "requires_custom_oauth",
      durationMs: Date.now() - startedAt,
    })
    throw new ComposioToolkitRequiresCustomOAuthError(toolkitSlug)
  }

  // 3. Early exit: existing config (no race window — read-only).
  const initialList = await composio.authConfigs.list({
    toolkit: toolkitSlug,
    limit: 25,
  })
  const initial = initialList.items[0]?.id
  if (initial) {
    logEnsure({
      toolkitSlug,
      action: "noop",
      durationMs: Date.now() - startedAt,
    })
    return initial
  }

  // 4. Race-protected create. Two concurrent first-Connect calls on the
  //    same toolkit must not both hit `composio.authConfigs.create` — at
  //    best Composio dedupes (one config), at worst we get duplicates +
  //    inconsistent ids returned to the two callers. Postgres session-
  //    scope advisory lock keyed on hashtext(slug) gives us exactly-once
  //    semantics across function instances.
  //
  //    `prisma.$transaction(async tx => ...)` is used here PURELY for
  //    connection-pinning under the Neon pgbouncer pool. Without the
  //    pin, our `pg_try_advisory_lock` and `pg_advisory_unlock` could
  //    land on different backend connections and the lock would leak.
  //    The transaction itself does no DB writes.
  return await prisma.$transaction(async (tx) => {
    let lockAcquired = false
    try {
      const lockRows = await tx.$queryRaw<
        Array<{ pg_try_advisory_lock: boolean }>
      >`SELECT pg_try_advisory_lock(hashtext(${toolkitSlug})::bigint)`
      lockAcquired = Boolean(lockRows[0]?.pg_try_advisory_lock)

      if (!lockAcquired) {
        // Contention: another caller is in step 4 right now. Per spec,
        // wait 500ms and re-list. If they finished, return their id; if
        // not, surface a 503-style "in-flight" error to the route
        // handler so the user retries.
        await new Promise((resolve) => setTimeout(resolve, 500))
        const contentionList = await composio.authConfigs.list({
          toolkit: toolkitSlug,
          limit: 25,
        })
        const contention = contentionList.items[0]?.id
        if (contention) {
          logEnsure({
            toolkitSlug,
            action: "noop",
            durationMs: Date.now() - startedAt,
            errorCode: "lock_held_other_succeeded",
          })
          return contention
        }
        logEnsure({
          toolkitSlug,
          action: "failed",
          durationMs: Date.now() - startedAt,
          errorCode: "lock_held_no_other_result",
        })
        throw new Error(
          `Composio auth-config create for "${toolkitSlug}" is in flight by another caller; retry shortly.`
        )
      }

      // Re-check inside the lock. Closes the window where another caller
      // finished + released between step 3 and our acquire here.
      const inLockList = await composio.authConfigs.list({
        toolkit: toolkitSlug,
        limit: 25,
      })
      const inLock = inLockList.items[0]?.id
      if (inLock) {
        logEnsure({
          toolkitSlug,
          action: "noop",
          durationMs: Date.now() - startedAt,
          errorCode: "raced_other_succeeded",
        })
        return inLock
      }

      // Create.
      try {
        const created = await composio.authConfigs.create(toolkitSlug, {
          type: "use_composio_managed_auth",
          name: `${toolkit.name} (Claws)`,
        })
        logEnsure({
          toolkitSlug,
          action: "created",
          durationMs: Date.now() - startedAt,
        })
        return created.id
      } catch (err) {
        if (isDefaultAuthConfigNotFound(err)) {
          // The structural pre-check at step 2 should have caught this,
          // but Composio's metadata may have been stale or raced an admin
          // toggle. Translate to the typed error so the route still
          // returns 422 (not 500).
          logEnsure({
            toolkitSlug,
            action: "requires_custom_oauth",
            durationMs: Date.now() - startedAt,
            errorCode: "create_caught_default_auth_not_found",
          })
          throw new ComposioToolkitRequiresCustomOAuthError(toolkitSlug)
        }
        const errorCode =
          (err as { constructor?: { name?: string } })?.constructor?.name ??
          "create_failed"
        logEnsure({
          toolkitSlug,
          action: "failed",
          durationMs: Date.now() - startedAt,
          errorCode,
        })
        throw err
      }
    } finally {
      if (lockAcquired) {
        try {
          await tx.$queryRaw`SELECT pg_advisory_unlock(hashtext(${toolkitSlug})::bigint)`
        } catch (unlockErr) {
          log.warn("composio.authconfig.ensure unlock failed", {
            toolkitSlug,
            error:
              unlockErr instanceof Error
                ? unlockErr.message
                : String(unlockErr),
          })
        }
      }
    }
  })
}

// ───────────────────────────────────────────────────────────────────────
//  BYOK (bring-your-own-API-key) path — PR2.9
//
//  For toolkits Composio recognizes but doesn't have managed OAuth for
//  (and that DO expose an API_KEY auth mode — `classifyToolkitAuthMode`
//  returns `"byok-api-key"`), the user supplies their own API key and
//  Composio brokers tool execution. Config-level credentials are an
//  operator-controlled placeholder; per-user real keys live at the
//  connection level (`AuthScheme.APIKey({ api_key })`).
//
//  SDK shape verified end-to-end by `--byok-probe typefully` in
//  scripts/pr2.8a-composio-authconfig-probe.mjs (GREEN against staging).
// ───────────────────────────────────────────────────────────────────────

/**
 * Idempotent + concurrency-safe lazy create of the per-project BYOK auth
 * config for `toolkitSlug`. Returns the auth config id.
 *
 * Behavior mirrors `ensureAuthConfigForToolkit`:
 *   - Existing custom-auth API_KEY config → return its id (early exit).
 *   - No existing config → advisory-lock + create with placeholder creds.
 *   - Lock contention → 500ms re-list; return other caller's id, else throw.
 *
 * Differences from the managed-OAuth helper:
 *   - Creates `type: "use_custom_auth", authScheme: "API_KEY"` with
 *     `credentials: { apiKey: <placeholder> }`.
 *   - Filters list results to exclude managed configs (an operator may
 *     have created a managed-OAuth config for the same toolkit by hand;
 *     we want the BYOK one).
 *   - No "requires_custom_oauth" branch — caller is expected to have
 *     classified the toolkit first via `classifyToolkitAuthMode`.
 */
export async function ensureBYOKAuthConfig(
  composio: Composio,
  toolkitSlug: string
): Promise<string> {
  const startedAt = Date.now()

  // 1. Toolkit name needed for the `name` field on the create payload.
  let toolkit: ToolkitMetadata
  try {
    toolkit = (await composio.toolkits.get(toolkitSlug)) as unknown as ToolkitMetadata
  } catch (err) {
    logEnsure({
      toolkitSlug,
      action: "failed",
      durationMs: Date.now() - startedAt,
      errorCode: "BYOK_TOOLKIT_GET_FAILED",
    })
    throw err
  }

  // 2. Early exit on existing custom-auth API_KEY config.
  //
  //    Filter: `isComposioManaged === false`. The toolkit might have BOTH
  //    a managed config (created via the OAuth path elsewhere — e.g. if
  //    Composio later adds managed-auth support) AND a BYOK config; we
  //    explicitly want the BYOK one.
  const initialList = await composio.authConfigs.list({
    toolkit: toolkitSlug,
    limit: 25,
  })
  const initial = initialList.items.find((c) => c.isComposioManaged === false)?.id
  if (initial) {
    logEnsure({
      toolkitSlug,
      action: "noop",
      durationMs: Date.now() - startedAt,
      errorCode: "byok",
    })
    return initial
  }

  // 3. Race-protected create. Same advisory-lock pattern as the managed
  //    helper — Postgres session-scope lock keyed on hashtext(slug),
  //    inside a $transaction for connection-pinning under Neon pgbouncer.
  return await prisma.$transaction(async (tx) => {
    let lockAcquired = false
    // Lock-key namespaced from the managed path so a BYOK create on slug
    // X doesn't contend with a managed-OAuth create on the same slug if
    // they ever happen concurrently (extremely unlikely, but free safety).
    const lockKey = `byok:${toolkitSlug}`
    try {
      const lockRows = await tx.$queryRaw<
        Array<{ pg_try_advisory_lock: boolean }>
      >`SELECT pg_try_advisory_lock(hashtext(${lockKey})::bigint)`
      lockAcquired = Boolean(lockRows[0]?.pg_try_advisory_lock)

      if (!lockAcquired) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        const contentionList = await composio.authConfigs.list({
          toolkit: toolkitSlug,
          limit: 25,
        })
        const contention = contentionList.items.find((c) => c.isComposioManaged === false)?.id
        if (contention) {
          logEnsure({
            toolkitSlug,
            action: "noop",
            durationMs: Date.now() - startedAt,
            errorCode: "byok_lock_held_other_succeeded",
          })
          return contention
        }
        logEnsure({
          toolkitSlug,
          action: "failed",
          durationMs: Date.now() - startedAt,
          errorCode: "byok_lock_held_no_other_result",
        })
        throw new Error(
          `Composio BYOK auth-config create for "${toolkitSlug}" is in flight by another caller; retry shortly.`
        )
      }

      // Re-check inside the lock.
      const inLockList = await composio.authConfigs.list({
        toolkit: toolkitSlug,
        limit: 25,
      })
      const inLock = inLockList.items.find((c) => c.isComposioManaged === false)?.id
      if (inLock) {
        logEnsure({
          toolkitSlug,
          action: "noop",
          durationMs: Date.now() - startedAt,
          errorCode: "byok_raced_other_succeeded",
        })
        return inLock
      }

      // Create. Placeholder credentials at config level; real per-user
      // keys flow through `createBYOKConnectedAccount` below.
      try {
        const created = await composio.authConfigs.create(toolkitSlug, {
          type: "use_custom_auth",
          authScheme: "API_KEY",
          name: `${toolkit.name} (Claws BYOK)`,
          credentials: { apiKey: BYOK_PLACEHOLDER_CREDENTIAL },
        })
        logEnsure({
          toolkitSlug,
          action: "created",
          durationMs: Date.now() - startedAt,
          errorCode: "byok",
        })
        return created.id
      } catch (err) {
        const errorCode =
          (err as { constructor?: { name?: string } })?.constructor?.name ??
          "byok_create_failed"
        logEnsure({
          toolkitSlug,
          action: "failed",
          durationMs: Date.now() - startedAt,
          errorCode,
        })
        throw err
      }
    } finally {
      if (lockAcquired) {
        try {
          await tx.$queryRaw`SELECT pg_advisory_unlock(hashtext(${lockKey})::bigint)`
        } catch (unlockErr) {
          log.warn("composio.authconfig.ensure unlock failed", {
            toolkitSlug,
            error:
              unlockErr instanceof Error
                ? unlockErr.message
                : String(unlockErr),
          })
        }
      }
    }
  })
}

/**
 * Create a Composio connected account for `(composioUserId, toolkitSlug)`
 * using the user's supplied API key.
 *
 * Idempotency caveat: Composio allows multiple connected accounts per
 * (user, auth-config) pair. If the user already has a BYOK connection
 * for this toolkit, calling this again creates a SECOND one (Composio
 * docs: pass `allowMultiple: false` to error out instead). Our route
 * layer is responsible for the "is there already a CONNECTED ToolConnection
 * row for this workspace+slug?" check; this helper is the lower-level
 * primitive.
 *
 * Returns the connection id (used as `composioConnectionId` on the
 * `ToolConnection` row).
 *
 * Logging guarantee: `userApiKey` is never logged. Not via `log.*`, not
 * to console, not to error messages. The function param shadows the key
 * variable; subsequent logs use the toolkit slug and the redacted
 * "<redacted>" marker only.
 */
export async function createBYOKConnectedAccount(
  composio: Composio,
  composioUserId: string,
  toolkitSlug: string,
  userApiKey: string
): Promise<string> {
  const startedAt = Date.now()

  if (!userApiKey || !userApiKey.trim()) {
    // Bail before reaching Composio — empty keys would create a connection
    // that always 401s at execute time, leaving an unusable row.
    log.warn("composio.byok.connect rejected empty key", { toolkitSlug, composioUserId })
    throw new Error("API key is required to connect this tool.")
  }

  const authConfigId = await ensureBYOKAuthConfig(composio, toolkitSlug)

  let connectionRequest
  try {
    connectionRequest = await composio.connectedAccounts.initiate(
      composioUserId,
      authConfigId,
      {
        config: AuthScheme.APIKey({ api_key: userApiKey }),
      }
    )
  } catch (err) {
    // Critical: do NOT include the key in any log line, including error
    // surfaces. The toolkitSlug is enough for triage; if the operator
    // needs to debug a specific user's flow, they can correlate via
    // composioUserId + audit logs in the Composio dashboard.
    log.error("composio.byok.connect initiate failed", {
      toolkitSlug,
      composioUserId,
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }

  const connectionId = connectionRequest.id
  if (!connectionId) {
    log.error("composio.byok.connect missing connection id", {
      toolkitSlug,
      composioUserId,
    })
    throw new Error("Composio returned no connection id for the BYOK connection.")
  }

  // Status check: BYOK initiate returns `ACTIVE` immediately (no OAuth
  // redirect — verified by --byok-probe). If we get anything else
  // (INITIATED, PENDING, FAILED), surface that — something has changed
  // on Composio's side that we should know about.
  const status = (connectionRequest as { status?: string }).status
  if (status && status !== "ACTIVE") {
    log.warn("composio.byok.connect non-active status", {
      toolkitSlug,
      composioUserId,
      status,
    })
  }

  log.info("composio.byok.connect ok", {
    toolkitSlug,
    composioUserId,
    durationMs: Date.now() - startedAt,
    status: status ?? "unknown",
  })

  return connectionId
}

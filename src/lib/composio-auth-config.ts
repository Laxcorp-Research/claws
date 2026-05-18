import type { Composio } from "@composio/core"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"

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
  //
  //    Cast: @composio/core@0.6.8's declared `ToolkitRetrieveResponse`
  //    doesn't include `composioManagedAuthSchemes` even though the
  //    backend returns it (verified by probe and used by
  //    composio-catalog.ts:14 already). Type drift between the bundled
  //    .d.mts and the live API. Structural cast captures only the fields
  //    we read; PR2.8a-fix1 ships against this gap.
  interface ToolkitMetadata {
    name: string
    composioManagedAuthSchemes?: readonly string[]
  }
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

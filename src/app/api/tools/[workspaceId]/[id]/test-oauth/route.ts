import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { getComposio, getComposioUserId } from "@/lib/composio"
import {
  CHEAP_OPS,
  UNSUPPORTED_TOOLKITS,
  UNSUPPORTED_TOOLKIT_TOOLTIP,
  classifyProbeResult,
  type ProbeClassification,
} from "@/lib/composio/cheap-ops"
import { getToolBySlug } from "@/data/tool-catalog"
import { log } from "@/lib/logger"

/**
 * POST /api/tools/[workspaceId]/[id]/test-oauth
 *
 * Probes a stored OAUTH_COMPOSIO connection by calling a lightweight
 * "whoami"-style `composio.tools.execute` op (see `src/lib/composio/cheap-ops.ts`).
 *
 * The route:
 *   1. Verifies workspace ownership.
 *   2. Validates the connection is `OAUTH_COMPOSIO` and carries the
 *      Composio identifiers. API-key tools are handled by the sibling
 *      `/test` route.
 *   3. Looks up the cheap-op for the connection's toolkit. Rejects early
 *      for `UNSUPPORTED_TOOLKITS` (currently: `asana`, tracked in GH #41)
 *      and for any catalog drift where the toolkit has no registry entry.
 *   4. Resolves the current tool version via `composio.getClient().tools.retrieve(op)`
 *      - Composio's v3 API rejects execute calls without `version` and
 *      per-toolkit versions drift on different cadences (POC §Step 3).
 *   5. Races `composio.tools.execute` against a 5 s soft timeout.
 *   6. Classifies the outcome via the pure `classifyProbeResult` helper
 *      so the same logic (401 detection, toolkit-mismatch detection,
 *      invalid-args detection) applies whether the SDK throws or resolves
 *      with `{ successful: false, error }` - both shapes were observed
 *      during the 500-validate probe run on 2026-04-21.
 *   7. On `provider_401` or `provider_403`: transitions the DB row to
 *      `EXPIRED` with `lastError` populated. This is the one code path
 *      in the repo today (per GH #40) that can flip CONNECTED → EXPIRED
 *      from a user-triggered probe. On every other outcome the DB is
 *      NOT mutated - stale-CONNECTED is preferred to spurious-EXPIRED.
 *   8. Emits a structured log event (`composio_test_probe_*`) with
 *      connection-id suffix only (last 8 chars - privacy) and the
 *      classification category for future support triage.
 *
 * Response shape:
 *   200 { ok: true,  state: "working" }                      - probe succeeded
 *   200 { ok: false, state: "expired" }                      - token dead, DB updated
 *   200 { ok: false, state: "error", message: "…" }          - transient / unknown, DB unchanged
 *   400 apiError "TOOL_TEST_UNSUPPORTED"                     - asana-class toolkit
 *   400 apiError "TOOL_TEST_NOT_REGISTERED"                  - catalog drift
 *   400 apiError VALIDATION                                  - wrong connectionType / missing fields
 *   503 apiError "COMPOSIO_NOT_CONFIGURED"                   - no COMPOSIO_API_KEY
 *
 * Cost: ~$0.001 per click (one Composio execute per test). Bounded by the
 * Test button's manual-click UX; no polling at this endpoint.
 */

export const maxDuration = 12 // Vercel/Next ceiling; we soft-limit at 5s internally

const PROBE_TIMEOUT_MS = 5_000

type ProbeState = "working" | "expired" | "error"

function toProbeState(classification: ProbeClassification): ProbeState {
  switch (classification.category) {
    case "working":
      return "working"
    case "provider_401":
    case "provider_403":
      return "expired"
    default:
      return "error"
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; id: string }> },
) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const { workspaceId, id } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const conn = await prisma.toolConnection.findFirst({
    where: { id, workspaceId },
  })
  if (!conn) return ERRORS.NOT_FOUND("Tool connection")

  if (conn.connectionType !== "OAUTH_COMPOSIO") {
    return ERRORS.VALIDATION(
      "This endpoint is for OAuth connections. API-key connections are tested via /test.",
    )
  }

  if (!conn.composioConnectionId || !conn.composioEntityId) {
    return ERRORS.VALIDATION(
      "OAuth connection is missing Composio identifiers. Reconnect to restore them.",
    )
  }

  // Resolve the toolkit slug the same way the generator does: prefer the
  // explicit `composioToolkitId` on the catalog entry, falling back to the
  // connection's `toolSlug`. This handles the catalog-vs-toolkit slug drift
  // (e.g., `google_calendar` catalog slug → `googlecalendar` Composio slug).
  const def = getToolBySlug(conn.toolSlug)
  const toolkitSlug = def?.composioToolkitId ?? conn.toolSlug

  if (UNSUPPORTED_TOOLKITS.includes(toolkitSlug)) {
    return apiError("TOOL_TEST_UNSUPPORTED", UNSUPPORTED_TOOLKIT_TOOLTIP, 400)
  }

  const cheapOp = CHEAP_OPS[toolkitSlug]
  if (!cheapOp) {
    return apiError(
      "TOOL_TEST_NOT_REGISTERED",
      `No test operation registered for toolkit '${toolkitSlug}'.`,
      400,
    )
  }

  const composio = getComposio()
  if (!composio) {
    return apiError(
      "COMPOSIO_NOT_CONFIGURED",
      "OAuth is not configured in this environment.",
      503,
    )
  }

  const startedAt = Date.now()
  const connIdSuffix = conn.composioConnectionId.slice(-8)

  // Resolve version. The SDK's default (`"00000000_00"`) is rejected by
  // Composio's v3 API - we MUST pass an explicit version. Each toolkit
  // ships on a different version cadence (observed during 500-validate:
  // 4 distinct versions across 16 toolkits), so caching per-process is
  // brittle. Resolve on each call (~300 ms overhead) for v1 simplicity.
  let version: string
  try {
    const client = (composio as unknown as {
      getClient?: () => { tools: { retrieve: (slug: string) => Promise<{ available_versions?: string[]; version?: string }> } }
    }).getClient
      ? (composio as unknown as { getClient: () => { tools: { retrieve: (slug: string) => Promise<{ available_versions?: string[]; version?: string }> } } }).getClient()
      : (composio as unknown as { tools: { retrieve: (slug: string) => Promise<{ available_versions?: string[]; version?: string }> } })
    const meta = await client.tools.retrieve(cheapOp.op)
    version = meta?.available_versions?.[0] ?? meta?.version ?? ""
    if (!version) {
      throw new Error("tools.retrieve returned no version")
    }
  } catch (err) {
    log.error("composio_test_probe_version_resolve_failed", {
      category: "tool",
      toolkit: toolkitSlug,
      op: cheapOp.op,
      connectionIdSuffix: connIdSuffix,
      workspaceId,
      userId: user.id,
      error: err instanceof Error ? err.message : String(err),
    })
    return apiSuccess({
      ok: false,
      state: "error" as ProbeState,
      message: "Couldn't resolve tool version from Composio. Try again.",
    })
  }

  // Race `tools.execute` against the 5 s soft timeout. Whichever wins
  // determines classification. A `PROBE_TIMEOUT` sentinel lets the
  // classifier bucket the timeout branch specifically (category:
  // "timeout", DB unchanged) rather than misclassifying as "unknown".
  let probeResult: { resolved?: unknown; threw?: unknown; timedOut?: boolean }
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    const executePromise = composio.tools.execute(cheapOp.op, {
      userId: getComposioUserId(user.id),
      connectedAccountId: conn.composioConnectionId,
      arguments: cheapOp.args,
      version,
    })
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("PROBE_TIMEOUT")), PROBE_TIMEOUT_MS)
    })
    const resolved = await Promise.race([executePromise, timeoutPromise])
    probeResult = { resolved }
  } catch (err) {
    if (err instanceof Error && err.message === "PROBE_TIMEOUT") {
      probeResult = { timedOut: true }
    } else {
      probeResult = { threw: err }
    }
  } finally {
    if (timer) clearTimeout(timer)
  }

  const latencyMs = Date.now() - startedAt
  const classification = classifyProbeResult(probeResult)

  // Structured log (rationale in the PR #5 review + GH #40 follow-up:
  // when a user reports "Test fails for my HubSpot" in 6 months, knowing
  // which SDK path fired narrows the investigation immediately).
  const eventName = probeResult.timedOut
    ? "composio_test_probe_timeout"
    : probeResult.threw !== undefined
      ? "composio_test_probe_threw"
      : "composio_test_probe_resolved"
  log.info(eventName, {
    category: "tool",
    toolkit: toolkitSlug,
    op: cheapOp.op,
    connectionIdSuffix: connIdSuffix,
    workspaceId,
    userId: user.id,
    latencyMs,
    classification: classification.category,
  })

  // DB transition. ONLY fires on the unambiguous provider-dead cases
  // (401 / 403). Every other category leaves the row alone - we prefer
  // stale CONNECTED to spurious EXPIRED because an incorrect EXPIRED
  // surfaces a Reconnect prompt the user shouldn't have to act on.
  if (
    classification.category === "provider_401" ||
    classification.category === "provider_403"
  ) {
    await prisma.toolConnection.update({
      where: { id },
      data: {
        status: "EXPIRED",
        lastTestedAt: new Date(),
        lastError: `Composio status: EXPIRED - test probe detected ${classification.category === "provider_401" ? "revoked" : "forbidden"} token`,
      },
    })
    log.toolEvent({
      event: "failed",
      toolSlug: conn.toolSlug,
      connectionType: "OAUTH_COMPOSIO",
      workspaceId,
      userId: user.id,
      error: `test-probe: ${classification.category}`,
    })
    return apiSuccess({ ok: false, state: "expired" as ProbeState })
  }

  if (classification.category === "working") {
    await prisma.toolConnection.update({
      where: { id },
      data: { lastTestedAt: new Date(), lastError: null },
    })
    return apiSuccess({ ok: true, state: "working" as ProbeState })
  }

  // Unclassified / transient: respond truthfully but don't touch DB.
  return apiSuccess({
    ok: false,
    state: toProbeState(classification),
    message: classification.message,
  })
}

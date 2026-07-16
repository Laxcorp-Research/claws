/**
 * Shared tool-state types + pure helpers used by the Setup Wizard Step 2.
 *
 * Extracted from `src/app/setup/[workspaceId]/step/[n]/page.tsx` (Commit 9)
 * so the non-template-connection merge logic is unit-testable without
 * standing up the whole wizard page. Before this extraction the types
 * lived inline in the page and the bug this module fixes was invisible
 * to tests: connections a user added via the Browse Tools modal for a
 * tool that wasn't in the workspace's template required/recommended list
 * never made it into the page's `tools` state, so `connectedSlugs`
 * stayed blind to them and the modal kept showing "Connect OAuth".
 *
 * See GH #39 (closed — moved into PR #4 scope) + PR #4 Commit 9.
 */
import type { ToolRowStatus } from "@/components/setup/tool-row"
import { getToolBySlug } from "@/data/tool-catalog"
import type { ApiKeyFormPayload } from "@/lib/oauth/use-oauth-connection"
import { isCredentialedKeyPending } from "@/lib/tools/required-tools"

export function titleCaseToolSlug(slug: string): string {
  return slug
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ") || slug
}

function nonEmpty(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export interface ToolState {
  slug: string
  name: string
  connectionType: "API_KEY" | "OAUTH_COMPOSIO" | "NO_AUTH"
  category: string
  status: ToolRowStatus
  errorMessage?: string
  /** Non-error informational note (e.g., "saved but not verified"). */
  warningMessage?: string
  connectionId?: string
  helpUrl?: string
  keyPlaceholder?: string
  required: boolean
  /**
   * Tool customization PR-2: true when this entry differs from the
   * template default (demoted, etc.). Drives Restore affordance.
   */
  customized?: boolean
  /**
   * Template-curated oneOf alternatives (WorkspaceToolRequirement.alternatives).
   * Suggested pins when Swap opens BrowseToolsModal.
   */
  alternatives?: string[]
  /**
   * PR #4 Commit 6: timestamp the OAuth connection was first established.
   * Sourced from `ToolConnection.createdAt`.
   */
  connectedAt?: string | null
  /**
   * PR #4 Commit 9: true when this row came from a `ToolConnection` that
   * is NOT in the workspace's template required/recommended list (i.e.
   * the user added it via the Browse Tools modal). Used by Step 2 to
   * render these under an "Additional tools" section distinct from the
   * template's required/recommended blocks, and to suppress the Swap
   * button (there is no template-alternative set for an extra tool).
   */
  extra?: boolean
}

export interface ServerConnectionSummary {
  toolSlug: string
  status: string
  id: string
  /** Present on the GET /api/tools/{ws} payload; used for non-template extras whose slug isn't in the static catalog. */
  displayName?: string
  connectionType?: string
  lastError?: string | null
  /** True when encrypted credentials exist (GET /api/tools). */
  hasCredentials?: boolean
  keyHint?: string | null
  /** PR #4 Commit 6: passed through for OAuth "Connected N days ago" rendering. */
  createdAt?: string | null
}

/**
 * Map a server-side `ToolConnection` row's `status` + `connectionType` +
 * `lastError` to the narrower UI tri-state plus optional error/warning copy.
 *
 * Kept as a pure function so Step 2's state machine and any future consumer
 * (dashboard manage-tools, admin review surface, etc.) share one mapping.
 */
export function connectionUiState(conn: ServerConnectionSummary): {
  status: ToolRowStatus
  errorMessage?: string
  warningMessage?: string
} {
  switch (conn.status) {
    case "CONNECTED":
      return { status: "connected" }
    // PR #4 Commit 6: EXPIRED/REVOKED un-collapsed from "error" so the
    // UI can render reconnect-required copy distinct from generic failure.
    case "EXPIRED":
      return { status: "expired" }
    case "REVOKED":
      return { status: "revoked" }
    case "ERROR":
      return {
        status: "error",
        errorMessage: conn.lastError ?? "Connection failed",
      }
    case "NEEDS_CREDENTIALS":
      return {
        status: "needs-credentials",
        warningMessage:
          conn.lastError ??
          "Some required fields are missing. Click Complete to finish setting this up.",
      }
    case "PENDING":
      // Finding F: same credentialed-key PENDING predicate as the deploy gate.
      if (isCredentialedKeyPending(conn)) {
        return {
          status: "connected",
          warningMessage: conn.lastError ?? undefined,
        }
      }
      return { status: "disconnected" }
    default:
      return { status: "disconnected" }
  }
}

/**
 * Build a single `ToolState` row for a connection the user added outside
 * the workspace template. Falls back gracefully when the tool isn't in
 * the static catalog (category = "OTHER", no helpUrl) — that case is
 * rare in practice but possible for dynamic Composio toolkits.
 */
export function buildExtraToolState(conn: ServerConnectionSummary): ToolState {
  const def = getToolBySlug(conn.toolSlug)
  const ui = connectionUiState(conn)
  return {
    slug: conn.toolSlug,
    name: def?.name ?? conn.displayName ?? conn.toolSlug,
    connectionType: (def?.connectionType ?? conn.connectionType ?? "API_KEY") as
      | "API_KEY"
      | "OAUTH_COMPOSIO"
      | "NO_AUTH",
    category: def?.category ?? "OTHER",
    status: ui.status,
    errorMessage: ui.errorMessage,
    warningMessage: ui.warningMessage,
    connectionId: conn.id,
    connectedAt: conn.createdAt ?? null,
    helpUrl: def?.helpUrl,
    keyPlaceholder: def?.keyPlaceholder,
    required: false,
    extra: true,
  }
}

/**
 * PR2.9-fix1 (Bug 1B): wizard-internal state for the BYOK credentials
 * modal. `tool` is optional because the modal opens for any
 * OAUTH_COMPOSIO + byok-api-key toolkit the user clicks, including ones
 * not in the wizard's template `tools` state (clicked via Browse modal).
 * The `apiKeyForm` is canonical (server-supplied via the initiate
 * response) and carries everything needed to render + submit even when
 * `tool` is null.
 */
export interface BYOKModalState {
  open: boolean
  tool: ToolState | null
  apiKeyForm: ApiKeyFormPayload | null
}

/**
 * Pure helper: given the BYOK modal state, return the props the
 * CredentialsModal should be rendered with, or null if the modal should
 * not render.
 *
 * Existence: extracted from the JSX conditional in
 * `src/app/setup/[workspaceId]/step/[n]/page.tsx` so it can be unit-tested
 * — Bug 1B was specifically that the inline conditional required
 * `state.tool` non-null, which blocked the modal for Browse-clicked
 * non-template tools. The test suite for this function asserts the
 * `state.tool === null` branch returns valid props, locking the fix.
 *
 * Display-name fallback chain (highest priority first):
 *   1. state.tool.name              — wizard template-row click
 *   2. state.apiKeyForm.displayName — server-provided (initiate response)
 *   3. getToolBySlug(slug)?.name    — client catalog lookup
 *   4. title-cased state.apiKeyForm.toolSlug — last-ditch display fallback
 *
 * The route's initiate response always sets displayName, so #2 is the
 * common case for Browse-clicked tools. #3 + #4 are belt-and-suspenders.
 */
export function resolveByokModalProps(state: BYOKModalState): {
  toolName: string
  helpUrl?: string
  credentialFields: ApiKeyFormPayload["fields"]
} | null {
  if (!state.open || !state.apiKeyForm) return null
  const toolName =
    nonEmpty(state.tool?.name)
    ?? nonEmpty(state.apiKeyForm.displayName)
    ?? nonEmpty(getToolBySlug(state.apiKeyForm.toolSlug)?.name)
    ?? titleCaseToolSlug(state.apiKeyForm.toolSlug)
  return {
    toolName,
    helpUrl: state.apiKeyForm.helpUrl,
    credentialFields: state.apiKeyForm.fields,
  }
}

/**
 * Workspace requirement entry from GET/PATCH tool-requirements.
 * Requirement entry is the row of record; ToolConnection only decorates it.
 */
export interface RequirementToolEntry {
  slug: string
  name: string
  category: string
  connectionType: "API_KEY" | "OAUTH_COMPOSIO" | "NO_AUTH" | string
  required: boolean
  alternatives?: string[]
  customized?: boolean
  dismissed?: boolean
}

/**
 * Resolve one requirement entry → one ToolState row.
 * Canonical identity is the oneOf-resolved slug (entry.slug or a connected
 * alternative). Connection state decorates that row. Open category-wide
 * "swap match" is intentionally NOT used — it orphaned the requirement
 * slug's connection as a second "Additional tools" row (PR-5 defect 1).
 */
export function resolveRequirementToolState(
  entry: RequirementToolEntry,
  required: boolean,
  connections: ServerConnectionSummary[],
): ToolState | null {
  const oneOf = [entry.slug, ...(entry.alternatives ?? [])]
  let chosenSlug = entry.slug
  for (const s of oneOf) {
    if (connections.some((c) => c.toolSlug === s)) {
      chosenSlug = s
      break
    }
  }
  if (chosenSlug === entry.slug) {
    for (const s of oneOf) {
      const d = getToolBySlug(s)
      if (d && !d.comingSoon) {
        chosenSlug = s
        break
      }
    }
  }

  const def = getToolBySlug(chosenSlug) ?? getToolBySlug(entry.slug)
  if (!def) {
    throw new Error(
      `[setup-wizard] requirement slug "${entry.slug}" (+ alternatives ${JSON.stringify(entry.alternatives ?? [])}) unresolved in ALL_TOOLS.`,
    )
  }
  if (def.comingSoon) return null

  const conn = connections.find((c) => c.toolSlug === chosenSlug)
  const ui = conn
    ? connectionUiState(conn)
    : { status: "disconnected" as const, errorMessage: undefined, warningMessage: undefined }

  return {
    slug: chosenSlug,
    name: def.name,
    connectionType: def.connectionType,
    category: def.category,
    status: ui.status,
    errorMessage: ui.errorMessage,
    warningMessage: ui.warningMessage,
    connectionId: conn?.id,
    connectedAt: conn?.createdAt ?? null,
    helpUrl: def.helpUrl,
    keyPlaceholder: def.keyPlaceholder,
    required,
    customized: entry.customized === true,
    alternatives: entry.alternatives,
  }
}

/** OneOf set for a requirement entry — used to claim connections so extras can't duplicate. */
export function requirementClaimedSlugs(entry: RequirementToolEntry): string[] {
  return [entry.slug, ...(entry.alternatives ?? [])]
}

/**
 * Build Step-2 tool rows: requirement entries (required + recommended) as
 * rows of record, then extras for connections not claimed by any entry.
 */
export function buildWorkspaceToolStates(
  requiredEntries: RequirementToolEntry[],
  recommendedEntries: RequirementToolEntry[],
  connections: ServerConnectionSummary[],
  isAiProvider: (slug: string) => boolean,
): ToolState[] {
  const claimed = new Set<string>()
  for (const e of [...requiredEntries, ...recommendedEntries]) {
    for (const s of requirementClaimedSlugs(e)) claimed.add(s)
  }

  const resolvedRequired = requiredEntries
    .map((e) => resolveRequirementToolState(e, true, connections))
    .filter((t): t is ToolState => t !== null)
    .filter((t) => !isAiProvider(t.slug))

  const requiredSlugs = new Set(resolvedRequired.map((t) => t.slug))
  const resolvedRecommended = recommendedEntries
    .map((e) => resolveRequirementToolState(e, false, connections))
    .filter((t): t is ToolState => t !== null)
    .filter((t) => !isAiProvider(t.slug) && !requiredSlugs.has(t.slug))

  const allTools = [...resolvedRequired, ...resolvedRecommended]
  const extras = buildExtraToolsFromConnections(allTools, connections, claimed)
  return [...allTools, ...extras]
}

/**
 * Given the template-driven `tools` array and the full list of DB
 * connections, return entries for every connection whose slug isn't
 * already represented in `tools`. These are appended to Step 2's state
 * under the "Additional tools" section so the UI correctly reflects
 * tools the user connected via the Browse Tools modal.
 *
 * @param claimedSlugs Optional oneOf / requirement slugs that must not
 *   surface as extras even when the rendered row currently uses a
 *   different chosen slug (PR-5 defect 1).
 */
export function buildExtraToolsFromConnections(
  existingTools: Pick<ToolState, "slug">[],
  connections: ServerConnectionSummary[],
  claimedSlugs: Iterable<string> = [],
): ToolState[] {
  const existingSlugs = new Set(existingTools.map((t) => t.slug))
  for (const s of claimedSlugs) existingSlugs.add(s)
  const out: ToolState[] = []
  const seenExtras = new Set<string>()
  for (const conn of connections) {
    if (existingSlugs.has(conn.toolSlug)) continue
    // The payload is ordered by createdAt asc (GET /api/tools/{ws}), so
    // the first occurrence per slug is the canonical one. De-dupe extras
    // defensively in case a race left two rows for the same slug.
    if (seenExtras.has(conn.toolSlug)) continue
    seenExtras.add(conn.toolSlug)
    const def = getToolBySlug(conn.toolSlug)
    if (def?.isAIProvider) continue // AI providers live on Step 1, not here.
    out.push(buildExtraToolState(conn))
  }
  return out
}

/**
 * PR2.9-fix3: reconcile the local `tools` state against the server's
 * authoritative connection list returned by `GET /api/tools/{workspaceId}`.
 * The server response is the source of truth; this function makes the
 * client match it.
 *
 * Bug fixed: pre-fix the merge was insert-only — slugs present locally
 * but ABSENT on the server kept their stale `status: "connected"` and
 * `connectionId`. After a successful revoke or disconnect the row UI
 * still said "Connected" until a full page reload. The connect path
 * incidentally dodged this because `useOAuthConnection.onSuccess`
 * applies an optimistic `setTools(... status: "connected")` AFTER
 * `refreshTools`; the disconnect handlers had no such optimistic patch
 * so the broken primitive was exposed.
 *
 * The fix is at the primitive (this function) so every present and
 * future mutation path inherits correct behavior without per-handler
 * patches.
 *
 * Reconciliation rules:
 *   1. Server has a connection for the slug → apply server state
 *      (status, errorMessage, warningMessage, connectionId, connectedAt).
 *   2. Server has NO connection for an "extra" row (came from a non-
 *      template connection — `extra: true`) → drop the row entirely.
 *      Extras exist ONLY because of a server connection; without that
 *      backing row they shouldn't be displayed.
 *   3. Server has NO connection for a template row (required /
 *      recommended) → reset the row to `status: "disconnected"`, clear
 *      `connectionId`, `connectedAt`, `errorMessage`, `warningMessage`.
 *      The row stays visible in its bucket so the user can re-connect.
 *   4. Server has a connection whose slug isn't in `prev` → append via
 *      `buildExtraToolsFromConnections` (existing insert path unchanged).
 *
 * @param prev        Current local `tools` array (template rows + any
 *                    previously-loaded extras).
 * @param connections Authoritative server connection list (full, not
 *                    paginated — see GET /api/tools/{ws}).
 */
export function mergeRefreshedTools(
  prev: ToolState[],
  connections: ServerConnectionSummary[],
): ToolState[] {
  const reconciled = prev
    .map((t): ToolState | null => {
      const conn = connections.find((c) => c.toolSlug === t.slug)
      if (conn) {
        const ui = connectionUiState(conn)
        return {
          ...t,
          status: ui.status,
          errorMessage: ui.errorMessage,
          warningMessage: ui.warningMessage,
          connectionId: conn.id,
          connectedAt: conn.createdAt ?? t.connectedAt ?? null,
        }
      }
      // Server has no record for this slug. Two cases:
      //   - extra row: existed only because of a server connection that's
      //     now gone → drop entirely.
      //   - template row: the user needs to see it as re-connectable, so
      //     it stays but gets reset to disconnected.
      if (t.extra) return null
      return {
        ...t,
        status: "disconnected" as const,
        connectionId: undefined,
        connectedAt: null,
        errorMessage: undefined,
        warningMessage: undefined,
      }
    })
    .filter((t): t is ToolState => t !== null)

  const claimed = new Set<string>()
  for (const t of reconciled) {
    if (t.extra) continue
    claimed.add(t.slug)
    for (const a of t.alternatives ?? []) claimed.add(a)
  }
  const extras = buildExtraToolsFromConnections(reconciled, connections, claimed)
  return extras.length > 0 ? [...reconciled, ...extras] : reconciled
}

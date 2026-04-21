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

export interface ToolState {
  slug: string
  name: string
  connectionType: "API_KEY" | "OAUTH_COMPOSIO"
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
      // API_KEY rows land PENDING when the key saved but couldn't be
      // validated — treat as connected-with-warning, not disconnected.
      if (conn.connectionType === "API_KEY" && conn.lastError) {
        return { status: "connected", warningMessage: conn.lastError }
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
      | "OAUTH_COMPOSIO",
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
 * Given the template-driven `tools` array and the full list of DB
 * connections, return entries for every connection whose slug isn't
 * already represented in `tools`. These are appended to Step 2's state
 * under the "Additional tools" section so the UI correctly reflects
 * tools the user connected via the Browse Tools modal.
 */
export function buildExtraToolsFromConnections(
  existingTools: Pick<ToolState, "slug">[],
  connections: ServerConnectionSummary[],
): ToolState[] {
  const existingSlugs = new Set(existingTools.map((t) => t.slug))
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

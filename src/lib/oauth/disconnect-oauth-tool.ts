/**
 * Shared client-side helper for the OAUTH_COMPOSIO disconnect flow (PR #4
 * Commit 7). Used by the setup wizard's Revoke ConfirmDialog confirm
 * handler. Extracted into its own module so it can be unit-tested without
 * mounting the whole Step2 component (which pulls in ~40 modal/hook
 * dependencies just to render).
 *
 * The server route
 *   POST /api/tools/[workspaceId]/oauth/disconnect
 * takes `{ toolSlug }` and both (a) asks Composio to delete its
 * connected-account record and (b) deletes the local ToolConnection row.
 * On any failure the response shape is
 *   { success: false, error: { code, message } }
 * matching the rest of our apiError helpers.
 *
 * This helper:
 *   - Posts the correct body.
 *   - Parses the JSON response once.
 *   - Throws a plain Error with the server-provided message on failure so
 *     callers can surface `err.message` verbatim in a toast or dialog.
 */
import { clientIsSelfHost } from "@/lib/profile-client"

export async function disconnectOauthTool(workspaceId: string, toolSlug: string): Promise<void> {
  if (clientIsSelfHost()) return
  const res = await fetch(`/api/tools/${workspaceId}/oauth/disconnect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toolSlug }),
  })
  let data: { success?: boolean; error?: { message?: string } }
  try {
    data = await res.json()
  } catch {
    throw new Error(`Unexpected response from disconnect (HTTP ${res.status})`)
  }
  if (!data.success) {
    throw new Error(data.error?.message || "Failed to disconnect")
  }
}

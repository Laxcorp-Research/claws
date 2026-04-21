// PR #4 Commit 7 — disconnect helper tests. The helper is the unit the
// Revoke ConfirmDialog's confirm handler calls. Tests cover the three
// response shapes the server can return:
//   - success: { success: true, data: { disconnected: true } } → resolves
//   - server failure: { success: false, error: { message } } → rejects with that message
//   - malformed JSON / non-200 → rejects with a generic HTTP-status message
// Tests for "dialog opens" and "list refetches" live in the component layer
// (and/or E2E); this file locks in the API-contract behavior.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { disconnectOauthTool } from "@/lib/oauth/disconnect-oauth-tool"

const WORKSPACE_ID = "ws-test-1"
const TOOL_SLUG = "hubspot"

function jsonResponse<T>(body: T, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  })
}

describe("disconnectOauthTool", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("POSTs to /api/tools/<workspaceId>/oauth/disconnect with the tool slug and resolves on success", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: { disconnected: true } }))

    await expect(disconnectOauthTool(WORKSPACE_ID, TOOL_SLUG)).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/tools/${WORKSPACE_ID}/oauth/disconnect`,
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolSlug: TOOL_SLUG }),
      }),
    )
  })

  it("rejects with the server-provided error message when the response reports failure", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { success: false, error: { message: "Composio refused to delete the connected account" } },
        { status: 502 },
      ),
    )

    await expect(disconnectOauthTool(WORKSPACE_ID, TOOL_SLUG)).rejects.toThrow(
      "Composio refused to delete the connected account",
    )
  })

  it("falls back to a generic message when the server response omits error.message", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: false, error: {} }, { status: 500 }))

    await expect(disconnectOauthTool(WORKSPACE_ID, TOOL_SLUG)).rejects.toThrow("Failed to disconnect")
  })

  it("rejects with an HTTP-status message when the server returns non-JSON", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(
      new Response("<html>500 internal error</html>", {
        status: 500,
        headers: { "content-type": "text/html" },
      }),
    )

    await expect(disconnectOauthTool(WORKSPACE_ID, TOOL_SLUG)).rejects.toThrow(
      "Unexpected response from disconnect (HTTP 500)",
    )
  })

  it("propagates fetch-level network errors", async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"))

    await expect(disconnectOauthTool(WORKSPACE_ID, TOOL_SLUG)).rejects.toThrow("ECONNREFUSED")
  })
})

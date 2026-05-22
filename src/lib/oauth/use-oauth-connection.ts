"use client"

import { useCallback, useEffect, useRef } from "react"

/**
 * Shared client-side OAuth connection flow (PR #4 Commit 7).
 *
 * This hook encapsulates the "click Connect → open Composio consent popup
 * → poll /oauth/status → transition to CONNECTED / ERROR / timed-out" dance
 * that's identical between:
 *   - Setup wizard's initial "Connect with OAuth" flow
 *     (src/app/setup/[workspaceId]/step/[n]/page.tsx handleOAuthConnect)
 *   - Dashboard manage-tools "Reconnect" for EXPIRED/REVOKED rows
 *     (same file, handleOauthReconnect)
 *
 * Before this extraction, the flow was a ~120-LOC inline block in the setup
 * wizard with no reuse path. PR #4 Commit 6 stubbed the reconnect handler
 * with a console.log; this commit extracts the shared logic so both call
 * sites run the same code.
 *
 * Design:
 *   - Caller passes workspaceId and a callback bundle (onSuccess /
 *     onFailure / onTimeout / onInitiateError / onInitiated). The hook
 *     drives fetch, popup management, polling, cleanup; the caller owns
 *     UI state transitions (setting a row to "connecting", refreshing the
 *     tool list on success, etc.).
 *   - `connect(toolSlug)` is async but returns `void` — the hook signals
 *     completion through callbacks, not the returned promise, because the
 *     full consent-to-active roundtrip spans seconds to minutes and the
 *     caller generally wants to update state incrementally rather than
 *     `await` a long-running promise.
 *   - Any in-flight connection is cancelled when `connect` is called again
 *     with a different slug OR when the hook unmounts. No leaked intervals.
 *   - Popup blocking, network failure at initiate, Composio returning no
 *     redirectUrl, and poll-returns-FAILED all route to distinct callbacks
 *     so the caller can surface accurate messages.
 */

export type OAuthPollStatus = "PENDING" | "ACTIVE" | "FAILED"

/**
 * BYOK apiKeyForm payload — what the wizard renders when a toolkit is
 * API-key-brokered through Composio (typefully, jotform, toggl, shopify,
 * lever, metaads, pipedrive, webflow, follow_up_boss). The user provides
 * the key inline; no OAuth popup; submit POSTs to
 * /api/tools/[workspaceId]/byok/submit. See PR2.9.
 */
export interface ApiKeyFormPayload {
  toolSlug: string
  /**
   * Optional — the route currently always sets it (sourced from
   * `getToolBySlug(slug)?.name ?? slug`), but the wizard's
   * `resolveByokModalProps` fallback chain defends against missing /
   * empty values from a future server-side regression. Keeping it
   * optional in the type reflects what the resolver actually accepts.
   */
  displayName?: string
  fields: ReadonlyArray<{
    envVar: string
    label: string
    required: boolean
    primary: boolean
    helpUrl?: string
    placeholder?: string
  }>
  helpUrl?: string
}

export interface OAuthConnectionCallbacks {
  /**
   * Fires after the initiate POST succeeds, before the popup opens. Useful
   * for flipping the caller's row state to "connecting" or similar.
   */
  onInitiated?: (toolSlug: string, connectionId: string) => void
  /** Polling saw status=ACTIVE. Connection is live; caller should refetch. */
  onSuccess: (toolSlug: string) => void
  /**
   * Polling saw status=FAILED (user denied consent, Composio rejected, etc.)
   * Caller surfaces `error` in the row or a toast.
   */
  onFailure: (toolSlug: string, error: string) => void
  /**
   * Poll duration exceeded `timeoutMs` without terminal status. The
   * connection may still eventually succeed server-side; caller should
   * tell the user to try again.
   */
  onTimeout: (toolSlug: string) => void
  /**
   * Initiate POST itself failed (network error, 4xx/5xx, Composio not
   * configured, popup blocked, etc.) — fires before any polling starts.
   *
   * `error.code` carries the server-side error code when present (e.g.
   * `COMPOSIO_TOOLKIT_REQUIRES_CUSTOM_OAUTH` for RED-state toolkits whose
   * managed auth isn't configured). Client-side failure paths (network,
   * popup blocked, JSON parse) leave `code` undefined. Wizard branches on
   * the code to render yellow warnings vs. red errors.
   */
  onInitiateError: (toolSlug: string, error: { message: string; code?: string }) => void
  /**
   * PR2.9: Initiate returned `mode: "byok"` — the toolkit is API-key-
   * brokered through Composio, not OAuth. The hook detects this from the
   * initiate response and short-circuits: no popup, no polling, no DB
   * write side effects on the client. Caller opens a credentials modal
   * with `apiKeyForm.fields` and POSTs the result to
   * /api/tools/[workspaceId]/byok/submit. On submit success, caller
   * fires its own state-update logic (parallel to `onSuccess` but driven
   * by the caller, not this hook).
   *
   * Hook's responsibility ends after firing this callback. The BYOK
   * submission flow does not flow through this hook.
   */
  onApiKeyFormRequired?: (toolSlug: string, apiKeyForm: ApiKeyFormPayload) => void
}

export interface UseOAuthConnectionOptions {
  workspaceId: string
  callbacks: OAuthConnectionCallbacks
  /** Override the 2s poll cadence (useful for tests). */
  pollIntervalMs?: number
  /** Override the 120s overall timeout (useful for tests). */
  timeoutMs?: number
}

interface Cleanup {
  (): void
}

/**
 * Center a popup on the user's primary monitor. Extracted so the setup
 * wizard and dashboard reconnect use the same geometry — avoids a
 * "popup appeared in a different place than I expected" UX papercut.
 */
function centerPopupGeometry(): { width: number; height: number; left: number; top: number } {
  const width = 600
  const height = 700
  const left = Math.round(window.screenX + (window.outerWidth - width) / 2)
  const top = Math.round(window.screenY + (window.outerHeight - height) / 2)
  return { width, height, left, top }
}

export function useOAuthConnection({
  workspaceId,
  callbacks,
  pollIntervalMs = 2_000,
  timeoutMs = 120_000,
}: UseOAuthConnectionOptions): {
  connect: (toolSlug: string) => void
} {
  // Track the active cleanup so repeat calls cancel the previous flow
  // and unmounting cancels any in-flight polling.
  const cleanupRef = useRef<Cleanup | null>(null)

  useEffect(() => {
    return () => {
      cleanupRef.current?.()
      cleanupRef.current = null
    }
  }, [])

  // Keep callbacks in a ref so connect() doesn't recreate on every parent
  // render (which would break memoization of downstream handlers). Update
  // happens in useEffect to satisfy react-hooks/refs (writing to a ref
  // during render is a React-18+ anti-pattern). Because click handlers
  // fire after render, a click-triggered connect() always sees the latest
  // callbacks — the one edge case to avoid is calling connect() inside
  // the same render pass that changed callbacks, which none of our call
  // sites do.
  const callbacksRef = useRef(callbacks)
  useEffect(() => {
    callbacksRef.current = callbacks
  }, [callbacks])

  const connect = useCallback(
    (toolSlug: string) => {
      void (async () => {
        // Cancel any in-flight connection before starting a new one.
        cleanupRef.current?.()
        cleanupRef.current = null

        const cb = callbacksRef.current

        // 1. Initiate. On any failure here, bail via onInitiateError — no
        //    popup, no polling, no DB write side effects from the client.
        let initiateRes: Response
        try {
          initiateRes = await fetch(`/api/tools/${workspaceId}/oauth/initiate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ toolSlug }),
          })
        } catch (err) {
          cb.onInitiateError(toolSlug, {
            message: err instanceof Error ? err.message : "Network error during OAuth initiate",
          })
          return
        }

        let initiateData: {
          success?: boolean
          data?: {
            mode?: "oauth" | "byok"
            redirectUrl?: string
            connectionId?: string
            apiKeyForm?: ApiKeyFormPayload
          }
          error?: { message?: string; code?: string }
        }
        try {
          initiateData = await initiateRes.json()
        } catch {
          cb.onInitiateError(toolSlug, {
            message: `Unexpected response from OAuth initiate (HTTP ${initiateRes.status})`,
          })
          return
        }

        // PR2.9: BYOK short-circuit. If the route returned `mode: "byok"`
        // with an apiKeyForm, hand off to the caller and bow out. No popup,
        // no polling, no DB write side effects from the hook. The caller's
        // onApiKeyFormRequired handler is responsible for opening the
        // credentials modal and POSTing to /byok/submit.
        if (
          initiateData.success &&
          initiateData.data?.mode === "byok" &&
          initiateData.data?.apiKeyForm
        ) {
          if (cb.onApiKeyFormRequired) {
            cb.onApiKeyFormRequired(toolSlug, initiateData.data.apiKeyForm)
          } else {
            // Caller didn't wire the BYOK callback. Treat as a configuration
            // bug — surface via onInitiateError so the user sees something
            // rather than a silent no-op. Code lets the wizard branch on
            // it if desired (currently no special handling beyond the
            // generic error path).
            cb.onInitiateError(toolSlug, {
              message:
                "This tool needs an API key, but the wizard isn't wired to collect one. Reload and try again.",
              code: "BYOK_HANDLER_MISSING",
            })
          }
          return
        }

        if (!initiateData.success || !initiateData.data?.redirectUrl || !initiateData.data?.connectionId) {
          cb.onInitiateError(toolSlug, {
            message: initiateData.error?.message || "Failed to start OAuth",
            code: initiateData.error?.code,
          })
          return
        }

        const { redirectUrl, connectionId } = initiateData.data as { redirectUrl: string; connectionId: string }
        cb.onInitiated?.(toolSlug, connectionId)

        // 2. Open popup. Popup-blocked is the most common failure mode on
        //    first-time connects, so surface a specific error string.
        const { width, height, left, top } = centerPopupGeometry()
        const popup = window.open(
          redirectUrl,
          "composio-oauth",
          `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`,
        )
        if (!popup) {
          cb.onInitiateError(toolSlug, {
            message: "Popup blocked. Allow popups for this site and try again.",
          })
          return
        }

        // 3. Set up polling + cleanup. Cleanup closes popup, clears timers,
        //    removes listener, and nulls out cleanupRef so repeat calls
        //    don't accidentally re-run cleanup.
        const onMessage = (event: MessageEvent) => {
          if (event.origin !== window.location.origin) return
          // Polling will pick up ACTIVE; message just confirms popup flow
          // finished (user closed it or Composio redirected).
        }
        window.addEventListener("message", onMessage)

        let pollInterval: number | null = null
        let timeoutId: number | null = null
        const cleanup: Cleanup = () => {
          if (pollInterval !== null) window.clearInterval(pollInterval)
          if (timeoutId !== null) window.clearTimeout(timeoutId)
          pollInterval = null
          timeoutId = null
          window.removeEventListener("message", onMessage)
          try {
            if (popup && !popup.closed) popup.close()
          } catch {
            /* cross-origin close sometimes throws; ignore */
          }
          if (cleanupRef.current === cleanup) cleanupRef.current = null
        }
        cleanupRef.current = cleanup

        pollInterval = window.setInterval(() => {
          void (async () => {
            try {
              const statusRes = await fetch(
                `/api/tools/${workspaceId}/oauth/status?connectionId=${encodeURIComponent(connectionId)}&toolSlug=${encodeURIComponent(toolSlug)}`,
              )
              const statusJson = (await statusRes.json()) as {
                success?: boolean
                data?: { status?: OAuthPollStatus }
              }
              if (!statusJson.success) return
              const st = statusJson.data?.status
              if (st === "ACTIVE") {
                cleanup()
                cb.onSuccess(toolSlug)
              } else if (st === "FAILED") {
                cleanup()
                cb.onFailure(toolSlug, "OAuth failed or was cancelled.")
              }
              // PENDING → keep polling; no-op here.
            } catch {
              /* transient polling errors — next tick will retry */
            }
          })()
        }, pollIntervalMs)

        timeoutId = window.setTimeout(() => {
          cleanup()
          cb.onTimeout(toolSlug)
        }, timeoutMs)
      })()
    },
    [workspaceId, pollIntervalMs, timeoutMs],
  )

  return { connect }
}

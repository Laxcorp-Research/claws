"use client"

import { cn } from "@/lib/utils"
import { StatusDot } from "@/components/ui/status-dot"
import { AlertCircle, AlertTriangle, Loader2 } from "lucide-react"
import type { ToolAuthMode } from "@/data/tool-catalog"
import { TruncatedText } from "@/components/ui/truncate-with-tooltip"

export type ToolRowStatus =
  | "connected"
  | "disconnected"
  | "error"
  | "connecting"
  | "testing"
  // PR #2: backfill or user save carried the primary credential but the tool
  // is multi-cred (e.g. binance needs secret; coinbase needs secret +
  // passphrase). UI renders an amber "Incomplete credentials" badge and
  // a "Complete" button that reopens the CredentialsModal with all fields
  // blank for the user to re-enter everything including the known field
  // (we intentionally don't surface any decrypted value to the UI).
  | "needs-credentials"
  // PR #4 Commit 6: OAUTH_COMPOSIO-specific states. Previously collapsed
  // into "error" at the mapToolConnectionStatus boundary, which lost the
  // semantic distinction between "token lapsed, user needs to reconnect"
  // and "connection failed for unknown reason". Now passed through so
  // ToolRow can render OAuth-appropriate copy and action buttons.
  | "expired"
  | "revoked"

interface ToolRowProps {
  name: string
  description?: string
  connectionStatus: ToolRowStatus
  connectionType: "API_KEY" | "OAUTH_COMPOSIO" | "NO_AUTH"
  /**
   * PR2.9-fix1 (Bug 1A): drives the connect-button label for OAUTH_COMPOSIO
   * tools. Catalog-sourced; required on OAUTH_COMPOSIO entries (drift test
   * enforces). Undefined falls back to "Connect with OAuth" for safety
   * (e.g., dynamic Composio catalog entries that don't carry authMode).
   */
  authMode?: ToolAuthMode
  /** When false, OAuth tools show a disabled hint instead of starting a broken flow */
  composioOAuthAvailable?: boolean
  swappable?: boolean
  errorMessage?: string
  /** Non-error informational note (e.g., "saved but not verified"). Shown in warn color. */
  warningMessage?: string
  /**
   * PR #4 Commit 6: timestamp the OAuth connection was established. When set on
   * an OAUTH_COMPOSIO + connected row, the description slot renders a relative
   * "Connected N days ago" label instead of the static category description.
   * ISO string or Date; anything unparseable falls back silently.
   */
  connectedAt?: string | Date | null
  onConnect?: () => void
  onSwap?: () => void
  onTest?: () => void
  /**
   * PR #5: when set on a CONNECTED row that would otherwise show a Test
   * button, renders the button in disabled state with this string as the
   * native tooltip (`title` attr). Used for OAuth toolkits whose cheap-ops
   * registry entry is deferred (Asana, tracked in GH #41). Has no effect
   * on rows that wouldn't show a Test button in the first place.
   */
  testDisabledReason?: string
  onDisconnect?: () => void
  onReconnect?: () => void
  /**
   * PR #4 Commit 6: OAuth-specific teardown. Disconnect for API_KEY tools
   * calls the local-delete flow; Revoke for OAUTH_COMPOSIO tools needs to
   * also tell Composio to drop the connected-account on their side. Kept
   * as a distinct prop so rendering can differentiate the button style
   * (outline danger) and the confirm-dialog copy (PR #4 Commit 7 wires this).
   */
  onRevoke?: () => void
  className?: string
}

/**
 * PR #4 Commit 6 helper. Relative-time label for OAuth CONNECTED rows.
 * Returns null when the input is missing/unparseable; callers fall back
 * to the static description.
 */
function daysAgoLabel(from: ToolRowProps["connectedAt"]): string | null {
  if (!from) return null
  const d = from instanceof Date ? from : new Date(from)
  const ms = d.getTime()
  if (Number.isNaN(ms)) return null
  const deltaMs = Date.now() - ms
  if (deltaMs < 0) return "Connected just now"
  const days = Math.floor(deltaMs / (1000 * 60 * 60 * 24))
  if (days === 0) return "Connected today"
  if (days === 1) return "Connected 1 day ago"
  return `Connected ${days} days ago`
}

export function ToolRow({ name, description, connectionStatus, connectionType, authMode, composioOAuthAvailable = false, swappable, errorMessage, warningMessage, connectedAt, onConnect, onSwap, onTest, testDisabledReason, onDisconnect, onReconnect, onRevoke, className }: ToolRowProps) {
  const isError = connectionStatus === "error"
  const isTesting = connectionStatus === "testing"
  const needsCredentials = connectionStatus === "needs-credentials"
  const isOAuth = connectionType === "OAUTH_COMPOSIO"
  const isExpiredOrRevoked = connectionStatus === "expired" || connectionStatus === "revoked"

  // Description slot (Q1=c decision):
  //   non-OAuth        → keep static `description` prop (category label)
  //   OAuth connected  → prefer "Connected N days ago" (relative time)
  //                      with graceful fallback to `description` if
  //                      `connectedAt` is missing/unparseable
  //   OAuth expired/revoked → "Token expired — reconnect required"
  const relativeConnectedLabel = isOAuth && connectionStatus === "connected" ? daysAgoLabel(connectedAt) : null
  const effectiveDescription = isOAuth && isExpiredOrRevoked
    ? "Token expired — reconnect required"
    : relativeConnectedLabel ?? description
  const effectiveDescriptionTone = isOAuth && isExpiredOrRevoked ? "text-[var(--err)]" : "text-[var(--tx2)]"

  // Left-side icon/dot selection:
  //   error          → AlertTriangle (pre-existing)
  //   needsCreds     → AlertCircle (pre-existing)
  //   expired/revoked → StatusDot variant="expired" (red, distinct a11y)
  //   connected/testing → StatusDot "connected" (green)
  //   connecting     → StatusDot "connecting" (spinner)
  //   disconnected   → StatusDot "disconnected" (hollow)
  const dotStatus =
    connectionStatus === "connected" || isTesting
      ? "connected" as const
      : connectionStatus === "connecting"
        ? "connecting" as const
        : isExpiredOrRevoked
          ? "expired" as const
          : "disconnected" as const

  return (
    <div className={cn("px-3.5 py-3 border-b border-[var(--bd)] last:border-b-0", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {isError ? (
            <AlertTriangle className="w-3.5 h-3.5 text-[var(--err)] shrink-0" aria-hidden="true" />
          ) : needsCredentials ? (
            <AlertCircle className="w-3.5 h-3.5 text-[var(--warn)] shrink-0" aria-hidden="true" />
          ) : (
            <StatusDot
              status={dotStatus}
              ariaLabel={isExpiredOrRevoked ? `${name} OAuth connection expired` : undefined}
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold"><TruncatedText>{name}</TruncatedText></div>
            {effectiveDescription && <div className={cn("text-[10px]", effectiveDescriptionTone)}><TruncatedText>{effectiveDescription}</TruncatedText></div>}
            {connectionStatus === "connecting" && <div className="text-[10px] text-[var(--ac-text)] mt-0.5 inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> Connecting...</div>}
            {isError && !errorMessage && <div className="text-[10px] text-[var(--err)] mt-0.5">Connection failed</div>}
            {needsCredentials && <div className="text-[10px] text-[var(--warn)] mt-0.5">Incomplete credentials</div>}
          </div>
        </div>
        <div className="flex flex-none items-center gap-1.5">
          {(connectionStatus === "connected" || isTesting) && (
            <>
              <span className="text-[10px] text-[var(--ok)] font-medium">Connected</span>
              {/* PR #5: two Test-button modes on CONNECTED rows.
                  Enabled   → onTest passed, no testDisabledReason.
                  Disabled  → testDisabledReason passed (Asana-class toolkit
                              per GH #41). Tooltip via native `title` attr. */}
              {onTest && !testDisabledReason && (
                <button onClick={onTest} disabled={isTesting} className={cn("text-[10px] px-2.5 py-[3px] rounded-md border border-[var(--bd)] text-[var(--tx2)] transition-colors", isTesting ? "opacity-50" : "hover:border-[var(--bd2)]")}>
                  {isTesting ? <span className="inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> Testing...</span> : "Test"}
                </button>
              )}
              {testDisabledReason && (
                <button
                  type="button"
                  disabled
                  title={testDisabledReason}
                  aria-label={testDisabledReason}
                  className="text-[10px] px-2.5 py-[3px] rounded-md border border-[var(--bd)] text-[var(--tx3)] opacity-50 cursor-not-allowed"
                >
                  Test
                </button>
              )}
              {/* OAuth + connected + onRevoke present: render Revoke (outline danger).
                  Non-OAuth or no onRevoke: fall back to the pre-existing Disconnect text button. */}
              {isOAuth && onRevoke ? (
                <button onClick={onRevoke} className="text-[10px] px-2.5 py-[3px] rounded-md border border-[var(--err)] text-[var(--err)] hover:bg-[var(--errbg)] transition-colors">
                  Revoke
                </button>
              ) : (
                onDisconnect && <button onClick={onDisconnect} className="text-[10px] px-2.5 py-[3px] text-[var(--tx3)] hover:text-[var(--err)] transition-colors">Disconnect</button>
              )}
            </>
          )}
          {connectionStatus === "disconnected" && (
            <>
              {connectionType === "API_KEY" && onConnect && <button onClick={onConnect} className="text-[10px] px-2.5 py-[3px] rounded-md bg-[var(--tx)] text-white hover:opacity-90 transition-opacity">Enter API key</button>}
              {connectionType === "OAUTH_COMPOSIO" && !composioOAuthAvailable && (
                <span className="text-[10px] text-[var(--tx3)] px-[8px] py-[3px] border border-[var(--bd)] rounded-[4px]">
                  OAuth not configured
                </span>
              )}
              {connectionType === "OAUTH_COMPOSIO" && composioOAuthAvailable && onConnect && (
                <button type="button" onClick={onConnect} className="text-[10px] px-2.5 py-[3px] rounded-md bg-[var(--tx)] text-white hover:opacity-90 transition-opacity">
                  {/* PR2.9-fix1 (Bug 1A): label-correct at first paint per
                      catalog `authMode`. Server-side classifier remains
                      canonical via the initiate response; the catalog
                      field exists so the client doesn't have to round-trip
                      to know the right label. Undefined authMode (e.g.,
                      dynamic Composio catalog) defaults to "Connect with
                      OAuth" — safe for managed; if a BYOK toolkit ever
                      reaches here without authMode, the user sees an
                      OAuth label but the click still routes through the
                      server which detects BYOK and opens the API-key
                      form (degraded label, not broken behavior). */}
                  {authMode === "byok-api-key" ? "Enter API key" : "Connect with OAuth"}
                </button>
              )}
              {swappable && onSwap && <button onClick={onSwap} className="text-[10px] px-2.5 py-[3px] rounded-md border border-[var(--bd)] text-[var(--tx2)] hover:border-[var(--bd2)] transition-colors">Swap</button>}
            </>
          )}
          {connectionStatus === "connecting" && (
            <button disabled className="text-[10px] px-2.5 py-[3px] rounded-md border border-[var(--bd)] text-[var(--tx3)] opacity-50">Connecting…</button>
          )}
          {isError && (onReconnect || onConnect) && (
            <button onClick={onReconnect || onConnect} className="text-[10px] px-2.5 py-[3px] rounded-md border border-[var(--err)] text-[var(--err)] hover:bg-[var(--errbg)] transition-colors">Retry</button>
          )}
          {/* OAuth EXPIRED/REVOKED: primary Reconnect button, replaces Revoke entirely.
              D5 spec: "inline Reconnect button replaces Revoke". */}
          {isExpiredOrRevoked && (onReconnect || onConnect) && (
            <button onClick={onReconnect || onConnect} className="text-[10px] px-2.5 py-[3px] rounded-md bg-[var(--tx)] text-white hover:opacity-90 transition-opacity">
              Reconnect
            </button>
          )}
          {needsCredentials && (onReconnect || onConnect) && (
            <button onClick={onReconnect || onConnect} className="text-[10px] px-2.5 py-[3px] rounded-md border border-[var(--warn)] text-[var(--warn)] hover:bg-[color:color-mix(in_oklab,var(--warn)_12%,transparent)] transition-colors">
              Complete
            </button>
          )}
        </div>
      </div>
      {needsCredentials && warningMessage && (
        <p className="text-[11px] text-[var(--warn)] mt-1.5 ml-[22px]">{warningMessage}</p>
      )}
      {isError && errorMessage && (
        <p className="text-[11px] text-[var(--err)] mt-1.5 ml-[22px]">
          {errorMessage}
          {onReconnect && <button onClick={onReconnect} className="font-semibold underline ml-1">Reconnect</button>}
        </p>
      )}
      {!isError && warningMessage && (
        <p className="text-[11px] text-[var(--warn)] mt-1.5 ml-[22px]">{warningMessage}</p>
      )}
    </div>
  )
}

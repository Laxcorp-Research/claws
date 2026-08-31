/**
 * RESEND ERROR HONESTY (2026-08-25): the Resend SDK does NOT throw on a
 * rejected send - it RESOLVES with `{ data: null, error: {...} }`. Every
 * call site in the codebase wrapped sends in try/catch and treated a
 * resolved promise as delivered, so a dead email looked like success:
 * trial-expiry stamped its notify marker without sending, the critical-alert
 * email fallback ledgered delivered:true and armed its own 12h dedup against
 * retrying, and the magic-link path told NextAuth the mail was out.
 *
 * This wrapper is the only legal way to send email (enforced by the
 * no-raw-resend grep test):
 *  - checks `error` on the RESOLVED response and returns a typed failure
 *    the caller must branch on (it never throws),
 *  - writes an ActivityLog row per send attempt when workspace context
 *    exists (metadata.eventKind email_sent/email_failed - same ledger
 *    pattern as critical-alert-push). Sends with no workspace (magic link,
 *    payout, marketplace review, platform alerts) have nowhere to ledger
 *    without a schema migration (ActivityLog.workspaceId is NOT NULL) -
 *    those get structured log lines and the typed result instead,
 *  - `critical: true` retries once, and a still-failed critical send with
 *    an `escalateWorkspaceId` raises the email-delivery-failed critical
 *    alert (owner Telegram, email fallback) so it never dies silently.
 */

import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { getResend } from "@/lib/resend"

export const DEFAULT_EMAIL_FROM = "Claws <noreply@buildclaws.ai>"

/** ActivityLog metadata.eventKind values for the email ledger. */
export const EMAIL_SENT_EVENT_KIND = "email_sent"
export const EMAIL_FAILED_EVENT_KIND = "email_failed"

export type EmailKind =
  | "magic_link"
  | "trial_expiry_notify"
  | "trial_expiry_stop"
  | "credits_exhausted_stop"
  | "payout_paid"
  | "critical_alert_fallback"
  | "template_approved"
  | "template_rejected"
  | "skill_approved"
  | "skill_rejected"
  | "security_update"
  | "credit_pool_alert"
  | "owner_alert"

export type SendEmailArgs = {
  kind: EmailKind
  to: string
  subject: string
  html: string
  from?: string
  /** Workspaces this email is about - one ActivityLog row is written per id. */
  workspaceIds?: string[]
  /** Critical sends get exactly one retry before reporting failure. */
  critical?: boolean
  /**
   * Workspace whose owner is critical-alerted (Telegram, email fallback)
   * when a critical send is still failed after the retry.
   */
  escalateWorkspaceId?: string
}

export type SendEmailResult =
  | { ok: true; attempts: number }
  | { ok: false; attempts: number; reason: string }

type AttemptOutcome = { ok: true } | { ok: false; reason: string }

async function attemptSend(payload: {
  from: string
  to: string
  subject: string
  html: string
}): Promise<AttemptOutcome> {
  try {
    const res = await getResend().emails.send(payload)
    // THE FIX: the SDK resolves { data, error } - a resolved promise is NOT
    // success. Removing this check reverts to the ignore-error bug (locked
    // by the MUTATION test in send-email.test.ts).
    const error = (res as { error?: { message?: string; name?: string } | null } | null)?.error
    if (error) {
      return { ok: false, reason: error.message || error.name || "resend-error-response" }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

async function ledgerEmailAttempt(args: {
  workspaceIds: string[]
  kind: EmailKind
  to: string
  attempts: number
  ok: boolean
  reason?: string
}): Promise<void> {
  for (const workspaceId of args.workspaceIds) {
    try {
      await prisma.activityLog.create({
        data: {
          workspaceId,
          action: args.ok ? `Email sent (${args.kind})` : `Email failed (${args.kind})`,
          detail: args.ok ? null : (args.reason ?? "unknown"),
          actionType: args.ok ? "SYSTEM" : "ERROR",
          timestamp: new Date(),
          metadata: JSON.stringify({
            eventKind: args.ok ? EMAIL_SENT_EVENT_KIND : EMAIL_FAILED_EVENT_KIND,
            emailKind: args.kind,
            to: args.to,
            attempts: args.attempts,
            reason: args.reason ?? null,
          }),
        },
      })
    } catch (err) {
      // Ledger failure must never mask (or invert) the send result.
      log.error("send-email: failed to ledger attempt", {
        workspaceId,
        kind: args.kind,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

/**
 * Send an email through Resend with honest failure reporting. Never throws:
 * callers branch on `result.ok` (magic link re-throws to satisfy NextAuth,
 * trial-notify skips its idempotency stamp so the next cron tick retries,
 * payout surfaces `notifyEmail: "failed"` to the admin response).
 */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const payload = {
    from: args.from ?? DEFAULT_EMAIL_FROM,
    to: args.to,
    subject: args.subject,
    html: args.html,
  }

  let attempts = 1
  let outcome = await attemptSend(payload)
  if (!outcome.ok && args.critical) {
    attempts = 2
    outcome = await attemptSend(payload)
  }

  const workspaceIds = args.workspaceIds ?? []
  if (outcome.ok) {
    log.info("send-email: delivered", { kind: args.kind, to: args.to, attempts })
    await ledgerEmailAttempt({ workspaceIds, kind: args.kind, to: args.to, attempts, ok: true })
    return { ok: true, attempts }
  }

  log.error("send-email: failed", {
    kind: args.kind,
    to: args.to,
    attempts,
    reason: outcome.reason,
  })
  await ledgerEmailAttempt({
    workspaceIds,
    kind: args.kind,
    to: args.to,
    attempts,
    ok: false,
    reason: outcome.reason,
  })

  // Sustained critical failure escalates to the workspace owner's critical
  // alert (Telegram first, email fallback). The fallback kind itself is
  // excluded: escalating a failed alert email would re-enter this path.
  if (args.critical && args.escalateWorkspaceId && args.kind !== "critical_alert_fallback") {
    try {
      const { sendCriticalAlert } = await import("@/lib/alerts/critical-alert-push")
      await sendCriticalAlert({
        workspaceId: args.escalateWorkspaceId,
        alertKey: "email-delivery-failed",
        detail: `Email "${args.kind}" to ${args.to} failed after ${attempts} attempts: ${outcome.reason}`,
      })
    } catch (err) {
      log.error("send-email: escalation failed", {
        kind: args.kind,
        workspaceId: args.escalateWorkspaceId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { ok: false, attempts, reason: outcome.reason }
}

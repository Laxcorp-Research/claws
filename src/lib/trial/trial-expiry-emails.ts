/**
 * Resend templates for GRACE-24 trial expiry (exhaustion.ts precedent).
 *
 * Copy uses "stopped/stop", never "paused" (#339).
 *
 * FLAG (restore gap): resubscribe does NOT auto-redeploy. Runtime files
 * restore on next deploy/wake only if a pre-destroy snapshot was synced.
 * Email therefore says "subscribe to redeploy", not "data auto-restored".
 */

import { sendEmail, type SendEmailResult } from "@/lib/email/send-email"

const APP_ORIGIN = "https://app.buildclaws.ai"
const BILLING_HREF = `${APP_ORIGIN}/settings?tab=billing`

function clawListHtml(clawNames: string[]): string {
  if (clawNames.length === 0) return "your Claws"
  if (clawNames.length === 1) return `<strong>${escapeHtml(clawNames[0])}</strong>`
  return clawNames.map((n) => `<strong>${escapeHtml(n)}</strong>`).join(", ")
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function emailShell(bodyInner: string): string {
  return `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body style="margin:0;padding:0;background-color:#FBFBFB;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;margin:40px auto;background:#FFFFFF;border:1px solid #EFEFEF;border-radius:12px;">
            <tr>
              <td style="padding:40px 32px;text-align:center;">
                <div style="font-size:20px;font-weight:700;color:#0A0A0B;margin-bottom:8px;">Claws</div>
                ${bodyInner}
              </td>
            </tr>
          </table>
        </body>
        </html>
      `
}

export async function sendTrialExpiryNotifyEmail(args: {
  to: string
  name: string | null
  clawNames: string[]
  workspaceIds?: string[]
}): Promise<SendEmailResult> {
  const greeting = escapeHtml(args.name || "there")
  const claws = clawListHtml(args.clawNames)
  // RESEND HONESTY: result propagates to the cron, which only stamps
  // trialExpiryNotifiedAt on ok - a failed send retries next hourly tick.
  return sendEmail({
    kind: "trial_expiry_notify",
    workspaceIds: args.workspaceIds,
    to: args.to,
    subject: "Your 3-day trial has ended",
    html: emailShell(`
                <div style="font-size:15px;color:#0A0A0B;margin-bottom:16px;">Hey ${greeting},</div>
                <div style="font-size:13px;color:#555;margin-bottom:24px;line-height:1.6;">
                  Your 3-day trial has ended - subscribe to keep ${claws} running.
                  We'll stop them in 24 hours otherwise.
                </div>
                <a href="${BILLING_HREF}" style="display:inline-block;padding:10px 32px;background-color:#0A0A0B;color:#FFFFFF;font-size:13px;font-weight:500;text-decoration:none;border-radius:8px;">
                  Subscribe
                </a>
    `),
  })
}

export async function sendTrialExpiryStoppedEmail(args: {
  to: string
  name: string | null
  stoppedNames: string[]
  workspaceIds?: string[]
}): Promise<SendEmailResult> {
  const greeting = escapeHtml(args.name || "there")
  const claws = clawListHtml(args.stoppedNames)
  const count = args.stoppedNames.length
  const countLabel =
    count === 1 ? "1 Claw" : `${count} Claws`
  // CRITICAL send: the user's claws were just stopped - this mail must not
  // die silently. One retry, then the email-delivery-failed critical alert
  // (owner Telegram) on the first stopped workspace.
  return sendEmail({
    kind: "trial_expiry_stop",
    critical: true,
    workspaceIds: args.workspaceIds,
    escalateWorkspaceId: args.workspaceIds?.[0],
    to: args.to,
    subject: "Your trial Claws have been stopped",
    html: emailShell(`
                <div style="font-size:15px;color:#0A0A0B;margin-bottom:16px;">Hey ${greeting},</div>
                <div style="font-size:13px;color:#555;margin-bottom:24px;line-height:1.6;">
                  We stopped ${countLabel} (${claws}) after your trial ended.
                  Subscribe to redeploy - workspace configuration is kept;
                  runtime memory restores on redeploy when a recent backup exists.
                </div>
                <a href="${BILLING_HREF}" style="display:inline-block;padding:10px 32px;background-color:#0A0A0B;color:#FFFFFF;font-size:13px;font-weight:500;text-decoration:none;border-radius:8px;">
                  Subscribe to redeploy
                </a>
    `),
  })
}

import { prisma } from "@/lib/db"
import { sendEmail } from "@/lib/email/send-email"
import { log } from "@/lib/logger"
import { syncThenDestroy } from "@/lib/openclaw/deployer"
import { getApiKeySource, isCreditUser } from "@/lib/credits/api-key-source"
import { STARTER_CREDIT_CENTS, formatCreditDollars } from "@/lib/credits/constants"

export async function onCreditsExhausted(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      workspaces: {
        where: { status: { in: ["RUNNING"] } },
        select: { id: true, apiKeySourceOverride: true },
      },
      creditAccount: { select: { initialGrantCents: true } },
    },
  })

  if (!user) return

  // Show the amount the user was ACTUALLY granted (accurate for legacy $25/$5
  // accounts), falling back to the current grant constant if absent.
  const grantedLabel = formatCreditDollars(
    user.creditAccount?.initialGrantCents ?? STARTER_CREDIT_CENTS,
  )

  for (const ws of user.workspaces) {
    // Resolved mode (override ?? user), not user-only - WIRE-TEST-style
    // fixtures set Workspace.apiKeySourceOverride=PLATFORM_CREDIT while
    // User.apiKeySource stays NONE.
    if (!isCreditUser(getApiKeySource(ws, user))) continue

    try {
      await syncThenDestroy(ws.id)
      // Credit termination: serviceDelete is correct - this claw is not napping.
    } catch (err) {
      log.error("Failed to destroy container on credit exhaustion", {
        workspaceId: ws.id,
        userId,
        error: String(err),
      })
    }

    // Converge to HIBERNATED (workspace + phase) so Wake works after BYOK recovery.
    // syncThenDestroy leaves STOPPED; overwriting both closes the wake dead-end.
    await prisma.$transaction([
      prisma.workspace.update({
        where: { id: ws.id },
        data: { status: "HIBERNATED" },
      }),
      prisma.containerState.updateMany({
        where: { workspaceId: ws.id },
        data: {
          containerPhase: "HIBERNATED",
          hibernatedAt: new Date(),
          wakeRequestedAt: null,
        },
      }),
    ])
  }

  // RESEND HONESTY: wrapper checks the SDK's resolved error field and
  // ledgers email_sent/email_failed on each stopped workspace's activity.
  const emailResult = await sendEmail({
    kind: "credits_exhausted_stop",
    workspaceIds: user.workspaces.map((ws) => ws.id),
    to: user.email,
    subject: "Your Claws starter credits have been used",
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body style="margin:0;padding:0;background-color:#FBFBFB;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;margin:40px auto;background:#FFFFFF;border:1px solid #EFEFEF;border-radius:12px;">
            <tr>
              <td style="padding:40px 32px;text-align:center;">
                <div style="font-size:20px;font-weight:700;color:#0A0A0B;margin-bottom:8px;">Claws</div>
                <div style="font-size:15px;color:#0A0A0B;margin-bottom:16px;">Hey ${user.name || "there"},</div>
                <div style="font-size:13px;color:#555;margin-bottom:24px;line-height:1.6;">
                  Your ${grantedLabel} starter credits have been used up.
                  ${user.workspaces.length > 0 ? `We've stopped ${user.workspaces.length} running Claw${user.workspaces.length > 1 ? "s" : ""}.` : ""}
                  Add your own API key or subscribe to keep your Claws running.
                </div>
                <a href="https://app.buildclaws.ai/settings?tab=api-keys" style="display:inline-block;padding:10px 32px;background-color:#0A0A0B;color:#FFFFFF;font-size:13px;font-weight:500;text-decoration:none;border-radius:8px;margin-right:8px;">
                  Add API Key
                </a>
                <a href="https://app.buildclaws.ai/settings?tab=billing" style="display:inline-block;padding:10px 32px;background-color:#FFFFFF;color:#0A0A0B;font-size:13px;font-weight:500;text-decoration:none;border-radius:8px;border:1px solid #EFEFEF;">
                  Subscribe
                </a>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
  })
  if (!emailResult.ok) {
    log.error("Failed to send credits-exhausted email", { userId, error: emailResult.reason })
  }

  log.info("Credits exhausted, workspaces paused", {
    userId,
    pausedCount: user.workspaces.length,
  })
}

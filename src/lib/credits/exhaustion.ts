import { prisma } from "@/lib/db"
import { getResend } from "@/lib/resend"
import { log } from "@/lib/logger"
import { destroyContainer } from "@/lib/openclaw/deployer"
import { STARTER_CREDIT_CENTS, formatCreditDollars } from "@/lib/credits/constants"

export async function onCreditsExhausted(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      workspaces: { where: { status: { in: ["RUNNING"] } } },
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
    if (user.apiKeySource === "PLATFORM_CREDIT") {
      try {
        await destroyContainer(ws.id)
      } catch (err) {
        log.error("Failed to destroy container on credit exhaustion", {
          workspaceId: ws.id,
          userId,
          error: String(err),
        })
      }

      // TODO: containerPhase='HIBERNATED' set here is inconsistent with
      // destroyContainer's containerPhase='STOPPED' (applied one call up).
      // Result: this branch leaves Workspace.status='STOPPED' but
      // ContainerState.containerPhase='HIBERNATED', a semantic mismatch
      // that predates the STOPPED/HIBERNATED distinction. To be resolved
      // in the billing-overhaul PR9: under the per-Claw subscription
      // model, credit exhaustion NO LONGER destroys containers
      // (subscription-funded), so this entire if-branch and the
      // destroyContainer call above both disappear.
      await prisma.containerState.updateMany({
        where: { workspaceId: ws.id },
        data: { containerPhase: "HIBERNATED", hibernatedAt: new Date() },
      })
    }
  }

  try {
    await getResend().emails.send({
      from: "Claws <noreply@buildclaws.ai>",
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
                  ${user.workspaces.length > 0 ? `We've paused ${user.workspaces.length} running Claw${user.workspaces.length > 1 ? "s" : ""}.` : ""}
                  Add your own API key or subscribe to keep your Claws running.
                </div>
                <a href="https://app.buildclaws.ai/settings/api-keys" style="display:inline-block;padding:10px 32px;background-color:#0A0A0B;color:#FFFFFF;font-size:13px;font-weight:500;text-decoration:none;border-radius:8px;margin-right:8px;">
                  Add API Key
                </a>
                <a href="https://app.buildclaws.ai/settings/billing" style="display:inline-block;padding:10px 32px;background-color:#FFFFFF;color:#0A0A0B;font-size:13px;font-weight:500;text-decoration:none;border-radius:8px;border:1px solid #EFEFEF;">
                  Subscribe
                </a>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    })
  } catch (err) {
    log.error("Failed to send credits-exhausted email", { userId, error: String(err) })
  }

  log.info("Credits exhausted, workspaces paused", {
    userId,
    pausedCount: user.workspaces.length,
  })
}

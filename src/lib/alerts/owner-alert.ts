import { log } from "@/lib/logger"
import { sendEmail } from "@/lib/email/send-email"
import { telegramSendMessage } from "@/lib/channels/telegram-bot-api"
import { dashboardUrl } from "@/lib/alerts/app-url"

export const OWNER_ALERT_KEYS = [
  "railway-create-budget",
  "railway-domain-cap",
  "heal-exhausted",
  "detector-anomaly",
] as const

export type OwnerAlertKey = (typeof OWNER_ALERT_KEYS)[number]

export function isOwnerAlertKey(key: string): boolean {
  return (OWNER_ALERT_KEYS as readonly string[]).includes(key)
}

function ownerEmail(): string | null {
  const email = process.env.ADMIN_ALERT_EMAIL?.trim()
  return email && email.length > 0 ? email : null
}

/**
 * Platform-health only. Never reads a workspace owner's email or Telegram.
 */
export async function sendOwnerAlert(args: {
  alertKey: OwnerAlertKey
  title: string
  detail?: string | null
  workspaceId?: string
}): Promise<{ sent: boolean; channel: "telegram" | "email" | "skipped"; reason?: string }> {
  const botToken = process.env.FOUNDER_TELEGRAM_BOT_TOKEN?.trim()
  const chatId = process.env.FOUNDER_TELEGRAM_CHAT_ID?.trim()
  const text = args.detail ? `${args.title}\n${args.detail}` : args.title

  if (botToken && chatId) {
    const ok = await telegramSendMessage({ botToken, chatId, text })
    if (ok) return { sent: true, channel: "telegram" }
  }

  const email = ownerEmail()
  if (!email) {
    log.warn("owner-alert: no founder Telegram or ADMIN_ALERT_EMAIL", {
      alertKey: args.alertKey,
    })
    return { sent: false, channel: "skipped", reason: "no-owner-channel" }
  }

  const href = dashboardUrl(args.workspaceId)
  const result = await sendEmail({
    kind: "owner_alert",
    to: email,
    subject: `Claws owner alert: ${args.title}`,
    html: `<p>${args.title}</p>${args.detail ? `<p>${args.detail}</p>` : ""}<p><a href="${href}">Open dashboard</a></p>`,
    workspaceIds: args.workspaceId ? [args.workspaceId] : [],
  })
  if (!result.ok) {
    log.error("owner-alert: email failed", {
      alertKey: args.alertKey,
      error: result.reason,
    })
    return { sent: false, channel: "email", reason: result.reason ?? "email-send-failed" }
  }
  return { sent: true, channel: "email" }
}

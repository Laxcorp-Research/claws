import { log } from "@/lib/logger"
import { sendEmail } from "@/lib/email/send-email"
import { telegramSendMessageDetailed } from "@/lib/channels/telegram-bot-api"
import { dashboardUrl } from "@/lib/alerts/app-url"

export const OWNER_ALERT_KEYS = [
  "railway-create-budget",
  "railway-domain-cap",
  "heal-exhausted",
  "detector-anomaly",
  "owner-plane-test",
  "silent-wake",
  "digest-missed",
  "runtime-candidate-ready",
  "runtime-candidate-stale",
  "hibernation-refuse-unsafe",
  "provider-auth-missing",
  "service-pool-low",
] as const

export type OwnerAlertKey = (typeof OWNER_ALERT_KEYS)[number]

export function isOwnerAlertKey(key: string): boolean {
  return (OWNER_ALERT_KEYS as readonly string[]).includes(key)
}

function ownerEmail(): string | null {
  const email = process.env.ADMIN_ALERT_EMAIL?.trim()
  return email && email.length > 0 ? email : null
}

export type OwnerAlertChannel = "telegram" | "email" | "both" | "skipped"

/**
 * Platform-health only. Never reads a workspace owner's email or Telegram.
 * When both founder Telegram and ADMIN_ALERT_EMAIL are configured, fan out to both.
 */
export async function sendOwnerAlert(args: {
  alertKey: OwnerAlertKey
  title: string
  detail?: string | null
  workspaceId?: string
}): Promise<{
  sent: boolean
  channel: OwnerAlertChannel
  telegramSent?: boolean
  emailSent?: boolean
  telegramMessageId?: number
  reason?: string
}> {
  const botToken = process.env.FOUNDER_TELEGRAM_BOT_TOKEN?.trim()
  const chatId = process.env.FOUNDER_TELEGRAM_CHAT_ID?.trim()
  const email = ownerEmail()
  const text = args.detail ? `${args.title}\n${args.detail}` : args.title

  let telegramSent = false
  let telegramMessageId: number | undefined
  if (botToken && chatId) {
    const tg = await telegramSendMessageDetailed({ botToken, chatId, text })
    telegramSent = tg.ok
    telegramMessageId = tg.messageId
    if (!telegramSent) {
      log.warn("owner-alert: founder Telegram send failed", { alertKey: args.alertKey })
    }
  }

  let emailSent = false
  let emailReason: string | undefined
  if (email) {
    const href = dashboardUrl(args.workspaceId)
    const result = await sendEmail({
      kind: "owner_alert",
      to: email,
      subject: `Claws owner alert: ${args.title}`,
      html: `<p>${args.title}</p>${args.detail ? `<p>${args.detail}</p>` : ""}<p><a href="${href}">Open dashboard</a></p>`,
      workspaceIds: args.workspaceId ? [args.workspaceId] : [],
    })
    emailSent = result.ok
    if (!result.ok) {
      emailReason = result.reason ?? "email-send-failed"
      log.error("owner-alert: email failed", {
        alertKey: args.alertKey,
        error: emailReason,
      })
    }
  }

  if (telegramSent && emailSent) {
    return {
      sent: true,
      channel: "both",
      telegramSent: true,
      emailSent: true,
      telegramMessageId,
    }
  }
  if (telegramSent) {
    return {
      sent: true,
      channel: "telegram",
      telegramSent: true,
      emailSent: false,
      telegramMessageId,
      reason: email ? emailReason : "no-admin-alert-email",
    }
  }
  if (emailSent) {
    return {
      sent: true,
      channel: "email",
      telegramSent: false,
      emailSent: true,
      reason: botToken && chatId ? "telegram-send-failed" : "no-founder-telegram",
    }
  }
  if (!botToken || !chatId) {
    if (!email) {
      log.warn("owner-alert: no founder Telegram or ADMIN_ALERT_EMAIL", {
        alertKey: args.alertKey,
      })
    }
    return { sent: false, channel: "skipped", reason: "no-owner-channel" }
  }
  return { sent: false, channel: "telegram", telegramSent: false, emailSent: false, reason: "telegram-send-failed" }
}

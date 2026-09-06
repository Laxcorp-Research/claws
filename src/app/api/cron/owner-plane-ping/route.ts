import { NextRequest } from "next/server"
import { apiError, apiSuccess } from "@/lib/api/response"
import { sendOwnerAlert } from "@/lib/alerts/owner-alert"

export const maxDuration = 15

/**
 * Manual owner-plane ping. Not scheduled in vercel.json.
 * Fires sendOwnerAlert through the Vercel-injected FOUNDER_TELEGRAM_* env.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}` || !process.env.CRON_SECRET) {
    return apiError("UNAUTHORIZED", "Unauthorized", 401)
  }
  if (req.nextUrl.searchParams.get("confirm") !== "owner-plane-test") {
    return apiError("VALIDATION_ERROR", "confirm=owner-plane-test required", 400)
  }

  const title = `CLAWS owner-plane ping ${new Date().toISOString()}`
  const result = await sendOwnerAlert({
    alertKey: "owner-plane-test",
    title,
    detail: "Prod/staging route ping. Founder Telegram + ADMIN_ALERT_EMAIL.",
  })

  return apiSuccess({
    sent: result.sent,
    channel: result.channel,
    telegramSent: result.telegramSent ?? false,
    emailSent: result.emailSent ?? false,
    telegramMessageId: result.telegramMessageId ?? null,
    chatId: process.env.FOUNDER_TELEGRAM_CHAT_ID?.trim() ?? null,
    reason: result.reason ?? null,
  })
}

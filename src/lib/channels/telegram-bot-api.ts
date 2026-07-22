import { createHmac } from "node:crypto"
import { log } from "@/lib/logger"

const TELEGRAM_API = "https://api.telegram.org"

export function telegramWebhookSecretToken(
  workspaceId: string,
  botToken: string,
): string {
  return createHmac("sha256", botToken).update(`wake-on-channel:${workspaceId}`).digest("hex")
}

export function publicAppBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.trim()}` : "")
  return raw.replace(/\/$/, "")
}

export function telegramWakeWebhookUrl(workspaceId: string): string | null {
  const base = publicAppBaseUrl()
  if (!base) return null
  return `${base}/api/webhooks/telegram/${workspaceId}`
}

async function telegramCall(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; description?: string }> {
  const res = await fetch(`${TELEGRAM_API}/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as { ok?: boolean; description?: string }
  return { ok: Boolean(json.ok), description: json.description }
}

export async function telegramSendMessage(args: {
  botToken: string
  chatId: string | number
  text: string
}): Promise<boolean> {
  try {
    const result = await telegramCall(args.botToken, "sendMessage", {
      chat_id: args.chatId,
      text: args.text,
    })
    if (!result.ok) {
      log.warn("telegram sendMessage failed", { description: result.description })
    }
    return result.ok
  } catch (err) {
    log.warn("telegram sendMessage error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

/** Point Telegram updates at the platform wake-on-channel webhook (hibernated claws). */
export async function telegramSetWakeWebhook(args: {
  botToken: string
  workspaceId: string
}): Promise<boolean> {
  const url = telegramWakeWebhookUrl(args.workspaceId)
  if (!url) {
    log.warn("telegram setWebhook skipped: no public app URL", {
      workspaceId: args.workspaceId,
    })
    return false
  }
  try {
    const result = await telegramCall(args.botToken, "setWebhook", {
      url,
      secret_token: telegramWebhookSecretToken(args.workspaceId, args.botToken),
      allowed_updates: ["message"],
      drop_pending_updates: false,
    })
    if (!result.ok) {
      log.warn("telegram setWebhook failed", {
        workspaceId: args.workspaceId,
        description: result.description,
      })
    }
    return result.ok
  } catch (err) {
    log.warn("telegram setWebhook error", {
      workspaceId: args.workspaceId,
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

/** Clear platform webhook so a live OpenClaw can resume polling. */
export async function telegramDeleteWebhook(botToken: string): Promise<boolean> {
  try {
    const result = await telegramCall(botToken, "deleteWebhook", {
      drop_pending_updates: false,
    })
    return result.ok
  } catch {
    return false
  }
}

export function extractTelegramTextMessage(update: unknown): {
  chatId: number
  text: string
  messageId: number
} | null {
  if (!update || typeof update !== "object") return null
  const msg = (update as { message?: unknown }).message
  if (!msg || typeof msg !== "object") return null
  const m = msg as {
    message_id?: unknown
    text?: unknown
    chat?: { id?: unknown }
  }
  if (typeof m.text !== "string" || m.text.length === 0) return null
  if (typeof m.chat?.id !== "number") return null
  if (typeof m.message_id !== "number") return null
  return { chatId: m.chat.id, text: m.text, messageId: m.message_id }
}

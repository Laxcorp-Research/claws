import { createHmac } from "node:crypto"
import { log } from "@/lib/logger"
import { isSelfHost } from "@/lib/profile"

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

/**
 * Self-host has no public URL requirement: Telegram updates arrive via
 * getUpdates. Hosted keeps setWebhook when a public app URL exists.
 */
export function telegramDeliveryMode(): "poll" | "webhook" {
  if (isSelfHost()) return "poll"
  if (!publicAppBaseUrl()) return "poll"
  return "webhook"
}

async function telegramCall(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; description?: string; result?: Record<string, unknown> }> {
  const res = await fetch(`${TELEGRAM_API}/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as {
    ok?: boolean
    description?: string
    result?: Record<string, unknown>
  }
  return { ok: Boolean(json.ok), description: json.description, result: json.result }
}

/** Telegram Bot API hard limit for sendMessage text. */
export const TELEGRAM_MAX_MESSAGE_CHARS = 4096

/** Split long agent replies so platform delivery does not silently fail. */
export function chunkTelegramText(
  text: string,
  maxChars: number = TELEGRAM_MAX_MESSAGE_CHARS,
): string[] {
  if (text.length === 0) return [""]
  if (text.length <= maxChars) return [text]
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += maxChars) {
    chunks.push(text.slice(i, i + maxChars))
  }
  return chunks
}

export type TelegramSendResult = {
  ok: boolean
  messageId?: number
}

export async function telegramSendMessageDetailed(args: {
  botToken: string
  chatId: string | number
  text: string
}): Promise<TelegramSendResult> {
  try {
    const chunks = chunkTelegramText(args.text)
    let messageId: number | undefined
    for (const chunk of chunks) {
      const result = await telegramCall(args.botToken, "sendMessage", {
        chat_id: args.chatId,
        text: chunk,
      })
      if (!result.ok) {
        log.warn("telegram sendMessage failed", { description: result.description })
        return { ok: false }
      }
      if (messageId === undefined && typeof result.result?.message_id === "number") {
        messageId = result.result.message_id
      }
    }
    return { ok: true, messageId }
  } catch (err) {
    log.warn("telegram sendMessage error", {
      error: err instanceof Error ? err.message : String(err),
    })
    return { ok: false }
  }
}

export async function telegramSendMessage(args: {
  botToken: string
  chatId: string | number
  text: string
}): Promise<boolean> {
  const result = await telegramSendMessageDetailed(args)
  return result.ok
}

/** Point Telegram updates at the platform wake-on-channel webhook (hibernated claws). */
export async function telegramSetWakeWebhook(args: {
  botToken: string
  workspaceId: string
}): Promise<boolean> {
  if (telegramDeliveryMode() === "poll") {
    log.info("telegram setWebhook skipped: getUpdates polling owns this profile", {
      workspaceId: args.workspaceId,
    })
    return false
  }
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

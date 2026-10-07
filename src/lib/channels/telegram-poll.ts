/**
 * Telegram getUpdates long-poll. Used when telegramDeliveryMode() is "poll"
 * (self-host, or hosted with no public URL). Deletes the webhook first so
 * Telegram will deliver updates to getUpdates.
 */
import { extractTelegramTextMessage } from "@/lib/channels/telegram-bot-api"

const TELEGRAM_API = "https://api.telegram.org"

export interface TelegramPollMessage {
  updateId: number
  chatId: number
  text: string
  messageId: number
}

type FetchImpl = typeof fetch

async function telegramPost(
  fetchImpl: FetchImpl,
  botToken: string,
  method: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  const res = await fetchImpl(`${TELEGRAM_API}/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return (await res.json()) as { ok: boolean; result?: unknown; description?: string }
}

export async function pollTelegramOnce(args: {
  botToken: string
  offset: number
  timeoutSec?: number
  fetchImpl?: FetchImpl
  /** First call of a session clears setWebhook so getUpdates receives traffic. */
  dropWebhook?: boolean
}): Promise<{ nextOffset: number; messages: TelegramPollMessage[] }> {
  const fetchImpl = args.fetchImpl ?? fetch
  if (args.dropWebhook) {
    const deleted = await telegramPost(fetchImpl, args.botToken, "deleteWebhook", {
      drop_pending_updates: false,
    })
    if (!deleted.ok) {
      throw new Error(deleted.description || "telegram deleteWebhook failed")
    }
  }

  const result = await telegramPost(fetchImpl, args.botToken, "getUpdates", {
    offset: args.offset,
    timeout: args.timeoutSec ?? 25,
    allowed_updates: ["message"],
  })
  if (!result.ok) {
    throw new Error(result.description || "telegram getUpdates failed")
  }

  const updates = Array.isArray(result.result) ? result.result : []
  const messages: TelegramPollMessage[] = []
  let nextOffset = args.offset
  for (const update of updates) {
    if (!update || typeof update !== "object") continue
    const updateId = (update as { update_id?: unknown }).update_id
    if (typeof updateId !== "number") continue
    nextOffset = Math.max(nextOffset, updateId + 1)
    const text = extractTelegramTextMessage(update)
    if (!text) continue
    messages.push({
      updateId,
      chatId: text.chatId,
      text: text.text,
      messageId: text.messageId,
    })
  }
  return { nextOffset, messages }
}

/**
 * Blocks on getUpdates until `signal` aborts. `onMessage` runs for each
 * text message. A thrown handler does not lose the offset: the offset
 * advances only after the handler resolves.
 */
export async function runTelegramLongPoll(args: {
  botToken: string
  signal: AbortSignal
  onMessage: (message: TelegramPollMessage) => Promise<void> | void
  fetchImpl?: FetchImpl
  timeoutSec?: number
}): Promise<void> {
  let offset = 0
  let dropWebhook = true
  while (!args.signal.aborted) {
    const batch = await pollTelegramOnce({
      botToken: args.botToken,
      offset,
      timeoutSec: args.timeoutSec ?? 25,
      fetchImpl: args.fetchImpl,
      dropWebhook,
    })
    dropWebhook = false
    for (const message of batch.messages) {
      if (args.signal.aborted) return
      await args.onMessage(message)
      offset = Math.max(offset, message.updateId + 1)
    }
    if (batch.messages.length === 0) {
      offset = batch.nextOffset
    }
  }
}

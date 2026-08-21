/**
 * Wake-on-channel reply routing - origin channel → delivery target.
 *
 * P5 injects Telegram inbound via operator `chat.send`, which the gateway
 * stamps as webchat. Gateway `deliver:true` therefore cannot send the agent
 * reply home on Telegram. Platform must deliver using the same Bot API path
 * as the wake-ack (`telegramSendMessage`).
 *
 * MUTATION: strip telegram → platform_telegram mapping → routing tests fail.
 */

export type WakeChannelOrigin = {
  channel: "telegram"
  chatId: number
}

export type WakeReplyDelivery =
  | { mode: "platform_telegram"; chatId: number }
  | { mode: "none" }

/** How long to hold the gateway WS waiting for chat.state=final after inject. */
export const WAKE_REPLY_WAIT_MS = 90_000

/**
 * Decide where the agent reply must be delivered for a wake-on-channel origin.
 * Telegram → platform Bot API (not gateway deliver).
 */
export function resolveWakeReplyDelivery(origin: WakeChannelOrigin): WakeReplyDelivery {
  if (origin.channel === "telegram" && Number.isFinite(origin.chatId)) {
    return { mode: "platform_telegram", chatId: origin.chatId }
  }
  return { mode: "none" }
}

/** Session key used for the gateway inject (keeps telegram chat identity). */
export function wakeInjectSessionKey(origin: WakeChannelOrigin): string {
  return `telegram:${origin.chatId}`
}

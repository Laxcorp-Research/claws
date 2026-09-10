import { telegramSendMessageDetailed } from "@/lib/channels/telegram-bot-api"
import { log } from "@/lib/logger"
import {
  preferNumericTelegramAllowFrom,
  type ChannelConfigMap,
} from "@/lib/openclaw/channel-config"

export type ClawChannelSendResult =
  | { sent: true; channel: "telegram" | "discord" | "slack"; messageId?: number }
  | { sent: false; channel: "none"; reason: "web-chat-only" | "send-failed" }

async function discordSendMessage(args: {
  token: string
  userId: string
  text: string
}): Promise<boolean> {
  try {
    const dm = await fetch("https://discord.com/api/v10/users/@me/channels", {
      method: "POST",
      headers: {
        Authorization: `Bot ${args.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ recipient_id: args.userId }),
    })
    if (!dm.ok) return false
    const opened = (await dm.json()) as { id?: string }
    if (!opened.id) return false
    const msg = await fetch(`https://discord.com/api/v10/channels/${opened.id}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${args.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: args.text.slice(0, 2000) }),
    })
    return msg.ok
  } catch (err) {
    log.warn("discord send-as-claw failed", {
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

async function slackSendMessage(args: {
  botToken: string
  channel: string
  text: string
}): Promise<boolean> {
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel: args.channel, text: args.text }),
    })
    const json = (await res.json()) as { ok?: boolean }
    return Boolean(json.ok)
  } catch (err) {
    log.warn("slack send-as-claw failed", {
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

export function hasLaunchChannel(config: ChannelConfigMap): boolean {
  const telegramChat = preferNumericTelegramAllowFrom(config.telegram?.allowFrom)?.[0]
  if (config.telegram?.botToken && telegramChat !== undefined && telegramChat !== null) {
    return true
  }
  if (config.discord?.token && config.discord.allowFrom?.[0]) return true
  if (config.slack?.botToken && config.slack.allowFrom?.[0]) return true
  return false
}

/**
 * Post as the claw on its connected launch channel (Telegram, then Discord, then Slack).
 * Web-chat-only workspaces return web-chat-only so the caller can email + dashboard.
 */
export async function sendAsClawChannel(
  config: ChannelConfigMap,
  text: string,
): Promise<ClawChannelSendResult> {
  const telegram = config.telegram
  const telegramChat = preferNumericTelegramAllowFrom(telegram?.allowFrom)?.[0]
  if (telegram?.botToken && telegramChat !== undefined && telegramChat !== null) {
    const result = await telegramSendMessageDetailed({
      botToken: telegram.botToken,
      chatId: telegramChat,
      text,
    })
    return result.ok
      ? { sent: true, channel: "telegram", messageId: result.messageId }
      : { sent: false, channel: "none", reason: "send-failed" }
  }

  const discordUser = config.discord?.allowFrom?.[0]
  if (config.discord?.token && discordUser) {
    const ok = await discordSendMessage({
      token: config.discord.token,
      userId: discordUser,
      text,
    })
    return ok
      ? { sent: true, channel: "discord" }
      : { sent: false, channel: "none", reason: "send-failed" }
  }

  const slackChannel = config.slack?.allowFrom?.[0]
  if (config.slack?.botToken && slackChannel) {
    const ok = await slackSendMessage({
      botToken: config.slack.botToken,
      channel: slackChannel,
      text,
    })
    return ok
      ? { sent: true, channel: "slack" }
      : { sent: false, channel: "none", reason: "send-failed" }
  }

  return { sent: false, channel: "none", reason: "web-chat-only" }
}

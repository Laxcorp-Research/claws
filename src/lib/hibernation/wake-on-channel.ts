import { after } from "next/server"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { decrypt } from "@/lib/encryption"
import { wakeWorkspace } from "@/lib/hibernation/manager"
import { touchLastChannelMessageAt } from "@/lib/hibernation/channel-inbound"
import { parseChannelConfigBlob } from "@/lib/openclaw/channel-config"
import {
  extractTelegramTextMessage,
  telegramDeleteWebhook,
  telegramSendMessage,
  telegramSetWakeWebhook,
  telegramWebhookSecretToken,
} from "@/lib/channels/telegram-bot-api"
import { getGatewayConnectionInfo } from "@/lib/openclaw/deployer"
import {
  decryptDeviceIdentity,
  encryptDeviceIdentity,
  generateDeviceIdentity,
} from "@/lib/openclaw/device-identity"
import { sendChatMessage } from "@/lib/openclaw/gateway-chat-client"
import {
  resolveWakeReplyDelivery,
  wakeInjectSessionKey,
  WAKE_REPLY_WAIT_MS,
} from "@/lib/hibernation/wake-reply-routing"
import {
  canWakeHibernatedWorkspace,
  WAKE_ON_CHANNEL_ENTITLEMENT_DENIED,
} from "@/lib/trial/wake-entitlement"
import crypto from "node:crypto"

/** Locked ack copy - mutation: change string → contract fails. */
export const WAKE_ON_CHANNEL_ACK = "Waking up - one moment"

/** ActivityLog eventKind for wake-ack Telegram sends (soak ledger completeness). */
export const WAKE_ACK_SENT_EVENT_KIND = "wake_ack_sent"

export const WAKE_ON_CHANNEL_FAIL =
  "Couldn't wake your Claw - try again or open the dashboard."

export const WAKE_ON_CHANNEL_STILL =
  "Still waking up - hang tight, I'll reply when I'm online."

export type WakeOnChannelDecision =
  | { action: "ack_and_wake" }
  | { action: "ack_still_waking" }
  | { action: "running_untouched" }
  | { action: "reject"; detail: string }

/**
 * Decide how a Telegram inbound should be handled for a workspace status.
 * RUNNING is "untouched" - platform webhook should not own live traffic
 * (OpenClaw polls); if an update arrives anyway we do not wake.
 */
export function decideWakeOnChannel(status: string): WakeOnChannelDecision {
  // Wake path is hibernation-only (wakeWorkspace rejects STOPPED).
  if (status === "HIBERNATED") {
    return { action: "ack_and_wake" }
  }
  if (status === "WAKING" || status === "DEPLOYING") {
    return { action: "ack_still_waking" }
  }
  if (status === "PROVISIONING_QUEUED") {
    return { action: "reject", detail: "provisioning queued" }
  }
  if (status === "RUNNING" || status === "PAUSED" || status === "ERROR") {
    return { action: "running_untouched" }
  }
  return { action: "reject", detail: `unsupported status ${status}` }
}

export async function armTelegramWakeWebhook(workspaceId: string): Promise<boolean> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { channelConfigEncrypted: true },
  })
  if (!ws?.channelConfigEncrypted) return false
  const config = parseChannelConfigBlob(ws.channelConfigEncrypted, decrypt)
  const botToken = config.telegram?.botToken
  if (!botToken) return false
  return telegramSetWakeWebhook({ botToken, workspaceId })
}

async function ledgerWakeAckSent(args: {
  workspaceId: string
  ackKind: "wake" | "still_waking"
  delivered: boolean
  chatId: number
}): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        workspaceId: args.workspaceId,
        action:
          args.ackKind === "wake"
            ? "Wake ack sent"
            : "Wake ack sent (still waking)",
        detail: args.delivered ? null : "telegram-send-failed",
        actionType: "SYSTEM",
        timestamp: new Date(),
        metadata: JSON.stringify({
          eventKind: WAKE_ACK_SENT_EVENT_KIND,
          ackKind: args.ackKind,
          delivered: args.delivered,
          chatId: args.chatId,
          channel: "telegram",
        }),
      },
    })
  } catch (err) {
    log.error("wake-on-channel: failed to ledger wake ack", {
      workspaceId: args.workspaceId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export type WakeOnChannelDeps = {
  wakeWorkspace: typeof wakeWorkspace
  sendMessage: typeof telegramSendMessage
  deleteWebhook: typeof telegramDeleteWebhook
  sendChat: typeof sendChatMessage
  /** Next.js `after()` or a test stub that schedules the continuation. */
  after: (task: () => void | Promise<void>) => void
}

const defaultDeps: WakeOnChannelDeps = {
  wakeWorkspace,
  sendMessage: telegramSendMessage,
  deleteWebhook: telegramDeleteWebhook,
  sendChat: sendChatMessage,
  after,
}

/**
 * Handle a Telegram Update for wake-on-channel.
 * Returns HTTP-ish result for the webhook route (always 200 to Telegram when parsed).
 */
export async function handleTelegramWakeOnChannel(
  args: {
    workspaceId: string
    update: unknown
    secretHeader: string | null
  },
  deps: WakeOnChannelDeps = defaultDeps,
): Promise<{ ok: true; handled: string } | { ok: false; status: number; error: string }> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: args.workspaceId },
    select: {
      id: true,
      status: true,
      channelConfigEncrypted: true,
      containerHost: true,
      gatewayToken: true,
      chatDeviceKeyEncrypted: true,
      user: {
        select: {
          trialUsed: true,
          trialStartedAt: true,
          trialEndsAt: true,
          hasActiveSubscription: true,
          subscriptionStatus: true,
          subscriptionOnHoldAt: true,
        },
      },
    },
  })
  if (!workspace) {
    return { ok: false, status: 404, error: "workspace not found" }
  }
  if (!workspace.channelConfigEncrypted) {
    return { ok: false, status: 400, error: "telegram not configured" }
  }

  const config = parseChannelConfigBlob(workspace.channelConfigEncrypted, decrypt)
  const botToken = config.telegram?.botToken
  if (!botToken) {
    return { ok: false, status: 400, error: "telegram not configured" }
  }

  const expected = telegramWebhookSecretToken(args.workspaceId, botToken)
  if (!args.secretHeader || args.secretHeader !== expected) {
    return { ok: false, status: 401, error: "invalid webhook secret" }
  }

  const inbound = extractTelegramTextMessage(args.update)
  if (!inbound) {
    return { ok: true, handled: "ignored-non-text" }
  }

  const decision = decideWakeOnChannel(workspace.status)

  if (decision.action === "running_untouched") {
    // Live claw owns Telegram via polling - clear stray platform webhook.
    await deps.deleteWebhook(botToken)
    return { ok: true, handled: "running_untouched" }
  }

  if (decision.action === "reject") {
    return { ok: true, handled: `reject:${decision.detail}` }
  }

  if (decision.action === "ack_still_waking") {
    const delivered = await deps.sendMessage({
      botToken,
      chatId: inbound.chatId,
      text: WAKE_ON_CHANNEL_STILL,
    })
    await ledgerWakeAckSent({
      workspaceId: args.workspaceId,
      ackKind: "still_waking",
      delivered,
      chatId: inbound.chatId,
    })
    return { ok: true, handled: "ack_still_waking" }
  }

  // ack_and_wake - entitlement gate before ack / WAKING flip.
  const entitlement = canWakeHibernatedWorkspace(workspace.user)
  if (!entitlement.allowed) {
    const delivered = await deps.sendMessage({
      botToken,
      chatId: inbound.chatId,
      text: WAKE_ON_CHANNEL_ENTITLEMENT_DENIED,
    })
    log.info("wake-on-channel: entitlement denied", {
      workspaceId: args.workspaceId,
      reason: entitlement.reason,
      delivered,
    })
    return { ok: true, handled: "entitlement_denied" }
  }

  // ack_and_wake
  const delivered = await deps.sendMessage({
    botToken,
    chatId: inbound.chatId,
    text: WAKE_ON_CHANNEL_ACK,
  })
  await ledgerWakeAckSent({
    workspaceId: args.workspaceId,
    ackKind: "wake",
    delivered,
    chatId: inbound.chatId,
  })

  try {
    await touchLastChannelMessageAt(args.workspaceId, new Date())
  } catch {
    // non-fatal
  }

  // Mark WAKING synchronously so a second inbound doesn't double-wake.
  await prisma.$transaction([
    prisma.workspace.update({
      where: { id: args.workspaceId },
      data: { status: "WAKING" },
    }),
    prisma.containerState.update({
      where: { workspaceId: args.workspaceId },
      data: { containerPhase: "WAKING", wakeRequestedAt: new Date() },
    }),
  ])

  const chatId = inbound.chatId
  const text = inbound.text
  const workspaceId = args.workspaceId

  deps.after(() =>
    runWakeDeliver({
      workspaceId,
      botToken,
      chatId,
      text,
      deps,
    }).catch((err) => {
      log.error("wake-on-channel async failed", {
        workspaceId,
        error: err instanceof Error ? err.message : String(err),
      })
    }),
  )

  return { ok: true, handled: "ack_and_wake" }
}

async function runWakeDeliver(args: {
  workspaceId: string
  botToken: string
  chatId: number
  text: string
  deps: WakeOnChannelDeps
}): Promise<void> {
  const { workspaceId, botToken, chatId, text, deps } = args

  await deps.wakeWorkspace(workspaceId)

  const afterWake = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      status: true,
      containerHost: true,
      gatewayToken: true,
      chatDeviceKeyEncrypted: true,
    },
  })

  if (!afterWake || afterWake.status !== "RUNNING") {
    await deps.sendMessage({
      botToken,
      chatId,
      text: WAKE_ON_CHANNEL_FAIL,
    })
    // Re-arm webhook so the next inbound can retry wake-on-channel.
    await telegramSetWakeWebhook({ botToken, workspaceId })
    return
  }

  // Hand Telegram back to OpenClaw polling before injecting the user message.
  await deps.deleteWebhook(botToken)

  const connection = await getGatewayConnectionInfo(workspaceId)
  if (!connection) {
    await deps.sendMessage({
      botToken,
      chatId,
      text: WAKE_ON_CHANNEL_FAIL,
    })
    return
  }

  const deviceKey = afterWake.chatDeviceKeyEncrypted
    ? decryptDeviceIdentity(afterWake.chatDeviceKeyEncrypted)
    : generateDeviceIdentity()
  if (!afterWake.chatDeviceKeyEncrypted) {
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { chatDeviceKeyEncrypted: encryptDeviceIdentity(deviceKey) },
    })
  }

  // Origin for reply routing. Operator chat.send stamps webchat - gateway
  // channel-deliver cannot send the reply home (RELAY-STRIPS-ORIGIN). Hold the
  // WS for the agent final, then platform-send via the same Bot API as the ack.
  const origin = { channel: "telegram" as const, chatId }
  const delivery = resolveWakeReplyDelivery(origin)
  const sessionKey = wakeInjectSessionKey(origin)
  const result = await deps.sendChat({
    wsUrl: connection.wsUrl,
    token: connection.token,
    deviceKey,
    sessionKey,
    message: text,
    idempotencyKey: crypto.randomUUID(),
    deliver: false,
    awaitReplyMs: delivery.mode === "platform_telegram" ? WAKE_REPLY_WAIT_MS : undefined,
  })

  if (!result.ok) {
    log.warn("wake-on-channel deliver failed", {
      workspaceId,
      reason: result.reason,
      detail: result.detail,
    })
    await deps.sendMessage({
      botToken,
      chatId,
      text: WAKE_ON_CHANNEL_FAIL,
    })
    return
  }

  if (delivery.mode === "platform_telegram") {
    const replyText = result.replyText?.trim()
    if (!replyText) {
      log.warn("wake-on-channel reply missing after inject", {
        workspaceId,
        runId: result.runId,
      })
      await deps.sendMessage({
        botToken,
        chatId: delivery.chatId,
        text: WAKE_ON_CHANNEL_FAIL,
      })
      return
    }
    const sent = await deps.sendMessage({
      botToken,
      chatId: delivery.chatId,
      text: replyText,
    })
    if (!sent) {
      log.warn("wake-on-channel platform telegram send failed", {
        workspaceId,
        runId: result.runId,
        chatId: delivery.chatId,
      })
    }
  }
}

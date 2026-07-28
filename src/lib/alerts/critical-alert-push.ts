/**
 * PR-B: Critical alerts push — owner Telegram (fallback email), with
 * opt-out + 12h dedup.
 *
 * Emitted for four alert classes (see AlertKey below). Each call to
 * `sendCriticalAlert` is independently deduped per (workspaceId, alertKey):
 * a SUCCESSFUL delivery (telegram or email) within the last COOLDOWN_MS
 * suppresses further pushes for that same key, even across process
 * restarts — the ledger lives in ActivityLog (SYSTEM rows,
 * metadata.eventKind = "critical_alert_push"), not in memory.
 *
 * Recovery/clear is implicit: callers (health-monitor, activity route) only
 * invoke this on a NEW transition into the bad state (e.g. `heartbeatMissedAt`
 * flips from null → Date). Once the underlying flag clears, the next raise is
 * a fresh transition and is eligible to send again as soon as the 12h
 * cooldown for that (workspaceId, alertKey) has elapsed — there is no
 * separate "clear" push.
 */

import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { decrypt } from "@/lib/encryption"
import { getResend } from "@/lib/resend"
import { parseChannelConfigBlob, type ChannelConfigMap } from "@/lib/openclaw/channel-config"
import { telegramSendMessage } from "@/lib/channels/telegram-bot-api"

// ─── Alert classes ─────────────────────────────────────────────────────────

export const ALERT_KEYS = [
  "container-unhealthy",
  "cron-job-failed",
  "heartbeat-missed",
  "state-sync-stale",
] as const

export type AlertKey = (typeof ALERT_KEYS)[number]

/** Dedup / re-alert window. MUTATION: dropping this check breaks dedup. */
export const COOLDOWN_MS = 12 * 60 * 60 * 1000

export const CRITICAL_ALERT_PUSH_EVENT_KIND = "critical_alert_push"

type AlertCopy = { title: string; emoji: string }

// Copy: never "paused" — these are health/ops signals, not lifecycle actions.
const ALERT_COPY: Record<AlertKey, AlertCopy> = {
  "container-unhealthy": { emoji: "\uD83D\uDD34", title: "Container unhealthy" },
  "cron-job-failed": { emoji: "\u26A0\uFE0F", title: "Cron job failing repeatedly" },
  "heartbeat-missed": { emoji: "\u23F0", title: "Heartbeat missed" },
  "state-sync-stale": { emoji: "\uD83D\uDD04", title: "State sync stale" },
}

export function buildAlertMessage(alertKey: AlertKey, detail?: string | null): string {
  const copy = ALERT_COPY[alertKey]
  const head = `${copy.emoji} ${copy.title}`
  return detail ? `${head}\n${detail}` : head
}

// ─── Pure decision helpers (unit-testable without DB/network) ─────────────

export type CriticalAlertDecision =
  | { action: "skip"; reason: "opt-out" }
  | { action: "skip"; reason: "cooldown"; lastDeliveredAt: Date }
  | { action: "send" }

/**
 * Pure planner: opt-out short-circuits; otherwise a successful delivery for
 * this (workspaceId, alertKey) within COOLDOWN_MS suppresses the send.
 * MUTATION: removing the COOLDOWN_MS comparison collapses dedup to "always
 * send" — the accompanying test asserts this stays gated.
 */
export function decideCriticalAlertSend(args: {
  optOut: boolean
  lastDeliveredAt: Date | null
  nowMs: number
}): CriticalAlertDecision {
  if (args.optOut) return { action: "skip", reason: "opt-out" }
  if (
    args.lastDeliveredAt &&
    args.nowMs - args.lastDeliveredAt.getTime() < COOLDOWN_MS
  ) {
    return { action: "skip", reason: "cooldown", lastDeliveredAt: args.lastDeliveredAt }
  }
  return { action: "send" }
}

export type DeliveryTarget =
  | { channel: "telegram"; botToken: string; chatId: string | number }
  | { channel: "email"; email: string }
  | { channel: "skipped"; reason: "no-channel-configured" }

/**
 * Pure resolver: prefer Telegram (workspace channel config allowFrom[0]),
 * fall back to the workspace owner's email, else no channel available.
 */
export function resolveDeliveryTarget(
  config: ChannelConfigMap,
  ownerEmail: string | null,
): DeliveryTarget {
  const telegram = config.telegram
  const chatId = telegram?.allowFrom?.[0]
  if (telegram?.botToken && chatId !== undefined && chatId !== null) {
    return { channel: "telegram", botToken: telegram.botToken, chatId }
  }
  if (ownerEmail) {
    return { channel: "email", email: ownerEmail }
  }
  return { channel: "skipped", reason: "no-channel-configured" }
}

// ─── Ledger (ActivityLog SYSTEM row per attempt) ───────────────────────────

async function ledgerCriticalAlertPush(args: {
  workspaceId: string
  alertKey: AlertKey
  channel: "telegram" | "email" | "skipped"
  delivered: boolean
  reason?: string
}): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        workspaceId: args.workspaceId,
        action: `Critical alert: ${ALERT_COPY[args.alertKey].title}`,
        detail: args.reason ?? null,
        actionType: "SYSTEM",
        timestamp: new Date(),
        metadata: JSON.stringify({
          eventKind: CRITICAL_ALERT_PUSH_EVENT_KIND,
          alertKey: args.alertKey,
          channel: args.channel,
          delivered: args.delivered,
          reason: args.reason ?? null,
        }),
      },
    })
  } catch (err) {
    log.error("critical-alert-push: failed to ledger send attempt", {
      workspaceId: args.workspaceId,
      alertKey: args.alertKey,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

async function findLastDeliveredAt(
  workspaceId: string,
  alertKey: AlertKey,
): Promise<Date | null> {
  const since = new Date(Date.now() - COOLDOWN_MS)
  const prior = await prisma.activityLog.findFirst({
    where: {
      workspaceId,
      actionType: "SYSTEM",
      timestamp: { gte: since },
      AND: [
        { metadata: { contains: `"eventKind":"${CRITICAL_ALERT_PUSH_EVENT_KIND}"` } },
        { metadata: { contains: `"alertKey":"${alertKey}"` } },
        { metadata: { contains: `"delivered":true` } },
      ],
    },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true },
  })
  return prior?.timestamp ?? null
}

async function sendCriticalAlertEmail(args: {
  email: string
  alertKey: AlertKey
  detail?: string | null
}): Promise<boolean> {
  const copy = ALERT_COPY[args.alertKey]
  try {
    await getResend().emails.send({
      from: "Claws <noreply@buildclaws.ai>",
      to: args.email,
      subject: `Claws critical alert: ${copy.title}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body style="margin:0;padding:0;background-color:#FBFBFB;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;margin:40px auto;background:#FFFFFF;border:1px solid #EFEFEF;border-radius:12px;">
            <tr>
              <td style="padding:40px 32px;text-align:center;">
                <div style="font-size:20px;font-weight:700;color:#0A0A0B;margin-bottom:8px;">Claws</div>
                <div style="font-size:15px;color:#0A0A0B;margin-bottom:16px;">${copy.emoji} ${copy.title}</div>
                ${args.detail ? `<div style="font-size:13px;color:#555;margin-bottom:16px;line-height:1.6;">${args.detail}</div>` : ""}
                <a href="https://app.buildclaws.ai/dashboard" style="display:inline-block;padding:10px 32px;background-color:#0A0A0B;color:#FFFFFF;font-size:13px;font-weight:500;text-decoration:none;border-radius:8px;">
                  Open dashboard
                </a>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    })
    return true
  } catch (err) {
    log.error("critical-alert-push: email send failed", {
      email: args.email,
      alertKey: args.alertKey,
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

export type SendCriticalAlertResult = {
  sent: boolean
  channel: "telegram" | "email" | "skipped"
  reason?: string
}

/**
 * Send (or dedup-skip) a critical alert push for one workspace + alert
 * class. Every invocation ledgers an ActivityLog SYSTEM row regardless of
 * outcome (skip included) so `findLastDeliveredAt` has a durable dedup
 * source across process restarts / serverless cold starts.
 */
export async function sendCriticalAlert(args: {
  workspaceId: string
  alertKey: AlertKey
  detail?: string | null
}): Promise<SendCriticalAlertResult> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: args.workspaceId },
    select: {
      id: true,
      criticalAlertsOptOut: true,
      channelConfigEncrypted: true,
      user: { select: { email: true } },
    },
  })
  if (!workspace) {
    log.warn("critical-alert-push: workspace not found", {
      workspaceId: args.workspaceId,
      alertKey: args.alertKey,
    })
    return { sent: false, channel: "skipped", reason: "workspace-not-found" }
  }

  const lastDeliveredAt = await findLastDeliveredAt(args.workspaceId, args.alertKey)
  const decision = decideCriticalAlertSend({
    optOut: workspace.criticalAlertsOptOut,
    lastDeliveredAt,
    nowMs: Date.now(),
  })

  if (decision.action === "skip") {
    await ledgerCriticalAlertPush({
      workspaceId: args.workspaceId,
      alertKey: args.alertKey,
      channel: "skipped",
      delivered: false,
      reason: decision.reason,
    })
    return { sent: false, channel: "skipped", reason: decision.reason }
  }

  let config: ChannelConfigMap = {}
  try {
    config = parseChannelConfigBlob(workspace.channelConfigEncrypted, decrypt)
  } catch (err) {
    log.error("critical-alert-push: failed to parse channel config", {
      workspaceId: args.workspaceId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  const ownerEmail = workspace.user?.email ?? null
  const target = resolveDeliveryTarget(config, ownerEmail)
  const text = buildAlertMessage(args.alertKey, args.detail)

  if (target.channel === "telegram") {
    const ok = await telegramSendMessage({
      botToken: target.botToken,
      chatId: target.chatId,
      text,
    })
    if (ok) {
      await ledgerCriticalAlertPush({
        workspaceId: args.workspaceId,
        alertKey: args.alertKey,
        channel: "telegram",
        delivered: true,
      })
      return { sent: true, channel: "telegram" }
    }
    // Telegram send failed — fall back to email (per requirement) if we
    // have an owner address.
    await ledgerCriticalAlertPush({
      workspaceId: args.workspaceId,
      alertKey: args.alertKey,
      channel: "telegram",
      delivered: false,
      reason: "telegram-send-failed",
    })
    if (ownerEmail) {
      const emailOk = await sendCriticalAlertEmail({
        email: ownerEmail,
        alertKey: args.alertKey,
        detail: args.detail,
      })
      await ledgerCriticalAlertPush({
        workspaceId: args.workspaceId,
        alertKey: args.alertKey,
        channel: "email",
        delivered: emailOk,
        reason: emailOk ? undefined : "email-send-failed",
      })
      return { sent: emailOk, channel: "email" }
    }
    return { sent: false, channel: "skipped", reason: "telegram-send-failed" }
  }

  if (target.channel === "email") {
    const ok = await sendCriticalAlertEmail({
      email: target.email,
      alertKey: args.alertKey,
      detail: args.detail,
    })
    await ledgerCriticalAlertPush({
      workspaceId: args.workspaceId,
      alertKey: args.alertKey,
      channel: "email",
      delivered: ok,
      reason: ok ? undefined : "email-send-failed",
    })
    return { sent: ok, channel: "email" }
  }

  await ledgerCriticalAlertPush({
    workspaceId: args.workspaceId,
    alertKey: args.alertKey,
    channel: "skipped",
    delivered: false,
    reason: "no-channel-configured",
  })
  return { sent: false, channel: "skipped", reason: "no-channel-configured" }
}

export const __internal = {
  ALERT_COPY,
  findLastDeliveredAt,
  ledgerCriticalAlertPush,
  sendCriticalAlertEmail,
}

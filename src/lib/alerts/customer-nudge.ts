import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { decrypt } from "@/lib/encryption"
import { sendEmail } from "@/lib/email/send-email"
import { dashboardUrl } from "@/lib/alerts/app-url"
import { sendAsClawChannel } from "@/lib/channels/send-as-claw"
import {
  parseChannelConfigBlob,
  type ChannelConfigMap,
} from "@/lib/openclaw/channel-config"
import type { HealConditionId } from "@/lib/healing/conditions"
import { getHealPolicy } from "@/lib/healing/registry"

export const CUSTOMER_NUDGE_EVENT_KIND = "customer_nudge"
export const CUSTOMER_NUDGE_RESOLVE_EVENT_KIND = "customer_nudge_resolved"

export type NudgeCopy = { tried: string; action: string }

const NUDGE_COPY: Partial<Record<HealConditionId, NudgeCopy>> = {
  "oauth-expired": {
    tried: "Reconnect retries are exhausted.",
    action: "Reconnect the expired tool on the dashboard Tools page.",
  },
  "tool-connection-error": {
    tried: "The connection check failed and retries are exhausted.",
    action: "Fix or reconnect the broken tool, then resume.",
  },
  "twitter-402-tier": {
    tried: "X API returned 402; search is Tavily-only until the tier includes that endpoint.",
    action: "Add credits or upgrade at developer.x.com.",
  },
  "subscription-on-hold": {
    tried: "Billing is on hold; the claw is in grace until the card is updated.",
    action: "Update your card in Settings > Billing.",
  },
  "payment-failed": {
    tried: "The last payment attempt failed.",
    action: "Update the card in Settings > Billing.",
  },
  "state-sync-near-cap": {
    tried: "Memory bundle is near the size cap; further growth risks a refused hibernate.",
    action: "Open Conversations and delete old sessions.",
  },
  "pending-approval-unactioned": {
    tried: "A deliverable has been waiting for your approval.",
    action: "Open the dashboard, read the draft, then Approve, Edit, or Reject.",
  },
  "spend-limit-100": {
    tried: "Monthly API spend hit your limit. The claw was synced and paused (not destroyed).",
    action: "Raise the spend limit or wait until next month.",
  },
}

export function userOnlyNudgeConditionIds(): HealConditionId[] {
  return (Object.keys(NUDGE_COPY) as HealConditionId[]).filter(
    (id) => getHealPolicy(id).ruling === "user-only" || id === "spend-limit-100",
  )
}

export function isUserOnlyNudgeCondition(id: string): boolean {
  return userOnlyNudgeConditionIds().includes(id as HealConditionId)
}

export function buildCustomerNudgeText(condition: HealConditionId): string {
  const copy = NUDGE_COPY[condition]
  if (!copy) return condition
  return `${copy.tried}\nOne action: ${copy.action}`
}

export function buildCustomerNudgeResolveText(condition: HealConditionId): string {
  return `${condition}: back to normal`
}

/**
 * DIGEST HONESTY: an open nudge (delivered, unresolved) renders in the
 * digest's "Needs you" section with its ONE action and a "reminded <date>"
 * dedup label instead of re-nudging the user.
 */
export type OpenUserNudge = {
  condition: HealConditionId
  /** The ONE action copy shown to the user. */
  action: string
  /** Last delivered nudge time (the "reminded Sep 9" label). */
  remindedAt: Date
}

export async function listOpenUserOnlyNudges(
  workspaceId: string,
): Promise<OpenUserNudge[]> {
  const out: OpenUserNudge[] = []
  for (const condition of userOnlyNudgeConditionIds()) {
    const remindedAt = await findOpenNudgeAt(workspaceId, condition)
    if (remindedAt) {
      out.push({
        condition,
        action: NUDGE_COPY[condition]?.action ?? condition,
        remindedAt,
      })
    }
  }
  return out
}

export type CustomerNudgeDecision =
  | { action: "skip"; reason: "not-user-only" | "already-open" }
  | { action: "send" }

export function decideCustomerNudge(args: {
  condition: string
  openNudgeAt: Date | null
}): CustomerNudgeDecision {
  if (!isUserOnlyNudgeCondition(args.condition)) {
    return { action: "skip", reason: "not-user-only" }
  }
  if (args.openNudgeAt) return { action: "skip", reason: "already-open" }
  return { action: "send" }
}

async function findOpenNudgeAt(
  workspaceId: string,
  condition: HealConditionId,
): Promise<Date | null> {
  const lastNudge = await prisma.activityLog.findFirst({
    where: {
      workspaceId,
      actionType: "SYSTEM",
      AND: [
        { metadata: { contains: `"eventKind":"${CUSTOMER_NUDGE_EVENT_KIND}"` } },
        { metadata: { contains: `"condition":"${condition}"` } },
        { metadata: { contains: `"delivered":true` } },
      ],
    },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true },
  })
  if (!lastNudge) return null
  const resolved = await prisma.activityLog.findFirst({
    where: {
      workspaceId,
      actionType: "SYSTEM",
      timestamp: { gte: lastNudge.timestamp },
      AND: [
        { metadata: { contains: `"eventKind":"${CUSTOMER_NUDGE_RESOLVE_EVENT_KIND}"` } },
        { metadata: { contains: `"condition":"${condition}"` } },
      ],
    },
    select: { id: true },
  })
  return resolved ? null : lastNudge.timestamp
}

async function ledgerNudge(args: {
  workspaceId: string
  condition: HealConditionId
  eventKind: typeof CUSTOMER_NUDGE_EVENT_KIND | typeof CUSTOMER_NUDGE_RESOLVE_EVENT_KIND
  channel: "telegram" | "discord" | "slack" | "email" | "dashboard" | "skipped"
  delivered: boolean
  reason?: string
  messageId?: number
}): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        workspaceId: args.workspaceId,
        action:
          args.eventKind === CUSTOMER_NUDGE_RESOLVE_EVENT_KIND
            ? `Nudge resolved: ${args.condition}`
            : `Nudge: ${args.condition}`,
        detail: args.reason ?? null,
        actionType: "SYSTEM",
        timestamp: new Date(),
        metadata: JSON.stringify({
          eventKind: args.eventKind,
          condition: args.condition,
          channel: args.channel,
          delivered: args.delivered,
          reason: args.reason ?? null,
          messageId: args.messageId ?? null,
        }),
      },
    })
  } catch (err) {
    log.error("customer-nudge: ledger failed", {
      workspaceId: args.workspaceId,
      condition: args.condition,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function sendCustomerNudge(args: {
  workspaceId: string
  condition: HealConditionId
}): Promise<{ sent: boolean; channel: string; reason?: string }> {
  const decision = decideCustomerNudge({
    condition: args.condition,
    openNudgeAt: await findOpenNudgeAt(args.workspaceId, args.condition),
  })
  if (decision.action === "skip") {
    await ledgerNudge({
      workspaceId: args.workspaceId,
      condition: args.condition,
      eventKind: CUSTOMER_NUDGE_EVENT_KIND,
      channel: "skipped",
      delivered: false,
      reason: decision.reason,
    })
    return { sent: false, channel: "skipped", reason: decision.reason }
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: args.workspaceId },
    select: {
      id: true,
      name: true,
      channelConfigEncrypted: true,
      user: { select: { email: true } },
    },
  })
  if (!workspace) {
    return { sent: false, channel: "skipped", reason: "workspace-not-found" }
  }

  let config: ChannelConfigMap = {}
  try {
    config = parseChannelConfigBlob(workspace.channelConfigEncrypted, decrypt)
  } catch (err) {
    log.error("customer-nudge: channel config parse failed", {
      workspaceId: args.workspaceId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  const text = buildCustomerNudgeText(args.condition)
  const channelResult = await sendAsClawChannel(config, text)
  if (channelResult.sent) {
    await ledgerNudge({
      workspaceId: args.workspaceId,
      condition: args.condition,
      eventKind: CUSTOMER_NUDGE_EVENT_KIND,
      channel: channelResult.channel,
      delivered: true,
      messageId: channelResult.messageId,
    })
    const email = workspace.user?.email
    if (email) {
      await sendEmail({
        kind: "customer_nudge",
        workspaceIds: [args.workspaceId],
        to: email,
        subject: `Claws: ${workspace.name?.trim() || "Your claw"} needs one action`,
        html: nudgeEmailHtml(workspace.name, text, args.workspaceId),
      })
    }
    return { sent: true, channel: channelResult.channel }
  }

  const email = workspace.user?.email
  if (email) {
    const emailOk = await sendEmail({
      kind: "customer_nudge",
      workspaceIds: [args.workspaceId],
      to: email,
      subject: `Claws: ${workspace.name?.trim() || "Your claw"} needs one action`,
      html: nudgeEmailHtml(workspace.name, text, args.workspaceId),
    })
    await ledgerNudge({
      workspaceId: args.workspaceId,
      condition: args.condition,
      eventKind: CUSTOMER_NUDGE_EVENT_KIND,
      channel: "email",
      delivered: emailOk.ok,
      reason: emailOk.ok ? "web-chat-only-email" : "email-send-failed",
    })
    return { sent: emailOk.ok, channel: "email", reason: emailOk.ok ? undefined : "email-send-failed" }
  }

  await ledgerNudge({
    workspaceId: args.workspaceId,
    condition: args.condition,
    eventKind: CUSTOMER_NUDGE_EVENT_KIND,
    channel: "dashboard",
    delivered: true,
    reason: "web-chat-only",
  })
  return { sent: true, channel: "dashboard", reason: "web-chat-only" }
}

export async function resolveCustomerNudge(args: {
  workspaceId: string
  condition: HealConditionId
}): Promise<{ sent: boolean; reason?: string }> {
  const openAt = await findOpenNudgeAt(args.workspaceId, args.condition)
  if (!openAt) return { sent: false, reason: "no-open-nudge" }

  const workspace = await prisma.workspace.findUnique({
    where: { id: args.workspaceId },
    select: {
      id: true,
      name: true,
      channelConfigEncrypted: true,
      user: { select: { email: true } },
    },
  })
  if (!workspace) return { sent: false, reason: "workspace-not-found" }

  let config: ChannelConfigMap = {}
  try {
    config = parseChannelConfigBlob(workspace.channelConfigEncrypted, decrypt)
  } catch {
    config = {}
  }

  const text = buildCustomerNudgeResolveText(args.condition)
  const channelResult = await sendAsClawChannel(config, text)
  if (channelResult.sent) {
    await ledgerNudge({
      workspaceId: args.workspaceId,
      condition: args.condition,
      eventKind: CUSTOMER_NUDGE_RESOLVE_EVENT_KIND,
      channel: channelResult.channel,
      delivered: true,
      messageId: channelResult.messageId,
    })
    return { sent: true }
  }

  const email = workspace.user?.email
  if (email) {
    const emailOk = await sendEmail({
      kind: "customer_nudge",
      workspaceIds: [args.workspaceId],
      to: email,
      subject: `Claws: ${workspace.name?.trim() || "Your claw"} is back to normal`,
      html: nudgeEmailHtml(workspace.name, text, args.workspaceId),
    })
    await ledgerNudge({
      workspaceId: args.workspaceId,
      condition: args.condition,
      eventKind: CUSTOMER_NUDGE_RESOLVE_EVENT_KIND,
      channel: "email",
      delivered: emailOk.ok,
    })
    return { sent: emailOk.ok }
  }

  await ledgerNudge({
    workspaceId: args.workspaceId,
    condition: args.condition,
    eventKind: CUSTOMER_NUDGE_RESOLVE_EVENT_KIND,
    channel: "dashboard",
    delivered: true,
    reason: "web-chat-only",
  })
  return { sent: true }
}

function nudgeEmailHtml(name: string | null, body: string, workspaceId: string): string {
  const title = name?.trim() || "Your claw"
  const escaped = body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  return `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body style="margin:0;padding:0;background-color:#FBFBFB;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;margin:40px auto;background:#FFFFFF;border:1px solid #EFEFEF;border-radius:12px;">
            <tr>
              <td style="padding:40px 32px;text-align:center;">
                <div style="font-size:20px;font-weight:700;color:#0A0A0B;margin-bottom:8px;">Claws</div>
                <div style="font-size:13px;color:#555;margin-bottom:8px;">${title}</div>
                <div style="font-size:15px;color:#0A0A0B;margin-bottom:16px;white-space:pre-line;">${escaped}</div>
                <a href="${dashboardUrl(workspaceId)}" style="display:inline-block;padding:10px 32px;background-color:#0A0A0B;color:#FFFFFF;font-size:13px;font-weight:500;text-decoration:none;border-radius:8px;">
                  Open dashboard
                </a>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `
}

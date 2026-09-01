import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { decrypt } from "@/lib/encryption"
import { dashboardUrl } from "@/lib/alerts/app-url"
import { sendAsClawChannel } from "@/lib/channels/send-as-claw"
import { parseChannelConfigBlob, type ChannelConfigMap } from "@/lib/openclaw/channel-config"

export const DELIVERABLE_NOTICE_EVENT_KIND = "deliverable_channel_notice"

export function buildDeliverableNoticeText(args: {
  workspaceId: string
  title: string
  preview: string
  isDecision: boolean
}): string {
  const open = `${dashboardUrl(args.workspaceId)}?tab=chat`
  const preview = args.preview.trim()
  const lines = [`New deliverable: ${args.title}`]
  if (preview) lines.push(preview)
  lines.push(`Open: ${open}`)
  if (args.isDecision) lines.push("Reply APPROVE or REJECT to decide.")
  return lines.join("\n")
}

export async function notifyDeliverableExtracted(args: {
  workspaceId: string
  title: string
  logicalPath: string
  fileVersionId: string
  preview: string
  isDecision: boolean
}): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: args.workspaceId },
    select: { channelConfigEncrypted: true },
  })
  if (!workspace) return

  let config: ChannelConfigMap = {}
  try {
    config = parseChannelConfigBlob(workspace.channelConfigEncrypted, decrypt)
  } catch (err) {
    log.warn("deliverable notice: channel config unreadable", {
      workspaceId: args.workspaceId,
      error: err instanceof Error ? err.message : String(err),
    })
    return
  }

  const text = buildDeliverableNoticeText({
    workspaceId: args.workspaceId,
    title: args.title,
    preview: args.preview,
    isDecision: args.isDecision,
  })
  const result = await sendAsClawChannel(config, text)
  await prisma.activityLog.create({
    data: {
      workspaceId: args.workspaceId,
      action: result.sent
        ? `Deliverable notice sent via ${result.channel}`
        : "Deliverable notice not sent",
      actionType: "SYSTEM",
      detail: args.logicalPath,
      metadata: JSON.stringify({
        eventKind: DELIVERABLE_NOTICE_EVENT_KIND,
        fileVersionId: args.fileVersionId,
        logicalPath: args.logicalPath,
        channel: result.channel,
        sent: result.sent,
        reason: result.sent ? null : result.reason,
      }),
    },
  })
}

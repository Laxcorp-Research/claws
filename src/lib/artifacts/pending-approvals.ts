import { prisma } from "@/lib/db"
import { decrypt } from "@/lib/encryption"
import { log } from "@/lib/logger"
import { sanitizeActivityText } from "@/lib/security/sanitize"
import { sendCustomerNudge } from "@/lib/alerts/customer-nudge"
import { hasLaunchChannel } from "@/lib/channels/send-as-claw"
import { parseChannelConfigBlob } from "@/lib/openclaw/channel-config"
import {
  deliverableKind,
  parseDeliverableMetadata,
  previewFromContent,
  titleFromDeliverablePath,
  type DeliverableKind,
} from "@/lib/artifacts/deliverable-kind"

/** Email (web-chat-only) after this many hours without Approve/Reject. */
export const PENDING_APPROVAL_NUDGE_AFTER_MS = 4 * 60 * 60 * 1000

export const PENDING_APPROVAL_NUDGE_CONDITION = "pending-approval-unactioned" as const

export type PendingApprovalView = {
  id: string
  fileVersionId: string
  title: string
  preview: string
  logicalPath: string
  deliverableKind: DeliverableKind
  humanRequestId: string
  timestamp: string
}

export function respondedRequestIds(
  responses: Array<{ metadata: string | null }>,
): Set<string> {
  const ids = new Set<string>()
  for (const row of responses) {
    try {
      const meta = JSON.parse(row.metadata || "{}") as { originalRequestId?: unknown }
      if (typeof meta.originalRequestId === "string") ids.add(meta.originalRequestId)
    } catch {
      /* skip malformed */
    }
  }
  return ids
}

export async function hydratePendingApprovals(
  requests: Array<{
    id: string
    timestamp: Date
    metadata: string | null
    action: string
  }>,
): Promise<PendingApprovalView[]> {
  const parsed = requests.map((req) => ({
    req,
    meta: parseDeliverableMetadata(req.metadata),
  }))
  const fvIds = [
    ...new Set(
      parsed
        .map((row) => row.meta.fileVersionId)
        .filter((id): id is string => Boolean(id)),
    ),
  ]
  const versions =
    fvIds.length > 0
      ? await prisma.fileVersion.findMany({
          where: { id: { in: fvIds } },
          select: { id: true, logicalPath: true, content: true },
        })
      : []
  const byId = new Map(versions.map((row) => [row.id, row]))

  const out: PendingApprovalView[] = []
  for (const { req, meta } of parsed) {
    const fileVersionId = meta.fileVersionId
    if (!fileVersionId) continue
    const fv = byId.get(fileVersionId)
    const logicalPath = fv?.logicalPath ?? meta.logicalPath
    if (!logicalPath) continue
    const title = sanitizeActivityText(titleFromDeliverablePath(logicalPath))
    const preview = sanitizeActivityText(
      meta.preview ?? (fv ? previewFromContent(fv.content) : ""),
    )
    out.push({
      id: req.id,
      fileVersionId,
      title,
      preview,
      logicalPath,
      deliverableKind: meta.deliverableKind ?? deliverableKind(logicalPath),
      humanRequestId: req.id,
      timestamp: req.timestamp.toISOString(),
    })
  }
  return out
}

export async function countPendingApprovalsByWorkspace(
  workspaceIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (workspaceIds.length === 0) return counts

  const [requests, responses] = await Promise.all([
    prisma.activityLog.findMany({
      where: { workspaceId: { in: workspaceIds }, actionType: "HUMAN_REQUEST" },
      select: { id: true, workspaceId: true, metadata: true },
    }),
    prisma.activityLog.findMany({
      where: {
        workspaceId: { in: workspaceIds },
        actionType: { in: ["HUMAN_APPROVE", "HUMAN_REJECT"] },
      },
      select: { metadata: true },
    }),
  ])
  const done = respondedRequestIds(responses)
  for (const req of requests) {
    if (done.has(req.id)) continue
    if (!parseDeliverableMetadata(req.metadata).fileVersionId) continue
    counts.set(req.workspaceId, (counts.get(req.workspaceId) ?? 0) + 1)
  }
  return counts
}

export async function nudgeStaleWebChatPendingApprovals(
  now = new Date(),
): Promise<{ scanned: number; nudged: number; skippedChannel: number }> {
  const cutoff = new Date(now.getTime() - PENDING_APPROVAL_NUDGE_AFTER_MS)
  const stale = await prisma.activityLog.findMany({
    where: {
      actionType: "HUMAN_REQUEST",
      timestamp: { lte: cutoff },
      workspace: { status: { in: ["RUNNING", "PAUSED"] } },
    },
    select: {
      id: true,
      workspaceId: true,
      metadata: true,
      workspace: { select: { channelConfigEncrypted: true } },
    },
    orderBy: { timestamp: "asc" },
    take: 40,
  })

  const byWorkspace = new Map<string, typeof stale>()
  for (const row of stale) {
    const list = byWorkspace.get(row.workspaceId) ?? []
    list.push(row)
    byWorkspace.set(row.workspaceId, list)
  }

  let scanned = 0
  let nudged = 0
  let skippedChannel = 0

  for (const [workspaceId, rows] of byWorkspace) {
    scanned += rows.length
    const responses = await prisma.activityLog.findMany({
      where: {
        workspaceId,
        actionType: { in: ["HUMAN_APPROVE", "HUMAN_REJECT"] },
      },
      select: { metadata: true },
    })
    const done = respondedRequestIds(responses)
    const open = rows.filter((row) => {
      if (done.has(row.id)) return false
      return Boolean(parseDeliverableMetadata(row.metadata).fileVersionId)
    })
    if (open.length === 0) continue

    let config = {}
    try {
      config = parseChannelConfigBlob(rows[0]?.workspace.channelConfigEncrypted, decrypt)
    } catch (err) {
      log.warn("pending-approval nudge: channel config unreadable", {
        workspaceId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    if (hasLaunchChannel(config)) {
      skippedChannel += 1
      continue
    }

    const result = await sendCustomerNudge({
      workspaceId,
      condition: PENDING_APPROVAL_NUDGE_CONDITION,
    })
    if (result.sent) nudged += 1
  }

  return { scanned, nudged, skippedChannel }
}

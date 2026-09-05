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
import type { ApprovalDecisionState } from "@/lib/artifacts/approval-version"
import { loadApprovalVersionStates, reconcileSupersededVersions } from "@/lib/artifacts/supersede-versions"

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
  decision: ApprovalDecisionState
  latestLabel: string
  isDecidable: boolean
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
  workspaceId: string,
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
  const paths = [
    ...new Set(
      parsed
        .map((row) => byId.get(row.meta.fileVersionId ?? "")?.logicalPath ?? row.meta.logicalPath)
        .filter((path): path is string => Boolean(path)),
    ),
  ]
  if (paths.length > 0) {
    try {
      await reconcileSupersededVersions({ workspaceId, logicalPaths: paths })
    } catch {
      /* reconcile is best-effort; view still uses computed state */
    }
  }
  const states = paths.length > 0
    ? await loadApprovalVersionStates({ workspaceId, logicalPaths: paths })
    : new Map()

  const out: PendingApprovalView[] = []
  for (const { req, meta } of parsed) {
    const fileVersionId = meta.fileVersionId
    if (!fileVersionId) continue
    const fv = byId.get(fileVersionId)
    const logicalPath = fv?.logicalPath ?? meta.logicalPath
    if (!logicalPath) continue
    const state = states.get(fileVersionId)
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
      decision: state?.decision ?? "NONE",
      latestLabel: state?.latestLabel ?? "",
      isDecidable: state?.isDecidable ?? false,
    })
  }
  return out.filter((row) => row.isDecidable)
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
  const open = requests.filter((req) => {
    if (done.has(req.id)) return false
    return Boolean(parseDeliverableMetadata(req.metadata).fileVersionId)
  })
  const byWorkspace = new Map<string, typeof open>()
  for (const req of open) {
    const list = byWorkspace.get(req.workspaceId) ?? []
    list.push(req)
    byWorkspace.set(req.workspaceId, list)
  }
  for (const [workspaceId, rows] of byWorkspace) {
    const paths = [
      ...new Set(
        rows
          .map((row) => parseDeliverableMetadata(row.metadata).logicalPath)
          .filter((path): path is string => Boolean(path)),
      ),
    ]
    const states = await loadApprovalVersionStates({ workspaceId, logicalPaths: paths })
    let n = 0
    for (const req of rows) {
      const fvId = parseDeliverableMetadata(req.metadata).fileVersionId
      if (fvId && states.get(fvId)?.isDecidable) n += 1
    }
    if (n > 0) counts.set(workspaceId, n)
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
    const paths = [
      ...new Set(
        rows
          .map((row) => parseDeliverableMetadata(row.metadata).logicalPath)
          .filter((path): path is string => Boolean(path)),
      ),
    ]
    const states = await loadApprovalVersionStates({ workspaceId, logicalPaths: paths })
    const open = rows.filter((row) => {
      if (done.has(row.id)) return false
      const fvId = parseDeliverableMetadata(row.metadata).fileVersionId
      return Boolean(fvId && states.get(fvId)?.isDecidable)
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

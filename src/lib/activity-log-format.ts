import { sanitizeActivityDetail, sanitizeActivityText } from "@/lib/security/sanitize"
import {
  DELIVERABLE_EXTRACT_EVENT_KIND,
  parseDeliverableMetadata,
  previewFromContent,
} from "@/lib/artifacts/deliverable-kind"
import { prisma } from "@/lib/db"

export interface ActivityLogFormatInput {
  id: string
  timestamp: Date
  agentName: string | null
  agentSlug: string | null
  action: string
  detail: string | null
  actionType: string
  apiCost: number | null
  channelId?: string | null
  metadata: string | null
}

// Shared ActivityLog wire projection for dashboard SSE and chat history.
// Keep history rows byte-identical to streamed rows so persisted-row dedupe can
// collapse the same DB row regardless of which source delivered it first.
export function formatActivityLog(log: ActivityLogFormatInput) {
  let messageId: string | null = null
  let channelId: string | null = log.channelId ?? null
  let from: string | null = null
  let runId: string | null = null
  let eventKind: string | null = null
  let fileVersionId: string | null = null
  let logicalPath: string | null = null
  let preview: string | null = null
  let deliverableKind: "decision" | "report" | null = null
  let humanRequestId: string | null = null
  let holdStatus: string | null = null
  let toolId: string | null = null
  let sessionKey: string | null = null

  if (log.metadata) {
    try {
      const m = JSON.parse(log.metadata) as Record<string, unknown>
      messageId = typeof m.messageId === "string" ? m.messageId : null
      channelId = channelId ?? (typeof m.channelId === "string" ? m.channelId : null)
      from = typeof m.from === "string" ? m.from : null
      runId = typeof m.runId === "string" ? m.runId : null
      holdStatus = typeof m.holdStatus === "string" ? m.holdStatus : null
      toolId = typeof m.toolId === "string" ? m.toolId : null
      sessionKey = typeof m.sessionKey === "string" ? m.sessionKey : null
      const doc = parseDeliverableMetadata(log.metadata)
      eventKind = doc.eventKind
      fileVersionId = doc.fileVersionId
      logicalPath = doc.logicalPath
      preview = doc.preview
      deliverableKind = doc.deliverableKind
      humanRequestId = doc.humanRequestId
    } catch {
      // malformed metadata -> leave the derived chat fields null
    }
  }

  return {
    id: log.id,
    timestamp: log.timestamp.toISOString(),
    agentName: log.agentName ?? "System",
    agentSlug: log.agentSlug,
    action: sanitizeActivityText(log.action),
    detail: sanitizeActivityDetail(log.detail),
    actionType: log.actionType,
    apiCost: log.apiCost,
    messageId,
    channelId,
    from,
    runId,
    eventKind,
    fileVersionId,
    logicalPath,
    preview,
    deliverableKind,
    humanRequestId,
    holdStatus,
    toolId,
    sessionKey,
  }
}

type PreviewRow = {
  eventKind?: string | null
  fileVersionId?: string | null
  preview?: string | null
}

/** Stored previews were clipped from the title and schema. Cards read the file body instead. */
export async function withFreshDeliverablePreviews<T extends PreviewRow>(rows: T[]): Promise<T[]> {
  const ids = [...new Set(
    rows.flatMap((row) =>
      row.eventKind === DELIVERABLE_EXTRACT_EVENT_KIND && row.fileVersionId ? [row.fileVersionId] : [],
    ),
  )]
  if (ids.length === 0) return rows
  const files = await prisma.fileVersion.findMany({
    where: { id: { in: ids } },
    select: { id: true, content: true },
  })
  if (!Array.isArray(files)) return rows
  const byId = new Map(files.map((file) => [file.id, file.content]))
  return rows.map((row) => {
    if (row.eventKind !== DELIVERABLE_EXTRACT_EVENT_KIND || !row.fileVersionId) return row
    const content = byId.get(row.fileVersionId)
    if (typeof content !== "string" || content.length === 0) return row
    return { ...row, preview: previewFromContent(content) }
  })
}

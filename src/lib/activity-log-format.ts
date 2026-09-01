import { sanitizeActivityDetail, sanitizeActivityText } from "@/lib/security/sanitize"
import { parseDeliverableMetadata } from "@/lib/artifacts/deliverable-kind"

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

  if (log.metadata) {
    try {
      const m = JSON.parse(log.metadata) as Record<string, unknown>
      messageId = typeof m.messageId === "string" ? m.messageId : null
      channelId = channelId ?? (typeof m.channelId === "string" ? m.channelId : null)
      from = typeof m.from === "string" ? m.from : null
      runId = typeof m.runId === "string" ? m.runId : null
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
  }
}

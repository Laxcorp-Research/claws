import type { ActivityType, Prisma } from "@/generated/prisma/client"
import { DELIVERABLE_EXTRACT_EVENT_KIND } from "@/lib/artifacts/deliverable-kind"
import { CHAT_SEND_HELD_EVENT_KIND } from "@/lib/openclaw/chat-send-events"

const MESSAGE_ACTION_TYPES: ActivityType[] = ["MESSAGE_RECEIVED", "MESSAGE_SENT"]
const TASK_ACTION_TYPES: ActivityType[] = ["TASK_START", "TASK_COMPLETE"]

// Chat owns a sibling EventSource on the existing activity SSE route.
// The query param is how the client subscription is locked: dashboard uses
// `/stream` (and may wholesale-replace its buffer on init); chat uses this
// scope and MERGES by id until Done. MUTATION: drop the scope → e2e fails.
export const CHAT_RUN_STATE_STREAM_SCOPE = "chat-run-state"

export const WEBCHAT_METADATA_MARKER = '"channelId":"webchat"'
export const DELIVERABLE_METADATA_MARKER = `"eventKind":"${DELIVERABLE_EXTRACT_EVENT_KIND}"`
export const HELD_SEND_METADATA_MARKER = `"eventKind":"${CHAT_SEND_HELD_EVENT_KIND}"`
export const RUN_ID_METADATA_MARKER = '"runId"'

export const CHAT_RUN_STATE_BUFFER_CAP = 200

export function chatRunStateStreamUrl(workspaceId: string): string {
  return `/api/activity/${workspaceId}/stream?scope=${CHAT_RUN_STATE_STREAM_SCOPE}`
}

export interface ChatRunStateEntry {
  id: string
  actionType: string
  timestamp: string
  agentName: string
  agentSlug?: string | null
  action: string
  detail?: string | null
  apiCost?: number | null
  messageId?: string | null
  channelId?: string | null
  from?: string | null
  runId?: string | null
  eventKind?: string | null
  fileVersionId?: string | null
  logicalPath?: string | null
  preview?: string | null
  deliverableKind?: "decision" | "report" | null
  humanRequestId?: string | null
  holdStatus?: string | null
}

function hasTurnKey(entry: Pick<ChatRunStateEntry, "runId" | "messageId">): boolean {
  return (
    (typeof entry.runId === "string" && entry.runId.length > 0) ||
    (typeof entry.messageId === "string" && entry.messageId.length > 0)
  )
}

/**
 * Keep webchat MESSAGE_* , TASK_* that carry a runId, and chat ledger SYSTEM
 * rows. A MESSAGE_SENT missing channelId still counts when it carries runId
 * (the page filter drops those; that miss must not hide Done).
 */
export function isChatRunStateEntry(entry: ChatRunStateEntry): boolean {
  if (entry.actionType === "TASK_START" || entry.actionType === "TASK_COMPLETE") {
    return typeof entry.runId === "string" && entry.runId.length > 0
  }
  if (entry.actionType === "MESSAGE_RECEIVED" || entry.actionType === "MESSAGE_SENT") {
    return entry.channelId === "webchat" || hasTurnKey(entry)
  }
  if (entry.actionType === "SYSTEM") {
    return (
      entry.eventKind === DELIVERABLE_EXTRACT_EVENT_KIND ||
      entry.eventKind === CHAT_SEND_HELD_EVENT_KIND
    )
  }
  return false
}

export function mergeChatRunStateRows<T extends { id: string; timestamp: string }>(
  current: readonly T[],
  incoming: readonly T[],
  cap: number = CHAT_RUN_STATE_BUFFER_CAP,
): T[] {
  const byId = new Map<string, T>()
  for (const row of current) byId.set(row.id, row)
  for (const row of incoming) byId.set(row.id, row)
  return Array.from(byId.values())
    .sort((a, b) => {
      const byTime = Date.parse(a.timestamp) - Date.parse(b.timestamp)
      return byTime !== 0 ? byTime : a.id.localeCompare(b.id)
    })
    .slice(-cap)
}

export function collectWorkingRunIds(
  rows: ReadonlyArray<Pick<ChatRunStateEntry, "actionType" | "runId">>,
): Set<string> {
  const ids = new Set<string>()
  for (const row of rows) {
    if (
      (row.actionType === "TASK_START" || row.actionType === "TASK_COMPLETE") &&
      typeof row.runId === "string" &&
      row.runId.length > 0
    ) {
      ids.add(row.runId)
    }
  }
  return ids
}

export function parseRunStateRunIds(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.length <= 128)
    .slice(0, 20)
}

export function parseRunStateSince(raw: string | null): Date | null {
  if (!raw) return null
  const parsed = Date.parse(raw)
  if (Number.isNaN(parsed)) return null
  return new Date(parsed)
}

/** Prisma `where` for chat-scoped SSE init - last N chat-relevant rows, not mixed noise. */
export function chatRunStateInitWhere(workspaceId: string): Prisma.ActivityLogWhereInput {
  return {
    workspaceId,
    OR: [
      {
        actionType: { in: MESSAGE_ACTION_TYPES },
        metadata: { contains: WEBCHAT_METADATA_MARKER },
      },
      {
        actionType: { in: MESSAGE_ACTION_TYPES },
        metadata: { contains: RUN_ID_METADATA_MARKER },
      },
      {
        actionType: { in: TASK_ACTION_TYPES },
        metadata: { contains: RUN_ID_METADATA_MARKER },
      },
      {
        actionType: "SYSTEM",
        metadata: { contains: DELIVERABLE_METADATA_MARKER },
      },
      {
        actionType: "SYSTEM",
        metadata: { contains: HELD_SEND_METADATA_MARKER },
      },
    ],
  }
}

export function chatRunStateQueryWhere(
  workspaceId: string,
  opts: { runIds?: readonly string[]; since?: Date | null } = {},
): Prisma.ActivityLogWhereInput {
  const initOr = chatRunStateInitWhere(workspaceId).OR ?? []
  const runIdClauses: Prisma.ActivityLogWhereInput[] = (opts.runIds ?? []).flatMap((id) => [
    { metadata: { contains: `"runId":"${id}"` } },
    { metadata: { contains: `"messageId":"${id}"` } },
  ])
  return {
    workspaceId,
    AND: [
      { OR: [...initOr, ...runIdClauses] },
      ...(opts.since ? [{ timestamp: { gt: opts.since } }] : []),
    ],
  }
}

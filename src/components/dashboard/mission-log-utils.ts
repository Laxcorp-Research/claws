import type { ChannelId } from "@/lib/openclaw/channel-config"

export type MissionTypeFilter = "all" | "tasks" | "messages" | "errors"
export type MissionTimeFilter = "today" | "7d" | "all"

export interface MissionLogEntry {
  id: string
  timestamp: string
  agentName: string
  agentSlug?: string | null
  action: string
  detail?: string | null
  actionType: string
  apiCost?: number | null
  messageId?: string | null
  channelId?: string | null
  from?: string | null
  runId?: string | null
}

export interface MissionAgent {
  name: string
  role: "ORCHESTRATOR" | "WORKER" | "CRITIC"
  color: string
  agentSlug: string
}

export interface MissionFilters {
  agentSlug: string
  type: MissionTypeFilter
  channelId: string
  time: MissionTimeFilter
  q: string
  showRoutine: boolean
}

export interface MissionRunCard {
  kind: "run"
  id: string
  runId: string
  events: MissionLogEntry[]
  status: "success" | "failed" | "open"
  agentName: string
  agentSlug: string | null
  agentColor: string
  taskName: string
  startedAt: string
  endedAt: string | null
  durationMs: number | null
  channelId: string | null
  routine: boolean
  pageBoundaryCut: boolean
}

export interface MissionSingleRow {
  kind: "single"
  id: string
  event: MissionLogEntry
  routine: boolean
}

export type MissionItem = MissionRunCard | MissionSingleRow

export const TASK_ACTION_TYPES = ["TASK_START", "TASK_COMPLETE", "TASK_FAILED", "SKILL_INVOKED"] as const
export const MESSAGE_ACTION_TYPES = ["MESSAGE_SENT", "MESSAGE_RECEIVED"] as const
export const ERROR_ACTION_TYPES = ["TASK_FAILED", "ERROR"] as const

export function actionTypesForMissionType(type: MissionTypeFilter): string[] {
  if (type === "tasks") return [...TASK_ACTION_TYPES]
  if (type === "messages") return [...MESSAGE_ACTION_TYPES]
  if (type === "errors") return [...ERROR_ACTION_TYPES]
  return []
}

export function sinceForMissionTime(time: MissionTimeFilter, now = new Date()): string | null {
  if (time === "all") return null
  const start = new Date(now)
  if (time === "today") {
    start.setHours(0, 0, 0, 0)
  } else {
    start.setDate(start.getDate() - 7)
  }
  return start.toISOString()
}

export function missionQueryParams(filters: MissionFilters, limit = 50, cursor?: string | null): URLSearchParams {
  const params = new URLSearchParams()
  params.set("limit", String(limit))
  if (cursor) params.set("cursor", cursor)
  if (filters.agentSlug) params.set("agentSlug", filters.agentSlug)
  if (filters.channelId) params.set("channelId", filters.channelId)
  const actionTypes = actionTypesForMissionType(filters.type)
  for (const actionType of actionTypes) params.append("actionType", actionType)
  const since = sinceForMissionTime(filters.time)
  if (since) params.set("since", since)
  if (filters.q.trim()) params.set("q", filters.q.trim())
  return params
}

export function isRoutineEvent(event: MissionLogEntry): boolean {
  return event.actionType === "TASK_START" && event.action.toLowerCase().includes("heartbeat")
}

function isRoutineRun(events: MissionLogEntry[]): boolean {
  return events.some(isRoutineEvent)
}

export function matchesMissionFilters(event: MissionLogEntry, filters: MissionFilters): boolean {
  if (filters.agentSlug && event.agentSlug !== filters.agentSlug) return false
  if (filters.channelId && event.channelId !== filters.channelId) return false
  const since = sinceForMissionTime(filters.time)
  if (since && new Date(event.timestamp).getTime() < new Date(since).getTime()) return false
  const actionTypes = actionTypesForMissionType(filters.type)
  if (actionTypes.length > 0 && !actionTypes.includes(event.actionType)) return false
  if (filters.q.trim()) {
    const needle = filters.q.trim().toLowerCase()
    if (!event.action.toLowerCase().includes(needle)) return false
  }
  if (!filters.showRoutine && isRoutineEvent(event)) return false
  return true
}

function byTimeAsc(a: MissionLogEntry, b: MissionLogEntry): number {
  const delta = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  return delta !== 0 ? delta : a.id.localeCompare(b.id)
}

function byItemDesc(a: MissionItem, b: MissionItem): number {
  const at = a.kind === "run" ? a.startedAt : a.event.timestamp
  const bt = b.kind === "run" ? b.startedAt : b.event.timestamp
  const delta = new Date(bt).getTime() - new Date(at).getTime()
  return delta !== 0 ? delta : b.id.localeCompare(a.id)
}

export function groupMissionLogEntries(
  entries: MissionLogEntry[],
  agentBySlug: Map<string, MissionAgent>,
  showRoutine = true,
): MissionItem[] {
  const byRunId = new Map<string, MissionLogEntry[]>()
  const singles: MissionSingleRow[] = []

  for (const entry of entries) {
    if (entry.runId) {
      const current = byRunId.get(entry.runId) ?? []
      current.push(entry)
      byRunId.set(entry.runId, current)
    } else {
      const routine = isRoutineEvent(entry)
      if (showRoutine || !routine) singles.push({ kind: "single", id: entry.id, event: entry, routine })
    }
  }

  const items: MissionItem[] = [...singles]
  for (const [runId, rawEvents] of byRunId) {
    const events = [...rawEvents].sort(byTimeAsc)
    const routine = isRoutineRun(events)
    if (!showRoutine && routine) continue

    const start = events.find((event) => event.actionType === "TASK_START") ?? events[0]
    const failed = events.find((event) => event.actionType === "TASK_FAILED" || event.actionType === "ERROR")
    const complete = events.find((event) => event.actionType === "TASK_COMPLETE")
    const terminal = failed ?? complete ?? null
    const agentSlug = start.agentSlug ?? null
    const agent = agentSlug ? agentBySlug.get(agentSlug) : undefined
    const startedAt = start.timestamp
    const endedAt = terminal?.timestamp ?? null

    items.push({
      kind: "run",
      id: `run-${runId}`,
      runId,
      events,
      status: failed ? "failed" : complete ? "success" : "open",
      agentName: start.agentName,
      agentSlug,
      agentColor: agent?.color ?? "#8BFCAE",
      taskName: start.action,
      startedAt,
      endedAt,
      durationMs: endedAt ? Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime()) : null,
      channelId: events.find((event) => event.channelId)?.channelId ?? null,
      routine,
      // A paged result can contain the terminal/tool rows without the start row.
      // v1 renders the partial run and makes the page boundary explicit.
      pageBoundaryCut: !events.some((event) => event.actionType === "TASK_START"),
    })
  }

  return items.sort(byItemDesc)
}

export function mergeMissionEvent(
  current: MissionLogEntry[],
  incoming: MissionLogEntry,
  filters: MissionFilters,
  maxEntries = 200,
): MissionLogEntry[] {
  if (!matchesMissionFilters(incoming, filters)) return current
  const byId = new Map(current.map((entry) => [entry.id, entry]))
  byId.set(incoming.id, incoming)
  return [...byId.values()]
    .sort((a, b) => {
      const delta = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      return delta !== 0 ? delta : b.id.localeCompare(a.id)
    })
    .slice(0, maxEntries)
}

export function isKnownProviderChannel(channelId: string | null | undefined): channelId is ChannelId {
  return channelId === "telegram" || channelId === "discord" || channelId === "slack" || channelId === "whatsapp" || channelId === "msteams"
}

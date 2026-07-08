import {
  isRoutineEvent,
  type MissionLogEntry,
} from "@/components/dashboard/mission-log-utils"

export interface LiveOpsAgent {
  id: string
  name: string
  role: "ORCHESTRATOR" | "WORKER" | "CRITIC"
  color: string
  model: string
  agentSlug: string
  isPaused?: boolean
  pauseApplied?: boolean
  lastActive?: string
}

export type AgentLiveState =
  | { kind: "working"; taskName: string; startedAt: string; elapsedMs: number; routine: boolean; runId: string }
  | { kind: "idle"; lastActive?: string; reason?: "stale-open" }
  | { kind: "paused" }
  | { kind: "pause-pending" }
  | { kind: "error"; message: string; timestamp: string }

export interface AgentLiveView {
  agent: LiveOpsAgent
  state: AgentLiveState
}

export interface RunChainView {
  runId: string
  routine: boolean
  agentSlugs: string[]
  activeAgentSlug: string | null
}

const OPEN_RUN_CAP_MS = 30 * 60 * 1000

function eventTime(event: MissionLogEntry): number {
  return new Date(event.timestamp).getTime()
}

function latestAgentError(agent: LiveOpsAgent, events: MissionLogEntry[], now: Date): MissionLogEntry | null {
  const cutoff = now.getTime() - OPEN_RUN_CAP_MS
  return events
    .filter((event) => event.agentSlug === agent.agentSlug && event.actionType === "ERROR" && eventTime(event) >= cutoff)
    .sort((a, b) => eventTime(b) - eventTime(a))[0] ?? null
}

function openRuns(events: MissionLogEntry[], now: Date): Array<{ runId: string; events: MissionLogEntry[]; start: MissionLogEntry; routine: boolean }> {
  const grouped = new Map<string, MissionLogEntry[]>()
  for (const event of events) {
    if (!event.runId) continue
    const group = grouped.get(event.runId) ?? []
    group.push(event)
    grouped.set(event.runId, group)
  }

  const out: Array<{ runId: string; events: MissionLogEntry[]; start: MissionLogEntry; routine: boolean }> = []
  for (const [runId, group] of grouped) {
    const start = group.find((event) => event.actionType === "TASK_START")
    if (!start) continue
    const hasTerminal = group.some((event) => event.actionType === "TASK_COMPLETE" || event.actionType === "TASK_FAILED")
    if (hasTerminal) continue
    if (now.getTime() - eventTime(start) > OPEN_RUN_CAP_MS) continue
    out.push({ runId, events: group, start, routine: isRoutineEvent(start) })
  }

  return out.sort((a, b) => eventTime(b.start) - eventTime(a.start))
}

export function deriveAgentLiveState(agent: LiveOpsAgent, events: MissionLogEntry[], now = new Date()): AgentLiveState {
  if (agent.role === "WORKER" && agent.isPaused && !agent.pauseApplied) return { kind: "pause-pending" }
  if (agent.role === "WORKER" && agent.isPaused && agent.pauseApplied) return { kind: "paused" }

  const error = latestAgentError(agent, events, now)
  if (error) return { kind: "error", message: error.action, timestamp: error.timestamp }

  const ownOpenRun = openRuns(events, now).find((run) =>
    run.events.some((event) => event.agentSlug === agent.agentSlug),
  )
  if (ownOpenRun) {
    return {
      kind: "working",
      taskName: ownOpenRun.start.action,
      startedAt: ownOpenRun.start.timestamp,
      elapsedMs: Math.max(0, now.getTime() - eventTime(ownOpenRun.start)),
      routine: ownOpenRun.routine,
      runId: ownOpenRun.runId,
    }
  }

  const staleStart = events
    .filter((event) => event.agentSlug === agent.agentSlug && event.actionType === "TASK_START")
    .sort((a, b) => eventTime(b) - eventTime(a))[0]
  if (staleStart && now.getTime() - eventTime(staleStart) > OPEN_RUN_CAP_MS) {
    return { kind: "idle", lastActive: agent.lastActive, reason: "stale-open" }
  }

  return { kind: "idle", lastActive: agent.lastActive }
}

export function deriveAgentLiveViews(agents: LiveOpsAgent[], events: MissionLogEntry[], now = new Date()): AgentLiveView[] {
  return agents.map((agent) => ({ agent, state: deriveAgentLiveState(agent, events, now) }))
}

export function deriveRunChain(events: MissionLogEntry[], now = new Date()): RunChainView | null {
  const run = openRuns(events, now).find((candidate) => !candidate.routine)
  if (!run) return null
  const agentSlugs: string[] = []
  for (const event of [...run.events].sort((a, b) => eventTime(a) - eventTime(b))) {
    if (event.agentSlug && !agentSlugs.includes(event.agentSlug)) agentSlugs.push(event.agentSlug)
  }
  return {
    runId: run.runId,
    routine: run.routine,
    agentSlugs,
    activeAgentSlug: agentSlugs.at(-1) ?? null,
  }
}

export function formatElapsed(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

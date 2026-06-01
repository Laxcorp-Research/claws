"use client"

import { useState, useMemo } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ActivityLogEntry } from "./activity-log-entry"
import { clawNarrative, type NarrativeTone } from "@/lib/utils/narrative"
import { formatCurrency } from "@/lib/utils/format"

export interface RosterAgent {
  id: string
  name: string
  role: "ORCHESTRATOR" | "WORKER" | "CRITIC"
  status: "running" | "healthy" | "paused" | "error" | "offline" | "degraded" | "starting"
  lastActive?: string
  color: string
}

export interface DrillLog {
  id: string
  timestamp: string
  agentName: string
  agentColor: string
  message: string
  detail?: string | null
}

export interface AgentCostRow {
  agentName: string
  model: string
  calls: number
  cost: number
}

interface ClawNarrativeRowProps {
  clawName: string
  status: string
  tasksToday: number
  tasksYesterday: number
  agentsError: number
  pendingReview: number
  agents: RosterAgent[]
  logs: DrillLog[]
  agentCosts?: AgentCostRow[]
  showCosts?: boolean
  clawPaused?: boolean
  onPauseAgent: (id: string) => void
  onResumeAgent: (id: string) => void
  onRestartAgent: (id: string) => void
  actionLoadingId?: string | null
}

const DRILL_LOG_LIMIT = 20

const toneColor: Record<NarrativeTone, string> = {
  calm: "text-[var(--tx2)]",
  attention: "text-[var(--warn)]",
  muted: "text-[var(--tx3)]",
}

const rosterDot: Record<RosterAgent["status"], string> = {
  running: "bg-[var(--ok)]",
  healthy: "bg-[var(--ok)]",
  paused: "bg-[var(--warn)]",
  degraded: "bg-[var(--warn)]",
  error: "bg-[var(--err)]",
  offline: "bg-[var(--tx3)]",
  starting: "bg-[var(--tx3)]",
}

const roleLabel: Record<RosterAgent["role"], string> = {
  ORCHESTRATOR: "Orchestrator",
  WORKER: "Worker",
  CRITIC: "Critic",
}

function agentAction(status: RosterAgent["status"]): { label: string; kind: "pause" | "resume" | "restart" } | null {
  if (status === "running" || status === "healthy" || status === "degraded") return { label: "Pause", kind: "pause" }
  if (status === "paused") return { label: "Resume", kind: "resume" }
  if (status === "error") return { label: "Restart", kind: "restart" }
  return null
}

export function ClawNarrativeRow({
  clawName,
  status,
  tasksToday,
  tasksYesterday,
  agentsError,
  pendingReview,
  agents,
  logs,
  agentCosts = [],
  showCosts = false,
  clawPaused = false,
  onPauseAgent,
  onResumeAgent,
  onRestartAgent,
  actionLoadingId,
}: ClawNarrativeRowProps) {
  const [expanded, setExpanded] = useState(false)
  const narrative = clawNarrative({ status, tasksToday, tasksYesterday, agentsError, pendingReview })

  // Most-recent log message per agent → the roster's one-line "current
  // activity". logs arrive oldest→newest, so the last write wins.
  const currentActivityByAgent = useMemo(() => {
    const map = new Map<string, string>()
    for (const l of logs) map.set(l.agentName, l.message)
    return map
  }, [logs])

  const recentLogs = useMemo(() => logs.slice(-DRILL_LOG_LIMIT).reverse(), [logs])

  // Only show the cost section when there's something to show — keeps the
  // drill-down calm for BYOK users (and credit users with no recorded spend
  // yet, which is everyone today since ActivityLog.apiCost is still null).
  const costRows = showCosts ? agentCosts : []
  const hasCostData = costRows.some((c) => c.cost > 0 || c.calls > 0)

  return (
    <div className="border border-[var(--bd)] rounded-lg">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label="Toggle Claw details"
        className="w-full text-left p-3.5 cursor-pointer hover:bg-[var(--bg2)] transition-colors rounded-lg"
      >
        <div className="flex items-center gap-2">
          <span className="inline-block w-[10px] text-[var(--tx3)] select-none" aria-hidden="true">
            {expanded ? "▾" : "▸"}
          </span>
          <span className="text-[14px] font-medium text-[var(--tx)]">{clawName}</span>
        </div>
        <p className={cn("text-[13px] mt-0.5 pl-[18px]", toneColor[narrative.tone])}>{narrative.text}</p>
      </button>

      {expanded && (
        <div className="px-3.5 pb-3.5 pt-1 border-t border-[var(--bd)] flex flex-col gap-4">
          {/* Agent roster */}
          <div>
            <h3 className="text-[11px] font-semibold text-[var(--tx2)] uppercase tracking-wide mt-3 mb-1.5">Agents</h3>
            <div className="flex flex-col gap-1.5">
              {agents.map((agent) => {
                const act = agentAction(agent.status)
                const controllable = agent.role === "WORKER" && !clawPaused
                const isLoading = actionLoadingId === agent.id
                const activity = currentActivityByAgent.get(agent.name)
                return (
                  <div key={agent.id} className="flex items-center justify-between gap-3 py-1">
                    <div className="flex items-start gap-2 min-w-0">
                      <span className={cn("w-2 h-2 rounded-full flex-shrink-0 mt-1", rosterDot[agent.status])} aria-hidden="true" />
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold text-[var(--tx)]" style={{ color: agent.color }}>{agent.name}</div>
                        <div className="text-[10px] text-[var(--tx2)] truncate">
                          {roleLabel[agent.role]}
                          {activity ? ` · ${activity}` : agent.lastActive ? ` · Last active ${agent.lastActive}` : ""}
                        </div>
                      </div>
                    </div>
                    {act && (
                      <Button
                        variant={act.kind === "resume" ? "primary" : "outline"}
                        size="xs"
                        disabled={!controllable || isLoading}
                        loading={isLoading}
                        onClick={() =>
                          act.kind === "pause"
                            ? onPauseAgent(agent.id)
                            : act.kind === "resume"
                              ? onResumeAgent(agent.id)
                              : onRestartAgent(agent.id)
                        }
                      >
                        {act.label}
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
            <p className="text-[10px] text-[var(--tx3)] mt-2">
              Only Workers can be paused individually. Use the Claw-level controls above for the Orchestrator and Critic.
            </p>
          </div>

          {/* Recent activity */}
          <div>
            <h3 className="text-[11px] font-semibold text-[var(--tx2)] uppercase tracking-wide mb-1.5">Recent activity</h3>
            {recentLogs.length === 0 ? (
              <p className="text-[11px] text-[var(--tx3)] py-2">No activity yet.</p>
            ) : (
              <div className="max-h-[320px] overflow-y-auto" role="log" aria-label="Recent agent activity">
                {recentLogs.map((log) => (
                  <ActivityLogEntry
                    key={log.id}
                    timestamp={log.timestamp}
                    agentName={log.agentName}
                    agentColor={log.agentColor}
                    message={log.message}
                    detail={log.detail}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Cost per agent — credit users with recorded spend only */}
          {hasCostData && (
            <div>
              <h3 className="text-[11px] font-semibold text-[var(--tx2)] uppercase tracking-wide mb-1.5">Cost per agent</h3>
              <div className="flex flex-col gap-1">
                {costRows.map((c) => (
                  <div key={c.agentName} className="flex items-center justify-between gap-3 text-[11px] py-0.5">
                    <div className="min-w-0">
                      <span className="font-medium text-[var(--tx)]">{c.agentName}</span>
                      <span className="text-[var(--tx2)]"> · {c.model}</span>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0 text-[var(--tx2)]">
                      <span>{c.calls.toLocaleString()} calls</span>
                      <span className="font-semibold text-[var(--tx)]">{formatCurrency(c.cost)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

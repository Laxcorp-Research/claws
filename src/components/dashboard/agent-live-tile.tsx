"use client"

import { Button } from "@/components/ui/button"
import { getModelShortDisplayName } from "@/lib/utils/format"
import { cn } from "@/lib/utils"
import { formatElapsed, type AgentLiveView } from "@/components/dashboard/live-ops-utils"
import { TruncatedText } from "@/components/ui/truncate-with-tooltip"

interface AgentLiveTileProps {
  view: AgentLiveView
  actionLoadingId?: string | null
  onPauseAgent: (id: string) => void
  onResumeAgent: (id: string) => void
}

function stateCopy(view: AgentLiveView): { label: string; detail: string; className: string; routine?: boolean } {
  const { state, agent } = view
  if (state.kind === "working") {
    return {
      label: "WORKING",
      detail: `${state.routine ? "Routine: " : ""}${state.taskName} · ${formatElapsed(state.elapsedMs)}`,
      className: "text-[var(--ac-text)]",
      routine: state.routine,
    }
  }
  if (state.kind === "paused") return { label: "PAUSED", detail: "Paused in deployed config", className: "text-[var(--warn)]" }
  if (state.kind === "pause-pending") return { label: "PAUSE-PENDING", detail: "Pause pending — redeploy to apply", className: "text-[var(--warn)]" }
  if (state.kind === "error") return { label: "ERROR", detail: state.message, className: "text-[var(--err)]" }
  return {
    label: "IDLE",
    detail: state.reason === "stale-open"
      ? "Last run exceeded 30m cap; showing idle"
      : agent.lastActive
        ? `Last active ${agent.lastActive}`
        : "No recent work",
    className: "text-[var(--tx2)]",
  }
}

export function AgentLiveTile({ view, actionLoadingId, onPauseAgent, onResumeAgent }: AgentLiveTileProps) {
  const { agent } = view
  const copy = stateCopy(view)
  const canControl = agent.role === "WORKER"
  const loading = actionLoadingId === agent.id
  const isPausedLike = view.state.kind === "paused" || view.state.kind === "pause-pending"

  return (
    <article
      className={cn(
        "min-h-[96px] rounded-[12px] border border-[var(--bd)] bg-[var(--bg)] px-[12px] py-[10px]",
        agent.role === "ORCHESTRATOR" && "md:col-span-2",
        copy.routine && "bg-[var(--bg2)]",
      )}
      aria-label={`${agent.name} live state`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-[6px]">
            <span className="h-[8px] w-[8px] rounded-full" style={{ backgroundColor: agent.color }} aria-hidden="true" />
            <h3 className="min-w-0 flex-1 text-[13px] font-semibold text-[var(--tx)]"><TruncatedText>{agent.name}</TruncatedText></h3>
          </div>
          <p className="mt-[1px] text-[10px] text-[var(--tx3)]">{agent.role}</p>
        </div>
        <span className="rounded-[6px] bg-[var(--bg2)] px-[6px] py-[2px] text-[10px] text-[var(--tx2)]">
          {getModelShortDisplayName(agent.model)}
        </span>
      </div>

      <p className={cn("mt-[8px] text-[12px] font-semibold", copy.className)}>{copy.label}</p>
      <p className={cn("mt-[3px] line-clamp-2 text-[11px] text-[var(--tx3)]", copy.routine && "text-[var(--tx3)]")}>
        {copy.detail}
      </p>

      {canControl && (
        <div className="mt-[9px]">
          {isPausedLike ? (
            <Button variant="primary" size="xs" loading={loading} onClick={() => onResumeAgent(agent.id)}>
              Resume
            </Button>
          ) : (
            <Button variant="outline" size="xs" loading={loading} onClick={() => onPauseAgent(agent.id)}>
              Pause
            </Button>
          )}
        </div>
      )}
    </article>
  )
}

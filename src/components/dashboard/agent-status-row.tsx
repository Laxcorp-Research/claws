"use client"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface AgentStatusRowProps {
  name: string
  role: "ORCHESTRATOR" | "WORKER" | "CRITIC"
  status: "healthy" | "paused" | "error" | "offline"
  lastActive?: string
  errorMessage?: string
  queuedTasks?: number
  passRate?: number
  canPause: boolean
  onPause?: () => void
  onResume?: () => void
  onRestart?: () => void
}

const statusDotColor = {
  healthy: "bg-[var(--ok)]",
  paused: "bg-[var(--warn)]",
  error: "bg-[var(--err)]",
  offline: "bg-[var(--tx3)]",
}

const rowBg = {
  healthy: "bg-[var(--bg2)]",
  paused: "bg-[var(--warnbg)]",
  error: "bg-[var(--errbg)]",
  offline: "bg-[var(--bg2)]",
}

export function AgentStatusRow({ name, role, status, lastActive, errorMessage, queuedTasks, passRate, canPause, onPause, onResume, onRestart }: AgentStatusRowProps) {
  return (
    <div className={cn("flex items-center justify-between py-2 px-2.5 rounded-md", rowBg[status])}>
      <div className="flex items-center gap-2">
        <div className={cn("w-2 h-2 rounded-full flex-shrink-0", statusDotColor[status])} />
        <div>
          <div className="flex items-center gap-1.5">
            <span className={cn("text-xs font-semibold", role === "CRITIC" && "text-[#5b21b6]")}>{name}</span>
            <span className="text-[9px] px-1.5 py-px rounded bg-[var(--bg2)] text-[var(--tx2)]">
              {role === "ORCHESTRATOR" ? "Orch" : role === "CRITIC" ? "Critic" : "Worker"}
            </span>
          </div>
          <div className="text-[10px] text-[var(--tx2)]">
            {status === "error" && errorMessage ? (
              <span className="text-[var(--err)]">{errorMessage}</span>
            ) : status === "paused" && queuedTasks ? (
              <span className="text-[#92400e]">Paused · {queuedTasks} tasks queued</span>
            ) : role === "CRITIC" && passRate !== undefined ? (
              <span>{passRate.toFixed(1)}/10 avg · {Math.round(passRate * 10)}% pass rate</span>
            ) : lastActive ? (
              <span>Last active: {lastActive}</span>
            ) : (
              <span>Idle</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={cn("text-[10px] font-medium", status === "healthy" ? "text-[var(--ok)]" : status === "paused" ? "text-[var(--warn)]" : status === "error" ? "text-[var(--err)]" : "text-[var(--tx3)]")}>
          {status === "healthy" ? "Running" : status === "paused" ? "Paused" : status === "error" ? "Error" : "Offline"}
        </span>
        {canPause && status === "healthy" && onPause && (
          <Button variant="outline" size="xs" onClick={onPause}>Pause</Button>
        )}
        {canPause && status === "paused" && onResume && (
          <Button variant="primary" size="xs" onClick={onResume}>Resume</Button>
        )}
        {status === "error" && onRestart && (
          <Button variant="outline" size="xs" onClick={onRestart}>Restart</Button>
        )}
      </div>
    </div>
  )
}

"use client"

import { memo } from "react"
import { Handle, Position } from "@xyflow/react"
import type { NodeProps } from "@xyflow/react"
import { cn } from "@/lib/utils"
import { Clock } from "lucide-react"
import type { AgentNodeData } from "@/stores/builder-store"
import { TruncateWithTooltip } from "@/components/ui/truncate-with-tooltip"
import { getModelDisplayName } from "@/lib/utils/format"

function AgentNodeComponent({ data, selected }: NodeProps & { data: AgentNodeData }) {
  const isOrchestrator = data.role === "ORCHESTRATOR"
  const isCritic = data.role === "CRITIC"
  const isWorker = data.role === "WORKER"

  const statusLabel = data.healthStatus === "healthy" ? "healthy" : data.healthStatus === "error" ? "error" : "idle"

  return (
    <div
      aria-label={`${data.name}, ${data.role.toLowerCase()} agent, ${statusLabel}`}
      className={cn(
        "bg-[var(--bg)] border rounded-lg px-3 py-2.5 relative select-none shadow-node overflow-hidden",
        isOrchestrator && "w-[160px] border-2 border-[var(--ac)] bg-[var(--acbg)]",
        isCritic && "w-[160px] border-2 border-[#8b5cf6] bg-[#ede9fe]",
        isWorker && "w-[130px] border-[var(--bd)] border-l-[3px]",
        selected && !isOrchestrator && !isCritic && "border-[var(--tx)]"
      )}
      style={isWorker ? { borderLeftColor: data.color } : undefined}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-2 !h-2 !bg-[var(--bd2)] !border-none"
      />

      {(isOrchestrator || isCritic) && (
        <div
          className={cn(
            "text-[9px] font-semibold uppercase tracking-[0.5px] mb-0.5",
            isOrchestrator && "text-[var(--ac)]",
            isCritic && "text-[#5b21b6]"
          )}
          aria-hidden="true"
        >
          {data.role}
        </div>
      )}

      <TruncateWithTooltip
        className={cn(
          "text-[11px] font-semibold mb-0.5 max-w-full pr-3",
          isCritic && "text-[#5b21b6]"
        )}
        as="div"
      >
        {data.name}
      </TruncateWithTooltip>

      <TruncateWithTooltip
        className={cn(
          "text-[9px] max-w-full pr-3",
          isCritic ? "text-[#7c3aed]" : "text-[var(--tx2)]"
        )}
        as="div"
      >
        {getModelDisplayName(data.model)}
      </TruncateWithTooltip>

      <div
        className={cn(
          "absolute top-[7px] right-[7px] w-1.5 h-1.5 rounded-full",
          data.healthStatus === "healthy" && "bg-[var(--ok)]",
          data.healthStatus === "idle" && "bg-[var(--tx3)]",
          data.healthStatus === "error" && "bg-[var(--err)]"
        )}
        aria-hidden="true"
      />

      {data.skillCount > 0 && (
        <div className="absolute -top-1.5 -right-1.5 bg-[var(--tx)] text-white text-[8px] font-semibold w-4 h-4 rounded-full flex items-center justify-center" aria-label={`${data.skillCount} skills`}>
          {data.skillCount}
        </div>
      )}

      {data.hasHeartbeat && (
        <div className="text-[8px] mt-1 text-[var(--tx3)] flex items-center gap-0.5">
          <Clock className="w-2.5 h-2.5" aria-hidden="true" /> Scheduled
        </div>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-2 !h-2 !bg-[var(--bd2)] !border-none"
      />
    </div>
  )
}

export const AgentNode = memo(AgentNodeComponent)

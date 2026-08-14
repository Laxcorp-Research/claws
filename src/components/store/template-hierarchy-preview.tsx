import { parseTemplateHierarchy, STORE_HIERARCHY_LEGEND } from "@/lib/marketplace/template-hierarchy"
import type { HierarchyAgent } from "@/lib/marketplace/template-hierarchy"
import { cn } from "@/lib/utils"

function HierarchyNode({ agent }: { agent: HierarchyAgent }) {
  const isOrch = agent.role === "ORCHESTRATOR"
  const isCritic = agent.role === "CRITIC"
  return (
    <div
      data-hierarchy-role={agent.role}
      data-agent-name={agent.name}
      className={cn(
        "inline-flex items-center gap-[6px] h-[28px] px-[9px] rounded-[8px] border bg-[var(--bg)]",
        isOrch && "border-2 border-[var(--ac)] bg-[var(--acbg)]",
        isCritic && "border-2 border-[#8b5cf6] bg-[#ede9fe]",
        !isOrch && !isCritic && "border-[var(--bd)] border-l-[3px]",
      )}
      style={!isOrch && !isCritic ? { borderLeftColor: agent.color } : undefined}
    >
      <span
        className="w-[7px] h-[7px] rounded-full flex-shrink-0"
        style={{ backgroundColor: agent.color }}
        aria-hidden="true"
      />
      <span
        className={cn(
          "text-[11px] font-semibold text-[var(--tx)] whitespace-nowrap",
          isCritic && "text-[#5b21b6]",
        )}
      >
        {agent.name}
      </span>
    </div>
  )
}

function ConnectorBand({
  count,
  kind,
}: {
  count: number
  kind: "solid" | "dotted"
}) {
  if (count <= 0) return null
  const midY = 14
  const top = 2
  const bottom = 26
  const xs = Array.from({ length: count }, (_, i) => ((i + 0.5) / count) * 100)
  const left = xs[0] ?? 50
  const right = xs[xs.length - 1] ?? 50
  const dash = kind === "dotted" ? "4 3" : undefined

  return (
    <svg
      className="block w-full h-[28px]"
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {kind === "solid" ? (
        <>
          <line
            data-edge="solid"
            x1="50"
            y1={top}
            x2="50"
            y2={midY}
            stroke="var(--bd2)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
          <line
            data-edge="solid"
            x1={left}
            y1={midY}
            x2={right}
            y2={midY}
            stroke="var(--bd2)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
          {xs.map((x) => (
            <line
              key={`solid-${x}`}
              data-edge="solid"
              x1={x}
              y1={midY}
              x2={x}
              y2={bottom}
              stroke="var(--bd2)"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </>
      ) : (
        <>
          {xs.map((x) => (
            <line
              key={`dot-down-${x}`}
              data-edge="dotted"
              x1={x}
              y1={top}
              x2={x}
              y2={midY}
              stroke="var(--bd2)"
              strokeWidth="1.5"
              strokeDasharray={dash}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <line
            data-edge="dotted"
            x1={left}
            y1={midY}
            x2={right}
            y2={midY}
            stroke="var(--bd2)"
            strokeWidth="1.5"
            strokeDasharray={dash}
            vectorEffect="non-scaling-stroke"
          />
          <line
            data-edge="dotted"
            x1="50"
            y1={midY}
            x2="50"
            y2={bottom}
            stroke="var(--bd2)"
            strokeWidth="1.5"
            strokeDasharray={dash}
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
    </svg>
  )
}

export function TemplateHierarchyPreview({ snapshot }: { snapshot: unknown }) {
  const hierarchy = parseTemplateHierarchy(snapshot)
  if (!hierarchy) return null

  const solidCount = hierarchy.workers.filter((w) =>
    hierarchy.solidWorkerKeys.includes(w.key),
  ).length
  const showDotted = hierarchy.critic !== null && hierarchy.workers.length > 0

  return (
    <div
      data-testid="template-hierarchy-preview"
      className="border border-[var(--bd)] rounded-[12px] p-[14px] mb-3.5"
      aria-label={`Team hierarchy: ${STORE_HIERARCHY_LEGEND}`}
    >
      <div className="flex flex-col items-stretch gap-0">
        <div className="flex justify-center">
          <HierarchyNode agent={hierarchy.orchestrator} />
        </div>
        {solidCount > 0 && <ConnectorBand count={solidCount} kind="solid" />}
        {hierarchy.workers.length > 0 && (
          <div className="flex flex-wrap justify-center gap-[8px]">
            {hierarchy.workers.map((worker) => (
              <HierarchyNode key={worker.key} agent={worker} />
            ))}
          </div>
        )}
        {showDotted && <ConnectorBand count={hierarchy.workers.length} kind="dotted" />}
        {hierarchy.critic && (
          <div className="flex justify-center">
            <HierarchyNode agent={hierarchy.critic} />
          </div>
        )}
      </div>
      <div className="flex items-center justify-center gap-[10px] mt-[10px] text-[10px] text-[var(--tx3)]">
        <span className="inline-flex items-center gap-[6px]">
          <span className="inline-block h-0 w-[18px] border-t-[1.5px] border-[var(--bd2)]" aria-hidden />
          <span className="inline-block h-0 w-[18px] border-t-[1.5px] border-dashed border-[var(--bd2)]" aria-hidden />
        </span>
        <span>{STORE_HIERARCHY_LEGEND}</span>
      </div>
    </div>
  )
}

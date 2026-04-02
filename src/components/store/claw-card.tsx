import Link from "next/link"
import { AgentPill } from "@/components/ui/agent-pill"
import { TrustBadge } from "@/components/marketplace/trust-badge"
import type { TrustTier } from "@/types/marketplace"

const MAX_VISIBLE_PILLS = 4

export interface ClawCardData {
  name: string
  slug: string
  price: number
  tagline: string
  flowDescription: string
  legalDisclaimer?: string | null
  agents: { name: string; role: string; color: string }[]
}

interface ClawCardProps {
  claw: ClawCardData
  index?: number
  trustTier?: TrustTier
  hideTrustBadge?: boolean
  installCount?: number
  avgRating?: number | null
  creatorName?: string | null
  creatorId?: string | null
}

export function ClawCard({ claw, index, trustTier, hideTrustBadge, installCount, avgRating, creatorName }: ClawCardProps) {
  const workers = claw.agents.filter((a) => a.role !== "ORCHESTRATOR")
  const visibleAgents = workers.slice(0, MAX_VISIBLE_PILLS)
  const remainingCount = workers.length - MAX_VISIBLE_PILLS

  return (
    <Link href={`/store/${claw.slug}`} className="block">
      <div className="bg-[var(--bg)] border border-[var(--bd)] rounded-[12px] px-4 py-3 hover:border-[var(--bd2)] transition-[border-color] duration-150 cursor-pointer">
        <div className="flex justify-between items-start mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[15px] font-semibold text-[var(--tx)] truncate" title={claw.name}>
              {index !== undefined && (
                <span className="text-[var(--tx2)] font-semibold">{index}. </span>
              )}
              {claw.name}
            </span>
            {trustTier && !hideTrustBadge && <TrustBadge tier={trustTier} />}
          </div>
          <div className="text-right whitespace-nowrap ml-4 shrink-0">
            <span className="text-[13px] font-semibold text-[var(--tx)]">${claw.price}</span>
            <span className="text-[10px] text-[var(--tx3)] ml-1">one-time</span>
          </div>
        </div>

        <p className="text-[12px] text-[var(--tx2)] leading-normal mb-1 line-clamp-1">
          {claw.tagline}
        </p>

        <div className="flex items-center gap-2 text-[10px] text-[var(--tx3)] mb-1.5">
          {creatorName && <span>by {creatorName}</span>}
          {installCount !== undefined && installCount > 0 && (
            <><span>·</span><span>{installCount.toLocaleString()} installs</span></>
          )}
          {avgRating !== undefined && avgRating !== null && avgRating > 0 && (
            <><span>·</span><span><span style={{ color: "#FFDC6E" }}>&#9733;</span> {avgRating.toFixed(1)}</span></>
          )}
        </div>

        {visibleAgents.length > 0 && (
          <div className="flex flex-wrap gap-[5px]">
            {visibleAgents.map((agent) => (
              <AgentPill key={agent.name} name={agent.name} color={agent.color} role={agent.role as "ORCHESTRATOR" | "WORKER" | "CRITIC"} />
            ))}
            {remainingCount > 0 && (
              <span className="text-[10px] text-[var(--tx3)] self-center px-1">+{remainingCount} more</span>
            )}
          </div>
        )}
      </div>
    </Link>
  )
}

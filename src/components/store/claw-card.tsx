import Link from "next/link"
import { AgentPill } from "@/components/ui/agent-pill"
import { TrustBadge } from "@/components/marketplace/trust-badge"
import type { TrustTier } from "@/types/marketplace"

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
  installCount?: number
  avgRating?: number | null
  creatorName?: string | null
  creatorId?: string | null
}

export function ClawCard({ claw, index, trustTier, installCount, avgRating, creatorName, creatorId }: ClawCardProps) {
  return (
    <Link href={`/store/${claw.slug}`} className="block">
      <div className="bg-[var(--bg)] border border-[var(--bd)] rounded-[12px] px-[18px] py-3.5 hover:border-[var(--bd2)] transition-[border-color] duration-150 cursor-pointer">
        <div className="flex justify-between items-start mb-1">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold text-[var(--tx)]">
              {index !== undefined && (
                <span className="text-[var(--tx2)] font-semibold">{index}. </span>
              )}
              {claw.name}
            </span>
            {trustTier && <TrustBadge tier={trustTier} />}
          </div>
          <div className="text-right whitespace-nowrap ml-4">
            <span className="text-[13px] font-semibold text-[var(--tx)]">${claw.price}</span>
            <span className="text-[10px] text-[var(--tx3)] ml-1">one-time</span>
          </div>
        </div>

        <p className="text-[12px] text-[var(--tx2)] leading-normal mb-1">
          {claw.tagline}
        </p>

        {creatorName && (
          <p className="text-[11px] text-[var(--tx3)] mb-1.5">
            by{" "}
            {creatorId ? (
              <span className="hover:text-[var(--tx2)] transition-colors">{creatorName}</span>
            ) : (
              creatorName
            )}
          </p>
        )}

        {(installCount !== undefined && installCount > 0 || avgRating !== undefined && avgRating !== null && avgRating > 0) && (
          <div className="flex items-center gap-2 mb-1.5">
            {installCount !== undefined && installCount > 0 && (
              <span className="text-[10px] text-[var(--tx3)]">{installCount.toLocaleString()} installs</span>
            )}
            {avgRating !== undefined && avgRating !== null && avgRating > 0 && (
              <span className="text-[10px] text-[var(--tx3)]">
                <span style={{ color: "#FFDC6E" }}>&#9733;</span> {avgRating.toFixed(1)}
              </span>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-[5px] mb-2">
          {claw.agents
            .filter((a) => a.role !== "ORCHESTRATOR")
            .map((agent) => (
              <AgentPill key={agent.name} name={agent.name} color={agent.color} role={agent.role as "ORCHESTRATOR" | "WORKER" | "CRITIC"} />
            ))}
        </div>

        <div className="text-[11px] text-[var(--tx2)] italic leading-normal py-2 px-3 bg-[var(--bg2)] rounded-[8px] border-l-[3px] border-[var(--bd)]">
          {claw.flowDescription}
        </div>

        {claw.legalDisclaimer && (
          <div className="text-[10px] text-[#92400e] bg-[var(--warnbg)] py-1.5 px-3 rounded-[8px] mt-2 border-l-[3px] border-[var(--warn)]">
            {claw.legalDisclaimer}
          </div>
        )}
      </div>
    </Link>
  )
}

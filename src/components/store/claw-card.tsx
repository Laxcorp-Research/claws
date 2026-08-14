import Link from "next/link"
import { AgentPill } from "@/components/ui/agent-pill"
import { TrustBadge } from "@/components/marketplace/trust-badge"
import type { TrustTier } from "@/types/marketplace"
import { TruncateWithTooltip } from "@/components/ui/truncate-with-tooltip"

const MAX_VISIBLE_PILLS = 4

/** Keep in lockstep with TEMPLATE_CATEGORIES labels on the store. */
const CATEGORY_LABEL: Record<string, string> = {
  MONEY_MAKING: "Money-Making",
  CREATOR: "Creator",
  BUSINESS_OPS: "Business Ops",
  VERTICAL: "Vertical",
  LIFESTYLE: "Lifestyle",
}

export interface ClawCardData {
  name: string
  slug: string
  price: number
  isFree?: boolean
  tagline: string
  category?: string
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

export function ClawCard({
  claw,
  index,
  trustTier,
  installCount,
  avgRating,
  creatorName,
}: ClawCardProps) {
  const workers = claw.agents.filter((a) => a.role !== "ORCHESTRATOR")
  const visibleAgents = workers.slice(0, MAX_VISIBLE_PILLS)
  const remainingCount = workers.length - MAX_VISIBLE_PILLS
  const categoryLabel = claw.category ? (CATEGORY_LABEL[claw.category] ?? claw.category) : null
  const installs = installCount ?? 0
  const meta: string[] = []
  if (creatorName) meta.push(`by ${creatorName}`)
  if (categoryLabel) meta.push(categoryLabel)
  meta.push(`${installs.toLocaleString()} installs`)
  const showRating = avgRating !== undefined && avgRating !== null && avgRating > 0
  const free = claw.isFree || claw.price === 0

  return (
    <Link href={`/store/${claw.slug}`} className="group block">
      <div className="bg-[var(--bg)] border border-[var(--bd)] rounded-[12px] px-4 py-3 hover:border-[var(--bd2)] transition-[border-color] duration-150 cursor-pointer">
        <div className="flex gap-4 items-stretch">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-[6px] mb-1 min-w-0">
              <TruncateWithTooltip className="text-[15px] font-semibold text-[var(--tx)] leading-[20px]">
                {index !== undefined ? `${index}. ${claw.name}` : claw.name}
              </TruncateWithTooltip>
              {trustTier && <TrustBadge tier={trustTier} />}
            </div>

            <div className="mb-1 min-w-0 text-[12px] leading-normal text-[var(--tx2)]">
              <TruncateWithTooltip>{claw.tagline}</TruncateWithTooltip>
            </div>

            <div data-store-card="meta" className="flex items-center gap-[6px] text-[10px] text-[var(--tx3)] mb-1.5 min-w-0">
              <TruncateWithTooltip>{meta.join(" · ")}</TruncateWithTooltip>
              {showRating && (
                <span className="shrink-0">
                  {" "}
                  <span style={{ color: "#FFDC6E" }}>&#9733;</span> {avgRating.toFixed(1)}
                </span>
              )}
            </div>

            {visibleAgents.length > 0 && (
              <div className="flex flex-nowrap items-center gap-[5px] overflow-hidden h-[28px]">
                {visibleAgents.map((agent) => (
                  <AgentPill
                    key={agent.name}
                    name={agent.name}
                    color={agent.color}
                    role={agent.role as "ORCHESTRATOR" | "WORKER" | "CRITIC"}
                  />
                ))}
                {remainingCount > 0 && (
                  <span className="text-[10px] py-[3px] px-2.5 rounded-[16px] border border-[var(--bd)] text-[var(--tx3)] bg-[var(--bg2)] inline-flex items-center shrink-0">
                    +{remainingCount}
                  </span>
                )}
              </div>
            )}
          </div>

          <div data-store-card="rail" className="flex flex-col items-end justify-center gap-[6px] shrink-0">
            {free ? (
              <span className="text-[13px] font-semibold text-[var(--ok)] leading-none">Free</span>
            ) : (
              <span className="text-[13px] font-semibold text-[var(--tx)] leading-none whitespace-nowrap">
                ${claw.price}
                <span className="text-[11px] font-normal text-[var(--tx3)] ml-1"> one-time</span>
              </span>
            )}
            <span className="text-[11px] font-medium text-[var(--tx2)] leading-none group-hover:text-[var(--tx)]">
              View
            </span>
          </div>
        </div>
      </div>
    </Link>
  )
}

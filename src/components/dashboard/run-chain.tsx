"use client"

import { cn } from "@/lib/utils"
import type { LiveOpsAgent, RunChainView } from "@/components/dashboard/live-ops-utils"

interface RunChainProps {
  chain: RunChainView | null
  agents: LiveOpsAgent[]
}

export function RunChain({ chain, agents }: RunChainProps) {
  if (!chain || chain.agentSlugs.length === 0) return null
  const bySlug = new Map(agents.map((agent) => [agent.agentSlug, agent]))

  return (
    <section className="mb-[10px] rounded-[12px] border border-[var(--bd)] bg-[var(--bg)] px-[12px] py-[9px]" aria-label="Run chain">
      <p className="mb-[6px] text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--tx3)]">RunChain</p>
      <div className="flex flex-wrap items-center gap-[6px]">
        {chain.agentSlugs.map((slug, index) => {
          const agent = bySlug.get(slug)
          const active = slug === chain.activeAgentSlug
          return (
            <div key={slug} className="inline-flex items-center gap-[6px]">
              {index > 0 && <span className="text-[12px] text-[var(--tx3)]">→</span>}
              <span
                className={cn(
                  "inline-flex h-[26px] items-center gap-[6px] rounded-[999px] border border-[var(--bd)] px-[9px] text-[11px] font-semibold text-[var(--tx2)]",
                  active && "border-[var(--ac)] bg-[var(--acbg)] text-[var(--ac-text)]",
                )}
              >
                <span className="h-[7px] w-[7px] rounded-full" style={{ backgroundColor: agent?.color ?? "#8BFCAE" }} aria-hidden="true" />
                {agent?.name ?? slug}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

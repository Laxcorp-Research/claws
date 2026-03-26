import Link from "next/link"
import { AgentPill } from "@/components/ui/agent-pill"

export interface ClawCardData {
  name: string
  slug: string
  price: number
  tagline: string
  flowDescription: string
  legalDisclaimer?: string | null
  agents: { name: string; role: string; color: string }[]
}

export function ClawCard({ claw, index }: { claw: ClawCardData; index?: number }) {
  return (
    <Link href={`/store/${claw.slug}`} className="block">
      <div className="bg-[var(--bg)] border border-[var(--bd)] rounded-[12px] px-[18px] py-3.5 hover:border-[var(--bd2)] transition-[border-color] duration-150 cursor-pointer">
        <div className="flex justify-between items-start mb-1">
          <div className="text-[15px] font-semibold text-[var(--tx)]">
            {index !== undefined && (
              <span className="text-[var(--tx2)] font-semibold">{index}. </span>
            )}
            {claw.name}
          </div>
          <div className="text-right whitespace-nowrap ml-4">
            <span className="text-[13px] font-semibold text-[var(--tx)]">${claw.price}</span>
            <span className="text-[10px] text-[var(--tx3)] ml-1">one-time</span>
          </div>
        </div>

        <p className="text-[12px] text-[var(--tx2)] leading-normal mb-2.5">
          {claw.tagline}
        </p>

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

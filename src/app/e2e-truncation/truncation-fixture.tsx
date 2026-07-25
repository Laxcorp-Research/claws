"use client"

import { AgentLiveTile } from "@/components/dashboard/agent-live-tile"
import { ProviderChannelBadge } from "@/components/dashboard/provider-channel-badge"
import { TruncatedText } from "@/components/ui/truncate-with-tooltip"

export const LONG_AGENT_NAME = "Extremely Long Strategic Research Agent Name That Must Ellipsize"
const LONG_SESSION_KEY = "agent:twitter-commander:subagent:151eda19-a0c9-49de-969d-ed39d16fe21c"

/** Short names that fit in the sidebar column — must NOT tip. */
const FITTING_SIDEBAR_NAMES = ["Engagement Strategist", "Content Writer", "Trend Scout"] as const

/** Long names that ellipsize in the same column — must tip. */
const TRUNCATED_SIDEBAR_NAMES = [
  "Extremely Long Engagement Strategist Name That Must Tip",
  "Content Writer With An Absurdly Long Display Label",
] as const

export function TruncationFixture() {
  return (
    <main className="mx-auto flex min-h-screen max-w-[720px] flex-col items-center justify-start p-6 pt-24">
      <div className="w-[240px]" data-testid="agent-fixture">
        <AgentLiveTile
          view={{
            agent: {
              id: "long-agent",
              name: LONG_AGENT_NAME,
              role: "WORKER",
              color: "#8BFCAE",
              model: "anthropic/claude-sonnet-4-6",
              agentSlug: "long-agent",
            },
            state: { kind: "idle" },
          }}
          onPauseAgent={() => {}}
          onResumeAgent={() => {}}
        />
      </div>

      <div className="mt-6 w-[240px] rounded-[10px] border border-[var(--bd)] p-3" data-testid="conversation-fixture">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 flex-1">
            <TruncatedText className="text-[12px] font-medium text-[var(--tx)]">{LONG_SESSION_KEY}</TruncatedText>
          </span>
          <ProviderChannelBadge channelId="telegram" className="flex-none" />
        </div>
      </div>

      {/* Side-by-side: fitting vs truncated in identical column width. */}
      <div className="mt-6 w-[220px] space-y-2" data-testid="policy-pair-fixture">
        <div data-testid="fitting-text-fixture" className="rounded-[6px] border border-[var(--bd)] px-2 py-1.5">
          <TruncatedText className="text-[12px] font-medium text-[var(--tx)]">Short fit</TruncatedText>
        </div>
        <div data-testid="truncated-text-fixture" className="rounded-[6px] border border-[var(--bd)] px-2 py-1.5">
          <TruncatedText className="text-[12px] font-medium text-[var(--tx)]">
            This truncated label is intentionally longer than the two-twenty column
          </TruncatedText>
        </div>
      </div>

      {/* Near-right viewport edge — collision must flip/shift; tip stays on-screen. */}
      <div
        className="fixed top-24 right-2 w-[160px]"
        data-testid="right-edge-fixture"
      >
        <TruncatedText className="text-[12px] font-medium text-[var(--tx)]">
          Right-edge collision tip content that is intentionally long
        </TruncatedText>
      </div>

      {/* Highest-risk: truncated text inside a scroll container (overflow clip parent). */}
      <div
        className="mt-6 h-[72px] w-[240px] overflow-y-auto rounded-[10px] border border-[var(--bd)] p-2"
        data-testid="scroll-clip-fixture"
      >
        <div className="h-[120px]">
          <TruncatedText className="text-[12px] font-medium text-[var(--tx)]">
            Scroll-container clipped name that must still portal-tip correctly
          </TruncatedText>
        </div>
      </div>

      {/* Builder-like list: fitting names (no tip) + truncated names (tip + top preferred). */}
      <div
        className="mt-6 h-[160px] w-[220px] overflow-y-auto rounded-[10px] border border-[var(--bd)] p-2"
        data-testid="sidebar-overflow-fixture"
      >
        <div className="space-y-[3px]">
          {FITTING_SIDEBAR_NAMES.map((name) => (
            <div
              key={name}
              className="flex items-center gap-1.5 py-1.5 px-2 rounded-[6px]"
              data-testid={`sidebar-fitting-${name.replace(/\s+/g, "-").toLowerCase()}`}
            >
              <TruncatedText className="text-[12px] font-medium text-[var(--tx)]">{name}</TruncatedText>
            </div>
          ))}
          {TRUNCATED_SIDEBAR_NAMES.map((name, i) => (
            <div
              key={name}
              className="flex items-center gap-1.5 py-1.5 px-2 rounded-[6px]"
              data-testid={`sidebar-truncated-row-${i}`}
            >
              <TruncatedText className="text-[12px] font-medium text-[var(--tx)]">{name}</TruncatedText>
            </div>
          ))}
        </div>
      </div>

      {/* Force side=bottom near top viewport edge. */}
      <div
        className="fixed top-2 left-1/2 w-[200px] -translate-x-1/2"
        data-testid="force-bottom-fixture"
      >
        <TruncatedText className="text-[12px] font-medium text-[var(--tx)]">
          Force-bottom tip near viewport top edge that must truncate
        </TruncatedText>
      </div>
    </main>
  )
}

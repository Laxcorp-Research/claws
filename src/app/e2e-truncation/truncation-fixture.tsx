"use client"

import { AgentLiveTile } from "@/components/dashboard/agent-live-tile"
import { ProviderChannelBadge } from "@/components/dashboard/provider-channel-badge"
import { TruncatedText } from "@/components/ui/truncate-with-tooltip"

export const LONG_AGENT_NAME = "Extremely Long Strategic Research Agent Name That Must Ellipsize"
const LONG_SESSION_KEY = "agent:twitter-commander:subagent:151eda19-a0c9-49de-969d-ed39d16fe21c"

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
    </main>
  )
}

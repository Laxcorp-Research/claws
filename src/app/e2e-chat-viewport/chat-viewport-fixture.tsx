"use client"

import { ChatPanel, type ChatRow } from "@/components/dashboard/chat-panel"

const rows: ChatRow[] = Array.from({ length: 36 }, (_, i) => ({
  id: `m-${i}`,
  actionType: i % 2 === 0 ? "MESSAGE_RECEIVED" : "MESSAGE_SENT",
  timestamp: `2026-07-14T12:${String(i % 60).padStart(2, "0")}:00.000Z`,
  agentName: i % 2 === 0 ? "You" : "Dev Commander",
  action: `Message ${i} — long enough to stack the chat pane past a naive min-height shell.`,
  detail: `Message ${i} — long enough to stack the chat pane past a naive min-height shell.`,
  messageId: i % 2 === 0 ? `r-${i}` : null,
  runId: i % 2 === 1 ? `r-${i - 1}` : null,
  channelId: "webchat",
}))

export function ChatViewportFixture() {
  return (
    <main className="max-w-5xl mx-auto px-5 py-6" data-testid="chat-viewport-fixture">
      <div className="h-[120px] border border-[var(--bd)] mb-3 rounded-lg p-3 text-[12px]" data-testid="fake-header">
        Fake header / tabs stand-in
      </div>
      <ChatPanel
        workspaceId="ws-e2e-chat"
        status="RUNNING"
        rows={rows}
        orchestratorName="Dev Commander"
        fullHeight
      />
    </main>
  )
}

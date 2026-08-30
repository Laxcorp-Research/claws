import { describe, expect, it } from "vitest"
import {
  isHumanFacingSessionKey,
  normalizeConversationMessages,
  normalizeConversationSummaries,
} from "@/lib/openclaw/conversations"

describe("conversation summaries - human-facing session filter", () => {
  it("returns main orchestrator and channel sessions while excluding subagent sessions", () => {
    const summaries = normalizeConversationSummaries({
      sessions: [
        { sessionKey: "agent:dev-commander:main", lastActivityAt: "2026-07-06T10:00:00.000Z" },
        { sessionKey: "telegram:chat-42", lastActivityAt: "2026-07-06T10:01:00.000Z" },
        { sessionKey: "webchat:ws-1", lastActivityAt: "2026-07-06T10:02:00.000Z" },
        { sessionKey: "agent:dev-commander:subagent:critic:7f2b", lastActivityAt: "2026-07-06T10:03:00.000Z" },
        { sessionKey: "agent:dev-commander:worker", lastActivityAt: "2026-07-06T10:04:00.000Z" },
      ],
    })

    expect(summaries.map((s) => s.sessionKey)).toEqual([
      "agent:dev-commander:main",
      "telegram:chat-42",
      "webchat:ws-1",
    ])
    expect(isHumanFacingSessionKey("agent:dev-commander:subagent:critic:7f2b")).toBe(false)
  })
})

describe("conversation messages - presentation mapper", () => {
  it("maps captured live gateway history to user text, assistant text, and name-only tool chips", () => {
    const messages = normalizeConversationMessages({
      history: [
        {
          role: "system",
          content: [{ type: "text", text: "Injected workspace context that must not render." }],
          timestamp: "2026-07-06T10:00:00.000Z",
        },
        {
          role: "user",
          content: [{ type: "text", text: "Research whether staging is leaking tool payloads." }],
          timestamp: "2026-07-06T10:00:01.000Z",
        },
        {
          role: "assistant",
          content: [{ type: "tool_use", name: "web_search", input: { query: "laxclaws staging leak" } }],
          stopReason: "tool_use",
          timestamp: "2026-07-06T10:00:02.000Z",
        },
        {
          role: "tool",
          content: [
            {
              type: "tool_result",
              tool_use_id: "search-1",
              content:
                '<EXTERNAL_UNTRUSTED_CONTENT>{"title":"Search result","url":"https://example.com","snippet":"raw result"}</EXTERNAL_UNTRUSTED_CONTENT>',
            },
          ],
          timestamp: "2026-07-06T10:00:03.000Z",
        },
        {
          role: "tool",
          content: [
            {
              type: "tool_result",
              tool_use_id: "read-1",
              content: "# SOUL.md\n\nPrivate operating notes that were read from disk.",
            },
          ],
          timestamp: "2026-07-06T10:00:04.000Z",
        },
        {
          role: "tool",
          content: JSON.stringify({
            type: "tool_result",
            name: "sessions_spawn",
            result: {
              sessionKey: "agent:dev-commander:subagent:critic:7f2b",
              protocolNote: "Auto-announce complete. The agent replied NO_REPLY.",
            },
          }),
          timestamp: "2026-07-06T10:00:05.000Z",
        },
        {
          role: "tool",
          content: JSON.stringify({ type: "tool_result", name: "read_file", stderr: "EISDIR: illegal operation on a directory" }),
          timestamp: "2026-07-06T10:00:06.000Z",
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "Staging should show this concise operator-facing summary only." }],
          timestamp: "2026-07-06T10:00:07.000Z",
        },
      ],
    })

    expect(messages).toEqual([
      {
        type: "message",
        role: "user",
        content: "Research whether staging is leaking tool payloads.",
        at: "2026-07-06T10:00:01.000Z",
      },
      { type: "tool", name: "web_search", at: "2026-07-06T10:00:02.000Z" },
      {
        type: "message",
        role: "assistant",
        content: "Staging should show this concise operator-facing summary only.",
        at: "2026-07-06T10:00:07.000Z",
      },
    ])

    const serialized = JSON.stringify(messages)
    expect(serialized).not.toContain("EXTERNAL_UNTRUSTED_CONTENT")
    expect(serialized).not.toContain("SOUL.md")
    expect(serialized).not.toContain("sessions_spawn")
    expect(serialized).not.toContain("auto-announce")
    expect(serialized).not.toContain("EISDIR")
    expect(serialized).not.toContain("tool_result")
    expect(serialized).not.toContain('"query"')
  })

  it("strips interview sentinel from assistant content; drops token-only (MUTATION: raw-token-rendered → fail)", () => {
    const messages = normalizeConversationMessages({
      messages: [
        { role: "user", content: "looks right" },
        { role: "assistant", content: "Profile saved. CLAWS_USER_MD_INTERVIEW_COMPLETE" },
        { role: "assistant", content: "CLAWS_USER_MD_INTERVIEW_COMPLETE" },
      ],
    })
    expect(messages).toEqual([
      { type: "message", role: "user", content: "looks right", at: null },
      { type: "message", role: "assistant", content: "Profile saved.", at: null },
    ])
    expect(JSON.stringify(messages)).not.toContain("CLAWS_USER_MD_INTERVIEW_COMPLETE")
  })

  it("drops assistant NO_REPLY so startup protocol tokens never become transcript bubbles", () => {
    expect(normalizeConversationMessages({
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "  NO_REPLY  " },
        { role: "assistant", content: "Ready now." },
      ],
    })).toEqual([
      { type: "message", role: "user", content: "hello", at: null },
      { type: "message", role: "assistant", content: "Ready now.", at: null },
    ])
  })
})

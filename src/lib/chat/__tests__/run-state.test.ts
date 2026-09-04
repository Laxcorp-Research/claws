import { describe, expect, it } from "vitest"
import {
  CHAT_RUN_STATE_STREAM_SCOPE,
  chatRunStateInitWhere,
  chatRunStateQueryWhere,
  chatRunStateStreamUrl,
  collectWorkingRunIds,
  isChatRunStateEntry,
  mergeChatRunStateRows,
  parseRunStateRunIds,
  parseRunStateSince,
  type ChatRunStateEntry,
} from "@/lib/chat/run-state"

function entry(overrides: Partial<ChatRunStateEntry> = {}): ChatRunStateEntry {
  return {
    id: "log-1",
    actionType: "MESSAGE_SENT",
    timestamp: "2026-09-04T08:00:00.000Z",
    agentName: "Orchestrator",
    action: "Replied: hi",
    detail: "hi",
    channelId: "webchat",
    runId: "run-1",
    ...overrides,
  }
}

describe("chat run-state helpers", () => {
  it("locks the EventSource URL to the activity stream with chat-run-state scope", () => {
    expect(CHAT_RUN_STATE_STREAM_SCOPE).toBe("chat-run-state")
    expect(chatRunStateStreamUrl("ws-1")).toBe("/api/activity/ws-1/stream?scope=chat-run-state")
  })

  it("keeps MESSAGE_SENT without channelId when runId is present (page filter miss)", () => {
    expect(
      isChatRunStateEntry(
        entry({ channelId: null, runId: "run-1", actionType: "MESSAGE_SENT" }),
      ),
    ).toBe(true)
    expect(
      isChatRunStateEntry(
        entry({ channelId: null, runId: null, messageId: null, actionType: "MESSAGE_SENT" }),
      ),
    ).toBe(false)
  })

  it("keeps TASK_START only when it carries a runId", () => {
    expect(isChatRunStateEntry(entry({ actionType: "TASK_START", runId: "run-1" }))).toBe(true)
    expect(isChatRunStateEntry(entry({ actionType: "TASK_START", runId: null }))).toBe(false)
  })

  it("MERGES incoming rows by id - never wholesale-replaces the buffer", () => {
    const first = [entry({ id: "a", timestamp: "2026-09-04T08:00:00.000Z" })]
    const second = [entry({ id: "b", timestamp: "2026-09-04T08:01:00.000Z" })]
    const merged = mergeChatRunStateRows(first, second)
    expect(merged.map((row) => row.id)).toEqual(["a", "b"])
    const replacedWouldBe = second
    expect(replacedWouldBe.map((row) => row.id)).not.toEqual(merged.map((row) => row.id))
  })

  it("collectWorkingRunIds treats TASK_START and TASK_COMPLETE as working evidence", () => {
    const ids = collectWorkingRunIds([
      entry({ actionType: "TASK_START", runId: "run-1" }),
      entry({ actionType: "TASK_COMPLETE", runId: "run-2" }),
      entry({ actionType: "MESSAGE_SENT", runId: "run-3" }),
    ])
    expect([...ids].sort()).toEqual(["run-1", "run-2"])
  })

  it("parseRunStateRunIds caps and drops junk", () => {
    expect(parseRunStateRunIds("run-1, run-2")).toEqual(["run-1", "run-2"])
    expect(parseRunStateRunIds("")).toEqual([])
    expect(parseRunStateRunIds(null)).toEqual([])
    expect(parseRunStateRunIds("x".repeat(200))).toEqual([])
  })

  it("parseRunStateSince rejects invalid stamps", () => {
    expect(parseRunStateSince("2026-09-04T08:00:00.000Z")?.toISOString()).toBe(
      "2026-09-04T08:00:00.000Z",
    )
    expect(parseRunStateSince("nope")).toBeNull()
  })

  it("chat-scoped Prisma where includes webchat + runId TASK rows", () => {
    const where = chatRunStateInitWhere("ws-1")
    expect(where.workspaceId).toBe("ws-1")
    expect(where.OR.some((clause) => clause.metadata?.contains === '"channelId":"webchat"')).toBe(
      true,
    )
    expect(where.OR.some((clause) => clause.actionType !== undefined && JSON.stringify(clause.actionType).includes("TASK_START"))).toBe(
      true,
    )
  })

  it("query where adds per-runId metadata contains clauses", () => {
    const where = chatRunStateQueryWhere("ws-1", {
      runIds: ["run-9"],
      since: new Date("2026-09-04T08:00:00.000Z"),
    })
    expect(where.AND[0].OR.some((clause) => clause.metadata?.contains === '"runId":"run-9"')).toBe(
      true,
    )
    expect(where.AND[1]).toEqual({ timestamp: { gt: new Date("2026-09-04T08:00:00.000Z") } })
  })
})

import { describe, expect, it } from "vitest"
import {
  groupMissionLogEntries,
  mergeMissionEvent,
  missionQueryParams,
  type MissionAgent,
  type MissionFilters,
  type MissionLogEntry,
} from "@/components/dashboard/mission-log-utils"

const agent: MissionAgent = {
  name: "Worker",
  role: "WORKER",
  color: "#8BFCAE",
  agentSlug: "worker",
}

const filters: MissionFilters = {
  agentSlug: "",
  type: "all",
  channelId: "",
  time: "all",
  q: "",
  showRoutine: true,
}

function row(overrides: Partial<MissionLogEntry> = {}): MissionLogEntry {
  return {
    id: "log-1",
    timestamp: "2026-07-07T12:00:00.000Z",
    agentName: "Worker",
    agentSlug: "worker",
    action: "Write brief",
    detail: null,
    actionType: "TASK_START",
    apiCost: null,
    channelId: "webchat",
    runId: "run-1",
    ...overrides,
  }
}

describe("Mission Log grouping", () => {
  it("groups start + skill + complete by runId into one card with duration", () => {
    const grouped = groupMissionLogEntries([
      row({ id: "complete", actionType: "TASK_COMPLETE", timestamp: "2026-07-07T12:00:06.000Z", action: "Task complete" }),
      row({ id: "skill", actionType: "SKILL_INVOKED", timestamp: "2026-07-07T12:00:02.000Z", action: "Used Gmail" }),
      row({ id: "start", actionType: "TASK_START", timestamp: "2026-07-07T12:00:00.000Z", action: "Write brief" }),
    ], new Map([["worker", agent]]))

    expect(grouped).toHaveLength(1)
    expect(grouped[0]).toMatchObject({
      kind: "run",
      runId: "run-1",
      status: "success",
      durationMs: 6000,
      taskName: "Write brief",
    })
    if (grouped[0].kind === "run") {
      expect(grouped[0].events.map((event) => event.id)).toEqual(["start", "skill", "complete"])
    }
  })

  it("mutation anchor: different runIds do not collapse into one card", () => {
    const grouped = groupMissionLogEntries([
      row({ id: "start-a", runId: "run-a" }),
      row({ id: "start-b", runId: "run-b" }),
    ], new Map([["worker", agent]]))

    expect(grouped).toHaveLength(2)
  })

  it("marks open, failed, and page-boundary-cut runs", () => {
    const grouped = groupMissionLogEntries([
      row({ id: "open", runId: "open-run", actionType: "TASK_START" }),
      row({ id: "failed", runId: "failed-run", actionType: "TASK_FAILED", timestamp: "2026-07-07T12:00:03.000Z" }),
    ], new Map([["worker", agent]]))

    const open = grouped.find((item) => item.kind === "run" && item.runId === "open-run")
    const failed = grouped.find((item) => item.kind === "run" && item.runId === "failed-run")
    expect(open).toMatchObject({ kind: "run", status: "open" })
    expect(failed).toMatchObject({ kind: "run", status: "failed", pageBoundaryCut: true })
  })

  it("classifies heartbeat starts as routine and hides them when routine is toggled off", () => {
    const routine = row({ id: "heartbeat", action: "Heartbeat check", runId: "heartbeat-run" })

    expect(groupMissionLogEntries([routine], new Map([["worker", agent]]), true)).toHaveLength(1)
    expect(groupMissionLogEntries([routine], new Map([["worker", agent]]), false)).toHaveLength(0)
  })

  it("builds server params for filters except the client-only routine toggle", () => {
    const params = missionQueryParams({
      agentSlug: "worker",
      type: "tasks",
      channelId: "slack",
      time: "all",
      q: "brief",
      showRoutine: false,
    })

    expect(params.get("agentSlug")).toBe("worker")
    expect(params.get("channelId")).toBe("slack")
    expect(params.getAll("actionType")).toEqual(["TASK_START", "TASK_COMPLETE", "TASK_FAILED", "SKILL_INVOKED"])
    expect(params.get("q")).toBe("brief")
    expect(params.has("showRoutine")).toBe(false)
  })

  it("merges an SSE event into an existing run and drops events outside active filters", () => {
    const current = [row({ id: "start", runId: "run-1" })]
    const merged = mergeMissionEvent(current, row({ id: "complete", runId: "run-1", actionType: "TASK_COMPLETE" }), filters)
    const grouped = groupMissionLogEntries(merged, new Map([["worker", agent]]))

    expect(merged).toHaveLength(2)
    expect(grouped).toHaveLength(1)
    expect(
      mergeMissionEvent(merged, row({ id: "other-channel", channelId: "slack" }), { ...filters, channelId: "webchat" }),
    ).toHaveLength(2)
  })
})

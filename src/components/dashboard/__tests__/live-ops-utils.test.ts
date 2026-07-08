import { describe, expect, it } from "vitest"
import {
  deriveAgentLiveState,
  deriveRunChain,
  type LiveOpsAgent,
} from "@/components/dashboard/live-ops-utils"
import type { MissionLogEntry } from "@/components/dashboard/mission-log-utils"

const now = new Date("2026-07-07T12:30:00.000Z")

const worker: LiveOpsAgent = {
  id: "w1",
  name: "Worker",
  role: "WORKER",
  color: "#8BFCAE",
  model: "anthropic/claude-sonnet-4-6",
  agentSlug: "worker",
  isPaused: false,
  pauseApplied: false,
}

function event(overrides: Partial<MissionLogEntry> = {}): MissionLogEntry {
  return {
    id: "e1",
    timestamp: "2026-07-07T12:20:00.000Z",
    agentName: "Worker",
    agentSlug: "worker",
    action: "Write brief",
    actionType: "TASK_START",
    channelId: "webchat",
    runId: "run-1",
    ...overrides,
  }
}

describe("Live Ops state derivation", () => {
  it("derives WORKING from an open run younger than 30 minutes", () => {
    expect(deriveAgentLiveState(worker, [event()], now)).toMatchObject({ kind: "working", runId: "run-1" })
  })

  it("renders stale open runs over 30 minutes as IDLE, never fake spinner", () => {
    expect(deriveAgentLiveState(worker, [event({ timestamp: "2026-07-07T11:00:00.000Z" })], now)).toMatchObject({
      kind: "idle",
      reason: "stale-open",
    })
  })

  it("derives PAUSED only when deployed pause truth matches DB pause", () => {
    expect(deriveAgentLiveState({ ...worker, isPaused: true, pauseApplied: true }, [], now)).toEqual({ kind: "paused" })
  })

  it("derives PAUSE-PENDING when DB pause is not deployed yet", () => {
    expect(deriveAgentLiveState({ ...worker, isPaused: true, pauseApplied: false }, [], now)).toEqual({ kind: "pause-pending" })
  })

  it("derives ERROR from agent-attributed ERROR within 30 minutes", () => {
    expect(deriveAgentLiveState(worker, [event({ actionType: "ERROR", action: "Tool failed" })], now)).toMatchObject({
      kind: "error",
      message: "Tool failed",
    })
  })

  it("marks heartbeat starts as routine working variant", () => {
    expect(deriveAgentLiveState(worker, [event({ action: "Heartbeat check" })], now)).toMatchObject({
      kind: "working",
      routine: true,
    })
  })

  it("builds RunChain in event order with active final hop", () => {
    const chain = deriveRunChain([
      event({ id: "orch", agentName: "Orchestrator", agentSlug: "orchestrator", timestamp: "2026-07-07T12:20:00.000Z" }),
      event({ id: "worker", agentName: "Worker", agentSlug: "worker", timestamp: "2026-07-07T12:21:00.000Z", actionType: "SKILL_INVOKED" }),
      event({ id: "critic", agentName: "Critic", agentSlug: "critic", timestamp: "2026-07-07T12:22:00.000Z", actionType: "ERROR" }),
    ], now)

    expect(chain?.agentSlugs).toEqual(["orchestrator", "worker", "critic"])
    expect(chain?.activeAgentSlug).toBe("critic")
  })
})

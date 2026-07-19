import { describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  computeNextHeartbeatAt,
  decideHeartbeatMissed,
  extractHeartbeatIntervalMsFromOpenclawJson,
  HEARTBEAT_MISS_GRACE_MS,
  isHeartbeatShapedActivity,
  lastExpectedCronFire,
  parseHeartbeatEveryToMs,
} from "@/lib/hibernation/next-heartbeat"

describe("parseHeartbeatEveryToMs / extract from openclaw.json", () => {
  it("parses 1h / 6h / 12h", () => {
    expect(parseHeartbeatEveryToMs("1h")).toBe(60 * 60 * 1000)
    expect(parseHeartbeatEveryToMs("6h")).toBe(6 * 60 * 60 * 1000)
    expect(parseHeartbeatEveryToMs("12h")).toBe(12 * 60 * 60 * 1000)
  })

  it("reads agents.defaults.heartbeat.every from openclaw.json", () => {
    const json = JSON.stringify({
      agents: { defaults: { heartbeat: { every: "1h" } } },
    })
    expect(extractHeartbeatIntervalMsFromOpenclawJson(json)).toBe(60 * 60 * 1000)
  })
})

describe("computeNextHeartbeatAt — rolling hint", () => {
  it("returns next cron fire for cron-scheduled claws", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-19T10:00:00.000Z"))
    try {
      const cron = JSON.stringify([
        { schedule: { kind: "cron", expr: "0 8 * * *", tz: "UTC" } },
      ])
      const next = computeNextHeartbeatAt({
        now: new Date(),
        heartbeatCronExpressions: cron,
        heartbeatIntervalMs: null,
      })
      expect(next).toBeInstanceOf(Date)
      expect(next!.toISOString()).toBe("2026-07-20T08:00:00.000Z")
    } finally {
      vi.useRealTimers()
    }
  })

  it("interval claw gets now + interval (hibernate wake hint)", () => {
    const now = new Date("2026-07-19T12:00:00.000Z")
    const next = computeNextHeartbeatAt({
      now,
      heartbeatCronExpressions: null,
      heartbeatIntervalMs: 60 * 60 * 1000,
    })
    expect(next!.toISOString()).toBe("2026-07-19T13:00:00.000Z")
  })

  it("hint rolls after fire (next day after 08:00Z fire)", () => {
    const cron = JSON.stringify([
      { schedule: { kind: "cron", expr: "0 8 * * *", tz: "UTC" } },
    ])
    const afterFire = new Date("2026-07-20T08:00:05.000Z")
    const rolled = computeNextHeartbeatAt({
      now: afterFire,
      heartbeatCronExpressions: cron,
      heartbeatIntervalMs: null,
    })
    expect(rolled!.toISOString()).toBe("2026-07-21T08:00:00.000Z")
  })

  it("MUTATION: one-shot (no roll) would fail continuity — activity route must call computeNextHeartbeatAt", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/internal/activity/[workspaceId]/route.ts"),
      "utf8",
    )
    expect(src).toContain("isHeartbeatShapedActivity")
    expect(src).toContain("computeNextHeartbeatAt")
    expect(src).toContain("nextHeartbeatAt")
  })

  it("MUTATION: hibernate path must recompute wake hint", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/hibernation/manager.ts"),
      "utf8",
    )
    expect(src).toContain("computeNextHeartbeatAt")
    expect(src).toContain("nextHeartbeatAt")
  })
})

describe("decideHeartbeatMissed — Watchtower window", () => {
  const cron = JSON.stringify([
    { schedule: { kind: "cron", expr: "0 8 * * *", tz: "UTC" } },
  ])

  it("fires when past expected+grace with no evidence", () => {
    // Last fire expected 08:00Z; now 08:15Z (> 10m grace); no evidence.
    const nowMs = new Date("2026-07-20T08:15:00.000Z").getTime()
    const expected = lastExpectedCronFire(cron, new Date(nowMs))
    expect(expected!.toISOString()).toBe("2026-07-20T08:00:00.000Z")

    const result = decideHeartbeatMissed({
      containerPhase: "RUNNING",
      heartbeatCronExpressions: cron,
      hasHeartbeatEvidenceInWindow: false,
      currentFlag: null,
      nowMs,
    })
    expect(result).toBeInstanceOf(Date)
  })

  it("does not fire inside grace window", () => {
    const nowMs = new Date("2026-07-20T08:05:00.000Z").getTime()
    const result = decideHeartbeatMissed({
      containerPhase: "RUNNING",
      heartbeatCronExpressions: cron,
      hasHeartbeatEvidenceInWindow: false,
      currentFlag: null,
      nowMs,
    })
    expect(result).toBeUndefined()
  })

  it("clears when evidence present after grace", () => {
    const nowMs = new Date("2026-07-20T08:15:00.000Z").getTime()
    const result = decideHeartbeatMissed({
      containerPhase: "RUNNING",
      heartbeatCronExpressions: cron,
      hasHeartbeatEvidenceInWindow: true,
      currentFlag: new Date("2026-07-20T08:12:00.000Z"),
      nowMs,
    })
    expect(result).toBeNull()
  })

  it("MUTATION: drop grace → false-positive when evidence is slightly late", () => {
    // Evidence at expected+30s; with grace=0 this is outside [expected, expected+0]
    // so decideHeartbeatMissed would flag — production grace prevents that.
    const nowMs = new Date("2026-07-20T08:00:30.000Z").getTime()
    const withGrace = decideHeartbeatMissed({
      containerPhase: "WARM",
      heartbeatCronExpressions: cron,
      hasHeartbeatEvidenceInWindow: false,
      currentFlag: null,
      nowMs,
      graceMs: HEARTBEAT_MISS_GRACE_MS,
    })
    expect(withGrace).toBeUndefined() // still inside 10m grace

    const noGrace = decideHeartbeatMissed({
      containerPhase: "WARM",
      heartbeatCronExpressions: cron,
      hasHeartbeatEvidenceInWindow: false,
      currentFlag: null,
      nowMs,
      graceMs: 0,
    })
    expect(noGrace).toBeInstanceOf(Date) // false-positive if grace dropped
    expect(HEARTBEAT_MISS_GRACE_MS).toBeGreaterThan(0)
  })

  it("null cron expressions never match (interval-only)", () => {
    const result = decideHeartbeatMissed({
      containerPhase: "RUNNING",
      heartbeatCronExpressions: null,
      hasHeartbeatEvidenceInWindow: false,
      currentFlag: null,
      nowMs: Date.now(),
    })
    expect(result).toBeUndefined()
  })
})

describe("isHeartbeatShapedActivity", () => {
  it("matches HEARTBEAT and overlay_boot TASK_START", () => {
    expect(isHeartbeatShapedActivity({ type: "HEARTBEAT" })).toBe(true)
    expect(
      isHeartbeatShapedActivity({
        type: "TASK_START",
        metadata: { eventKind: "overlay_boot" },
      }),
    ).toBe(true)
    expect(isHeartbeatShapedActivity({ type: "MESSAGE_RECEIVED" })).toBe(false)
  })
})

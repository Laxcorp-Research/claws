import { describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  computeNextHeartbeatAt,
  decideHeartbeatMissed,
  decideMissedWake,
  decideWokeLateNeverBeat,
  extractHeartbeatIntervalMsFromOpenclawJson,
  HEARTBEAT_MISS_GRACE_MS,
  isHeartbeatBeatEvidence,
  isHeartbeatShapedActivity,
  lastExpectedCronFire,
  OPENCLAW_HEARTBEAT_POLL_MARKER,
  parseHeartbeatEveryToMs,
  WOKE_LATE_CATCHUP_GRACE_MS,
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

describe("computeNextHeartbeatAt - rolling hint", () => {
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

  it("MUTATION: one-shot (no roll) would fail continuity - activity route must call computeNextHeartbeatAt", () => {
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

  it("MUTATION: Watchtower evidence must use poll-marker OR (not HEARTBEAT-only)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/cron/health-monitor/route.ts"),
      "utf8",
    )
    expect(src).toContain("heartbeatEvidenceOrClause")
    expect(src).toContain("decideMissedWake")
    // HEARTBEAT-only where would miss OpenClaw poll TASK_START evidence.
    expect(src).not.toMatch(
      /actionType:\s*"HEARTBEAT",\s*\n\s*timestamp:/,
    )
  })
})

describe("decideHeartbeatMissed - Watchtower window", () => {
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

  it("sticky miss: in-grace MUST NOT clear late-wake flag (16:01 class)", () => {
    // Late-wake set sticky at 08:01; health-monitor still inside 08:00+10m grace.
    const sticky = new Date("2026-07-20T08:01:00.000Z")
    const nowMs = new Date("2026-07-20T08:05:00.000Z").getTime()
    const result = decideHeartbeatMissed({
      containerPhase: "RUNNING",
      heartbeatCronExpressions: cron,
      hasHeartbeatEvidenceInWindow: false,
      currentFlag: sticky,
      nowMs,
    })
    // MUTATION: return clearIfSet (null) here → fixture missed=null after pastDue wake.
    expect(result).toBeUndefined()
  })

  it("P2.3: grace-edge (exactly expected+grace) flags for RUNNING/WARM", () => {
    const nowMs = new Date("2026-07-20T08:10:00.000Z").getTime()
    const result = decideHeartbeatMissed({
      containerPhase: "WARM",
      heartbeatCronExpressions: cron,
      hasHeartbeatEvidenceInWindow: false,
      currentFlag: null,
      nowMs,
    })
    expect(result).toBeInstanceOf(Date)
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
    // so decideHeartbeatMissed would flag - production grace prevents that.
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

describe("decideHeartbeatMissed - activation guard (D6 2026-08-22 incident)", () => {
  // Exact incident shape: first-ever deploy completed 14:44:47Z carrying
  // "0 19 * * *"; health-monitor pass one second later back-projected
  // expectedAt=Aug-21T19:00Z (20h BEFORE any container existed) and flagged.
  const cron = JSON.stringify([
    { schedule: { kind: "cron", expr: "0 19 * * *", tz: "UTC" } },
  ])
  const deployCompletedAt = new Date("2026-08-22T14:44:47.000Z")
  const monitorNowMs = new Date("2026-08-22T14:44:48.000Z").getTime()

  it("expected fire predating deployment completedAt → no instant miss (undefined)", () => {
    const expected = lastExpectedCronFire(cron, new Date(monitorNowMs))
    expect(expected!.toISOString()).toBe("2026-08-21T19:00:00.000Z")

    const result = decideHeartbeatMissed({
      containerPhase: "RUNNING",
      heartbeatCronExpressions: cron,
      hasHeartbeatEvidenceInWindow: false,
      currentFlag: null,
      nowMs: monitorNowMs,
      scheduleActivatedAt: deployCompletedAt,
    })
    expect(result).toBeUndefined()
  })

  it("MUTATION: guard dropped (no scheduleActivatedAt) → the incident's false flag returns", () => {
    const result = decideHeartbeatMissed({
      containerPhase: "RUNNING",
      heartbeatCronExpressions: cron,
      hasHeartbeatEvidenceInWindow: false,
      currentFlag: null,
      nowMs: monitorNowMs,
    })
    expect(result).toBeInstanceOf(Date)
  })

  it("expected fire after activation with no evidence past grace → still flags (real misses kept)", () => {
    // Tonight's fire 19:00Z came and went with no beat: 19:15Z > 19:00 + 10m grace.
    const nowMs = new Date("2026-08-22T19:15:00.000Z").getTime()
    const result = decideHeartbeatMissed({
      containerPhase: "RUNNING",
      heartbeatCronExpressions: cron,
      hasHeartbeatEvidenceInWindow: false,
      currentFlag: null,
      nowMs,
      scheduleActivatedAt: deployCompletedAt,
    })
    expect(result).toBeInstanceOf(Date)
  })

  it("guard no-ops sticky flags (never clears via pre-activation window)", () => {
    const sticky = new Date("2026-08-22T14:44:48.000Z")
    const result = decideHeartbeatMissed({
      containerPhase: "RUNNING",
      heartbeatCronExpressions: cron,
      hasHeartbeatEvidenceInWindow: false,
      currentFlag: sticky,
      nowMs: monitorNowMs,
      scheduleActivatedAt: deployCompletedAt,
    })
    expect(result).toBeUndefined()
  })
})

describe("arming never targets the past (authoring a time earlier than now)", () => {
  it("cron authored at a time already past today arms tomorrow's occurrence", () => {
    // Authored "0 13 * * *" at 14:44Z (13:00Z already gone) → next = tomorrow 13:00Z.
    const cron = JSON.stringify([
      { schedule: { kind: "cron", expr: "0 13 * * *", tz: "UTC" } },
    ])
    const next = computeNextHeartbeatAt({
      now: new Date("2026-08-22T14:44:47.000Z"),
      heartbeatCronExpressions: cron,
      heartbeatIntervalMs: null,
    })
    expect(next!.toISOString()).toBe("2026-08-23T13:00:00.000Z")
  })

  it("cron authored at a time still ahead today arms today's occurrence (D6: 19:00Z)", () => {
    const cron = JSON.stringify([
      { schedule: { kind: "cron", expr: "0 19 * * *", tz: "UTC" } },
    ])
    const next = computeNextHeartbeatAt({
      now: new Date("2026-08-22T14:44:47.000Z"),
      heartbeatCronExpressions: cron,
      heartbeatIntervalMs: null,
    })
    expect(next!.toISOString()).toBe("2026-08-22T19:00:00.000Z")
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

  it("isHeartbeatBeatEvidence excludes overlay_boot (sticky miss)", () => {
    expect(isHeartbeatBeatEvidence({ type: "HEARTBEAT" })).toBe(true)
    expect(
      isHeartbeatBeatEvidence({
        type: "TASK_START",
        metadata: { eventKind: "overlay_boot" },
      }),
    ).toBe(false)
    expect(
      isHeartbeatBeatEvidence({
        type: "TASK_START",
        action: "Task started: [OpenClaw heartbeat poll] daily",
      }),
    ).toBe(true)
  })

  it("MUTATION: patching overlay_boot into isHeartbeatBeatEvidence must fail", () => {
    // Tripwire: if boot were treated as beat evidence, WOKE-LATE would go blind.
    const boot = {
      type: "TASK_START",
      metadata: { eventKind: "overlay_boot" },
    }
    expect(isHeartbeatBeatEvidence(boot)).toBe(false)
    const src = readFileSync(
      join(process.cwd(), "src/lib/hibernation/next-heartbeat.ts"),
      "utf8",
    )
    const fnStart = src.indexOf("export function isHeartbeatBeatEvidence")
    const fnEnd = src.indexOf("export function heartbeatEvidenceOrClause")
    const body = src.slice(fnStart, fnEnd)
    expect(body).not.toMatch(/eventKind\s*===\s*["']overlay_boot["']/)
    expect(body).not.toContain('metadata?.eventKind === "overlay_boot"')
  })

  it("matches TASK_START with OpenClaw heartbeat poll marker (action or detail)", () => {
    expect(
      isHeartbeatShapedActivity({
        type: "TASK_START",
        action: `Task started: ${OPENCLAW_HEARTBEAT_POLL_MARKER} daily check`,
      }),
    ).toBe(true)
    expect(
      isHeartbeatShapedActivity({
        type: "TASK_START",
        detail: `${OPENCLAW_HEARTBEAT_POLL_MARKER}\nfull prompt`,
      }),
    ).toBe(true)
  })

  it("MUTATION: HEARTBEAT-only predicate would miss poll-marker TASK_START", () => {
    const poll = {
      type: "TASK_START",
      action: `Task started: ${OPENCLAW_HEARTBEAT_POLL_MARKER}`,
    }
    expect(isHeartbeatShapedActivity(poll)).toBe(true)
    // HEARTBEAT-only (pre-P2.1) would reject this - lock that gap closed.
    expect(poll.type === "HEARTBEAT").toBe(false)
  })
})

describe("decideMissedWake - HIBERNATED past nextHeartbeatAt", () => {
  it("fires on July fixture shape (HIBERNATED + past hint + no boot)", () => {
    // Fixture: armed for 08:00Z, still HIBERNATED at 08:20Z, never woke.
    const nextHeartbeatAt = new Date("2026-07-20T08:00:00.000Z")
    const nowMs = new Date("2026-07-20T08:20:00.000Z").getTime()
    const result = decideMissedWake({
      workspaceStatus: "HIBERNATED",
      nextHeartbeatAt,
      hasBootSinceExpected: false,
      currentFlag: null,
      nowMs,
    })
    expect(result).toBeInstanceOf(Date)
  })

  it("does not fire inside grace after nextHeartbeatAt", () => {
    const nextHeartbeatAt = new Date("2026-07-20T08:00:00.000Z")
    const nowMs = new Date("2026-07-20T08:05:00.000Z").getTime()
    const result = decideMissedWake({
      workspaceStatus: "HIBERNATED",
      nextHeartbeatAt,
      hasBootSinceExpected: false,
      currentFlag: null,
      nowMs,
    })
    expect(result).toBeUndefined()
  })

  it("P2.3: grace-edge (exactly expected+grace) flags", () => {
    const nextHeartbeatAt = new Date("2026-07-20T08:00:00.000Z")
    const nowMs = new Date("2026-07-20T08:10:00.000Z").getTime() // == expected+10m
    const result = decideMissedWake({
      workspaceStatus: "HIBERNATED",
      nextHeartbeatAt,
      hasBootSinceExpected: false,
      currentFlag: null,
      nowMs,
    })
    expect(result).toBeInstanceOf(Date)
  })

  it("sticky miss: boot does not clear an existing heartbeatMissedAt", () => {
    const flag = new Date("2026-07-20T08:12:00.000Z")
    const result = decideMissedWake({
      workspaceStatus: "HIBERNATED",
      nextHeartbeatAt: new Date("2026-07-20T08:00:00.000Z"),
      hasBootSinceExpected: true,
      currentFlag: flag,
      nowMs: new Date("2026-07-20T08:20:00.000Z").getTime(),
    })
    // No-op - keep sticky flag (beat evidence clears via activity roller only).
    expect(result).toBeUndefined()
  })

  it("boot without existing flag → no new missed-wake flag", () => {
    const result = decideMissedWake({
      workspaceStatus: "HIBERNATED",
      nextHeartbeatAt: new Date("2026-07-20T08:00:00.000Z"),
      hasBootSinceExpected: true,
      currentFlag: null,
      nowMs: new Date("2026-07-20T08:20:00.000Z").getTime(),
    })
    expect(result).toBeUndefined()
  })

  it("ignores non-HIBERNATED statuses", () => {
    const result = decideMissedWake({
      workspaceStatus: "RUNNING",
      nextHeartbeatAt: new Date("2026-07-20T08:00:00.000Z"),
      hasBootSinceExpected: false,
      currentFlag: null,
      nowMs: new Date("2026-07-20T08:20:00.000Z").getTime(),
    })
    expect(result).toBeUndefined()
  })

  it("sticky miss: non-HIBERNATED / in-grace never clearIfSet", () => {
    const sticky = new Date("2026-07-20T08:01:00.000Z")
    const running = decideMissedWake({
      workspaceStatus: "RUNNING",
      nextHeartbeatAt: new Date("2026-07-20T08:00:00.000Z"),
      hasBootSinceExpected: false,
      currentFlag: sticky,
      nowMs: new Date("2026-07-20T08:20:00.000Z").getTime(),
    })
    expect(running).toBeUndefined()

    const inGrace = decideMissedWake({
      workspaceStatus: "HIBERNATED",
      nextHeartbeatAt: new Date("2026-07-20T08:00:00.000Z"),
      hasBootSinceExpected: false,
      currentFlag: sticky,
      nowMs: new Date("2026-07-20T08:05:00.000Z").getTime(),
    })
    expect(inGrace).toBeUndefined()
  })

  it("ERROR past window still flags (failed wake stays in Watchtower)", () => {
    const result = decideMissedWake({
      workspaceStatus: "ERROR",
      nextHeartbeatAt: new Date("2026-07-20T08:00:00.000Z"),
      hasBootSinceExpected: false,
      currentFlag: null,
      nowMs: new Date("2026-07-20T08:20:00.000Z").getTime(),
    })
    expect(result).toBeInstanceOf(Date)
  })

  it("MUTATION: 9-day silence still flags (no 48h max-age no-op)", () => {
    const src = readFileSync(join(__dirname, "../next-heartbeat.ts"), "utf8")
    const fn = src.match(
      /export function decideMissedWake\([\s\S]*?^export function decideWokeLateNeverBeat/m,
    )?.[0]
    expect(fn).toBeTruthy()
    expect(fn).not.toContain("HEARTBEAT_MISS_MAX_AGE_MS")
    const result = decideMissedWake({
      workspaceStatus: "ERROR",
      nextHeartbeatAt: new Date("2026-08-18T12:00:00.000Z"),
      hasBootSinceExpected: false,
      currentFlag: null,
      nowMs: new Date("2026-09-09T00:00:00.000Z").getTime(),
    })
    expect(result).toBeInstanceOf(Date)
  })
})

describe("decideWokeLateNeverBeat - post-cron boot without beat", () => {
  const expectedAt = new Date("2026-07-24T08:00:00.000Z")
  const bootAt = new Date("2026-07-24T08:20:02.000Z")

  it("post-cron boot + no beat after boot+grace′ → flag", () => {
    const nowMs = bootAt.getTime() + WOKE_LATE_CATCHUP_GRACE_MS
    const result = decideWokeLateNeverBeat({
      expectedAt,
      bootAt,
      hasBeatEvidenceByDeadline: false,
      currentFlag: null,
      nowMs,
    })
    expect(result).toBeInstanceOf(Date)
  })

  it("post-cron boot + catch-up beat within grace′ → no flag", () => {
    const nowMs = bootAt.getTime() + WOKE_LATE_CATCHUP_GRACE_MS
    const result = decideWokeLateNeverBeat({
      expectedAt,
      bootAt,
      hasBeatEvidenceByDeadline: true,
      currentFlag: null,
      nowMs,
    })
    expect(result).toBeUndefined()
  })

  it("still inside grace′ → no flag (do not race catch-up)", () => {
    const nowMs = bootAt.getTime() + WOKE_LATE_CATCHUP_GRACE_MS - 1
    const result = decideWokeLateNeverBeat({
      expectedAt,
      bootAt,
      hasBeatEvidenceByDeadline: false,
      currentFlag: null,
      nowMs,
    })
    expect(result).toBeUndefined()
  })

  it("pre-cron boot → no flag (Watchtower owns in-window miss)", () => {
    const preBoot = new Date("2026-07-24T07:58:00.000Z")
    const result = decideWokeLateNeverBeat({
      expectedAt,
      bootAt: preBoot,
      hasBeatEvidenceByDeadline: false,
      currentFlag: null,
      nowMs: expectedAt.getTime() + 20 * 60 * 1000,
    })
    expect(result).toBeUndefined()
  })

  it("sticky: existing flag → keep (return existing), never clear", () => {
    const sticky = new Date("2026-07-24T08:25:00.000Z")
    const result = decideWokeLateNeverBeat({
      expectedAt,
      bootAt,
      hasBeatEvidenceByDeadline: false,
      currentFlag: sticky,
      nowMs: bootAt.getTime() + WOKE_LATE_CATCHUP_GRACE_MS,
    })
    expect(result).toEqual(sticky)
  })

  it("grace′ is 5 minutes (exceeds catch-up fire time)", () => {
    expect(WOKE_LATE_CATCHUP_GRACE_MS).toBe(5 * 60 * 1000)
    expect(WOKE_LATE_CATCHUP_GRACE_MS).toBeLessThan(HEARTBEAT_MISS_GRACE_MS)
  })

  it("activation guard: expected fire predating deployment completedAt → no flag (fresh-deploy boot is not a late wake)", () => {
    // D6 shape: deploy boot 14:44:33Z postdates the back-projected Aug-21T19:00Z
    // occurrence, so without the guard this detector flags every fresh deploy
    // of a cron whose occurrence already passed.
    const backProjected = new Date("2026-08-21T19:00:00.000Z")
    const deployBoot = new Date("2026-08-22T14:44:33.000Z")
    const guarded = decideWokeLateNeverBeat({
      expectedAt: backProjected,
      bootAt: deployBoot,
      hasBeatEvidenceByDeadline: false,
      currentFlag: null,
      nowMs: deployBoot.getTime() + WOKE_LATE_CATCHUP_GRACE_MS,
      scheduleActivatedAt: new Date("2026-08-22T14:44:47.000Z"),
    })
    expect(guarded).toBeUndefined()

    // MUTATION: guard dropped → the same shape flags.
    const unguarded = decideWokeLateNeverBeat({
      expectedAt: backProjected,
      bootAt: deployBoot,
      hasBeatEvidenceByDeadline: false,
      currentFlag: null,
      nowMs: deployBoot.getTime() + WOKE_LATE_CATCHUP_GRACE_MS,
    })
    expect(unguarded).toBeInstanceOf(Date)
  })
})

describe("backfill plan idempotency", () => {
  it("same now → same nextHeartbeatAt (idempotent)", () => {
    const cron = JSON.stringify([
      { schedule: { kind: "cron", expr: "0 8 * * *", tz: "UTC" } },
    ])
    const now = new Date("2026-07-20T12:00:00.000Z")
    const a = computeNextHeartbeatAt({
      now,
      heartbeatCronExpressions: cron,
      heartbeatIntervalMs: null,
    })
    const b = computeNextHeartbeatAt({
      now,
      heartbeatCronExpressions: cron,
      heartbeatIntervalMs: null,
    })
    expect(a!.toISOString()).toBe(b!.toISOString())
    expect(a!.toISOString()).toBe("2026-07-21T08:00:00.000Z")
  })
})

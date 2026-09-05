import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  countOpenTasks,
  decideMissionAwareHibernate,
  isInsideMissionWindow,
  MISSION_WINDOW_MAX_MS,
} from "@/lib/hibernation/mission-idle"

const CRON = JSON.stringify([
  { schedule: { kind: "cron", expr: "0 8 * * *", tz: "UTC" } },
  { schedule: { kind: "cron", expr: "0 12,16,20 * * *", tz: "UTC" } },
])

describe("decideMissionAwareHibernate", () => {
  it("MUTATION: chat-only idle with active subagents → hibernates → fail", () => {
    expect(
      decideMissionAwareHibernate({
        chatIdle: true,
        hasInFlightRuns: true,
        insideMissionWindow: false,
      }),
    ).toBe(false)
    expect(
      decideMissionAwareHibernate({
        chatIdle: true,
        hasInFlightRuns: false,
        insideMissionWindow: true,
      }),
    ).toBe(false)
    expect(
      decideMissionAwareHibernate({
        chatIdle: true,
        hasInFlightRuns: false,
        insideMissionWindow: false,
      }),
    ).toBe(true)
  })

  it("source keeps all three conjuncts (restore chat-only → fail)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/hibernation/mission-idle.ts"),
      "utf8",
    )
    expect(src).toContain("!signals.hasInFlightRuns")
    expect(src).toContain("!signals.insideMissionWindow")
    expect(src).toContain("signals.chatIdle")
    const cron = readFileSync(
      join(process.cwd(), "src/app/api/cron/hibernation/route.ts"),
      "utf8",
    )
    expect(cron).toContain("shouldHibernateMissionAware")
  })
})

describe("isInsideMissionWindow", () => {
  it("08:00 fire stays active at 08:30 and expires after max", () => {
    expect(
      isInsideMissionWindow({
        heartbeatCronExpressions: CRON,
        now: new Date("2026-08-31T08:30:00.000Z"),
      }),
    ).toBe(true)
    expect(
      isInsideMissionWindow({
        heartbeatCronExpressions: CRON,
        now: new Date("2026-08-31T08:01:00.000Z"),
      }),
    ).toBe(true)
    const after = new Date("2026-08-31T08:00:00.000Z").getTime() + MISSION_WINDOW_MAX_MS + 1
    expect(
      isInsideMissionWindow({
        heartbeatCronExpressions: CRON,
        now: new Date(after),
      }),
    ).toBe(false)
  })
})

describe("countOpenTasks", () => {
  it("ignores heartbeat polls and counts unmatched subagent starts", () => {
    expect(
      countOpenTasks([
        { type: "TASK_START", action: "[OpenClaw heartbeat poll]" },
        { type: "TASK_START", action: "Subagent Context", detail: "scout" },
        { type: "TASK_COMPLETE", action: "done" },
      ]),
    ).toBe(0)
    expect(
      countOpenTasks([
        { type: "TASK_START", action: "Subagent Context" },
        { type: "TASK_START", action: "Writer resubmit" },
        { type: "TASK_COMPLETE", action: "one done" },
      ]),
    ).toBe(1)
  })
})

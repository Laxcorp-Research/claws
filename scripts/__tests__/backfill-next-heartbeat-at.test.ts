import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import {
  deriveScheduleFromOrchestrator,
  planAndMaybeApply,
} from "../backfill-next-heartbeat-at"

function makeDb(
  states: Array<{
    workspaceId: string
    nextHeartbeatAt: Date | null
    heartbeatCronExpressions: string | null
    heartbeatInterval: number | null
    workspace: {
      status: string
      name: string
      timezone: string | null
      agents: Array<{
        name: string
        agentSlug: string | null
        heartbeatFrequency: string | null
        heartbeatTime: string | null
        heartbeatMd: string | null
      }>
    }
  }>,
) {
  const update = vi.fn().mockResolvedValue({})
  return {
    containerState: {
      findMany: vi.fn().mockResolvedValue(states),
      update,
    },
  }
}

const FIXTURE_MD = `- cron: "0 8 * * *"
  task: daily_trend_scan
- cron: "0 12,16,20 * * *"
  task: content_cycle
- cron: "0 21 * * *"
  task: daily_analytics`

describe("deriveScheduleFromOrchestrator", () => {
  it("fixture-shaped MD schedule → jobs include 08:00Z cron with OpenClaw id", () => {
    const derived = deriveScheduleFromOrchestrator({
      orchestrator: {
        name: "Twitter Commander",
        agentSlug: "twitter-commander",
        heartbeatFrequency: null,
        heartbeatTime: null,
        heartbeatMd: FIXTURE_MD,
      },
      timezone: "UTC",
    })
    expect(derived.source).toBe("agent-schedule")
    expect(derived.cronJson).toContain("0 8 * * *")
    expect(derived.cronJson).toContain('"id"')
    expect(derived.cronJson).toContain("session:agent:twitter-commander:main")
    expect(derived.intervalMs).toBeNull()
  })

  it("Builder daily frequency wins over MD lines", () => {
    const derived = deriveScheduleFromOrchestrator({
      orchestrator: {
        name: "Twitter Commander",
        agentSlug: "twitter-commander",
        heartbeatFrequency: "daily",
        heartbeatTime: "08:00",
        heartbeatMd: FIXTURE_MD,
      },
      timezone: "UTC",
    })
    expect(derived.source).toBe("agent-schedule")
    const jobs = JSON.parse(derived.cronJson!) as Array<{ schedule: { expr: string } }>
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.schedule.expr).toBe("0 8 * * *")
  })
})

describe("backfill-next-heartbeat-at", () => {
  const cron = JSON.stringify([
    {
      id: "heartbeat-x-daily",
      name: "orchestrator-heartbeat-daily",
      schedule: { kind: "cron", expr: "0 8 * * *", tz: "UTC" },
      agentId: "x",
      sessionTarget: "session:agent:x:main",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "Heartbeat." },
      enabled: true,
      deleteAfterRun: false,
      description: "x",
    },
  ])
  const now = new Date("2026-07-20T12:00:00.000Z")

  it("computes next hint for DB-scheduled claw", async () => {
    const db = makeDb([
      {
        workspaceId: "ws-db",
        nextHeartbeatAt: null,
        heartbeatCronExpressions: cron,
        heartbeatInterval: null,
        workspace: {
          status: "HIBERNATED",
          name: "db",
          timezone: "UTC",
          agents: [],
        },
      },
    ])
    const result = await planAndMaybeApply(db, {
      confirm: false,
      now,
      log: () => {},
    })
    expect(result.updated).toBe(1)
    expect(result.rows[0]!.scheduleSource).toBe("db")
    expect(result.rows[0]!.nextHeartbeatAt!.toISOString()).toBe(
      "2026-07-21T08:00:00.000Z",
    )
  })

  it("fixture-shaped agent schedule → nextHeartbeatAt = tomorrow 08:00Z", async () => {
    const db = makeDb([
      {
        workspaceId: "cmr3fo19r000404jlze8o7dm8",
        nextHeartbeatAt: null,
        heartbeatCronExpressions: null,
        heartbeatInterval: null,
        workspace: {
          status: "HIBERNATED",
          name: "fixture",
          timezone: "UTC",
          agents: [
            {
              name: "Twitter Commander",
              agentSlug: "twitter-commander",
              heartbeatFrequency: null,
              heartbeatTime: null,
              heartbeatMd: FIXTURE_MD,
            },
          ],
        },
      },
    ])
    const result = await planAndMaybeApply(db, {
      confirm: true,
      // After the day's last MD cron (21:00Z) → next fire is tomorrow 08:00Z
      // (wake lead is applied by hibernation cron, not stored on the hint).
      now: new Date("2026-07-20T22:00:00.000Z"),
      log: () => {},
    })
    expect(result.updated).toBe(1)
    expect(result.rows[0]!.scheduleSource).toBe("agent-schedule")
    expect(result.rows[0]!.nextHeartbeatAt!.toISOString()).toBe(
      "2026-07-21T08:00:00.000Z",
    )
    expect(db.containerState.update).toHaveBeenCalledWith({
      where: { workspaceId: "cmr3fo19r000404jlze8o7dm8" },
      data: expect.objectContaining({
        nextHeartbeatAt: new Date("2026-07-21T08:00:00.000Z"),
        heartbeatCronExpressions: expect.stringContaining("0 8 * * *"),
      }),
    })
  })

  it("idempotent: already-armed same hint → skipped, no write", async () => {
    const armed = new Date("2026-07-21T08:00:00.000Z")
    const db = makeDb([
      {
        workspaceId: "ws-armed",
        nextHeartbeatAt: armed,
        heartbeatCronExpressions: cron,
        heartbeatInterval: null,
        workspace: {
          status: "HIBERNATED",
          name: "armed",
          timezone: "UTC",
          agents: [],
        },
      },
    ])
    const first = await planAndMaybeApply(db, { confirm: true, now, log: () => {} })
    expect(first.skipped).toBe(1)
    expect(first.updated).toBe(0)
    expect(db.containerState.update).not.toHaveBeenCalled()
  })

  it("MUTATION: #337 snapshot HEARTBEAT.md hydrate must stay removed", () => {
    const src = readFileSync(
      join(process.cwd(), "scripts/backfill-next-heartbeat-at.ts"),
      "utf8",
    )
    expect(src).not.toContain("recoverCronJobsJsonFromSnapshot")
    expect(src).not.toContain("snapshot-heartbeat-md")
    expect(src).not.toContain("gunzipSync")
    expect(src).toContain("deriveScheduleFromOrchestrator")
    expect(src).toContain("resolveHeartbeatSchedule")
  })
})

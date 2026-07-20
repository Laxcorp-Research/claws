import { gzipSync } from "node:zlib"
import { describe, expect, it, vi } from "vitest"
import {
  cronJobsJsonFromExprs,
  extractCronExprsFromHeartbeatMd,
  planAndMaybeApply,
  recoverCronJobsJsonFromSnapshot,
} from "../backfill-next-heartbeat-at"

function makeGzipSnapshot(files: Record<string, string>): Uint8Array {
  const encoded: Record<string, string> = {}
  for (const [path, content] of Object.entries(files)) {
    encoded[path] = Buffer.from(content, "utf8").toString("base64")
  }
  return gzipSync(JSON.stringify({ files: encoded, totalSize: 1 }))
}

function makeDb(
  states: Array<{
    workspaceId: string
    nextHeartbeatAt: Date | null
    heartbeatCronExpressions: string | null
    heartbeatInterval: number | null
    runtimeStateSnapshot: Uint8Array | null
    workspace: { status: string; name: string }
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

describe("HEARTBEAT.md cron recovery", () => {
  it("parses cron lines from HEARTBEAT.md", () => {
    const md = `- cron: "0 8 * * *"
  task: daily_trend_scan
- cron: "0 12,16,20 * * *"
  task: content_cycle`
    expect(extractCronExprsFromHeartbeatMd(md)).toEqual([
      "0 8 * * *",
      "0 12,16,20 * * *",
    ])
    const json = cronJobsJsonFromExprs(extractCronExprsFromHeartbeatMd(md))
    expect(json).toContain("0 8 * * *")
  })

  it("recovers from snapshot HEARTBEAT.md when jobs.json absent", () => {
    const gzip = makeGzipSnapshot({
      "workspace-twitter-commander/HEARTBEAT.md": `- cron: "0 8 * * *"
  task: daily_trend_scan`,
    })
    const recovered = recoverCronJobsJsonFromSnapshot(gzip)
    expect(recovered?.source).toBe("snapshot-heartbeat-md")
    expect(recovered?.json).toContain("0 8 * * *")
  })

  it("prefers cron/jobs.json over HEARTBEAT.md", () => {
    const jobs = JSON.stringify([
      { schedule: { kind: "cron", expr: "3 21 * * *", tz: "UTC" } },
    ])
    const gzip = makeGzipSnapshot({
      "cron/jobs.json": jobs,
      "workspace-x/HEARTBEAT.md": `- cron: "0 8 * * *"`,
    })
    const recovered = recoverCronJobsJsonFromSnapshot(gzip)
    expect(recovered?.source).toBe("snapshot-jobs")
    expect(recovered?.json).toContain("3 21 * * *")
  })
})

describe("backfill-next-heartbeat-at", () => {
  const cron = JSON.stringify([
    { schedule: { kind: "cron", expr: "0 8 * * *", tz: "UTC" } },
  ])
  const now = new Date("2026-07-20T12:00:00.000Z")

  it("computes next hint for DB-scheduled claw", async () => {
    const db = makeDb([
      {
        workspaceId: "ws-db",
        nextHeartbeatAt: null,
        heartbeatCronExpressions: cron,
        heartbeatInterval: null,
        runtimeStateSnapshot: null,
        workspace: { status: "HIBERNATED", name: "db" },
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

  it("hydrates fixture from snapshot HEARTBEAT.md → ~08:00Z", async () => {
    const gzip = makeGzipSnapshot({
      "workspace-twitter-commander/HEARTBEAT.md": `- cron: "0 8 * * *"
  task: daily_trend_scan
- cron: "0 12,16,20 * * *"
  task: content_cycle
- cron: "0 21 * * *"
  task: daily_analytics`,
    })
    const db = makeDb([
      {
        workspaceId: "cmr3fo19r000404jlze8o7dm8",
        nextHeartbeatAt: null,
        heartbeatCronExpressions: null,
        heartbeatInterval: null,
        runtimeStateSnapshot: gzip,
        workspace: { status: "HIBERNATED", name: "fixture" },
      },
    ])
    const result = await planAndMaybeApply(db, {
      confirm: true,
      now: new Date("2026-07-20T05:00:00.000Z"),
      log: () => {},
    })
    expect(result.updated).toBe(1)
    expect(result.rows[0]!.scheduleSource).toBe("snapshot-heartbeat-md")
    expect(result.rows[0]!.nextHeartbeatAt!.toISOString()).toBe(
      "2026-07-20T08:00:00.000Z",
    )
    expect(db.containerState.update).toHaveBeenCalledWith({
      where: { workspaceId: "cmr3fo19r000404jlze8o7dm8" },
      data: expect.objectContaining({
        nextHeartbeatAt: new Date("2026-07-20T08:00:00.000Z"),
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
        runtimeStateSnapshot: null,
        workspace: { status: "HIBERNATED", name: "armed" },
      },
    ])
    const first = await planAndMaybeApply(db, { confirm: true, now, log: () => {} })
    expect(first.skipped).toBe(1)
    expect(first.updated).toBe(0)
    expect(db.containerState.update).not.toHaveBeenCalled()
  })
})

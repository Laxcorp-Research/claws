import { describe, expect, it, vi } from "vitest"
import { planAndMaybeApply } from "../backfill-next-heartbeat-at"

function makeDb(states: Array<{
  workspaceId: string
  nextHeartbeatAt: Date | null
  heartbeatCronExpressions: string | null
  heartbeatInterval: number | null
  workspace: { status: string; name: string }
}>) {
  const update = vi.fn().mockResolvedValue({})
  return {
    containerState: {
      findMany: vi.fn().mockResolvedValue(states),
      update,
    },
  }
}

describe("backfill-next-heartbeat-at", () => {
  const cron = JSON.stringify([
    { schedule: { kind: "cron", expr: "0 8 * * *", tz: "UTC" } },
  ])
  const now = new Date("2026-07-20T12:00:00.000Z")

  it("computes next hint for HIBERNATED claw (fixture shape)", async () => {
    const db = makeDb([
      {
        workspaceId: "cmr3fo19r000404jlze8o7dm8",
        nextHeartbeatAt: null,
        heartbeatCronExpressions: cron,
        heartbeatInterval: null,
        workspace: { status: "HIBERNATED", name: "fixture" },
      },
    ])
    const result = await planAndMaybeApply(db, {
      confirm: false,
      now,
      log: () => {},
    })
    expect(result.mode).toBe("dry-run")
    expect(result.updated).toBe(1)
    expect(result.rows[0]!.nextHeartbeatAt!.toISOString()).toBe(
      "2026-07-21T08:00:00.000Z",
    )
    expect(db.containerState.update).not.toHaveBeenCalled()
  })

  it("idempotent: already-armed same hint → skipped, no write", async () => {
    const armed = new Date("2026-07-21T08:00:00.000Z")
    const db = makeDb([
      {
        workspaceId: "ws-armed",
        nextHeartbeatAt: armed,
        heartbeatCronExpressions: cron,
        heartbeatInterval: null,
        workspace: { status: "HIBERNATED", name: "armed" },
      },
    ])
    const first = await planAndMaybeApply(db, { confirm: true, now, log: () => {} })
    expect(first.skipped).toBe(1)
    expect(first.updated).toBe(0)
    expect(db.containerState.update).not.toHaveBeenCalled()

    const second = await planAndMaybeApply(db, { confirm: true, now, log: () => {} })
    expect(second.skipped).toBe(1)
    expect(db.containerState.update).not.toHaveBeenCalled()
  })

  it("applies write when confirm=yes and hint differs", async () => {
    const db = makeDb([
      {
        workspaceId: "ws-write",
        nextHeartbeatAt: null,
        heartbeatCronExpressions: cron,
        heartbeatInterval: null,
        workspace: { status: "RUNNING", name: "live" },
      },
    ])
    const result = await planAndMaybeApply(db, { confirm: true, now, log: () => {} })
    expect(result.mode).toBe("applied")
    expect(result.updated).toBe(1)
    expect(db.containerState.update).toHaveBeenCalledWith({
      where: { workspaceId: "ws-write" },
      data: { nextHeartbeatAt: new Date("2026-07-21T08:00:00.000Z") },
    })
  })
})

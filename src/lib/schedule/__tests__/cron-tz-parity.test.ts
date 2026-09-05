import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { calculateNextHeartbeat } from "@/lib/hibernation/next-heartbeat"
import { buildCronJobsFromHeartbeatMd } from "@/lib/openclaw/heartbeat-md-cron"
import { emitHeartbeatJobs, scheduleToCronExprs } from "@/lib/schedule/emit"
import {
  cronTzOrUtc,
  formatCronWallLabel,
  labelClaimsUtc,
} from "@/lib/schedule/cron-tz"
import type { ScheduleValue } from "@/lib/schedule/types"

const FROM = new Date("2026-08-31T00:00:00.000Z")

describe("B-3 cron tz parity", () => {
  it("Dubai authored 08:00 GMT+4 fires 04:00Z and platform expects 04:00Z", () => {
    const value: ScheduleValue = { mode: "daily", time: "08:00", tz: "Asia/Dubai" }
    const planned = scheduleToCronExprs(value, "UTC")
    expect(planned[0]?.tz).toBe("Asia/Dubai")
    expect(planned[0]?.expr).toBe("0 8 * * *")

    const jobs = emitHeartbeatJobs({
      value,
      timezone: "UTC",
      orchestratorAgentSlug: "twitter-commander",
    })
    const next = calculateNextHeartbeat(JSON.stringify(jobs), FROM)
    expect(next?.toISOString()).toBe("2026-08-31T04:00:00.000Z")
    expect(formatCronWallLabel("0 8 * * *", "Asia/Dubai")).toBe("08:00 Asia/Dubai")
    expect(labelClaimsUtc(formatCronWallLabel("0 8 * * *", "Asia/Dubai"))).toBe(false)
  })

  it("template UTC HEARTBEAT.md 08:00 fires 08:00Z even if workspace is Dubai", () => {
    const jobs = buildCronJobsFromHeartbeatMd({
      heartbeatMd: "## window 0 8 * * *\n1. Work.\n",
      orchestratorAgentSlug: "twitter-commander",
      timezone: "Asia/Dubai",
    })
    expect(jobs[0]?.schedule.tz).toBe("UTC")
    const next = calculateNextHeartbeat(JSON.stringify(jobs), FROM)
    expect(next?.toISOString()).toBe("2026-08-31T08:00:00.000Z")
    expect(jobs[0]?.payload.message).toContain("08:00 UTC")
    expect(jobs[0]?.payload.message).not.toContain("08:00 Asia/Dubai")
  })

  it("MUTATION: TZ drift restored (workspace tz on unstamped daily) fails", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/schedule/emit.ts"), "utf8")
    expect(src).toContain("void _workspaceTimezone")
    expect(src).not.toMatch(/tz: wsTz/)
    expect(src).toContain("resolveAuthoredCronTz")
    const unstamped = scheduleToCronExprs({ mode: "daily", time: "08:00" }, "Asia/Dubai")
    expect(unstamped[0]?.tz).toBe("UTC")
  })

  it("missing job tz is UTC on the platform roller", () => {
    expect(cronTzOrUtc(undefined)).toBe("UTC")
    const next = calculateNextHeartbeat(
      JSON.stringify([{ schedule: { kind: "cron", expr: "0 8 * * *" } }]),
      FROM,
    )
    expect(next?.toISOString()).toBe("2026-08-31T08:00:00.000Z")
  })
})

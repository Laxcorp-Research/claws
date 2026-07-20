import { describe, expect, it } from "vitest"
import { resolveHeartbeatSchedule } from "@/lib/openclaw/generator"

const SLUG = "twitter-commander"
const FIXTURE_MD = `- cron: "0 8 * * *"
  task: daily_trend_scan
- cron: "0 21 * * *"
  task: daily_analytics`

describe("resolveHeartbeatSchedule", () => {
  it("frequency daily wins — single cronJob, no mdCronJobs", () => {
    const r = resolveHeartbeatSchedule("daily", "08:00", "UTC", SLUG, FIXTURE_MD)
    expect(r?.cronJob?.schedule.expr).toBe("0 8 * * *")
    expect(r?.mdCronJobs).toBeUndefined()
  })

  it("null frequency + MD → mdCronJobs with 08:00 entry", () => {
    const r = resolveHeartbeatSchedule(null, null, "UTC", SLUG, FIXTURE_MD)
    expect(r?.cronJob).toBeUndefined()
    expect(r?.mdCronJobs?.map((j) => j.schedule.expr)).toEqual([
      "0 8 * * *",
      "0 21 * * *",
    ])
  })

  it("explicit off suppresses MD cron emission", () => {
    const r = resolveHeartbeatSchedule("off", null, "UTC", SLUG, FIXTURE_MD)
    expect(r).toBeNull()
  })
})

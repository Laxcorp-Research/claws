import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { buildCronJobsFromHeartbeatMd } from "@/lib/openclaw/heartbeat-md-cron"

describe("P2.2 heartbeat single-source", () => {
  it("MD cron lines become OpenClaw-shaped jobs (id + sessionTarget)", () => {
    const jobs = buildCronJobsFromHeartbeatMd({
      heartbeatMd: `- cron: "0 8 * * *"
  task: daily_trend_scan`,
      orchestratorAgentSlug: "twitter-commander",
      timezone: "UTC",
    })
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.schedule.expr).toBe("0 8 * * *")
    expect(jobs[0]!.id).toContain("twitter-commander")
    expect(jobs[0]!.sessionTarget).toBe("session:agent:twitter-commander:main")
    expect(jobs[0]!.name.startsWith("orchestrator-heartbeat-")).toBe(true)
  })

  it("window heading jobs address the matching HEARTBEAT.md section", () => {
    const jobs = buildCronJobsFromHeartbeatMd({
      heartbeatMd: `## window 0 21 * * *\n1. Wake.\n2. Measure.\n3. Recap.\nDeliverable: recap.md\n`,
      orchestratorAgentSlug: "twitter-commander",
      timezone: "UTC",
    })
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.payload.message).toContain('## window 0 21 * * *')
    expect(jobs[0]!.schedule.expr).toBe("0 21 * * *")
  })

  it("MUTATION: deploy must store cols from generated config only (no HEARTBEAT.md hydrate)", () => {
    const deployer = readFileSync(
      join(process.cwd(), "src/lib/openclaw/deployer.ts"),
      "utf8",
    )
    // Single source: cols come from generated['cron/jobs.json'] / openclaw.json.
    expect(deployer).toContain("generated['cron/jobs.json']")
    expect(deployer).toContain("extractHeartbeatIntervalMsFromOpenclawJson")
    // Re-adding #337-style MD hydrate in deploy would fail this guard.
    expect(deployer).not.toContain("extractCronExprsFromHeartbeatMd")
    expect(deployer).not.toContain("recoverCronJobsJsonFromSnapshot")
    expect(deployer).not.toMatch(/HEARTBEAT\.md[\s\S]{0,80}heartbeatCronExpressions/)
  })
})

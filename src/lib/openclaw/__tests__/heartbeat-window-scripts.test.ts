import { describe, expect, it } from "vitest"
import { ALL_TEMPLATES } from "../../../../prisma/seed-data"
import {
  buildCronJobsFromHeartbeatMd,
  heartbeatPayloadMessage,
  heartbeatWindowHeading,
  parseHeartbeatWindowScripts,
} from "@/lib/openclaw/heartbeat-md-cron"

describe("INFRA-4 HEARTBEAT window scripts", () => {
  it("every template window parses to >=3 steps and a deliverable line", () => {
    expect(ALL_TEMPLATES).toHaveLength(20)
    for (const tmpl of ALL_TEMPLATES) {
      const orch = tmpl.agents.find((a) => a.role === "ORCHESTRATOR")
      expect(orch, tmpl.slug).toBeDefined()
      const scripts = parseHeartbeatWindowScripts(orch!.heartbeatMd)
      expect(scripts.length, tmpl.slug).toBeGreaterThan(0)
      for (const script of scripts) {
        expect(script.cron.length, `${tmpl.slug} ${script.cron}`).toBeGreaterThan(0)
        expect(script.steps.length, `${tmpl.slug} ${script.cron}`).toBeGreaterThanOrEqual(3)
        expect(script.deliverable.length, `${tmpl.slug} ${script.cron}`).toBeGreaterThan(0)
      }
    }
  })

  it("MUTATION: label-only window restored → fails the script bar", () => {
    const restored = `## window 0 8 * * *
- cron: "0 8 * * *"
  task: daily_trend_scan
  description: Scan trends and identify content opportunities`
    const scripts = parseHeartbeatWindowScripts(restored)
    expect(scripts).toHaveLength(1)
    const [script] = scripts
    const passesBar = script.steps.length >= 3 && script.deliverable.length > 0
    expect(passesBar).toBe(false)
  })

  it("regulated-six windows keep compliance rails in the script", () => {
    const md = (slug: string) =>
      ALL_TEMPLATES.find((t) => t.slug === slug)!.agents.find((a) => a.role === "ORCHESTRATOR")!
        .heartbeatMd
    expect(md("medical-practice-manager")).toMatch(/consent note/i)
    expect(md("medical-practice-manager")).toMatch(/Never visit reason|no clinical/i)
    expect(md("law-firm-intake-os")).toMatch(/does not constitute legal advice|Never advise/i)
    expect(md("real-estate-agent-os")).toMatch(/Fair Housing/i)
    expect(md("home-services-dispatcher")).toMatch(/911 first/i)
    expect(md("student-accelerator")).toMatch(/ghostwriting|academic-integrity/i)
    expect(md("b2b-sales-machine")).toMatch(/CAN-SPAM/i)
  })

  it("cron payload names the window section (runtime ground truth)", () => {
    const expr = "0 8 * * *"
    const md = `## window ${expr}\n1. Wake.\n2. Tools.\n3. Delegate.\nDeliverable: x.md\n`
    const jobs = buildCronJobsFromHeartbeatMd({
      heartbeatMd: md,
      orchestratorAgentSlug: "twitter-commander",
      timezone: "UTC",
    })
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.payload.message).toBe(heartbeatPayloadMessage(expr))
    expect(jobs[0]!.payload.message).toContain(heartbeatWindowHeading(expr))
    expect(jobs[0]!.payload.message).toContain("HEARTBEAT_OK")
  })
})

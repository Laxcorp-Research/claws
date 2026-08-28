import { describe, expect, it } from "vitest"
import {
  ALL_TEMPLATES,
  FORMERLY_EMPTY_TEMPLATE_SLUGS,
  TEMPLATE_SPEC_CRONS,
} from "../../../../prisma/seed-data"
import { extractCronExprsFromHeartbeatMd } from "@/lib/openclaw/heartbeat-md-cron"
import { hydrateSchedule } from "@/lib/schedule/hydrate"

describe("hydration from all 20 template seeds", () => {
  it("has 20 templates", () => {
    expect(ALL_TEMPLATES).toHaveLength(20)
  })

  it("each orchestrator HEARTBEAT.md hydrates to a selected editor value (never custom banner)", () => {
    for (const tmpl of ALL_TEMPLATES) {
      const orch = tmpl.agents.find((a) => a.role === "ORCHESTRATOR")
      expect(orch, tmpl.slug).toBeDefined()
      const value = hydrateSchedule({
        heartbeatFrequency: null,
        heartbeatTime: null,
        heartbeatMd: orch!.heartbeatMd,
        timezone: "UTC",
      })
      const hasCron =
        /cron:\s*"/.test(orch!.heartbeatMd) ||
        /^## window[ \t]+/m.test(orch!.heartbeatMd)
      if (hasCron) {
        expect(value.mode, tmpl.slug).not.toBe("off")
        if (value.mode === "times") {
          expect(value.slots.length, tmpl.slug).toBeGreaterThan(0)
        }
        if (value.mode === "cron") {
          expect(value.expressions.length, tmpl.slug).toBeGreaterThan(0)
        }
      } else {
        expect(value.mode, tmpl.slug).toBe("off")
      }
    }
  })

  it("multi-window seeds become Custom times rows", () => {
    const twitter = ALL_TEMPLATES.find((t) => t.slug.includes("twitter") || t.slug.includes("x-growth"))
    const withWindows = twitter ?? ALL_TEMPLATES.find((t) => {
      const orch = t.agents.find((a) => a.role === "ORCHESTRATOR")
      return (orch?.heartbeatMd.match(/cron:\s*"/g) ?? []).length >= 2
    })
    expect(withWindows).toBeDefined()
    const orch = withWindows!.agents.find((a) => a.role === "ORCHESTRATOR")!
    const value = hydrateSchedule({ heartbeatMd: orch.heartbeatMd, timezone: "UTC" })
    expect(value.mode === "times" || value.mode === "cron").toBe(true)
    if (value.mode === "times") {
      expect(value.slots.length).toBeGreaterThan(1)
    }
  })

  it("9 formerly-empty templates hydrate to ON with their spec'd schedules", () => {
    expect(FORMERLY_EMPTY_TEMPLATE_SLUGS).toHaveLength(9)
    for (const slug of FORMERLY_EMPTY_TEMPLATE_SLUGS) {
      const tmpl = ALL_TEMPLATES.find((t) => t.slug === slug)
      expect(tmpl, slug).toBeDefined()
      const orch = tmpl!.agents.find((a) => a.role === "ORCHESTRATOR")
      expect(orch, slug).toBeDefined()
      const exprs = extractCronExprsFromHeartbeatMd(orch!.heartbeatMd)
      expect(exprs, slug).toEqual(TEMPLATE_SPEC_CRONS[slug])
      expect(exprs.length, slug).toBeGreaterThan(0)
      const value = hydrateSchedule({
        heartbeatFrequency: null,
        heartbeatTime: null,
        heartbeatMd: orch!.heartbeatMd,
        timezone: "UTC",
      })
      expect(value.mode, slug).not.toBe("off")
    }
  })
})

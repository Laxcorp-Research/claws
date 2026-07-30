import { describe, expect, it } from "vitest"
import { ALL_TEMPLATES } from "../../prisma/seed-data"
import { REGULATED_TEMPLATE_SLUGS } from "@/lib/openclaw/regulated-threshold-floor"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * WIRE-FULL PR-3: seeds are native citizens of the canvas contract.
 * MUTATION: re-add worker→critic in buildConnections → fails.
 */
describe("seed template topology (WIRE-FULL)", () => {
  it("has exactly 20 templates", () => {
    expect(ALL_TEMPLATES).toHaveLength(20)
  })

  it("every solid edge is orch→worker by role; zero worker→critic / critic→*", () => {
    for (const template of ALL_TEMPLATES) {
      const bySlug = new Map(template.agents.map((a) => [a.agentSlug, a]))
      expect(template.connections.length).toBeGreaterThan(0)
      for (const c of template.connections) {
        expect(c.condition).toBe("ON_COMPLETE")
        const src = bySlug.get(c.sourceSlug)
        const tgt = bySlug.get(c.targetSlug)
        expect(src, `${template.slug}: missing source ${c.sourceSlug}`).toBeTruthy()
        expect(tgt, `${template.slug}: missing target ${c.targetSlug}`).toBeTruthy()
        expect(src!.role).toBe("ORCHESTRATOR")
        expect(tgt!.role).toBe("WORKER")
      }
    }
  })

  it("regulated critics seed qualityThreshold ≥ 8 (via seed.ts projection default)", () => {
    // Critic agents may omit the field in SeedAgent; seed.ts defaults CRITIC → 8.
    for (const slug of REGULATED_TEMPLATE_SLUGS) {
      const template = ALL_TEMPLATES.find((t) => t.slug === slug)
      expect(template, slug).toBeTruthy()
      const critic = template!.agents.find((a) => a.role === "CRITIC")
      expect(critic, `${slug} critic`).toBeTruthy()
      const threshold = critic!.qualityThreshold ?? 8
      expect(threshold).toBeGreaterThanOrEqual(8)
    }
  })

  it("MUTATION: buildConnections must not emit worker→critic", () => {
    const src = readFileSync(
      join(process.cwd(), "prisma/seed-data/soul-generators.ts"),
      "utf8",
    )
    expect(src).toContain("WIRE-FULL: solid edges are ORCH→WORKER only")
    // The old pattern pushed worker → critic inside the loop.
    expect(src).not.toMatch(/sourceSlug:\s*w[\s\S]{0,40}targetSlug:\s*criticSlug/)
  })
})

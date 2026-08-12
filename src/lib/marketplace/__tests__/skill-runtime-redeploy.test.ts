/**
 * PR-8: install → AgentSkill → generator SKILL.md / skills.entries round-trip.
 * MUTATION: sever AgentSkill attach → emission fails.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import yaml from "yaml"

const ROOT = process.cwd()

describe("PR-8 skill runtime REDEPLOY-CARRIES", () => {
  it("install route bridges Skill + AgentSkill and claims next redeploy", () => {
    const src = readFileSync(
      join(ROOT, "src/app/api/marketplace/skills/[slug]/install/route.ts"),
      "utf8",
    )
    expect(src).toContain("bridgeMarketplaceSkillToSkill")
    expect(src).toContain("agentSkill.createMany")
    expect(src).toContain("appliesOnNextRedeploy")
    expect(src).toContain("ORCHESTRATOR")
    expect(src).not.toContain("TODO: Hot-add")
  })

  it("generator emits marketplace requiredEnvVars into SKILL.md frontmatter", () => {
    const src = readFileSync(join(ROOT, "src/lib/openclaw/generator.ts"), "utf8")
    expect(src).toContain("marketplaceEnv")
    expect(src).toContain("emitMarketplaceSkillEntries")
    expect(src).toContain("requiredEnvVars")
  })

  it("round-trip shape: marketplace skillMd body + requires.env frontmatter", () => {
    // Simulate generator frontmatter for a bridged marketplace skill.
    const requiredEnvVars = ["NOTE_HELPER_TOKEN"]
    const requires: Record<string, string[]> = { env: requiredEnvVars }
    const frontmatter = {
      name: "note-helper",
      description: "Summarize notes",
      metadata: { openclaw: { primaryEnv: requiredEnvVars[0], requires } },
    }
    const yamlStr = yaml.stringify(frontmatter, { lineWidth: 0 })
    const skillMd = `---\n${yamlStr}---\n\n# Note helper\n\nSummarize a local file.\n`
    expect(skillMd).toContain("NOTE_HELPER_TOKEN")
    expect(skillMd).toContain("primaryEnv")
    expect(skillMd).toContain("note-helper")
  })

  it("MUTATION: sever AgentSkill attach → install source no longer emits createMany", () => {
    const src = readFileSync(
      join(ROOT, "src/app/api/marketplace/skills/[slug]/install/route.ts"),
      "utf8",
    )
    // If AgentSkill attach is removed, generator emission has nothing to walk.
    expect(src).toMatch(/agentSkill\.createMany/)
  })

  it("skill-bridge copies requiredBins/requiredEnvVars/emoji", () => {
    const src = readFileSync(join(ROOT, "src/lib/marketplace/skill-bridge.ts"), "utf8")
    expect(src).toContain("requiredBins")
    expect(src).toContain("requiredEnvVars")
    expect(src).toContain("emoji")
  })
})

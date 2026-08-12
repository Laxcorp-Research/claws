import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { buildSandboxReport } from "@/lib/marketplace/sandbox-grade"
import {
  isJailExecutionReport,
  isPinnedOpenclawRuntimeImage,
  isSimulatedSandboxReport,
} from "@/lib/marketplace/sandbox-jail"
import { resolveCommunityApprovedTrustTier } from "@/lib/marketplace/public-visibility"

const ROOT = process.cwd()
const PINNED = "ghcr.io/laxcorp-research/openclaw-runtime:2026.5.22-4"

function jailReport(overrides: Partial<Parameters<typeof buildSandboxReport>[0]> = {}) {
  return buildSandboxReport({
    skillId: "sk-jail",
    contentDigest: "a".repeat(64),
    skillMd: "# ok\n\nNo network.",
    requiredBins: [],
    requiredEnvVars: [],
    dockerImage: PINNED,
    execution: "jail",
    agentTurnText: "Completed checklist. command -v none. Blocked without secrets.",
    agentCompleted: true,
    ...overrides,
  })
}

describe("sandbox jail quality (VERIFIED gate)", () => {
  afterEach(() => {
    delete process.env.SANDBOX_VETTING_ENABLED
  })

  it("accepts pinned openclaw-runtime tags only", () => {
    expect(isPinnedOpenclawRuntimeImage(PINNED)).toBe(true)
    expect(isPinnedOpenclawRuntimeImage("ghcr.io/laxcorp-research/openclaw-runtime:latest")).toBe(
      false,
    )
    expect(isPinnedOpenclawRuntimeImage("e2e-local-grade")).toBe(false)
  })

  it("jail report with real agent turn is mintable shape", () => {
    const report = jailReport()
    expect(report.execution).toBe("jail")
    expect(isJailExecutionReport(report)).toBe(true)
  })

  it("simulated / AGENT_SKIPPED / local image cannot mint", () => {
    const sim = jailReport({
      execution: "simulated",
      dockerImage: "e2e-local-grade",
      agentTurnText: "AGENT_SKIPPED",
      agentCompleted: false,
    })
    expect(isJailExecutionReport(sim)).toBe(false)
    expect(isSimulatedSandboxReport(JSON.stringify(sim))).toBe(true)

    process.env.SANDBOX_VETTING_ENABLED = "true"
    expect(resolveCommunityApprovedTrustTier(true, JSON.stringify(sim))).toBe("SCANNED")
  })

  it("flag on + passed + jail report → VERIFIED", () => {
    process.env.SANDBOX_VETTING_ENABLED = "true"
    const report = jailReport()
    expect(resolveCommunityApprovedTrustTier(true, JSON.stringify(report))).toBe("VERIFIED")
  })

  it("MUTATION: approve must pass sandboxReport into resolve", () => {
    const approve = readFileSync(
      join(ROOT, "src/app/api/admin/review-queue/skills/[id]/approve/route.ts"),
      "utf8",
    )
    expect(approve).toContain("resolveCommunityApprovedTrustTier(")
    expect(approve).toContain("skill.sandboxReport")
    const vis = readFileSync(join(ROOT, "src/lib/marketplace/public-visibility.ts"), "utf8")
    expect(vis).toContain("isJailExecutionReportRaw")
  })

  it("MUTATION: drop jail dockerImage check → fail", () => {
    const src = readFileSync(join(ROOT, "src/lib/marketplace/sandbox-jail.ts"), "utf8")
    expect(src).toContain("isPinnedOpenclawRuntimeImage")
    expect(src).toContain("AGENT_SKIPPED")
    expect(src).toContain('execution === "simulated"')
  })
})

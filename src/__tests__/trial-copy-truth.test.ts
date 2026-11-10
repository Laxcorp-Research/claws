/**
 * PR-2 - honest trial copy for credit × trial-state.
 * MUTATION: hide trial behind creditUser → fail.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.cwd()

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8")
}

describe("trial copy truth (credit × trial-state)", () => {
  const setup = read("src/app/setup/[workspaceId]/step/[n]/page.tsx")
  const dashboard = read("src/app/dashboard/[workspaceId]/page.tsx")
  const billing = read("src/components/settings/billing-dashboard.tsx")
  const emails = read("src/lib/trial/trial-expiry-emails.ts")
  const exhaustion = read("src/lib/credits/exhaustion.ts")

  it("step-4 credit-mode shows BOTH starter-credits AND 3-day platform trial lines", () => {
    expect(setup).toContain("Powered by Claws Starter Credits - no payment needed.")
    expect(setup).toContain(
      "Includes your 3-day platform trial - $79/mo after, cancel anytime",
    )
    // Credits line is gated on creditUser; trial line is NOT.
    expect(setup).toMatch(/\{(?:!selfHost && )?creditUser && \([\s\S]*?Starter Credits/)
    expect(setup).toMatch(
      /\(eligibility\?\.isFirstDeploy \|\| eligibility\?\.reason === "trial_active"\) && \([\s\S]*?Includes your 3-day platform trial/,
    )
    expect(setup).not.toMatch(
      /creditUser\s*\?\s*\([\s\S]*?Starter Credits[\s\S]*?\)\s*:\s*eligibility\?\.isFirstDeploy/,
    )
  })

  it("MUTATION: dashboard trial banners must not be gated on !creditUser", () => {
    // Live predicate (not the mutation-comment that documents the ban).
    expect(dashboard).toMatch(
      /if\s*\(\s*trialInfo\s*&&\s*trialInfo\.trialUsed\s*&&\s*!trialInfo\.hasActiveSubscription\s*\)/,
    )
    expect(dashboard).not.toMatch(
      /if\s*\(\s*!creditUser\s*&&\s*trialInfo/,
    )
    expect(dashboard).toContain("Trial banners apply to credit users too")
  })

  it("billing trial line uses consistent 3-day platform trial language", () => {
    expect(billing).toContain("3-day platform trial on first deploy")
    expect(billing).toContain("$79/mo after")
    expect(billing).toContain("Your 3-day trial has ended")
  })

  it("grep-guard: trial/exhaustion user-facing copy never says paused", () => {
    const surfaces = [emails, exhaustion, billing, setup]
    for (const src of surfaces) {
      // Strip line comments that may document the ban.
      const code = src
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
        .join("\n")
      const htmlish = [
        ...code.matchAll(/subject:\s*"([^"]+)"/g),
        ...code.matchAll(/font-medium">([^<]+)</g),
        ...code.matchAll(/opacity-80">([^<]+)</g),
        ...code.matchAll(/We've stopped[^<`"]+/g),
        ...code.matchAll(/Subscribe to[^<`"]+/g),
        ...code.matchAll(/Includes your 3-day[^<`"]+/g),
      ]
        .map((m) => (m[1] ?? m[0] ?? "").toLowerCase())
        .join("\n")
      expect(htmlish, "user-facing trial/stop copy").not.toMatch(/\bpaused\b/)
    }
  })
})

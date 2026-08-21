/**
 * Batch B source guards.
 * MUTATION: reverse locked wiring → fail.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = process.cwd()
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8")
}

describe("Batch B recurrence guards", () => {
  it("shown-once: User.onboardingCompleted - no new migration field", () => {
    const schema = read("prisma/schema.prisma")
    expect(schema).toMatch(/onboardingCompleted\s+Boolean/)
    // Must not invent a second flag
    expect(schema).not.toMatch(/onboardingShownAt|hasSeenOnboarding/)
  })

  it("proxy redirects incomplete users; settings allowed", () => {
    const src = read("src/proxy.ts")
    expect(src).toContain("isAllowedDuringOnboarding")
    expect(src).toContain("onboardingCompleted")
    expect(src).toContain('/onboarding')
  })

  it("session exposes onboardingCompleted", () => {
    const src = read("src/lib/auth.ts")
    expect(src).toContain("session.onboardingCompleted")
  })

  it("signin uses resolvePostAuthPath (not hardcode /my-claws only)", () => {
    const src = read("src/app/auth/signin/page.tsx")
    expect(src).toContain("resolvePostAuthPath")
    expect(src).not.toMatch(/router\.replace\("\/my-claws"\)/)
  })

  it("onboarding CTAs: settings api-keys + create workspace", () => {
    const src = read("src/components/onboarding/onboarding-client.tsx")
    expect(src).toContain('/settings?tab=api-keys')
    expect(src).toContain('/api/workspaces')
    expect(src).toContain("Create custom Claw")
  })

  it("Stop reconciles via onStopped + status STOPPED", () => {
    const menu = read("src/components/my-claws/workspace-context-menu.tsx")
    expect(menu).toContain("onStopped")
    expect(menu).toContain("Claw stopped")
    const page = read("src/app/my-claws/page.tsx")
    expect(page).toContain("handleStopped")
    const stop = read("src/app/api/deploy/[workspaceId]/stop/route.ts")
    expect(stop).toContain('status: "STOPPED"')
  })

  it("E2E test-session JWT includes onboardingCompleted (proxy gate)", () => {
    const src = read("src/app/api/auth/test-session/route.ts")
    expect(src).toContain("onboardingCompleted")
    expect(src).toContain("VERCEL_ENV")
    expect(src).toContain("onboardingParam === 'false'")
    // MUTATION: omit claim from encode → E2E waitForURL(/my-claws) fails
    const encodeBlock = src.slice(src.indexOf("encode("), src.indexOf("secret:"))
    expect(encodeBlock).toContain("onboardingCompleted")
  })

  it("onboarding page is revisitable from DB truth (stale-cookie escape via allowlist + JWT refresh)", () => {
    const page = read("src/app/onboarding/page.tsx")
    expect(page).toContain("loadOnboardingGate")
    expect(page).toContain("loadGettingStartedTracker")
    // v2: completed users render tracker (no redirect away / no SessionSync bounce).
    expect(page).not.toContain("OnboardingSessionSync")
    expect(page).not.toMatch(/redirect\(\s*["']\/my-claws["']\s*\)/)
    const gate = read("src/lib/auth/onboarding-gate.ts")
    expect(gate).toContain('"revisit"')
    expect(gate).not.toContain('redirectTo: "/my-claws"')
    const client = read("src/components/onboarding/onboarding-client.tsx")
    expect(client).toContain("OnboardingJwtRefresh")
  })

  it("workspace create completes onboarding server-side", () => {
    const src = read("src/app/api/workspaces/route.ts")
    expect(src).toContain("completeOnboardingAfterFirstWorkspace")
    expect(src).toContain('name === "My Claw 1"')
  })
})

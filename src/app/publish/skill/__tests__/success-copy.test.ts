/**
 * B5 — publish success copy must not claim a live marketplace listing.
 * MUTATION: restore "View in Marketplace" / store slug CTA → fail.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = process.cwd()
const TRUTH = "Submitted for review — you'll get an email when it's approved."
const DASHBOARD_CTA = "View in your creator dashboard"
const DASHBOARD_HREF = "/settings?tab=creator"

function assertHonestSuccessScreen(rel: string) {
  const page = readFileSync(join(ROOT, rel), "utf8")
  expect(page).toContain(TRUTH)
  expect(page).toContain(DASHBOARD_CTA)
  expect(page).toContain(`href="${DASHBOARD_HREF}"`)
  expect(page).not.toMatch(/View in Marketplace/i)
  expect(page).not.toMatch(/See in marketplace/i)
  expect(page).not.toMatch(/href=\{`\/store\//)
  expect(page).not.toMatch(/listed immediately/i)
}

describe("publish success screen (B5)", () => {
  it("skill success-screen CTA targets dashboard", () => {
    assertHonestSuccessScreen("src/app/publish/skill/page.tsx")
  })

  it("template success-screen CTA targets dashboard", () => {
    assertHonestSuccessScreen("src/app/publish/template/page.tsx")
  })

  it("MUTATION: marketplace-CTA restored → fails", () => {
    const skill = readFileSync(join(ROOT, "src/app/publish/skill/page.tsx"), "utf8")
    const template = readFileSync(join(ROOT, "src/app/publish/template/page.tsx"), "utf8")
    expect(skill).not.toContain("`/store/skills/${publishedSlug}`")
    expect(template).not.toContain("`/store/${publishedSlug}`")
    expect(skill).not.toMatch(/Sandbox test and manual review queued/i)
    expect(skill).not.toMatch(/\bsandbox\b/i)
  })
})

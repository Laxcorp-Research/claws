// @vitest-environment jsdom
//
// C4-a: outline (transparent + --tx2) still read as a gray label. CTA must be
// filled DS primary at default 11px - never sm, never outline.

import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { WriteReviewButton } from "@/components/marketplace/write-review-button"

afterEach(() => cleanup())

const DEFAULT_SIZE = "text-[11px]"
const SM_SIZE = "text-[10px]"

describe("WriteReviewButton - DS default size", () => {
  it("is visible at default 11px, not sm 10px", () => {
    render(<WriteReviewButton onClick={() => {}} />)
    const btn = screen.getByTestId("write-review-cta")
    expect(btn.getAttribute("hidden")).toBeNull()
    expect(getComputedStyle(btn).display).not.toBe("none")
    expect(getComputedStyle(btn).visibility).not.toBe("hidden")
    expect(btn.textContent).toBe("Write a review")
    expect(btn.className).toContain(DEFAULT_SIZE)
    expect(btn.className).not.toContain(SM_SIZE)
    expect(btn.className).toContain("bg-[var(--tx)]")
    expect(btn.className).toContain("text-white")
    expect(btn.className).not.toContain("text-[var(--tx2)]")
    expect(btn.getAttribute("class")).not.toMatch(/\btext-\[10px\]\b/)
  })

  it("MUTATION: outline or a non-default size on the CTA → fail", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/marketplace/write-review-button.tsx"),
      "utf8",
    )
    expect(src).not.toMatch(/size=["']sm["']/)
    expect(src).not.toMatch(/size=["']lg["']/)
    expect(src).not.toMatch(/size=["']xs["']/)
    expect(src).not.toContain('variant="outline"')
    expect(src).toContain('variant="primary"')
    expect(src).toContain("data-testid=\"write-review-cta\"")
  })

  it("MUTATION: template + skill pages must use WriteReviewButton (not inline sm)", () => {
    const tpl = readFileSync(join(process.cwd(), "src/app/store/[slug]/page.tsx"), "utf8")
    const skill = readFileSync(join(process.cwd(), "src/app/store/skills/[slug]/page.tsx"), "utf8")
    for (const src of [tpl, skill]) {
      expect(src).toContain("WriteReviewButton")
      expect(src).not.toMatch(/Write a review/)
    }
  })
})

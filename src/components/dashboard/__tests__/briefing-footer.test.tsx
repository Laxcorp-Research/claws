// @vitest-environment jsdom
//
// PR-6: the credit-consumed footer. Guards the calm-by-default contract — it
// renders only when there's real consumed spend, and hides for the nullish /
// zero (BYOK, not-onboarded, nothing-consumed-yet) cases.

import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { BriefingFooter } from "@/components/dashboard/briefing-footer"

afterEach(() => cleanup())

describe("BriefingFooter", () => {
  it("renders consumed credit formatted as currency", () => {
    render(<BriefingFooter consumedCents={140} />)
    expect(screen.getByText("$1.40 consumed this period")).toBeTruthy()
  })

  it("renders nothing when consumed is 0", () => {
    const { container } = render(<BriefingFooter consumedCents={0} />)
    expect(container.firstChild).toBeNull()
  })

  it("renders nothing when consumed is null (BYOK / not onboarded)", () => {
    const { container } = render(<BriefingFooter consumedCents={null} />)
    expect(container.firstChild).toBeNull()
  })

  it("renders nothing when consumed is undefined", () => {
    const { container } = render(<BriefingFooter />)
    expect(container.firstChild).toBeNull()
  })
})

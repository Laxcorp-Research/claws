// @vitest-environment jsdom
//
// PR-6a: the briefing cost footer's three states (BYOK disclosure, platform
// credit consumed/exhausted, calm-hidden). These guard the render matrix,
// the exhausted-line wording (calm, no nag), and the exhausted-over-consumed
// precedence.

import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { BriefingFooter } from "@/components/dashboard/briefing-footer"

afterEach(() => cleanup())

describe("BriefingFooter", () => {
  it("PLATFORM_CREDIT + consumed > 0 → shows the amount", () => {
    render(<BriefingFooter apiKeySource="PLATFORM_CREDIT" consumedCents={140} />)
    expect(screen.getByText("$1.40 consumed this period")).toBeTruthy()
  })

  it("PLATFORM_CREDIT + consumed 0 → renders nothing (calm)", () => {
    const { container } = render(<BriefingFooter apiKeySource="PLATFORM_CREDIT" consumedCents={0} />)
    expect(container.firstChild).toBeNull()
  })

  it("PLATFORM_CREDIT + consumed nullish → renders nothing (no-account runtime case)", () => {
    const { container } = render(<BriefingFooter apiKeySource="PLATFORM_CREDIT" />)
    expect(container.firstChild).toBeNull()
  })

  it("USER_OWN_KEY → shows BYOK disclosure with the Anthropic usage link", () => {
    render(<BriefingFooter apiKeySource="USER_OWN_KEY" />)
    expect(screen.getByText(/Running on your own API key\./)).toBeTruthy()
    const link = screen.getByRole("link", { name: /console\.anthropic\.com/ })
    expect(link.getAttribute("href")).toBe("https://console.anthropic.com/settings/usage")
    expect(link.getAttribute("target")).toBe("_blank")
    expect(link.getAttribute("rel")).toBe("noopener noreferrer")
  })

  it("PLATFORM_CREDIT + EXHAUSTED → calm 'Credits exhausted.' with no nag, beating the consumed amount", () => {
    render(<BriefingFooter apiKeySource="PLATFORM_CREDIT" creditStatus="EXHAUSTED" consumedCents={250} />)
    // STRICT: exact text content — a reverted wording with a trailing
    // "— add your own API key or top up" would NOT match this.
    expect(screen.getByText("Credits exhausted.")).toBeTruthy()
    // the calm footer must NOT duplicate the loud banner's CTA
    expect(screen.queryByText(/add your own API key/)).toBeNull()
    // precedence: exhausted wins over the $2.50 consumed line
    expect(screen.queryByText(/2\.50/)).toBeNull()
  })

  it("NONE / no source → renders nothing even with a consumed figure", () => {
    const { container } = render(<BriefingFooter apiKeySource="NONE" consumedCents={500} />)
    expect(container.firstChild).toBeNull()
  })

  it("undefined apiKeySource → renders nothing", () => {
    const { container } = render(<BriefingFooter consumedCents={140} />)
    expect(container.firstChild).toBeNull()
  })
})

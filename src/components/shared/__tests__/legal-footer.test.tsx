// @vitest-environment jsdom
// App footer -> buildclaws.ai legal pages (the app hosts no legal pages).
import { describe, it, expect, afterEach } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { LegalFooter } from "@/components/shared/legal-footer"
import { LEGAL_URLS } from "@/lib/legal/consent"

afterEach(() => cleanup())

describe("LegalFooter", () => {
  it("links all five legal documents to the buildclaws.ai URLs, opening in a new tab", () => {
    render(<LegalFooter />)
    const expectations: Array<[string, string]> = [
      ["Privacy", LEGAL_URLS.privacy],
      ["Terms", LEGAL_URLS.terms],
      ["Cookies", LEGAL_URLS.cookie],
      ["Acceptable Use", LEGAL_URLS.aup],
      ["Data Processing", LEGAL_URLS.dataProcessing],
    ]
    for (const [label, href] of expectations) {
      const link = screen.getByRole("link", { name: label }) as HTMLAnchorElement
      expect(link.href).toBe(href)
      expect(link.target).toBe("_blank")
      expect(link.rel).toContain("noopener")
    }
  })

  it("names the legal entity", () => {
    render(<LegalFooter />)
    expect(screen.getByText(/Laxcorp Software Design FZCO/)).toBeTruthy()
  })
})

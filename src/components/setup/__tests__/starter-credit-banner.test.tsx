// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import {
  StarterCreditBanner,
  resolveStarterCreditBannerCents,
} from "@/components/setup/starter-credit-banner"
import { STARTER_CREDIT_CENTS } from "@/lib/credits/constants"

afterEach(() => cleanup())

describe("resolveStarterCreditBannerCents", () => {
  it("uses live balance when a CreditAccount exists", () => {
    expect(resolveStarterCreditBannerCents({ hasCreditAccount: true, balanceCents: 500 })).toBe(500)
  })

  it("falls back to grant constant only when no CreditAccount row exists", () => {
    expect(resolveStarterCreditBannerCents({ hasCreditAccount: false, balanceCents: 0 })).toBe(
      STARTER_CREDIT_CENTS,
    )
  })
})

describe("StarterCreditBanner", () => {
  it("renders live $5.00 when balanceCents is 500 (never static $50 after spend)", () => {
    render(<StarterCreditBanner balanceCents={500} />)
    expect(screen.getByText(/You have \$5\.00 in free credits/)).toBeTruthy()
    expect(screen.queryByText(/\$50\.00/)).toBeNull()
    // MUTATION: reinstate formatCreditDollars(STARTER_CREDIT_CENTS) in the banner → fails.
  })

  it("falls back to grant $50.00 when balanceCents is null (no account yet)", () => {
    render(<StarterCreditBanner balanceCents={null} />)
    expect(screen.getByText(/You have \$50\.00 in free credits/)).toBeTruthy()
  })
})

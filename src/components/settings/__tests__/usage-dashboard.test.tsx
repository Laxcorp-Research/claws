// @vitest-environment jsdom
//
// PR-7 (Bug A integration): the Usage tab must render "$0.00", never "$NaN",
// even if totalConsumedCents arrives undefined (the no-account runtime case).

import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

vi.mock("@/hooks/use-credit-balance", () => ({
  useCreditBalance: () => ({
    hasCredits: false,
    balanceCents: 0,
    totalConsumedCents: undefined, // the bug input — must not become "$NaN"
    initialGrantCents: 0,
    status: null,
    grantedAt: null,
    exhaustedAt: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

vi.mock("@/hooks/use-credit-usage", () => ({
  useCreditUsage: () => ({ daily: [], records: [], loading: false, error: null }),
}))

import { UsageDashboard } from "@/components/settings/usage-dashboard"

afterEach(() => cleanup())

describe("UsageDashboard", () => {
  it("renders $0.00 (never $NaN) when totalConsumedCents is undefined", () => {
    render(<UsageDashboard />)
    expect(screen.queryByText("$NaN")).toBeNull()
    expect(screen.getAllByText("$0.00").length).toBeGreaterThanOrEqual(1)
  })

  it("empty-state uses DS TextLink forward to My Claws", () => {
    render(<UsageDashboard />)
    const link = screen.getByRole("link", { name: /Go to My Claws/ })
    expect(link.getAttribute("href")).toBe("/my-claws")
    expect(link.textContent).toContain("→")
    // MUTATION: reinstate raw <Link>+ArrowRight without TextLink → role/name still works
    // but text would lack the DS " →" suffix from TextLink direction=forward.
  })
})

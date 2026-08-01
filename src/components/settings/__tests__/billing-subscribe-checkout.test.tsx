// @vitest-environment jsdom
/**
 * P7: lapsed Subscribe must open Dodo platform checkout — not /pricing.
 * MUTATION: button-links-to-pricing restored → this file fails.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"
import {
  BillingDashboard,
  BILLING_SUBSCRIBE_RETURN,
} from "@/components/settings/billing-dashboard"

const push = vi.fn()
const searchParamsGet = vi.fn((_key: string) => null as string | null)

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push,
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => ({ get: searchParamsGet }),
}))

const expiredBilling = {
  success: true,
  data: {
    hasActiveSubscription: false,
    activeClaws: 0,
    runningClaws: 0,
    pausedClaws: 0,
    thisMonthTotal: 0,
    trialUsed: true,
    trialStartedAt: "2026-07-20T00:00:00.000Z",
    trialEndsAt: "2026-07-23T00:00:00.000Z",
  },
}

const stoppedWs = {
  success: true,
  data: [{ id: "ws-stopped", name: "Lapsed Claw", status: "STOPPED" }],
}

function fetchRouter(opts: {
  checkout?: unknown
  billing?: unknown
  workspaces?: unknown
}) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.includes("/api/user/billing")) {
      return { json: async () => opts.billing ?? expiredBilling }
    }
    if (url.includes("/api/workspaces")) {
      return { json: async () => opts.workspaces ?? stoppedWs }
    }
    if (url.includes("/api/dodo-payments/checkout")) {
      return {
        json: async () =>
          opts.checkout ?? {
            success: true,
            data: { checkoutUrl: "https://checkout.dodopayments.com/sub_test" },
          },
      }
    }
    if (url.includes("/api/dodo-payments/portal")) {
      return {
        json: async () => ({ success: true, data: { portalUrl: null } }),
      }
    }
    return { json: async () => ({ success: false }) }
  })
}

beforeEach(() => {
  searchParamsGet.mockReturnValue(null)
  push.mockReset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("BillingDashboard Subscribe → Dodo checkout", () => {
  it("MUTATION lock: Subscribe handler must not navigate to /pricing", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/settings/billing-dashboard.tsx"),
      "utf8",
    )
    expect(src).not.toMatch(/router\.push\(\s*["']\/pricing["']\s*\)/)
    expect(src).toContain("/api/dodo-payments/checkout")
    expect(src).toContain('type: "claw_platform"')
    expect(src).toContain(BILLING_SUBSCRIBE_RETURN)
  })

  it("Subscribe creates claw_platform checkout and navigates to Dodo URL", async () => {
    const fetchMock = fetchRouter({})
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch)
    const loc = { href: "http://localhost/settings?tab=billing" }
    Object.defineProperty(window, "location", {
      configurable: true,
      value: loc,
    })

    render(<BillingDashboard />)
    const btn = await screen.findByRole("button", { name: /Subscribe - \$79\/mo/i })
    fireEvent.click(btn)

    await waitFor(() => {
      expect(loc.href).toBe("https://checkout.dodopayments.com/sub_test")
    })

    const checkoutCall = fetchMock.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("/api/dodo-payments/checkout"),
    )
    expect(checkoutCall).toBeDefined()
    const body = JSON.parse((checkoutCall![1] as RequestInit).body as string) as {
      type: string
      workspaceId?: string
      returnUrl: string
    }
    expect(body.type).toBe("claw_platform")
    expect(body.workspaceId).toBe("ws-stopped")
    expect(body.returnUrl).toBe(BILLING_SUBSCRIBE_RETURN)
    expect(body.returnUrl).toContain("subscribed=1")
    expect(push).not.toHaveBeenCalledWith("/pricing")
  })

  it("mockMode activates entitlement and shows Subscription active + Redeploy", async () => {
    let billing: unknown = expiredBilling
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/api/user/billing")) {
        return Promise.resolve({ json: () => Promise.resolve(billing) })
      }
      if (url.includes("/api/workspaces")) {
        return Promise.resolve({ json: () => Promise.resolve(stoppedWs) })
      }
      if (url.includes("/api/dodo-payments/checkout")) {
        billing = {
          success: true,
          data: { ...expiredBilling.data, hasActiveSubscription: true },
        }
        return Promise.resolve({
          json: () => Promise.resolve({ success: true, data: { mockMode: true } }),
        })
      }
      return Promise.resolve({ json: () => Promise.resolve({ success: false }) })
    }) as unknown as typeof fetch
    vi.stubGlobal("fetch", fetchMock)

    render(<BillingDashboard />)
    fireEvent.click(await screen.findByRole("button", { name: /Subscribe - \$79\/mo/i }))

    expect(await screen.findByText("Subscription active")).toBeTruthy()
    expect(await screen.findByRole("button", { name: /Redeploy/i })).toBeTruthy()
  })

  it("?subscribed=1 refetches billing and shows success when entitled", async () => {
    searchParamsGet.mockImplementation((key: string) =>
      key === "subscribed" ? "1" : null,
    )
    vi.stubGlobal(
      "fetch",
      fetchRouter({
        billing: {
          success: true,
          data: { ...expiredBilling.data, hasActiveSubscription: true },
        },
      }),
    )

    render(<BillingDashboard />)
    expect(await screen.findByText("Subscription active")).toBeTruthy()
    expect(await screen.findByRole("button", { name: /Redeploy/i })).toBeTruthy()
  })
})

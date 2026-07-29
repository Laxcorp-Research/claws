// @vitest-environment jsdom
//
// PR-7 (Bug B): clicking Manage subscription / View invoices when the portal
// is unavailable (Dodo mock mode / no dodoCustomerId) must surface the server
// message instead of silently doing nothing, and the buttons must show a
// loading/disabled state while the request is in flight. We do NOT assert
// window.open (jsdom doesn't implement it) — only the message-surfacing path.

import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"
import { BillingDashboard } from "@/components/settings/billing-dashboard"

// BillingDashboard calls useRouter(); provide a stub so it renders outside an
// app-router provider.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
}))

const billingData = {
  success: true,
  data: {
    hasActiveSubscription: false,
    activeClaws: 0,
    runningClaws: 0,
    pausedClaws: 0,
    thisMonthTotal: 0,
    trialUsed: false,
    trialStartedAt: null,
    trialEndsAt: null,
  },
}
const workspacesData = { success: true, data: [] }

function routeFetch(portal: unknown) {
  return vi.fn((url: string) => {
    if (url.includes("/api/user/billing")) return Promise.resolve({ json: () => Promise.resolve(billingData) })
    if (url.includes("/api/workspaces")) return Promise.resolve({ json: () => Promise.resolve(workspacesData) })
    if (url.includes("/api/dodo-payments/portal")) {
      // a thenable → treat as the (deferred) response promise itself
      if (portal && typeof (portal as { then?: unknown }).then === "function") return portal
      return Promise.resolve({ json: () => Promise.resolve(portal) })
    }
    return Promise.resolve({ json: () => Promise.resolve({ success: false }) })
  }) as unknown as typeof fetch
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("BillingDashboard trial copy truth", () => {
  it("shows 3-day platform trial language when trial is available", async () => {
    vi.stubGlobal("fetch", routeFetch({ success: true, data: { portalUrl: null } }))
    render(<BillingDashboard />)
    await screen.findByText("Billing summary")
    expect(screen.getByText("3-day platform trial on first deploy")).toBeTruthy()
    expect(screen.getByText("Available")).toBeTruthy()
  })
})

describe("BillingDashboard Batch A / A6 — runningClaws estimate", () => {
  it("uses data.runningClaws for Est. monthly (PAUSED not billed as running)", async () => {
    const billing = {
      success: true,
      data: {
        hasActiveSubscription: true,
        activeClaws: 2,
        runningClaws: 1,
        pausedClaws: 1,
        thisMonthTotal: 0,
        trialUsed: true,
        trialStartedAt: null,
        trialEndsAt: null,
      },
    }
    const workspaces = {
      success: true,
      data: [
        { id: "w1", name: "Run", status: "RUNNING" },
        { id: "w2", name: "Pause", status: "PAUSED" },
      ],
    }
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("/api/user/billing")) {
          return Promise.resolve({ json: () => Promise.resolve(billing) })
        }
        if (url.includes("/api/workspaces")) {
          return Promise.resolve({ json: () => Promise.resolve(workspaces) })
        }
        return Promise.resolve({ json: () => Promise.resolve({ success: false }) })
      }) as unknown as typeof fetch,
    )

    render(<BillingDashboard />)
    await screen.findByText("Billing summary")
    expect(screen.getByText("$79")).toBeTruthy() // Est. monthly = 1 × 79
    expect(screen.getByText("1 running Claw × $79")).toBeTruthy()
    expect(screen.queryByText("2 running Claws × $79")).toBeNull()
    expect(screen.queryByText("$158")).toBeNull()
  })
})

describe("BillingDashboard billing portal", () => {
  it("surfaces the server message when portalUrl is null", async () => {
    vi.spyOn(window, "open").mockReturnValue(null as unknown as Window)
    vi.stubGlobal(
      "fetch",
      routeFetch({ success: true, data: { portalUrl: null, message: "No billing history yet" } }),
    )

    render(<BillingDashboard />)
    await screen.findByText("Billing summary")
    fireEvent.click(screen.getByText("Manage subscription"))

    expect(await screen.findByText("No billing history yet")).toBeTruthy()
  })

  it("disables the portal buttons while the request is in flight", async () => {
    vi.spyOn(window, "open").mockReturnValue(null as unknown as Window)
    let resolvePortal!: () => void
    const deferred = new Promise<{ json: () => Promise<unknown> }>((r) => {
      resolvePortal = () =>
        r({ json: () => Promise.resolve({ success: true, data: { portalUrl: null, message: "done" } }) })
    })
    vi.stubGlobal("fetch", routeFetch(deferred))

    render(<BillingDashboard />)
    await screen.findByText("Billing summary")
    const manageBtn = screen.getByText("Manage subscription").closest("button") as HTMLButtonElement

    fireEvent.click(manageBtn)
    await waitFor(() => expect(manageBtn.disabled).toBe(true))

    resolvePortal()
    await waitFor(() => expect(manageBtn.disabled).toBe(false))
  })
})

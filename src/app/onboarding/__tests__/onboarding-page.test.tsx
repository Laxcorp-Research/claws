// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import OnboardingPage from "@/app/onboarding/page"

const replace = vi.fn()
const push = vi.fn()
const update = vi.fn().mockResolvedValue({})

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push, prefetch: vi.fn() }),
  usePathname: () => "/onboarding",
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { onboardingCompleted: false, user: { id: "u1" } },
    status: "authenticated",
    update,
  }),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  replace.mockReset()
  push.mockReset()
})

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: "ws-new" } }),
      }),
    ) as unknown as typeof fetch,
  )
})

describe("OnboardingPage Batch B CTAs", () => {
  it("Add Anthropic/OpenAI key links to /settings?tab=api-keys", () => {
    render(<OnboardingPage />)
    const links = screen.getAllByRole("link").filter((a) =>
      (a as HTMLAnchorElement).href.includes("/settings?tab=api-keys"),
    )
    expect(links.length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText("Add Anthropic key").closest("a")?.getAttribute("href")).toBe(
      "/settings?tab=api-keys",
    )
    expect(screen.getByText("Add OpenAI key").closest("a")?.getAttribute("href")).toBe(
      "/settings?tab=api-keys",
    )
  })

  it("Create custom Claw POSTs workspace then navigates to builder (My Claws pattern)", async () => {
    render(<OnboardingPage />)
    fireEvent.click(screen.getByText("Create custom Claw"))
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/builder/ws-new")
    })
    expect(fetch).toHaveBeenCalledWith(
      "/api/workspaces",
      expect.objectContaining({ method: "POST" }),
    )
  })
})

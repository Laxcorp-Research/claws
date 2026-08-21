// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { OnboardingClient } from "@/components/onboarding/onboarding-client"
import type { TrackerState } from "@/lib/onboarding/tracker-state"

const update = vi.fn()
const showSnackbar = vi.fn()
const assign = vi.fn()
const push = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/onboarding",
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { onboardingCompleted: false, user: { id: "u1" } },
    status: "authenticated",
    update,
  }),
}))

vi.mock("@/components/shared/snackbar", () => ({
  useSnackbarOptional: () => ({ show: showSnackbar, dismiss: vi.fn() }),
}))

vi.mock("@/hooks/use-onboarding-state", () => ({
  useOnboardingNavVisible: () => false,
  invalidateOnboardingStateCache: vi.fn(),
}))

const emptyState: TrackerState = {
  s1Done: false,
  s1DoneVia: null,
  s2Done: false,
  s3Done: false,
  allDone: false,
  connectedProviders: [],
  workspaceCount: 0,
  balanceCents: 0,
  showAnthropicTemplateHint: false,
  deployedWorkspaceId: null,
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  update.mockReset()
  showSnackbar.mockReset()
  assign.mockReset()
  push.mockReset()
})

beforeEach(() => {
  update.mockResolvedValue({ onboardingCompleted: true })
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, assign },
  })
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (String(url).includes("/api/workspaces")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { id: "ws-new" } }),
        })
      }
      if (String(url).includes("/api/user/complete-onboarding")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { onboardingCompleted: true } }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    }) as unknown as typeof fetch,
  )
})

describe("OnboardingClient Batch B CTAs (v2.1 props)", () => {
  it("Add Anthropic/OpenAI key links when S1 not done", () => {
    render(<OnboardingClient mode="gate" state={emptyState} workspaces={[]} />)
    expect(screen.getByText("Add Anthropic key").closest("a")?.getAttribute("href")).toBe(
      "/settings?tab=api-keys",
    )
  })

  it("marks step 1 done via key - Manage keys", () => {
    render(
      <OnboardingClient
        mode="gate"
        state={{
          ...emptyState,
          s1Done: true,
          s1DoneVia: "key",
          connectedProviders: ["Anthropic"],
        }}
        workspaces={[]}
      />,
    )
    expect(screen.queryByRole("button", { name: "Add Anthropic key" })).toBeNull()
    expect(screen.getByRole("link", { name: /Manage keys/ })).toBeTruthy()
  })

  it("Create custom Claw POSTs workspace then hard-navigates to builder", async () => {
    render(<OnboardingClient mode="gate" state={emptyState} workspaces={[]} />)
    fireEvent.click(screen.getByText("Create custom Claw"))
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith("/builder/ws-new")
    })
  })

  it("Skip hard-navigates after successful complete-onboarding", async () => {
    render(<OnboardingClient mode="gate" state={emptyState} workspaces={[]} />)
    fireEvent.click(screen.getByRole("button", { name: /Skip onboarding/ }))
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith("/my-claws")
    })
  })
})

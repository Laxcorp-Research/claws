// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { OnboardingClient } from "@/components/onboarding/onboarding-client"
import type { TrackerState, TrackerWorkspace } from "@/lib/onboarding/tracker-state"

const update = vi.fn()
const showSnackbar = vi.fn()
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
  vi.clearAllMocks()
})

beforeEach(() => {
  update.mockResolvedValue({ onboardingCompleted: true })
})

describe("OnboardingClient v2.1", () => {
  it("step-3 with no workspace → snackbar + step-2 emphasis", () => {
    render(<OnboardingClient mode="gate" state={emptyState} workspaces={[]} />)
    fireEvent.click(screen.getByRole("button", { name: /Set up & deploy/ }))
    expect(showSnackbar).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/Create a Claw first/) }),
    )
  })

  it("step-3 with single workspace → picker (not direct route)", () => {
    const workspaces: TrackerWorkspace[] = [
      {
        id: "ws-1",
        name: "My Claw 1",
        status: "SETUP_INCOMPLETE",
        hasCompletedDeployment: false,
      },
    ]
    render(
      <OnboardingClient
        mode="gate"
        state={{ ...emptyState, s2Done: true, workspaceCount: 1 }}
        workspaces={workspaces}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /Set up & deploy/ }))
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByText("Choose a Claw to set up")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /My Claw 1/ }))
    expect(push).toHaveBeenCalledWith("/setup/ws-1/step/1")
  })

  it("credits-done step 1 copy", () => {
    render(
      <OnboardingClient
        mode="gate"
        state={{
          ...emptyState,
          s1Done: true,
          s1DoneVia: "credits",
          balanceCents: 5000,
        }}
        workspaces={[]}
      />,
    )
    expect(screen.getByText(/Powered by Claws Starter Credits - \$50\.00 remaining/)).toBeTruthy()
    expect(screen.getByRole("link", { name: /Add your own key/ })).toBeTruthy()
  })

  it("step 2 done uses primary Go to My Claws button", () => {
    render(
      <OnboardingClient
        mode="gate"
        state={{ ...emptyState, s2Done: true, workspaceCount: 1 }}
        workspaces={[
          { id: "w1", name: "A", status: "DRAFT", hasCompletedDeployment: false },
        ]}
      />,
    )
    expect(screen.getByRole("link", { name: "Go to My Claws" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /My Claws →/ })).toBeNull()
  })

  it("Skip only in gate mode", () => {
    const { unmount } = render(
      <OnboardingClient mode="gate" state={emptyState} workspaces={[]} />,
    )
    expect(screen.getByRole("button", { name: /Skip onboarding/ })).toBeTruthy()
    unmount()
    render(<OnboardingClient mode="revisit" state={emptyState} workspaces={[]} />)
    expect(screen.queryByRole("button", { name: /Skip onboarding/ })).toBeNull()
  })

  it("create claw still POSTs and navigates", async () => {
    const assign = vi.fn()
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
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) })
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      }) as unknown as typeof fetch,
    )
    render(<OnboardingClient mode="gate" state={emptyState} workspaces={[]} />)
    fireEvent.click(screen.getByRole("button", { name: "Create custom Claw" }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/builder/ws-new"))
  })
})

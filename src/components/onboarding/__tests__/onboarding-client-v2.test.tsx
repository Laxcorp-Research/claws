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

const emptyState: TrackerState = {
  s1Done: false,
  s2Done: false,
  s3Done: false,
  allDone: false,
  connectedProviders: [],
  workspaceCount: 0,
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

describe("OnboardingClient v2 step-3 branching", () => {
  it("step-3 with no workspace → snackbar + step-2 emphasis", () => {
    render(
      <OnboardingClient mode="gate" state={emptyState} workspaces={[]} />,
    )
    fireEvent.click(screen.getByRole("button", { name: /Connect tools & deploy/ }))
    expect(showSnackbar).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(/Create a Claw first/),
        variant: "error",
      }),
    )
    const step2 = screen.getByText("Pick your first Claw").closest("[data-emphasized]")
    expect(step2?.getAttribute("data-emphasized")).toBe("true")
  })

  it("step-3 with single SETUP_INCOMPLETE workspace → direct route", () => {
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
    fireEvent.click(screen.getByRole("button", { name: /Continue setup/ }))
    expect(push).toHaveBeenCalledWith("/setup/ws-1/step/1")
  })

  it("Skip only in gate mode", () => {
    const { unmount } = render(
      <OnboardingClient mode="gate" state={emptyState} workspaces={[]} />,
    )
    expect(screen.getByRole("button", { name: /Skip onboarding/ })).toBeTruthy()
    unmount()
    render(
      <OnboardingClient mode="revisit" state={emptyState} workspaces={[]} />,
    )
    expect(screen.queryByRole("button", { name: /Skip onboarding/ })).toBeNull()
  })

  it("all-done header variant", () => {
    render(
      <OnboardingClient
        mode="revisit"
        state={{
          ...emptyState,
          s1Done: true,
          s2Done: true,
          s3Done: true,
          allDone: true,
          connectedProviders: ["Anthropic"],
          workspaceCount: 1,
          deployedWorkspaceId: "ws-1",
        }}
        workspaces={[
          {
            id: "ws-1",
            name: "My Claw 1",
            status: "STOPPED",
            hasCompletedDeployment: true,
          },
        ]}
      />,
    )
    expect(screen.getByRole("heading", { name: "You're all set" })).toBeTruthy()
    expect(screen.getByRole("link", { name: /Open dashboard/ })).toBeTruthy()
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
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true }),
          })
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      }) as unknown as typeof fetch,
    )
    render(<OnboardingClient mode="gate" state={emptyState} workspaces={[]} />)
    fireEvent.click(screen.getByRole("button", { name: "Create custom Claw" }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/builder/ws-new"))
  })
})

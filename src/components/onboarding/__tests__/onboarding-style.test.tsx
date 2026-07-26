// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { OnboardingClient } from "@/components/onboarding/onboarding-client"
import type { TrackerState } from "@/lib/onboarding/tracker-state"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/onboarding",
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { onboardingCompleted: false, user: { id: "u1" } },
    status: "authenticated",
    update: vi.fn(),
  }),
}))

vi.mock("@/components/shared/snackbar", () => ({
  useSnackbarOptional: () => ({ show: vi.fn(), dismiss: vi.fn() }),
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

describe("onboarding / wizard TextLink identity (PR-3)", () => {
  it("Skip onboarding uses DS TextLink forward (not raw accent button)", () => {
    render(<OnboardingClient mode="gate" state={emptyState} workspaces={[]} />)
    const skip = screen.getByRole("button", { name: /Skip onboarding/ })
    expect(skip.textContent).toContain("→")
    expect(skip.className).not.toMatch(/ac-text/)
    cleanup()
  })

  it("wizard chrome exit uses TextLink direction=back", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/setup/[workspaceId]/step/[n]/page.tsx"),
      "utf8",
    )
    expect(src).toMatch(/direction="back"[\s\S]*Back to (Builder|My Claws)/)
  })
})

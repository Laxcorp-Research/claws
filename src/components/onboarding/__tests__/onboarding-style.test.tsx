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

describe("onboarding / wizard TextLink identity (PR-3)", () => {
  it("Skip onboarding uses DS TextLink forward (not raw accent button)", () => {
    render(<OnboardingClient mode="gate" state={emptyState} workspaces={[]} />)
    const skip = screen.getByRole("button", { name: /Skip onboarding/ })
    expect(skip.textContent).toContain("→")
    expect(skip.className).not.toMatch(/ac-text/)
    const src = readFileSync(
      join(process.cwd(), "src/components/onboarding/onboarding-client.tsx"),
      "utf8",
    )
    expect(src).toContain('direction="forward"')
    expect(src).toContain("Skip onboarding")
    expect(src).not.toMatch(/text-\[var\(--ac-text\)\].*Skip|Skip.*text-\[var\(--ac-text\)\]/)
    cleanup()
  })

  it("wizard chrome exit uses TextLink direction=back", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/setup/[workspaceId]/step/[n]/page.tsx"),
      "utf8",
    )
    expect(src).toMatch(/direction="back"[\s\S]*Back to (Builder|My Claws)/)
    expect(src).not.toMatch(
      /onClick=\{exitWizard\}\s*\n\s*className="text-\[11px\] text-\[var\(--tx2\)\]/,
    )
  })
})

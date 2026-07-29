// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const useSession = vi.fn()

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/versions",
}))

vi.mock("next-auth/react", () => ({
  useSession: () => useSession(),
  signOut: vi.fn(),
}))

vi.mock("@/hooks/use-onboarding-state", () => ({
  useOnboardingNavVisible: () => false,
  invalidateOnboardingStateCache: vi.fn(),
}))

import { TopBar } from "@/components/shared/top-bar"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("TopBar session loading — no Sign-in flash", () => {
  it("status===loading renders session skeleton, never Sign in", () => {
    useSession.mockReturnValue({ data: null, status: "loading" })
    render(<TopBar />)
    expect(screen.getByRole("status", { name: "Loading session" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /sign in/i })).toBeNull()
    expect(screen.queryByText("Sign in")).toBeNull()
    expect(screen.queryByText("Pricing")).toBeNull()
    expect(screen.queryByText("My Claws")).toBeNull()
  })

  it("status===unauthenticated paints Sign in", () => {
    useSession.mockReturnValue({ data: null, status: "unauthenticated" })
    render(<TopBar />)
    expect(screen.getByText("Sign in")).toBeTruthy()
    expect(screen.getByText("Pricing")).toBeTruthy()
  })

  it("status===authenticated paints avatar, not Sign in", () => {
    useSession.mockReturnValue({
      data: { user: { name: "Ada", email: "ada@example.com" } },
      status: "authenticated",
    })
    render(<TopBar />)
    expect(screen.queryByText("Sign in")).toBeNull()
    expect(screen.getByLabelText("User menu")).toBeTruthy()
    expect(screen.getByText("My Claws")).toBeTruthy()
  })

  it("MUTATION: fall-through session?auth:SignIn without status===loading gate fails", () => {
    const src = readFileSync(join(process.cwd(), "src/components/shared/top-bar.tsx"), "utf8")
    expect(src).toContain("Loading session")
    expect(src).toContain("LoadingSkeleton")
    // CTA must branch loading → sessionReady → Sign in (never falsy-session fallthrough)
    expect(src).toMatch(
      /\{\s*status === "loading"\s*\?[\s\S]*sessionReady\s*\?[\s\S]*Sign in/,
    )
  })
})

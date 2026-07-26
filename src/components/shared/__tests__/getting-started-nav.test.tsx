// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { TopBar } from "@/components/shared/top-bar"

const useOnboardingNavVisible = vi.fn()

vi.mock("next/navigation", () => ({
  usePathname: () => "/my-claws",
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { name: "Ada", email: "ada@example.com" } },
    status: "authenticated",
  }),
  signOut: vi.fn(),
}))

vi.mock("@/hooks/use-onboarding-state", () => ({
  useOnboardingNavVisible: (...args: unknown[]) => useOnboardingNavVisible(...args),
  invalidateOnboardingStateCache: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Getting started nav visibility vs menu", () => {
  it("shows gradient nav when tracker incomplete; menu always present", async () => {
    useOnboardingNavVisible.mockReturnValue(true)
    render(<TopBar />)
    await waitFor(() => {
      const navLinks = screen
        .getByRole("navigation", { name: "Main navigation" })
        .querySelectorAll("a")
      const labels = [...navLinks].map((a) => a.textContent)
      expect(labels).toContain("Getting started")
    })
    const navLink = screen
      .getByRole("navigation", { name: "Main navigation" })
      .querySelector("a.ai-gradient-accent")
    expect(navLink?.textContent).toBe("Getting started")

    // Menu item source always includes Getting started (unconditional).
    const src = readFileSync(join(process.cwd(), "src/components/shared/top-bar.tsx"), "utf8")
    expect(src).toContain('label="Getting started"')
    expect(src).toContain("Menu entry ALWAYS visible")
  })

  it("hides nav item when all-green; menu entry remains in source", () => {
    useOnboardingNavVisible.mockReturnValue(false)
    render(<TopBar />)
    const nav = screen.getByRole("navigation", { name: "Main navigation" })
    expect(nav.textContent).not.toContain("Getting started")
    const src = readFileSync(join(process.cwd(), "src/components/shared/top-bar.tsx"), "utf8")
    expect(src).toContain('label="Getting started"')
  })
})

describe("AI gradient reduced-motion", () => {
  it("CSS suppresses animation under prefers-reduced-motion", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8")
    expect(css).toContain(".ai-gradient-accent")
    expect(css).toMatch(/@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/)
    expect(css).toMatch(
      /prefers-reduced-motion:\s*reduce[\s\S]*\.ai-gradient-accent[\s\S]*animation:\s*none/,
    )
    // Static render shows mid-blend, not a pale endpoint.
    expect(css).toMatch(
      /prefers-reduced-motion:\s*reduce[\s\S]*background-position:\s*50%\s*50%/,
    )
  })

  it("saturated AI gradient tokens are pinned", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8")
    expect(css).toContain("--ai-grad-1: #2563EB")
    expect(css).toContain("--ai-grad-2: #7C3AED")
    expect(css).toContain("--ai-grad-3: #DB2777")
    // Pale v2.1 endpoints must not return.
    expect(css).not.toContain("--ai-grad-1: #3B82F6")
    expect(css).not.toContain("--ai-grad-3: #93C5FD")
  })
})

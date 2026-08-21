// @vitest-environment jsdom
/**
 * Admin hard-load auth flash - coverage gap after #389.
 *
 * #389 gated TopBar on status==="loading" but tested TopBar in isolation;
 * admin layout tests stubbed PageShell (TopBar) away. Hard load of
 * /admin/versions can paint admin children (cookie /api/admin/check OK)
 * while useSession is still resolving - the else-fallthrough to public
 * nav + "Sign in" was the hole.
 *
 * MUTATION: restore `status !== "loading" && !sessionReady → Sign in`
 * fall-through in TopBar → this suite fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import AdminClientLayout from "@/app/admin/AdminClientLayout"

const useSession = vi.fn()

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/versions",
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock("next-auth/react", () => ({
  useSession: () => useSession(),
  signOut: vi.fn(),
}))

vi.mock("@/hooks/use-onboarding-state", () => ({
  useOnboardingNavVisible: () => false,
  invalidateOnboardingStateCache: vi.fn(),
}))

const CHILD = "ADMIN_VERSIONS_CONTENT"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { isAdmin: true } }),
  }) as unknown as typeof fetch
})

describe("Admin /admin/* first paint - no Sign-in flash", () => {
  it("session loading + admin check OK: children visible, never Sign in / Pricing", async () => {
    useSession.mockReturnValue({ data: null, status: "loading" })

    render(
      <AdminClientLayout>
        <div>{CHILD}</div>
      </AdminClientLayout>,
    )

    await screen.findByText(CHILD)
    expect(screen.queryByText("Sign in")).toBeNull()
    expect(screen.queryByText("Pricing")).toBeNull()
    expect(screen.getByRole("status", { name: "Loading session" })).toBeTruthy()
    expect(screen.getByText("Versions")).toBeTruthy()
  })

  it("MUTATION: else-fallthrough to Sign in without unauthenticated gate fails", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/shared/top-bar.tsx"),
      "utf8",
    )
    // Must keep explicit unauthenticated gate before Sign in CTA.
    expect(src).toContain('status === "unauthenticated"')
    // Forbidden pattern: loading ternary whose else is bare Sign in
    // (the #389 shape that still flashed when status wasn't exactly "loading").
    const fallThrough =
      /status === "loading"\s*\?[\s\S]*sessionReady\s*\?[\s\S]*:\s*\(\s*<Link href="\/auth\/signin">/
    expect(src).not.toMatch(fallThrough)
  })
})

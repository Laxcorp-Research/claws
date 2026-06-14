// @vitest-environment jsdom
//
// GH #127 defense-in-depth: each admin page must treat a 403 fetch as
// unauthorized (render <AdminAccessDenied />), NOT fall through to its benign
// "empty" state. Regression guard: reverting a page's 403 branch makes it show
// its empty-state copy instead of access-denied → these fail.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import AdminVersionsPage from "@/app/admin/versions/page"
import AdminReportsPage from "@/app/admin/reports/page"
import AdminReviewsPage from "@/app/admin/reviews/page"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

const DENIED = "You don't have admin access"

afterEach(() => cleanup())
beforeEach(() => {
  // Every admin fetch returns 403 (unauthorized), as the API does for a non-admin.
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status: 403,
    json: async () => ({ success: false, error: { code: "FORBIDDEN", statusCode: 403 } }),
  }) as unknown as typeof fetch
})

describe("Admin pages render access-denied (not empty-state) on a 403 (GH #127)", () => {
  it("/admin/versions: 403 → access-denied, NOT 'No versions registered'", async () => {
    render(<AdminVersionsPage />)
    await screen.findByText(DENIED)
    expect(screen.queryByText("No versions registered")).toBeNull()
  })

  it("/admin/reports: 403 → access-denied, NOT 'No open reports'", async () => {
    render(<AdminReportsPage />)
    await screen.findByText(DENIED)
    expect(screen.queryByText("No open reports")).toBeNull()
  })

  it("/admin/reviews: 403 → access-denied, NOT 'No items pending review'", async () => {
    render(<AdminReviewsPage />)
    await screen.findByText(DENIED)
    expect(screen.queryByText("No items pending review")).toBeNull()
  })
})

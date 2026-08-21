// @vitest-environment jsdom
/**
 * Batch G - admin list fetch failures (non-403) must show NetworkError + Retry,
 * never a false-empty queue. MUTATION: empty-state on 500 → fail.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import AdminVersionsPage from "@/app/admin/versions/page"
import AdminReportsPage from "@/app/admin/reports/page"
import AdminReviewsPage from "@/app/admin/reviews/page"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

afterEach(() => cleanup())

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status: 500,
    json: async () => ({ success: false }),
  }) as unknown as typeof fetch
})

describe("Admin pages NetworkError on 500 (Batch G)", () => {
  it("/admin/versions: 500 → Unable to load, NOT empty queue", async () => {
    render(<AdminVersionsPage />)
    expect(await screen.findByRole("heading", { name: "Unable to load" })).toBeDefined()
    expect(screen.queryByText("No versions registered")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /Try again/i }))
    expect(global.fetch).toHaveBeenCalled()
  })

  it("/admin/reports: 500 → Unable to load, NOT empty queue", async () => {
    render(<AdminReportsPage />)
    expect(await screen.findByRole("heading", { name: "Unable to load" })).toBeDefined()
    expect(screen.queryByText("No open reports")).toBeNull()
  })

  it("/admin/reviews: 500 → Unable to load, NOT empty queue", async () => {
    render(<AdminReviewsPage />)
    expect(await screen.findByRole("heading", { name: "Unable to load" })).toBeDefined()
    expect(screen.queryByText("No items pending review")).toBeNull()
  })

  it("MUTATION: empty-state on 500 → fail (source guard)", () => {
    for (const file of [
      "src/app/admin/reviews/page.tsx",
      "src/app/admin/reports/page.tsx",
      "src/app/admin/versions/page.tsx",
    ]) {
      const src = readFileSync(join(process.cwd(), file), "utf8")
      expect(src, file).toContain("NetworkError")
      expect(src, file).toContain("loadError")
    }
  })
})

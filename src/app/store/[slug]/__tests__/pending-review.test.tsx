// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "pending-community" }),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/store/pending-community",
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "creator-1" } } }),
}))

import TemplateDetailPage from "@/app/store/[slug]/page"

describe("creator-views-pending store page (B5)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            listingState: "pending_review",
            name: "Pending",
            slug: "pending-community",
          },
        }),
      }) as Response,
    )
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("creator-views-pending renders pending state, not 404", async () => {
    render(<TemplateDetailPage />)
    await waitFor(() => {
      expect(screen.getByText("Pending review")).toBeTruthy()
    })
    expect(
      screen.getByText("Submitted for review - you'll get an email when it's approved."),
    ).toBeTruthy()
    expect(screen.getByRole("link", { name: "View in your creator dashboard" }).getAttribute("href")).toBe(
      "/settings?tab=creator",
    )
    expect(screen.queryByText("Template not found")).toBeNull()
  })

  it("MUTATION: pending_review store branch dropped → fail", () => {
    const tpl = readFileSync(join(process.cwd(), "src/app/store/[slug]/page.tsx"), "utf8")
    const skill = readFileSync(join(process.cwd(), "src/app/store/skills/[slug]/page.tsx"), "utf8")
    expect(tpl).toContain('listingState === "pending_review"')
    expect(skill).toContain('listingState === "pending_review"')
    expect(tpl).toContain("PendingReviewEmptyState")
    expect(skill).toContain("PendingReviewEmptyState")
  })
})

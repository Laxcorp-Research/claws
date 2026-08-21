// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "unpublished-claw" }),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/store/unpublished-claw",
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "creator-1" } } }),
}))

import TemplateDetailPage from "@/app/store/[slug]/page"

describe("creator-views-unpublished store page", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            listingState: "unpublished",
            name: "Unpublished",
            slug: "unpublished-claw",
          },
        }),
      }) as Response,
    )
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("owner unpublished state, not 404", async () => {
    render(<TemplateDetailPage />)
    await waitFor(() => {
      expect(screen.getByText("Unpublished")).toBeTruthy()
    })
    expect(
      screen.getByText(/Off the store - no new buyers/),
    ).toBeTruthy()
    expect(screen.queryByText("Template not found")).toBeNull()
  })

  it("MUTATION: unpublished store branch dropped → fail", () => {
    const tpl = readFileSync(join(process.cwd(), "src/app/store/[slug]/page.tsx"), "utf8")
    const skill = readFileSync(join(process.cwd(), "src/app/store/skills/[slug]/page.tsx"), "utf8")
    expect(tpl).toContain('listingState === "unpublished"')
    expect(skill).toContain('listingState === "unpublished"')
    expect(tpl).toContain("UnpublishedEmptyState")
    expect(skill).toContain("UnpublishedEmptyState")
  })
})

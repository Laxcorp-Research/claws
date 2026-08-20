// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "test-template-4" }),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/store/test-template-4",
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "buyer-1" } }, status: "authenticated" }),
}))

import TemplateDetailPage from "@/app/store/[slug]/page"

const SAMPLE_REVIEW = {
  id: "rev-1",
  userName: "Alex",
  rating: 5,
  title: "Great",
  body: "Works",
  verifiedInstall: true,
  createdAt: new Date("2026-08-01T00:00:00.000Z").toISOString(),
}

function templatePayload(reviews: typeof SAMPLE_REVIEW[]) {
  return {
    template: {
      id: "tpl-4",
      name: "test template 4",
      slug: "test-template-4",
      tagline: "Tagline",
      description: "Description",
      category: "CREATOR",
      price: 0,
      isFree: true,
      trustTier: "OFFICIAL",
      installCount: 1,
      avgRating: reviews.length ? 5 : null,
      estimatedMonthlyCost: "40",
      agentCount: 1,
      version: 1,
      creatorId: null,
      creator: null,
      agents: [
        { name: "Commander", role: "ORCHESTRATOR", color: "#5BA1F5", model: "m", roleDescription: "r" },
      ],
      tools: { required: [], recommended: [] },
      flowDescription: "Flow",
      legalDisclaimer: null,
    },
    reviews,
    reviewCount: reviews.length,
    installCount: 1,
    similar: [],
    hasPurchased: true,
    isOwner: false,
  }
}

function mockFetch(reviews: typeof SAMPLE_REVIEW[]) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/api/marketplace/templates/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: templatePayload(reviews) }),
      } as Response
    }
    return { ok: true, status: 200, json: async () => ({ success: true }) } as Response
  })
}

function expectFindableCta() {
  const btn = screen.getByTestId("write-review-cta")
  expect(btn.getAttribute("hidden")).toBeNull()
  expect(getComputedStyle(btn).display).not.toBe("none")
  expect(getComputedStyle(btn).visibility).not.toBe("hidden")
  expect(btn.className).toContain("text-[11px]")
  expect(btn.className).not.toContain("text-[10px]")
}

describe("template store page — write-review CTA", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("empty Reviews: CTA is visible at DS default size, not 10px sm", async () => {
    mockFetch([])
    render(<TemplateDetailPage />)
    await waitFor(() => {
      expect(screen.getByText("No reviews yet. Be the first!")).toBeTruthy()
    })
    expectFindableCta()
  })

  it("non-empty Reviews: CTA stays visible at DS default size", async () => {
    mockFetch([SAMPLE_REVIEW])
    render(<TemplateDetailPage />)
    await waitFor(() => {
      expect(screen.getByText("Great")).toBeTruthy()
    })
    expectFindableCta()
  })
})

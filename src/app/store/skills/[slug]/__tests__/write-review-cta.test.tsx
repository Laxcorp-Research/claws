// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "test-skill" }),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/store/skills/test-skill",
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "buyer-1" } }, status: "authenticated" }),
}))

import SkillDetailPage from "@/app/store/skills/[slug]/page"

const SAMPLE_REVIEW = {
  id: "rev-1",
  userName: "Alex",
  rating: 5,
  title: "Great",
  body: "Works",
  verifiedInstall: true,
  createdAt: new Date("2026-08-01T00:00:00.000Z").toISOString(),
}

function skillPayload(reviews: typeof SAMPLE_REVIEW[]) {
  return {
    skill: {
      id: "sk-1",
      slug: "test-skill",
      name: "Test Skill",
      emoji: null,
      description: "A skill",
      category: "utility",
      trustTier: "OFFICIAL",
      isFree: true,
      price: 0,
      installCount: 1,
      avgRating: reviews.length ? 5 : null,
      skillMd: "# Skill",
      requiredBins: [],
      requiredEnvVars: [],
      minOpenClawVersion: null,
      creator: null,
      publishedAt: "2026-08-01T00:00:00.000Z",
    },
    reviews,
    reviewCount: reviews.length,
    installStatus: {
      installed: true,
      hasPurchased: true,
      hasRunningWorkspaces: true,
      workspaces: [],
    },
    isOwner: false,
  }
}

function mockFetch(reviews: typeof SAMPLE_REVIEW[]) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/api/marketplace/skills/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: skillPayload(reviews) }),
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
  expect(btn.className).toContain("bg-[var(--tx)]")
  expect(btn.className).toContain("text-white")
  expect(btn.className).not.toContain("text-[var(--tx2)]")
}

describe("skill store page — write-review CTA", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("empty Reviews: CTA is visible at DS default size, not 10px sm", async () => {
    mockFetch([])
    render(<SkillDetailPage />)
    await waitFor(() => {
      expect(screen.getByText("No reviews yet. Be the first!")).toBeTruthy()
    })
    expectFindableCta()
  })

  it("non-empty Reviews: CTA stays visible at DS default size", async () => {
    mockFetch([SAMPLE_REVIEW])
    render(<SkillDetailPage />)
    await waitFor(() => {
      expect(screen.getByText("Great")).toBeTruthy()
    })
    expectFindableCta()
  })
})

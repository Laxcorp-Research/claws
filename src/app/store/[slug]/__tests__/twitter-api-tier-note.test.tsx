// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TWITTER_API_STORE_TIER_NOTE } from "@/lib/tools/twitter-api-honesty"

const mockPush = vi.fn()

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "twitter-growth-machine" }),
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/store/twitter-growth-machine",
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null }),
}))

import TemplateDetailPage from "@/app/store/[slug]/page"

function payload(requiredSlug: string) {
  return {
    template: {
      id: "tpl-twitter",
      name: "Twitter/X Growth Machine",
      slug: "twitter-growth-machine",
      tagline: "Grow",
      description: "Desc",
      category: "CREATOR",
      price: 0,
      isFree: true,
      trustTier: "OFFICIAL",
      installCount: 0,
      avgRating: null,
      estimatedMonthlyCost: "40",
      agentCount: 6,
      version: 1,
      creatorId: null,
      creator: null,
      agents: [{ name: "Twitter Commander", role: "ORCHESTRATOR", color: "#5BA1F5" }],
      tools: {
        required: [
          {
            slug: requiredSlug,
            name: requiredSlug === "twitter-api" ? "Twitter API" : "Tavily",
            category: "Platform",
            connectionType: "API_KEY",
            required: true,
          },
        ],
        recommended: [],
      },
      flowDescription: "Flow",
      legalDisclaimer: null,
    },
    reviews: [],
    reviewCount: 0,
    installCount: 0,
    similar: [],
    hasPurchased: false,
    isOwner: false,
  }
}

describe("store template detail twitter-api tier note", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("shows free-tier read limits on the required Twitter API row", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/marketplace/templates/twitter-growth-machine")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: payload("twitter-api") }),
        } as Response
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) } as Response
    })

    render(<TemplateDetailPage />)
    expect(await screen.findByText("Twitter API")).toBeDefined()
    expect(screen.getByText(TWITTER_API_STORE_TIER_NOTE)).toBeDefined()
  })

  it("does not attach the Twitter tier note to other required tools", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/marketplace/templates/twitter-growth-machine")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: payload("tavily") }),
        } as Response
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) } as Response
    })

    render(<TemplateDetailPage />)
    expect(await screen.findByText("Tavily")).toBeDefined()
    expect(screen.queryByText(TWITTER_API_STORE_TIER_NOTE)).toBeNull()
  })
})

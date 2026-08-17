// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let routeSlug = "medical-practice-manager"
const mockPush = vi.fn()

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: routeSlug }),
  useRouter: () => ({ push: mockPush }),
  usePathname: () => `/store/${routeSlug}`,
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null }),
}))

import TemplateDetailPage from "@/app/store/[slug]/page"
import { COMPLIANCE_NOTICES } from "@/lib/compliance-notices"

function templatePayload(slug: string) {
  return {
    template: {
      id: `tpl-${slug}`,
      name: slug,
      slug,
      tagline: "Template tagline",
      description: "Template description",
      category: "VERTICAL",
      price: 99,
      isFree: false,
      trustTier: "OFFICIAL",
      installCount: 0,
      avgRating: null,
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
    reviews: [],
    reviewCount: 0,
    installCount: 0,
    similar: [],
    hasPurchased: false,
    isOwner: false,
  }
}

function mockStoreFetch() {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/api/marketplace/templates/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: templatePayload(routeSlug) }),
      } as Response
    }
    return { ok: true, status: 200, json: async () => ({ success: true }) } as Response
  })
}

describe("Template detail compliance notices", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    routeSlug = "medical-practice-manager"
    mockStoreFetch()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it.each(Object.keys(COMPLIANCE_NOTICES))("renders compliance block for %s", async (slug) => {
    routeSlug = slug

    render(<TemplateDetailPage />)

    expect(await screen.findByText("Compliance & Responsibility")).toBeDefined()
    expect(screen.getByText(COMPLIANCE_NOTICES[slug])).toBeDefined()
  })

  it("does not render compliance block for an unregulated template", async () => {
    routeSlug = "twitter-growth-machine"

    render(<TemplateDetailPage />)

    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByText("Compliance & Responsibility")).toBeNull()
  })
})

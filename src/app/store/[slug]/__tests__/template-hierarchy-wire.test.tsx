// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CREATOR_TEMPLATES } from "../../../../../prisma/seed-data/creator-templates"
import { buildWorkspaceSnapshotFromSeedTemplate } from "@/lib/marketplace/workspace-snapshot"

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

function twitterSlimSnapshot(): unknown {
  const twitter = CREATOR_TEMPLATES.find((t) => t.slug === "twitter-growth-machine")
  if (!twitter) throw new Error("twitter-growth-machine seed missing")
  const full = JSON.parse(buildWorkspaceSnapshotFromSeedTemplate(twitter)) as {
    agents: Array<{ name: string; agentSlug: string; role: string; color: string }>
    connections: unknown[]
  }
  return {
    agents: full.agents.map((a) => ({
      name: a.name,
      agentSlug: a.agentSlug,
      role: a.role,
      color: a.color,
    })),
    connections: full.connections,
  }
}

describe("store template detail hierarchy wire", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/marketplace/templates/twitter-growth-machine")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
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
                agents: [
                  { name: "Twitter Commander", role: "ORCHESTRATOR", color: "#5BA1F5" },
                ],
                tools: { required: [], recommended: [] },
                flowDescription: "Trend & Topic Scout identifies trending topics",
                legalDisclaimer: null,
                workspaceSnapshot: twitterSlimSnapshot(),
              },
              reviews: [],
              reviewCount: 0,
              installCount: 0,
              similar: [],
              hasPurchased: false,
              isOwner: false,
            },
          }),
        } as Response
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) } as Response
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders hierarchy preview above the flow-description sentence", async () => {
    render(<TemplateDetailPage />)
    const preview = await screen.findByTestId("template-hierarchy-preview")
    expect(preview.querySelectorAll('[data-hierarchy-role="ORCHESTRATOR"]')).toHaveLength(1)
    expect(preview.querySelectorAll('[data-hierarchy-role="WORKER"]')).toHaveLength(4)
    expect(preview.querySelectorAll('[data-hierarchy-role="CRITIC"]')).toHaveLength(1)
    expect(preview.querySelectorAll('[data-edge="dotted"]').length).toBeGreaterThan(0)

    const flow = screen.getByText("Trend & Topic Scout identifies trending topics")
    expect(preview.compareDocumentPosition(flow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

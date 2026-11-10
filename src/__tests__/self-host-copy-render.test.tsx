// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SelfHostProvider } from "@/lib/profile-client"

const FORBIDDEN = ["credits", "trial", "starter", "subscription", "billing", "upgrade"]

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/store",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ workspaceId: "ws-1", n: "1" }),
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
  signOut: vi.fn(),
}))

vi.mock("@/hooks/use-onboarding-state", () => ({
  useOnboardingNavVisible: () => false,
  invalidateOnboardingStateCache: vi.fn(),
}))

vi.mock("@/hooks/use-model-catalog", () => ({
  useModelCatalog: () => ({ options: [], loading: false }),
}))

vi.mock("@/hooks/use-marketplace", () => ({
  useMarketplace: () => ({
    items: [
      {
        id: "t1",
        slug: "twitter-growth-machine",
        name: "Twitter/X Growth Machine",
        tagline: "Grow an audience",
        description: "Six agents",
        category: "CREATOR",
        price: 0,
        isFree: true,
        trustTier: "OFFICIAL",
        installCount: 0,
        avgRating: null,
        agents: [{ name: "Writer" }],
        creator: null,
        flowDescription: "",
      },
    ],
    isLoading: false,
    error: null,
    nextCursor: null,
    totalCount: 1,
    loadMore: () => {},
    isLoadingMore: false,
  }),
}))

function assertNoHostedCopy(html: string) {
  const lower = html.toLowerCase()
  for (const word of FORBIDDEN) {
    expect(lower, word).not.toContain(word)
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("self-host rendered copy", () => {
  it("setup step 1 banner has no credits, trial, starter, subscription, billing, or upgrade", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes("/api/agents/")) {
          return Response.json({
            success: true,
            data: [
              {
                id: "a1",
                name: "Writer",
                role: "WORKER",
                model: "anthropic/claude-haiku-4-5",
                thinkingDefault: null,
              },
            ],
          })
        }
        return Response.json({ success: true, data: [] })
      }),
    )
    const { Step1 } = await import("@/app/setup/[workspaceId]/step/[n]/page")
    render(
      <SelfHostProvider selfHost>
        <Step1 workspaceId="ws-1" />
      </SelfHostProvider>,
    )
    const banner = await screen.findByTestId("setup-model-banner")
    expect(banner.textContent).toBe(
      "Bring your own model key. Anthropic, OpenAI, Google or OpenRouter.",
    )
    await waitFor(() => {
      expect(screen.getByText("Writer")).toBeTruthy()
    })
    assertNoHostedCopy(document.body.innerHTML)
  })

  it("store page has none of those words", async () => {
    const StorePage = (await import("@/app/store/page")).default
    render(
      <SelfHostProvider selfHost>
        <StorePage />
      </SelfHostProvider>,
    )
    expect((await screen.findAllByText("Twitter/X Growth Machine")).length).toBeGreaterThan(0)
    assertNoHostedCopy(document.body.innerHTML)
  })
})

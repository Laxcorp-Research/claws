// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"

const mockPush = vi.fn()
const mockReplace = vi.fn()
vi.mock("next/navigation", () => ({
  useParams: () => ({ workspaceId: "ws-1" }),
  useRouter: () => ({ push: mockPush, replace: mockReplace, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { name: "Ada", email: "ada@example.com" } } }),
}))

const mockStartRedeploy = vi.fn()
vi.mock("@/components/dashboard/use-workspace-redeploy", () => ({
  useWorkspaceRedeploy: vi.fn(() => ({
    modalOpen: false,
    redeploying: false,
    status: null,
    lastStage: null,
    error: null,
    startRedeploy: mockStartRedeploy,
    closeModal: vi.fn(),
    retry: vi.fn(),
  })),
}))

vi.mock("@/hooks/use-credit-balance", () => ({
  useCreditBalance: () => ({
    hasCredits: false,
    status: "INACTIVE",
    totalConsumedCents: 0,
  }),
}))

vi.mock("@/hooks/use-activity-stream", () => ({
  useActivityStream: vi.fn(),
}))

vi.mock("@/components/shared/page-header", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => (
    <header><h1>{title}</h1>{actions}</header>
  ),
}))
vi.mock("@/components/dashboard/briefing-header", () => ({
  BriefingHeader: () => <div>Briefing header</div>,
  clawGreeting: (name: string | null) => `Hi ${name ?? "there"}`,
}))
vi.mock("@/components/dashboard/needs-you-section", () => ({ NeedsYouSection: () => null }))
vi.mock("@/components/dashboard/chat-panel", () => ({ ChatPanel: () => null }))
vi.mock("@/components/dashboard/claw-narrative-row", () => ({ ClawNarrativeRow: () => null }))
vi.mock("@/components/dashboard/briefing-footer", () => ({ BriefingFooter: () => null }))
vi.mock("@/components/dashboard/version-update-banner", () => ({ VersionUpdateBanner: () => null }))
vi.mock("@/components/dashboard/redeploy-progress-modal", () => ({ RedeployProgressModal: () => null }))
vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: ({
    open,
    onConfirm,
    confirmLabel,
  }: {
    open: boolean;
    onConfirm: () => void;
    confirmLabel: string;
  }) => open ? <button onClick={onConfirm}>Confirm {confirmLabel}</button> : null,
}))

import DashboardPage from "@/app/dashboard/[workspaceId]/page"

function activityPayload(mcpSessionHealthStatus: "HEALTHY" | "DEAD" | "UNREACHABLE" | null) {
  return {
    success: true,
    data: {
      workspace: {
        id: "ws-1",
        name: "Sales Claw",
        status: "RUNNING",
        healthStatus: "HEALTHY",
        lastHealthCheck: null,
        lastHealthReason: null,
        mcpSessionHealthStatus,
        mcpSessionCheckedAt: mcpSessionHealthStatus ? "2026-07-04T21:20:00.000Z" : null,
        mcpSessionLastError: mcpSessionHealthStatus === "DEAD" ? "session not found" : null,
        currentMonthApiCost: 0,
        apiSpendLimit: 50,
        costAlertThreshold: 0.8,
        apiKeySource: "USER_OWN_KEY",
      },
      stats: {
        agentsRunning: 1,
        agentsPaused: 0,
        agentsError: 0,
        agentsOffline: 0,
        agentsDegraded: 0,
        tasksToday: 0,
        tasksYesterday: 0,
        apiCostThisMonth: 0,
        apiCostProjected: 0,
        pendingReview: 0,
      },
      agents: [
        {
          id: "agent-1",
          name: "Orchestrator",
          role: "ORCHESTRATOR",
          color: "#000",
          model: "anthropic/claude-sonnet-4-6",
          agentSlug: "orchestrator",
          status: "healthy",
          lastActive: null,
        },
      ],
      pendingApprovals: [],
      spend: { thisMonth: 0, limit: 50, percent: 0 },
      expiredTools: [],
      recentLogs: [],
      agentCosts: [],
    },
  }
}

function mockFetch(mcpSessionHealthStatus: "HEALTHY" | "DEAD" | "UNREACHABLE" | null) {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/api/activity/ws-1")) {
      return { ok: true, json: async () => activityPayload(mcpSessionHealthStatus) } as Response
    }
    if (url.includes("/api/deploy/ws-1/status?drift=1")) {
      return { ok: true, json: async () => ({ success: true, data: { drift: { isStale: false, changedAreas: [] } } }) } as Response
    }
    if (url.includes("/api/user/billing")) {
      return { ok: true, json: async () => ({ success: true, data: { trialUsed: false, trialEndsAt: null, hasActiveSubscription: true } }) } as Response
    }
    return { ok: true, json: async () => ({ success: true }) } as Response
  })
}

describe("DashboardPage MCP session banner", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch("DEAD")
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders the long-tail disconnected banner and uses the shared redeploy flow", async () => {
    render(<DashboardPage />)

    expect(await screen.findByText("Long-tail tools disconnected — redeploy to restore")).toBeDefined()
    fireEvent.click(screen.getAllByRole("button", { name: "Redeploy" }).at(-1)!)
    fireEvent.click(screen.getByRole("button", { name: "Confirm Redeploy" }))

    await waitFor(() => expect(mockStartRedeploy).toHaveBeenCalledTimes(1))
  })

  it("does not render the long-tail banner when the session is healthy", async () => {
    mockFetch("HEALTHY")

    render(<DashboardPage />)

    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByText("Long-tail tools disconnected — redeploy to restore")).toBeNull()
  })
})

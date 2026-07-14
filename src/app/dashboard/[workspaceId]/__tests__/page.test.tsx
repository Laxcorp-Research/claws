// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"

const mockPush = vi.fn()
const mockReplace = vi.fn()
let mockSearchParams = new URLSearchParams()
vi.mock("next/navigation", () => ({
  useParams: () => ({ workspaceId: "ws-1" }),
  useRouter: () => ({ push: mockPush, replace: mockReplace, refresh: vi.fn() }),
  useSearchParams: () => mockSearchParams,
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
    warningText,
  }: {
    open: boolean;
    onConfirm: () => void;
    confirmLabel: string;
    warningText?: string;
  }) => open ? (
    <div>
      {warningText && <p>{warningText}</p>}
      <button onClick={onConfirm}>Confirm {confirmLabel}</button>
    </div>
  ) : null,
}))

import DashboardPage from "@/app/dashboard/[workspaceId]/page"

function activityPayload(opts: {
  mcpSessionHealthStatus: "HEALTHY" | "DEAD" | "UNREACHABLE" | null;
  activitySilenceDetectedAt?: string | null;
  stateSyncStaleDetectedAt?: string | null;
  stateSyncNearCapActive?: boolean;
  healthStatus?: "HEALTHY" | "DEGRADED" | "UNHEALTHY";
  lastHealthCheck?: string | null;
  expiredTools?: Array<{ name: string; status: "ERROR" | "EXPIRED" | "REVOKED"; connectionType: "API_KEY" | "OAUTH_COMPOSIO" | "CHANNEL_NATIVE" }>;
}) {
  const {
    mcpSessionHealthStatus,
    activitySilenceDetectedAt = null,
    stateSyncStaleDetectedAt = null,
    stateSyncNearCapActive = false,
    healthStatus = "HEALTHY",
    lastHealthCheck = null,
    expiredTools = [],
  } = opts
  return {
    success: true,
    data: {
      workspace: {
        id: "ws-1",
        name: "Sales Claw",
        status: "RUNNING",
        healthStatus,
        lastHealthCheck,
        lastHealthReason: null,
        mcpSessionHealthStatus,
        mcpSessionCheckedAt: mcpSessionHealthStatus ? "2026-07-04T21:20:00.000Z" : null,
        mcpSessionLastError: mcpSessionHealthStatus === "DEAD" ? "session not found" : null,
        activitySilenceDetectedAt,
        stateSyncStaleDetectedAt,
        stateSyncNearCapActive,
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
        estimatedCostToday: 0,
        estimatedCostTodayCalls: 0,
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
      expiredTools,
      recentLogs: [
        {
          id: "log-1",
          timestamp: "2026-07-07T12:00:00.000Z",
          agentName: "Orchestrator",
          agentSlug: "orchestrator",
          action: "Task started: draft brief",
          actionType: "TASK_START",
          detail: null,
          runId: "run-1",
          channelId: "webchat",
        },
      ],
      agentCosts: [],
      costWindow: {
        range: "today",
        since: "2026-07-14T00:00:00.000Z",
        agents: [],
        total: 0,
        isEstimate: false,
      },
    },
  }
}

function mockFetch(opts: {
  mcpSessionHealthStatus?: "HEALTHY" | "DEAD" | "UNREACHABLE" | null;
  activitySilenceDetectedAt?: string | null;
  stateSyncStaleDetectedAt?: string | null;
  stateSyncNearCapActive?: boolean;
} = {}) {
  const payloadOptions = {
    mcpSessionHealthStatus: opts.mcpSessionHealthStatus ?? null,
    activitySilenceDetectedAt: opts.activitySilenceDetectedAt ?? null,
    stateSyncStaleDetectedAt: opts.stateSyncStaleDetectedAt ?? null,
    stateSyncNearCapActive: opts.stateSyncNearCapActive ?? false,
  }
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/api/activity/ws-1")) {
      return { ok: true, json: async () => activityPayload(payloadOptions) } as Response
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
    mockSearchParams = new URLSearchParams()
    mockFetch({ mcpSessionHealthStatus: "DEAD" })
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
    mockFetch({ mcpSessionHealthStatus: "HEALTHY" })

    render(<DashboardPage />)

    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByText("Long-tail tools disconnected — redeploy to restore")).toBeNull()
  })

  it("renders the activity silence warning and reuses the Force-restart action", async () => {
    mockFetch({ activitySilenceDetectedAt: "2026-07-05T08:30:00.000Z" })

    render(<DashboardPage />)

    expect(await screen.findByText("Activity feed appears silent — agents may be running but not reporting.")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Force restart" }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/deploy/ws-1/restart", { method: "POST" })
    })
  })

  it("renders the stale memory backup warning and reuses the Force-restart action", async () => {
    mockFetch({ stateSyncStaleDetectedAt: "2026-07-05T08:30:00.000Z" })

    render(<DashboardPage />)

    expect(await screen.findByText("Agent memory backup is stale — recent memory may not survive a restart. Force-restart to restore syncing.")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Force restart" }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/deploy/ws-1/restart", { method: "POST" })
    })
  })

  it("warns about stale memory when the redeploy confirmation opens", async () => {
    mockFetch({ stateSyncStaleDetectedAt: "2026-07-05T08:30:00.000Z" })

    render(<DashboardPage />)

    await screen.findByText("Agent memory backup is stale — recent memory may not survive a restart. Force-restart to restore syncing.")
    fireEvent.click(screen.getAllByRole("button", { name: "Redeploy" })[0])

    expect(await screen.findByText("Memory backup is stale — recent agent memory may be lost.")).toBeDefined()
  })

  it("syncs dashboard tabs to the URL", async () => {
    mockFetch({ mcpSessionHealthStatus: "HEALTHY" })
    render(<DashboardPage />)

    fireEvent.click(await screen.findByRole("tab", { name: "Activity" }))

    expect(mockReplace).toHaveBeenCalledWith("/dashboard/ws-1?tab=activity")
  })

  it("renders the workspace name exactly once in the consolidated header", async () => {
    mockFetch({ mcpSessionHealthStatus: "HEALTHY" })
    render(<DashboardPage />)

    await screen.findByText("Sales Claw")
    expect(screen.getAllByText("Sales Claw")).toHaveLength(1)
  })

  it("preview View all switches to the Activity tab", async () => {
    mockFetch({ mcpSessionHealthStatus: "HEALTHY" })
    render(<DashboardPage />)

    fireEvent.click(await screen.findByRole("button", { name: "View all →" }))

    expect(mockReplace).toHaveBeenCalledWith("/dashboard/ws-1?tab=activity")
  })

  it("Costs preview View details lives in the header row, not the body", async () => {
    mockFetch({ mcpSessionHealthStatus: "HEALTHY" })
    render(<DashboardPage />)

    const costs = await screen.findByRole("region", { name: "Costs" })
    const headerLink = within(costs).getByRole("button", { name: "View details →" })
    expect(headerLink).toBeTruthy()

    const headerRow = headerLink.parentElement
    expect(headerRow?.className).toContain("justify-between")
    expect(within(headerRow!).getByRole("heading", { name: "Costs" })).toBeTruthy()

    // Empty-state body copy is outside the header row (link only in header).
    const bodyEmpty = within(costs).getByText("No estimated calls yet.")
    expect(bodyEmpty.closest(".justify-between")).toBeNull()
    expect(headerLink.closest(".justify-between")).toBeTruthy()
  })

  it("Costs tab keeps zero-call state honest without fabricated $0.00", async () => {
    mockSearchParams = new URLSearchParams("tab=costs")
    mockFetch({ mcpSessionHealthStatus: "HEALTHY" })
    render(<DashboardPage />)

    expect(await screen.findByText("No attributable calls for this range.")).toBeDefined()
    expect(screen.queryByText("$0.00")).toBeNull()
  })

  it("MUTATION-anchored: page does not client-derive costs via costSince/resolveAgentCostWindow", async () => {
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const src = readFileSync(
      join(process.cwd(), "src/app/dashboard/[workspaceId]/page.tsx"),
      "utf8",
    )
    // MUTATION: reinject client-side costSince filter / resolveAgentCostWindow → fails.
    expect(src.includes("resolveAgentCostWindow")).toBe(false)
    expect(/\bcostSince\b/.test(src)).toBe(false)
    expect(src.includes('params.set("costRange", costRange)')).toBe(true)
  })

  it("orders the eight cockpit alerts with container-down first and expands the rest with CTAs intact", async () => {
    const payload = activityPayload({
      mcpSessionHealthStatus: "DEAD",
      activitySilenceDetectedAt: "2026-07-05T08:30:00.000Z",
      stateSyncNearCapActive: true,
      stateSyncStaleDetectedAt: "2026-07-05T08:31:00.000Z",
      healthStatus: "UNHEALTHY",
      lastHealthCheck: "2026-07-05T08:00:00.000Z",
      expiredTools: [{ name: "HubSpot", status: "EXPIRED", connectionType: "OAUTH_COMPOSIO" }],
    })

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/activity/ws-1")) {
        return { ok: true, json: async () => payload } as Response
      }
      if (url.includes("/api/deploy/ws-1/status?drift=1")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              deployment: { containerImage: "ghcr.io/laxcorp-research/openclaw-runtime:2026.5.22" },
              drift: { isStale: true, changedAreas: ["tools"] },
            },
          }),
        } as Response
      }
      if (url.includes("/api/versions/stable")) {
        return {
          ok: true,
          json: async () => ({ success: true, data: { version: "2026.6.6", dockerImage: "runtime:2026.6.6", releaseNotes: null } }),
        } as Response
      }
      if (url.includes("/api/user/billing")) {
        return { ok: true, json: async () => ({ success: true, data: { trialUsed: false, trialEndsAt: null, hasActiveSubscription: true } }) } as Response
      }
      if (url.includes("/api/channels/ws-1/status")) {
        return { ok: true, json: async () => ({ success: true, data: { channels: {}, configuredChannelIds: [], hasConfiguredChannels: false } }) } as Response
      }
      return { ok: true, json: async () => ({ success: true }) } as Response
    })

    render(<DashboardPage />)

    expect(await screen.findByText("Agent container is not responding")).toBeDefined()
    const expander = await screen.findByRole("button", { name: "7 more alerts" })
    expect(screen.queryByText("A runtime update is available — redeploy to apply")).toBeNull()

    fireEvent.click(expander)

    expect(await screen.findByText("Activity feed appears silent — agents may be running but not reporting.")).toBeDefined()
    expect(screen.getByText(/Memory bundle approaching size limit/)).toBeDefined()
    expect(screen.getByRole("button", { name: "Manage sessions" })).toBeDefined()
    expect(screen.getByText("Agent memory backup is stale — recent memory may not survive a restart. Force-restart to restore syncing.")).toBeDefined()
    expect(screen.getByText("HubSpot connection expired")).toBeDefined()
    expect(screen.getByText("Long-tail tools disconnected — redeploy to restore")).toBeDefined()
    expect(screen.getByText("Configuration changed since last deploy — redeploy to apply")).toBeDefined()
    expect(screen.getByText("A runtime update is available — redeploy to apply")).toBeDefined()

    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }))
    expect(mockPush).toHaveBeenCalledWith("/setup/ws-1/step/2?mode=manage")

    fireEvent.click(screen.getAllByRole("button", { name: "Force restart" })[0])
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/deploy/ws-1/restart", { method: "POST" })
    })
  })

  it("renders near-cap banner from synthetic stateSyncNearCapActive and routes Manage sessions", async () => {
    mockFetch({ stateSyncNearCapActive: true })
    render(<DashboardPage />)

    expect(await screen.findByText(/Memory bundle approaching size limit/)).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Manage sessions" }))
    expect(mockPush).toHaveBeenCalledWith("/dashboard/ws-1?tab=conversations")
  })

  it("hides near-cap banner when stateSyncNearCapActive is false (auto-resolved)", async () => {
    mockFetch({ stateSyncNearCapActive: false, activitySilenceDetectedAt: "2026-07-05T08:30:00.000Z" })
    render(<DashboardPage />)

    expect(await screen.findByText("Activity feed appears silent — agents may be running but not reporting.")).toBeDefined()
    expect(screen.queryByText(/Memory bundle approaching size limit/)).toBeNull()
  })
})

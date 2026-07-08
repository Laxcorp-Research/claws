// PR-3 — dashboard agentStatus derivation tests.
//
// The previous derivation was a tautology: any workspace with
// status=RUNNING returned all agents as "healthy" regardless of actual
// reachability, because no cron ever wrote workspace.healthStatus.
//
// With /api/cron/health-monitor now writing honest health data, the
// derivation depends on (workspace.status, workspace.healthStatus,
// agent.isPaused). These tests lock the precedence and the
// agentsRunning headcount fix.

import { gzipSync } from "node:zlib";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock } from "@/test/helpers/mock-prisma";
import { createMockRequest } from "@/test/helpers/mock-request";

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/api/auth", () => ({
  getSessionUser: vi.fn(async () => ({ id: "user-1" })),
}));
vi.mock("@/lib/api/ownership", () => ({
  verifyWorkspaceOwnership: vi.fn(),
}));
vi.mock("@/lib/credits/api-key-source", () => ({
  getApiKeySource: vi.fn(() => "user"),
}));
vi.mock("@/lib/security/sanitize", () => ({
  sanitizeActivityText: vi.fn((s: string) => s),
  // Passthrough with the null-for-empty contract (real HTML-strip + cap is
  // unit-tested in src/lib/security/__tests__/sanitize.test.ts). This lets the
  // route test assert the wiring: detail flows through, absent → null.
  sanitizeActivityDetail: vi.fn((s: string | null | undefined) => (s && s.length > 0 ? s : null)),
}));

import { GET } from "@/app/api/activity/[workspaceId]/route";
import { verifyWorkspaceOwnership } from "@/lib/api/ownership";

const WORKSPACE_ID = "ws-1";

type WsOverrides = {
  status?: "RUNNING" | "PAUSED" | "HIBERNATED" | "ERROR" | "STOPPED";
  healthStatus?: "HEALTHY" | "DEGRADED" | "UNHEALTHY" | "UNKNOWN";
  isPaused?: boolean;
  workerPaused?: boolean;
  lastHealthReason?: string | null;
  lastHealthCheck?: Date | null;
  expiredTools?: Array<{ displayName: string; status: string; connectionType: string }>;
  todayCallGroups?: Array<{ agentSlug: string | null; _count: { _all: number } }>;
  query?: string;
  recentRows?: unknown[];
  deployedPausedWorkers?: string[];
};

async function callRoute(opts: WsOverrides) {
  const workspace = {
    id: WORKSPACE_ID,
    name: "ws",
    status: opts.status ?? "RUNNING",
    healthStatus: opts.healthStatus ?? "HEALTHY",
    lastHealthReason: opts.lastHealthReason ?? null,
    lastHealthCheck: opts.lastHealthCheck ?? null,
    currentMonthApiCost: 0,
    apiSpendLimit: 50,
    costAlertThreshold: 0.8,
  };
  (verifyWorkspaceOwnership as ReturnType<typeof vi.fn>).mockResolvedValue({
    error: null,
    workspace,
  });
  (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ apiKeySource: "user" } as never);
  (prismaMock.agent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
    {
      id: "a1",
      name: "Orchestrator",
      role: "ORCHESTRATOR",
      color: "#fff",
      model: "claude",
      agentSlug: "orchestrator",
      isPaused: opts.isPaused ?? false,
      lastActiveAt: null,
    },
    {
      id: "a2",
      name: "Worker",
      role: "WORKER",
      color: "#fff",
      model: "claude",
      agentSlug: "worker",
      isPaused: opts.workerPaused ?? false,
      lastActiveAt: null,
    },
  ] as never);
  (prismaMock.activityLog.count as ReturnType<typeof vi.fn>).mockResolvedValue(0 as never);
  (prismaMock.activityLog.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({ _sum: { apiCost: 0 } } as never);
  (prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockImplementation((args: { orderBy?: unknown }) => {
    if (Array.isArray(args.orderBy)) return Promise.resolve((opts.recentRows ?? []) as never);
    return Promise.resolve([] as never);
  });
  (prismaMock.activityLog.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue((opts.todayCallGroups ?? []) as never);
  (prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mockResolvedValue((opts.expiredTools ?? []) as never);
  (prismaMock.deployment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
    configSnapshotGzip: gzipSync(JSON.stringify({
      workspaces: {
        "workspace-test-commander": {
          "TOOLS.md": (opts.deployedPausedWorkers ?? [])
            .map((name) => `- Worker ${name} is paused — do not delegate to it.`)
            .join("\n"),
        },
      },
    })),
  } as never);
  // The route also runs $queryRawUnsafe twice. Mock that.
  (prismaMock.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue([] as never);

  const req = createMockRequest(`http://localhost:3000/api/activity/${WORKSPACE_ID}${opts.query ?? ""}`, { method: "GET" });
  const res = await GET(req, { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) });
  const body = await res.json();
  return body.data;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("agentStatus derivation: precedence (PR-3 honest health)", () => {
  it("HEALTHY workspace → both agents healthy, agentsRunning=2", async () => {
    const data = await callRoute({ status: "RUNNING", healthStatus: "HEALTHY" });
    expect(data.agents.map((a: { status: string }) => a.status)).toEqual(["healthy", "healthy"]);
    expect(data.stats.agentsRunning).toBe(2);
    expect(data.stats.agentsPaused).toBe(0);
  });

  it("UNHEALTHY workspace → both agents error, agentsRunning=0 (PR-3: fix the headcount tautology)", async () => {
    const data = await callRoute({ status: "RUNNING", healthStatus: "UNHEALTHY" });
    expect(data.agents.map((a: { status: string }) => a.status)).toEqual(["error", "error"]);
    // The bug: prior code returned 2 here (agents.length - pausedCount=0).
    // Fix: count only healthy + degraded.
    expect(data.stats.agentsRunning).toBe(0);
  });

  it("DEGRADED workspace → both agents degraded, agentsRunning=2 (degraded still counts)", async () => {
    const data = await callRoute({ status: "RUNNING", healthStatus: "DEGRADED" });
    expect(data.agents.map((a: { status: string }) => a.status)).toEqual(["degraded", "degraded"]);
    expect(data.stats.agentsRunning).toBe(2);
  });

  it("PAUSED workspace overrides healthStatus → both paused", async () => {
    const data = await callRoute({ status: "PAUSED", healthStatus: "HEALTHY" });
    expect(data.agents.map((a: { status: string }) => a.status)).toEqual(["paused", "paused"]);
    expect(data.stats.agentsRunning).toBe(0);
    expect(data.stats.agentsPaused).toBe(2);
  });

  it("isPaused agent (precedence #1) wins over UNHEALTHY workspace", async () => {
    const data = await callRoute({ status: "RUNNING", healthStatus: "UNHEALTHY", isPaused: true });
    // a1 is paused, a2 takes the workspace UNHEALTHY → error.
    expect(data.agents[0].status).toBe("paused");
    expect(data.agents[1].status).toBe("error");
    expect(data.stats.agentsRunning).toBe(0);
    expect(data.stats.agentsPaused).toBe(1);
  });

  it("HIBERNATED workspace → offline (precedence #2)", async () => {
    const data = await callRoute({ status: "HIBERNATED", healthStatus: "HEALTHY" });
    expect(data.agents.every((a: { status: string }) => a.status === "offline")).toBe(true);
    expect(data.stats.agentsRunning).toBe(0);
  });

  it("ERROR workspace → offline (status != RUNNING precedes healthStatus)", async () => {
    const data = await callRoute({ status: "ERROR", healthStatus: "HEALTHY" });
    expect(data.agents.every((a: { status: string }) => a.status === "offline")).toBe(true);
    expect(data.stats.agentsRunning).toBe(0);
  });

  it("STOPPED workspace → offline", async () => {
    const data = await callRoute({ status: "STOPPED", healthStatus: "HEALTHY" });
    expect(data.agents.every((a: { status: string }) => a.status === "offline")).toBe(true);
  });
});

describe("PR-4: stats per-status breakdown for the truthful StatCard subtext", () => {
  it("UNHEALTHY → agentsError=2, others 0", async () => {
    const data = await callRoute({ status: "RUNNING", healthStatus: "UNHEALTHY" });
    expect(data.stats.agentsError).toBe(2);
    expect(data.stats.agentsOffline).toBe(0);
    expect(data.stats.agentsDegraded).toBe(0);
    expect(data.stats.agentsPaused).toBe(0);
  });

  it("DEGRADED → agentsDegraded=2, agentsError=0", async () => {
    const data = await callRoute({ status: "RUNNING", healthStatus: "DEGRADED" });
    expect(data.stats.agentsDegraded).toBe(2);
    expect(data.stats.agentsError).toBe(0);
    expect(data.stats.agentsRunning).toBe(2);
  });

  it("HIBERNATED → agentsOffline=2", async () => {
    const data = await callRoute({ status: "HIBERNATED", healthStatus: "HEALTHY" });
    expect(data.stats.agentsOffline).toBe(2);
    expect(data.stats.agentsError).toBe(0);
  });

  it("isPaused agent + UNHEALTHY workspace → 1 paused + 1 error", async () => {
    const data = await callRoute({ status: "RUNNING", healthStatus: "UNHEALTHY", isPaused: true });
    expect(data.stats.agentsPaused).toBe(1);
    expect(data.stats.agentsError).toBe(1);
  });
});

describe("PR-4: workspace health fields surfaced for the banner", () => {
  it("surfaces lastHealthReason and lastHealthCheck (ISO) on the workspace", async () => {
    const when = new Date("2026-05-30T08:00:00.000Z");
    const data = await callRoute({
      status: "RUNNING",
      healthStatus: "DEGRADED",
      lastHealthReason: "plugin-not-loaded",
      lastHealthCheck: when,
    });
    expect(data.workspace.lastHealthReason).toBe("plugin-not-loaded");
    expect(data.workspace.lastHealthCheck).toBe(when.toISOString());
  });

  it("null lastHealthCheck/lastHealthReason surface as null (no crash)", async () => {
    const data = await callRoute({ status: "RUNNING", healthStatus: "HEALTHY" });
    expect(data.workspace.lastHealthCheck).toBeNull();
    expect(data.workspace.lastHealthReason).toBeNull();
  });
});

describe("tool connection banner data", () => {
  it("surfaces swept EXPIRED ToolConnection rows through expiredTools for the existing dashboard banner", async () => {
    const data = await callRoute({
      status: "RUNNING",
      healthStatus: "HEALTHY",
      expiredTools: [
        { displayName: "HubSpot", status: "EXPIRED", connectionType: "OAUTH_COMPOSIO" },
      ],
    });

    expect(data.expiredTools).toEqual([
      { name: "HubSpot", status: "EXPIRED", connectionType: "OAUTH_COMPOSIO" },
    ]);
    const query = (prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(query.where.status.in).toEqual(["ERROR", "EXPIRED", "REVOKED"]);
  });
});

describe("K1 command strip data", () => {
  it("counts tasks today from TASK_COMPLETE and estimates cost from attributed completions", async () => {
    const data = await callRoute({
      status: "RUNNING",
      healthStatus: "HEALTHY",
      todayCallGroups: [{ agentSlug: "worker", _count: { _all: 4 } }],
    });

    const firstTaskCount = (prismaMock.activityLog.count as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(firstTaskCount.where.actionType).toBe("TASK_COMPLETE");
    expect(data.stats.estimatedCostTodayCalls).toBe(4);
    expect(data.stats.estimatedCostToday).toBe(0.06);
  });
});

describe("K3 pause pending truth", () => {
  it("returns pauseApplied from last deployed snapshot, not DB-only pause state", async () => {
    const pending = await callRoute({ status: "RUNNING", healthStatus: "HEALTHY", workerPaused: true, deployedPausedWorkers: [] });
    expect(pending.agents[1].isPaused).toBe(true);
    expect(pending.agents[1].pauseApplied).toBe(false);

    const applied = await callRoute({ status: "RUNNING", healthStatus: "HEALTHY", workerPaused: true, deployedPausedWorkers: ["Worker"] });
    expect(applied.agents[1].pauseApplied).toBe(true);
  });
});

describe("K2 activity pagination and filters", () => {
  it("uses the extracted channelId column with capped cursor pagination filters", async () => {
    await callRoute({
      status: "RUNNING",
      healthStatus: "HEALTHY",
      query: "?agentSlug=worker&actionType=TASK_START&actionType=TASK_COMPLETE&channelId=webchat&since=2026-07-07T00:00:00.000Z&until=2026-07-08T00:00:00.000Z&q=brief&limit=75",
    });

    const recentQuery = (prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mock.calls.find(([arg]) =>
      Array.isArray(arg.orderBy),
    )?.[0];
    expect(recentQuery.take).toBe(51);
    expect(recentQuery.where.channelId).toBe("webchat");
    expect(recentQuery.where.metadata).toBeUndefined();
    expect(recentQuery.where.agentSlug).toBe("worker");
    expect(recentQuery.where.actionType).toEqual({ in: ["TASK_START", "TASK_COMPLETE"] });
    expect(recentQuery.where.action).toEqual({ contains: "brief", mode: "insensitive" });
    expect(recentQuery.where.AND[0].timestamp).toEqual({
      gte: new Date("2026-07-07T00:00:00.000Z"),
      lte: new Date("2026-07-08T00:00:00.000Z"),
    });
  });

  it("returns a timestamp+id cursor and applies it to page 2 without overlap", async () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({
      id: `log-${String(index).padStart(2, "0")}`,
      timestamp: new Date(`2026-07-07T12:${String(59 - index).padStart(2, "0")}:00.000Z`),
      agentName: "Worker",
      agentSlug: "worker",
      action: `Task ${index}`,
      detail: null,
      actionType: "TASK_COMPLETE",
      apiCost: null,
      channelId: "webchat",
      metadata: JSON.stringify({ runId: `run-${index}`, channelId: "webchat" }),
    }));
    const page1 = await callRoute({ status: "RUNNING", healthStatus: "HEALTHY", recentRows: rows });
    expect(page1.recentLogs).toHaveLength(50);
    expect(page1.activityPage.hasMore).toBe(true);
    expect(page1.activityPage.nextCursor).toEqual(expect.any(String));

    vi.clearAllMocks();
    await callRoute({
      status: "RUNNING",
      healthStatus: "HEALTHY",
      query: `?cursor=${encodeURIComponent(page1.activityPage.nextCursor)}`,
      recentRows: rows,
    });
    const page2Query = (prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mock.calls.find(([arg]) =>
      Array.isArray(arg.orderBy),
    )?.[0];
    expect(page2Query.where.AND).toEqual([
      {
        OR: [
          { timestamp: { lt: rows[49].timestamp } },
          { timestamp: rows[49].timestamp, id: { lt: rows[49].id } },
        ],
      },
    ]);
  });
});

describe("PR-4: recentLogs detail passthrough", () => {
  it("wires detail through sanitizeActivityDetail; null when absent", async () => {
    // Differentiate the recentLogs query (no actionType filter) from the
    // human-request/response queries so only the feed query returns rows.
    (verifyWorkspaceOwnership as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: null,
      workspace: {
        id: WORKSPACE_ID, name: "ws", status: "RUNNING", healthStatus: "HEALTHY",
        lastHealthReason: null, lastHealthCheck: null,
        currentMonthApiCost: 0, apiSpendLimit: 50, costAlertThreshold: 0.8,
      },
    });
    (prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ apiKeySource: "user" } as never);
    (prismaMock.agent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([] as never);
    (prismaMock.activityLog.count as ReturnType<typeof vi.fn>).mockResolvedValue(0 as never);
    (prismaMock.activityLog.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({ _sum: { apiCost: 0 } } as never);
    (prismaMock.activityLog.groupBy as ReturnType<typeof vi.fn>).mockResolvedValue([] as never);
    (prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([] as never);
    (prismaMock.deployment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null as never);
    (prismaMock.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue([] as never);
    (prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockImplementation((args: { where?: { actionType?: unknown } }) => {
      // Only the recentLogs query has no actionType filter.
      if (args?.where && args.where.actionType === undefined) {
        return Promise.resolve([
          { id: "log-1", timestamp: new Date("2026-05-30T08:00:00Z"), agentName: "Orchestrator", agentSlug: "orchestrator", action: "Heartbeat check", detail: "[cron:heartbeat-x] Read HEARTBEAT.md and follow it strictly.", actionType: "HEARTBEAT", apiCost: null, channelId: null, metadata: null },
          { id: "log-2", timestamp: new Date("2026-05-30T07:59:00Z"), agentName: "Worker", agentSlug: "worker", action: "Task completed in 2s", detail: null, actionType: "TASK_COMPLETE", apiCost: null, channelId: "webchat", metadata: JSON.stringify({ runId: "run-2", channelId: "webchat" }) },
        ]) as never;
      }
      return Promise.resolve([] as never);
    });

    const req = createMockRequest(`http://localhost:3000/api/activity/${WORKSPACE_ID}`, { method: "GET" });
    const res = await GET(req, { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) });
    const body = await res.json();
    const logs = body.data.recentLogs as Array<{ id: string; detail: string | null; channelId: string | null; runId: string | null }>;
    const log1 = logs.find((l) => l.id === "log-1")!;
    const log2 = logs.find((l) => l.id === "log-2")!;
    // detail present flows through to the response.
    expect(log1.detail).toBe("[cron:heartbeat-x] Read HEARTBEAT.md and follow it strictly.");
    // Absent detail → null (no expand affordance client-side).
    expect(log2.detail).toBeNull();
    expect(log2.channelId).toBe("webchat");
    expect(log2.runId).toBe("run-2");
  });
});

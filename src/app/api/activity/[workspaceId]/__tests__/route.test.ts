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
  lastHealthReason?: string | null;
  lastHealthCheck?: Date | null;
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
      isPaused: false,
      lastActiveAt: null,
    },
  ] as never);
  (prismaMock.activityLog.count as ReturnType<typeof vi.fn>).mockResolvedValue(0 as never);
  (prismaMock.activityLog.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({ _sum: { apiCost: 0 } } as never);
  (prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([] as never);
  (prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([] as never);
  // The route also runs $queryRawUnsafe twice. Mock that.
  (prismaMock.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue([] as never);

  const req = createMockRequest(`http://localhost:3000/api/activity/${WORKSPACE_ID}`, { method: "GET" });
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
    (prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([] as never);
    (prismaMock.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue([] as never);
    (prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockImplementation((args: { where?: { actionType?: unknown } }) => {
      // Only the recentLogs query has no actionType filter.
      if (args?.where && args.where.actionType === undefined) {
        return Promise.resolve([
          { id: "log-1", timestamp: new Date("2026-05-30T08:00:00Z"), agentName: "Orchestrator", action: "Heartbeat check", detail: "[cron:heartbeat-x] Read HEARTBEAT.md and follow it strictly.", actionType: "HEARTBEAT", apiCost: null },
          { id: "log-2", timestamp: new Date("2026-05-30T07:59:00Z"), agentName: "Worker", action: "Task completed in 2s", detail: null, actionType: "TASK_COMPLETE", apiCost: null },
        ]) as never;
      }
      return Promise.resolve([] as never);
    });

    const req = createMockRequest(`http://localhost:3000/api/activity/${WORKSPACE_ID}`, { method: "GET" });
    const res = await GET(req, { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) });
    const body = await res.json();
    const logs = body.data.recentLogs as Array<{ id: string; detail: string | null }>;
    const log1 = logs.find((l) => l.id === "log-1")!;
    const log2 = logs.find((l) => l.id === "log-2")!;
    // detail present flows through to the response.
    expect(log1.detail).toBe("[cron:heartbeat-x] Read HEARTBEAT.md and follow it strictly.");
    // Absent detail → null (no expand affordance client-side).
    expect(log2.detail).toBeNull();
  });
});

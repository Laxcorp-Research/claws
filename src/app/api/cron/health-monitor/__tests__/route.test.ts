// PR-3 - tests for /api/cron/health-monitor.
//
// This route owns workspace.healthStatus / lastHealthCheck / status /
// consecutiveHealthFailures. The mapping table from the audit
// (src/app/api/cron/health-monitor/route.ts top-of-file) is the spec
// - these tests are the contract.
//
// MUTATION-anchored cases below double as regression locks:
//   - "MUTATION-anchored UNHEALTHY threshold": breaking
//     UNHEALTHY_THRESHOLD from 2 to 1 must make a specific test fail.
//   - "MUTATION-anchored ERROR threshold": breaking ERROR_THRESHOLD
//     from 5 to 4 must make a specific test fail.
// Verified by deliberately patching the source and re-running - see
// the PR description.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prismaMock } from "@/test/helpers/mock-prisma";
import { createMockRequest } from "@/test/helpers/mock-request";

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/encryption", () => ({
  decrypt: vi.fn((s: string) => `decrypted:${s}`),
}));

const mockClearParked = vi.hoisted(() => vi.fn())
const mockHealRunning = vi.hoisted(() => vi.fn())
vi.mock("@/lib/healing/stale-sync", () => ({
  clearParkedStaleSyncFlags: (...args: unknown[]) => mockClearParked(...args),
  healRunningStaleSync: (...args: unknown[]) => mockHealRunning(...args),
}))
vi.mock("@/lib/healing/runtime-heals", () => ({
  planHealthRuntimeHeal: () => null,
  scheduleHealthRuntimeHeal: vi.fn(),
}))
vi.mock("@/lib/healing/mission-resume", () => ({
  maybeLedgerMissionInterrupted: vi.fn().mockResolvedValue(false),
}))

import { GET, __internal } from "@/app/api/cron/health-monitor/route";

const CRON_SECRET = "test-cron-secret";

function makeWs(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "ws-1",
    status: "RUNNING" as const,
    healthStatus: "HEALTHY" as const,
    consecutiveHealthFailures: 0,
    containerId: "rwy-svc-1",
    containerHost: "claw-ws-1.up.railway.app",
    gatewayToken: "enc:tok",
    activitySilenceDetectedAt: null,
    stateSyncStaleDetectedAt: null,
    stateSyncStaleConsecutive: 0,
    heartbeatMissedAt: null,
    containerState: {
      runtimeStateUpdatedAt: new Date(),
      containerPhase: "RUNNING",
      heartbeatCronExpressions: null,
    },
    deployments: [{ completedAt: new Date(Date.now() - 20 * 60 * 1000) }],
    ...overrides,
  };
}

function makeReq(opts: { auth?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.auth !== undefined) headers["authorization"] = opts.auth;
  return createMockRequest("http://localhost:3000/api/cron/health-monitor", {
    method: "GET",
    headers,
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const HEALTHY_PAYLOAD = {
  ok: true,
  payload: {
    ok: true,
    ts: Date.now(),
    durationMs: 1,
    agents: [{ agentId: "orchestrator", isDefault: true }],
    plugins: { loaded: ["foo"], errors: [] },
    channels: {},
    channelOrder: [],
    channelLabels: {},
    heartbeatSeconds: 60,
    defaultAgentId: "orchestrator",
    sessions: { path: "/", count: 0, recent: [] },
  },
};

// PR-4b helpers: build non-JSON responses + route the fetch mock by URL
// (probeWorkspace fires the admin-rpc POST and, only on a 404, a /healthz GET).
function textResponse(body: string, status: number, contentType = "text/plain; charset=utf-8") {
  return new Response(body, { status, headers: { "Content-Type": contentType } });
}

function rawResponse(body: string, status: number, contentType: string) {
  return new Response(body, { status, headers: { "Content-Type": contentType } });
}

function aborted(): never {
  const e = new Error("aborted");
  e.name = "AbortError";
  throw e;
}

function mockProbeFetch(opts: { adminRpc: Response | (() => never); healthz?: Response | (() => never) }) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
    const u = String(input);
    if (u.includes("/healthz")) {
      if (opts.healthz === undefined) throw new Error("test: unexpected /healthz fetch");
      return typeof opts.healthz === "function" ? opts.healthz() : opts.healthz;
    }
    return typeof opts.adminRpc === "function" ? opts.adminRpc() : opts.adminRpc;
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET;
  vi.restoreAllMocks();
  mockClearParked.mockReset()
  mockHealRunning.mockReset()
  mockClearParked.mockResolvedValue(0)
  mockHealRunning.mockResolvedValue({ cleared: false, alert: false, synced: false })
  // P4 stranded adopter sibling pass - default empty (no stranded deploys).
  ;(prismaMock.deployment.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

// ─── Auth gate ─────────────────────────────────────────────────────────

describe("auth gate", () => {
  it("rejects when CRON_SECRET env is unset", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeReq({ auth: "Bearer anything" }));
    expect(res.status).toBe(401);
  });

  it("rejects missing Authorization header", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("rejects wrong token", async () => {
    const res = await GET(makeReq({ auth: "Bearer wrong" }));
    expect(res.status).toBe(401);
  });

  it("accepts correct Bearer token and runs the loop", async () => {
    (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const res = await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.workspacesProbed).toBe(0);
  });
});

// ─── Iteration scope ───────────────────────────────────────────────────

describe("iteration scope", () => {
  it("iterates RUNNING + ERROR workspaces (PR-4a: ERROR re-probed to self-heal; deliberate-off skipped)", async () => {
    (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }));
    const call = (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call?.where).toEqual({ status: { in: ["RUNNING", "ERROR"] } });
  });
});

// ─── Probe branches via probeWorkspace (the network mapping) ──────────

describe("probeWorkspace: zombie state (no container)", () => {
  it("returns failure/no-container when containerId is null", async () => {
    const ws = makeWs({ containerId: null });
    const result = await __internal.probeWorkspace(ws as never);
    expect(result.result.kind).toBe("failure");
    if (result.result.kind === "failure") expect(result.result.reason).toBe("no-container");
    expect(result.httpStatus).toBeNull();
  });

  it("returns failure/no-container when containerHost is null", async () => {
    const ws = makeWs({ containerHost: null });
    const result = await __internal.probeWorkspace(ws as never);
    expect(result.result.kind).toBe("failure");
    if (result.result.kind === "failure") expect(result.result.reason).toBe("no-container");
  });

  it("returns failure/no-container when gatewayToken is null", async () => {
    const ws = makeWs({ gatewayToken: null });
    const result = await __internal.probeWorkspace(ws as never);
    expect(result.result.kind).toBe("failure");
    if (result.result.kind === "failure") expect(result.result.reason).toBe("no-container");
  });
});

describe("probeWorkspace: HTTP responses", () => {
  it("HTTP 200 ok:true with agents and no plugin errors → healthy", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(HEALTHY_PAYLOAD));
    const result = await __internal.probeWorkspace(makeWs() as never);
    expect(result.result.kind).toBe("healthy");
    expect(result.httpStatus).toBe(200);
    expect(spy).toHaveBeenCalledOnce();
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe("https://claw-ws-1.up.railway.app/api/v1/admin/rpc");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer decrypted:enc:tok");
  });

  it("HTTP 200 ok:true with plugin errors → degraded/plugin-errors", async () => {
    const payload = {
      ok: true,
      payload: { ...HEALTHY_PAYLOAD.payload, plugins: { loaded: [], errors: [{ id: "x", origin: "y", activated: false, error: "boom" }] } },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(payload));
    const result = await __internal.probeWorkspace(makeWs() as never);
    expect(result.result.kind).toBe("degraded");
    if (result.result.kind === "degraded") expect(result.result.reason).toBe("plugin-errors");
  });

  it("HTTP 200 ok:true with zero agents → degraded/no-agents", async () => {
    const payload = { ok: true, payload: { ...HEALTHY_PAYLOAD.payload, agents: [] } };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(payload));
    const result = await __internal.probeWorkspace(makeWs() as never);
    expect(result.result.kind).toBe("degraded");
    if (result.result.kind === "degraded") expect(result.result.reason).toBe("no-agents");
  });

  it("HTTP 200 ok:false envelope → failure/envelope-failed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: false, error: { code: "UNAVAILABLE", message: "x" } }));
    const result = await __internal.probeWorkspace(makeWs() as never);
    expect(result.result.kind).toBe("failure");
    if (result.result.kind === "failure") expect(result.result.reason).toBe("envelope-failed");
  });

  it("HTTP 5xx → failure/http-5xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: false }, 503));
    const result = await __internal.probeWorkspace(makeWs() as never);
    expect(result.result.kind).toBe("failure");
    if (result.result.kind === "failure") expect(result.result.reason).toBe("http-5xx");
  });

  it("network exception (non-abort) → failure/network", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    const result = await __internal.probeWorkspace(makeWs() as never);
    expect(result.result.kind).toBe("failure");
    if (result.result.kind === "failure") expect(result.result.reason).toBe("network");
    expect(result.httpStatus).toBeNull();
  });

  it("AbortError → failure/timeout", async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(err);
    const result = await __internal.probeWorkspace(makeWs() as never);
    expect(result.result.kind).toBe("failure");
    if (result.result.kind === "failure") expect(result.result.reason).toBe("timeout");
  });
});

// ─── PR-4b: 404 / 401 false-heal guard ───────────────────────────────────
// A bare 404/401 from an edge/CDN/dead service must NOT heal a stuck ERROR.
// 404 → plugin-not-loaded only if /healthz confirms our gateway is live.
// 401 → bad-token only if the body carries the gateway's { error.type:
// "unauthorized" } envelope. Everything else → no-route failure.

describe("PR-4b: 404 disambiguation via /healthz", () => {
  // (a) our gateway, plugin disabled: 404 text/plain "Not Found" + /healthz 200
  it("(a) gateway 404 'Not Found' + /healthz 200 → plugin-not-loaded (heal-eligible)", async () => {
    mockProbeFetch({
      adminRpc: textResponse("Not Found", 404),
      healthz: jsonResponse({ ok: true, status: "live" }, 200),
    });
    const r = await __internal.probeWorkspace(makeWs() as never);
    expect(r.result.kind).toBe("degraded");
    if (r.result.kind === "degraded") expect(r.result.reason).toBe("plugin-not-loaded");
    expect(r.httpStatus).toBe(404);
  });

  // (b) bare HTML 404 (e.g. an intermediary), /healthz also fails → no-route
  it("(b) bare HTML 404 + /healthz fails → no-route failure (no heal)", async () => {
    mockProbeFetch({
      adminRpc: rawResponse("<html><body>not found</body></html>", 404, "text/html"),
      healthz: rawResponse("<html>nope</html>", 404, "text/html"),
    });
    const r = await __internal.probeWorkspace(makeWs() as never);
    expect(r.result.kind).toBe("failure");
    if (r.result.kind === "failure") expect(r.result.reason).toBe("no-route");
  });

  // (c) Railway-edge-style JSON 404 (NOT our gateway), /healthz fails → no-route.
  // This is the one that defeats a naive "404 + JSON ⟹ heal" rule.
  it("(c) Railway-edge JSON 404 + /healthz fails → no-route failure (no heal)", async () => {
    mockProbeFetch({
      adminRpc: jsonResponse({ status: "error", message: "Application not found" }, 404),
      healthz: jsonResponse({ status: "error", message: "Application not found" }, 404),
    });
    const r = await __internal.probeWorkspace(makeWs() as never);
    expect(r.result.kind).toBe("failure");
    if (r.result.kind === "failure") expect(r.result.reason).toBe("no-route");
  });

  // (f) /healthz times out on the 404 path → fail closed → no-route
  it("(f) gateway 404 + /healthz timeout → no-route failure (fail closed)", async () => {
    mockProbeFetch({ adminRpc: textResponse("Not Found", 404), healthz: aborted });
    const r = await __internal.probeWorkspace(makeWs() as never);
    expect(r.result.kind).toBe("failure");
    if (r.result.kind === "failure") expect(r.result.reason).toBe("no-route");
  });

  // (g) /healthz returns 200 with NON-gateway JSON → still heal (status-only check)
  it("(g) 404 + /healthz 200 with non-gateway JSON body → plugin-not-loaded (any 200 is good enough)", async () => {
    mockProbeFetch({
      adminRpc: textResponse("Not Found", 404),
      healthz: jsonResponse({ totally: "different", shape: true }, 200),
    });
    const r = await __internal.probeWorkspace(makeWs() as never);
    expect(r.result.kind).toBe("degraded");
    if (r.result.kind === "degraded") expect(r.result.reason).toBe("plugin-not-loaded");
  });

  // REGRESSION LOCK - the exact PR-4a WIRE-TEST heal path must still work.
  // text/plain "Not Found" on admin-rpc, 200 {"ok":true,"status":"live"} on
  // /healthz → plugin-not-loaded → (via decideUpdate) heals ERROR→RUNNING.
  it("REGRESSION: PR-4a WIRE-TEST path (404 'Not Found' + /healthz live 200) still heals", async () => {
    mockProbeFetch({
      adminRpc: textResponse("Not Found", 404),
      healthz: jsonResponse({ ok: true, status: "live" }, 200),
    });
    const probe = await __internal.probeWorkspace(makeWs({ status: "ERROR", healthStatus: "UNHEALTHY", consecutiveHealthFailures: 5 }) as never);
    expect(probe.result.kind).toBe("degraded");
    if (probe.result.kind === "degraded") expect(probe.result.reason).toBe("plugin-not-loaded");
    // and decideUpdate still heals it
    const u = __internal.decideUpdate(
      { status: "ERROR", healthStatus: "UNHEALTHY", consecutiveHealthFailures: 5 },
      probe.result,
      1_700_000_000_000,
    );
    expect(u.status).toBe("RUNNING");
    expect(u.healthStatus).toBe("DEGRADED");
    expect(u.lastHealthReason).toBe("plugin-not-loaded");
  });
});

describe("PR-4b: 401 gating on gateway envelope", () => {
  // (d) gateway 401 with { error.type: "unauthorized" } → bad-token (heal-eligible)
  it("(d) gateway 401 envelope → bad-token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: { message: "Unauthorized", type: "unauthorized" } }, 401),
    );
    const r = await __internal.probeWorkspace(makeWs() as never);
    expect(r.result.kind).toBe("degraded");
    if (r.result.kind === "degraded") expect(r.result.reason).toBe("bad-token");
    expect(r.httpStatus).toBe(401);
  });

  // (e) bare text/plain 401 (non-gateway) → no-route
  it("(e) bare text 401 → no-route failure (no heal)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(textResponse("Unauthorized", 401));
    const r = await __internal.probeWorkspace(makeWs() as never);
    expect(r.result.kind).toBe("failure");
    if (r.result.kind === "failure") expect(r.result.reason).toBe("no-route");
    expect(r.httpStatus).toBe(401);
  });

  // (h) 401 with valid JSON but a different error.type → no-route (exact match only)
  it("(h) 401 JSON with error.type !== 'unauthorized' → no-route failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: { type: "some-other-thing" } }, 401),
    );
    const r = await __internal.probeWorkspace(makeWs() as never);
    expect(r.result.kind).toBe("failure");
    if (r.result.kind === "failure") expect(r.result.reason).toBe("no-route");
  });

  // (i) 401 with truncated/invalid JSON → no-route (parse failure fails closed)
  it("(i) 401 with invalid JSON body → no-route failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(rawResponse('{"error":{"type":"unaut', 401, "application/json"));
    const r = await __internal.probeWorkspace(makeWs() as never);
    expect(r.result.kind).toBe("failure");
    if (r.result.kind === "failure") expect(r.result.reason).toBe("no-route");
  });
});

// ─── decideUpdate: the mapping table is the spec ──────────────────────

const NOW = 1_700_000_000_000;

describe("decideUpdate: healthy paths", () => {
  it("fresh healthy probe: status unchanged, healthStatus=HEALTHY, counter=0, lastHealthCheck=now", () => {
    const u = __internal.decideUpdate(
      { status: "RUNNING", healthStatus: "UNKNOWN", consecutiveHealthFailures: 0 },
      { kind: "healthy" },
      NOW,
    );
    expect(u).toEqual({
      status: "RUNNING",
      healthStatus: "HEALTHY",
      consecutiveHealthFailures: 0,
      lastHealthCheck: new Date(NOW),
      // PR-4a: a fully-healthy probe records no reason (null) - nothing to flag.
      lastHealthReason: null,
    });
  });

  it("recovery from UNHEALTHY: counter=3 healthy → HEALTHY/counter=0", () => {
    const u = __internal.decideUpdate(
      { status: "RUNNING", healthStatus: "UNHEALTHY", consecutiveHealthFailures: 3 },
      { kind: "healthy" },
      NOW,
    );
    expect(u.healthStatus).toBe("HEALTHY");
    expect(u.consecutiveHealthFailures).toBe(0);
    expect(u.lastHealthCheck).toEqual(new Date(NOW));
    expect(u.lastHealthReason).toBeNull();
  });

  // PR-4a - CANONICAL STATEMENT OF THE SYMMETRIC SELF-HEAL RULE.
  // Supersedes the PR-3/PR-4 "status=ERROR is NOT downgraded on recovery"
  // intent: ERROR now heals to RUNNING on ANY successful HTTP response. The
  // "what happened" trace is preserved by lastHealthReason + lastHealthCheck.
  it("status=ERROR heals to RUNNING on any successful response (HEALTHY, 4xx-config-drift, or 200-degraded)", () => {
    const healthy = __internal.decideUpdate(
      { status: "ERROR", healthStatus: "UNHEALTHY", consecutiveHealthFailures: 6 },
      { kind: "healthy" },
      NOW,
    );
    expect(healthy.status).toBe("RUNNING");
    expect(healthy.healthStatus).toBe("HEALTHY");
    expect(healthy.consecutiveHealthFailures).toBe(0);
    expect(healthy.lastHealthCheck).toEqual(new Date(NOW));
    expect(healthy.lastHealthReason).toBeNull();

    const configDrift = __internal.decideUpdate(
      { status: "ERROR", healthStatus: "UNHEALTHY", consecutiveHealthFailures: 6 },
      { kind: "degraded", reason: "plugin-not-loaded" },
      NOW,
    );
    expect(configDrift.status).toBe("RUNNING");
    expect(configDrift.healthStatus).toBe("DEGRADED");
    expect(configDrift.lastHealthReason).toBe("plugin-not-loaded");

    const gatewayIssue = __internal.decideUpdate(
      { status: "ERROR", healthStatus: "UNHEALTHY", consecutiveHealthFailures: 6 },
      { kind: "degraded", reason: "no-agents" },
      NOW,
    );
    expect(gatewayIssue.status).toBe("RUNNING");
    expect(gatewayIssue.healthStatus).toBe("DEGRADED");
    expect(gatewayIssue.lastHealthReason).toBe("no-agents");
  });
});

describe("decideActivitySilence", () => {
  const now = new Date("2026-07-05T08:00:00.000Z").getTime();

  it("MUTATION-anchored: flags when latest activity is older than 2x heartbeat interval", () => {
    const result = __internal.decideActivitySilence({
      status: "RUNNING",
      healthStatus: "HEALTHY",
      heartbeatIntervalMs: 60 * 60 * 1000,
      latestActivityAt: new Date(now - (2 * 60 * 60 * 1000) - 1),
      currentFlag: null,
      nowMs: now,
    });

    expect(result).toEqual(new Date(now));
  });

  it("clears when newer activity arrives", () => {
    const existing = new Date(now - 60_000);
    const result = __internal.decideActivitySilence({
      status: "RUNNING",
      healthStatus: "HEALTHY",
      heartbeatIntervalMs: 60 * 60 * 1000,
      latestActivityAt: new Date(now - 10 * 60 * 1000),
      currentFlag: existing,
      nowMs: now,
    });

    expect(result).toBeNull();
  });

  it("MUTATION-anchored: heartbeat off/absent never flags", () => {
    const result = __internal.decideActivitySilence({
      status: "RUNNING",
      healthStatus: "HEALTHY",
      heartbeatIntervalMs: null,
      latestActivityAt: null,
      currentFlag: null,
      nowMs: now,
    });

    expect(result).toBeUndefined();
  });

  it("PAUSED never flags", () => {
    const result = __internal.decideActivitySilence({
      status: "PAUSED",
      healthStatus: "HEALTHY",
      heartbeatIntervalMs: 60 * 60 * 1000,
      latestActivityAt: null,
      currentFlag: null,
      nowMs: now,
    });

    expect(result).toBeUndefined();
  });

  it("container unhealthy never flags", () => {
    const result = __internal.decideActivitySilence({
      status: "RUNNING",
      healthStatus: "UNHEALTHY",
      heartbeatIntervalMs: 60 * 60 * 1000,
      latestActivityAt: null,
      currentFlag: null,
      nowMs: now,
    });

    expect(result).toBeUndefined();
  });

  it("uses a 30 minute minimum threshold", () => {
    const result = __internal.decideActivitySilence({
      status: "RUNNING",
      healthStatus: "HEALTHY",
      heartbeatIntervalMs: 5 * 60 * 1000,
      latestActivityAt: new Date(now - 29 * 60 * 1000),
      currentFlag: null,
      nowMs: now,
    });

    expect(result).toBeUndefined();
  });

  it("maps known heartbeat frequencies to intervals", () => {
    expect(__internal.heartbeatIntervalMs("test_5min")).toBe(5 * 60 * 1000);
    expect(__internal.heartbeatIntervalMs("hourly")).toBe(60 * 60 * 1000);
    expect(__internal.heartbeatIntervalMs("every_6h")).toBe(6 * 60 * 60 * 1000);
    expect(__internal.heartbeatIntervalMs("every_12h")).toBe(12 * 60 * 60 * 1000);
    expect(__internal.heartbeatIntervalMs("daily")).toBe(24 * 60 * 60 * 1000);
    expect(__internal.heartbeatIntervalMs("weekday")).toBe(24 * 60 * 60 * 1000);
    expect(__internal.heartbeatIntervalMs("off")).toBeNull();
  });
});

describe("decideStateSyncStale", () => {
  const now = new Date("2026-07-05T08:00:00.000Z").getTime();
  const oldDeploy = new Date(now - 30 * 60 * 1000);

  // PR-C #13 cry-wolf guard: a lone stale probe increments the counter but
  // must NOT set the flag yet.
  it("MUTATION-anchored: first stale probe increments consecutive but does not flag", () => {
    const result = __internal.decideStateSyncStale({
      status: "RUNNING",
      healthStatus: "HEALTHY",
      runtimeStateUpdatedAt: new Date(now - (15 * 60 * 1000) - 1),
      latestDeploymentCompletedAt: oldDeploy,
      currentFlag: null,
      currentConsecutive: 0,
      nowMs: now,
    });

    expect(result.stateSyncStaleDetectedAt).toBeUndefined();
    expect(result.stateSyncStaleConsecutive).toBe(1);
  });

  // MUTATION: flagging on the FIRST stale probe (count>=1 instead of >=2)
  // would make this assertion fail - locks in the 2-consecutive requirement.
  it("MUTATION-anchored: second CONSECUTIVE stale probe sets the flag", () => {
    const result = __internal.decideStateSyncStale({
      status: "RUNNING",
      healthStatus: "HEALTHY",
      runtimeStateUpdatedAt: new Date(now - (15 * 60 * 1000) - 1),
      latestDeploymentCompletedAt: oldDeploy,
      currentFlag: null,
      currentConsecutive: 1,
      nowMs: now,
    });

    expect(result.stateSyncStaleDetectedAt).toEqual(new Date(now));
    expect(result.stateSyncStaleConsecutive).toBe(2);
  });

  it("MUTATION-anchored: flags when ContainerState row is missing, after 2 consecutive probes", () => {
    const first = __internal.decideStateSyncStale({
      status: "RUNNING",
      healthStatus: "HEALTHY",
      runtimeStateUpdatedAt: null,
      latestDeploymentCompletedAt: oldDeploy,
      currentFlag: null,
      currentConsecutive: 0,
      nowMs: now,
    });
    expect(first.stateSyncStaleDetectedAt).toBeUndefined();

    const second = __internal.decideStateSyncStale({
      status: "RUNNING",
      healthStatus: "HEALTHY",
      runtimeStateUpdatedAt: null,
      latestDeploymentCompletedAt: oldDeploy,
      currentFlag: null,
      currentConsecutive: first.stateSyncStaleConsecutive ?? 0,
      nowMs: now,
    });
    expect(second.stateSyncStaleDetectedAt).toEqual(new Date(now));
  });

  it("keeps the original detection timestamp on a third+ consecutive stale probe", () => {
    const existing = new Date(now - 60_000);
    const result = __internal.decideStateSyncStale({
      status: "RUNNING",
      healthStatus: "HEALTHY",
      runtimeStateUpdatedAt: new Date(now - 20 * 60 * 1000),
      latestDeploymentCompletedAt: oldDeploy,
      currentFlag: existing,
      currentConsecutive: 2,
      nowMs: now,
    });

    // Flag already set and unchanged → no rewrite needed.
    expect(result.stateSyncStaleDetectedAt).toBeUndefined();
    expect(result.stateSyncStaleConsecutive).toBe(3);
  });

  it("clears both flag and consecutive count when runtime snapshot is fresh", () => {
    const result = __internal.decideStateSyncStale({
      status: "RUNNING",
      healthStatus: "HEALTHY",
      runtimeStateUpdatedAt: new Date(now - 5 * 60 * 1000),
      latestDeploymentCompletedAt: oldDeploy,
      currentFlag: new Date(now - 60_000),
      currentConsecutive: 2,
      nowMs: now,
    });

    expect(result.stateSyncStaleDetectedAt).toBeNull();
    expect(result.stateSyncStaleConsecutive).toBe(0);
  });

  it("does not rewrite already-cleared flag/count on a fresh snapshot", () => {
    const result = __internal.decideStateSyncStale({
      status: "RUNNING",
      healthStatus: "HEALTHY",
      runtimeStateUpdatedAt: new Date(now - 5 * 60 * 1000),
      latestDeploymentCompletedAt: oldDeploy,
      currentFlag: null,
      currentConsecutive: 0,
      nowMs: now,
    });

    expect(result.stateSyncStaleDetectedAt).toBeUndefined();
    expect(result.stateSyncStaleConsecutive).toBeUndefined();
  });

  it("PAUSED and STOPPED never flag and reset any in-flight consecutive count", () => {
    for (const status of ["PAUSED", "STOPPED"] as const) {
      const result = __internal.decideStateSyncStale({
        status,
        healthStatus: "HEALTHY",
        runtimeStateUpdatedAt: null,
        latestDeploymentCompletedAt: oldDeploy,
        currentFlag: null,
        currentConsecutive: 1,
        nowMs: now,
      });

      expect(result.stateSyncStaleDetectedAt).toBeUndefined();
      expect(result.stateSyncStaleConsecutive).toBe(0);
    }
  });

  it("container unhealthy never flags", () => {
    const result = __internal.decideStateSyncStale({
      status: "RUNNING",
      healthStatus: "UNHEALTHY",
      runtimeStateUpdatedAt: null,
      latestDeploymentCompletedAt: oldDeploy,
      currentFlag: null,
      currentConsecutive: 0,
      nowMs: now,
    });

    expect(result.stateSyncStaleDetectedAt).toBeUndefined();
    expect(result.stateSyncStaleConsecutive).toBeUndefined();
  });

  it("workspaces deployed less than 15 minutes ago never flag", () => {
    const result = __internal.decideStateSyncStale({
      status: "RUNNING",
      healthStatus: "HEALTHY",
      runtimeStateUpdatedAt: null,
      latestDeploymentCompletedAt: new Date(now - 14 * 60 * 1000),
      currentFlag: null,
      currentConsecutive: 0,
      nowMs: now,
    });

    expect(result.stateSyncStaleDetectedAt).toBeUndefined();
    expect(result.stateSyncStaleConsecutive).toBeUndefined();
  });
});

describe("decideUpdate: degraded paths (gateway answered)", () => {
  it("plugin-errors: counter unchanged (0), healthStatus=DEGRADED, lastHealthCheck=now", () => {
    const u = __internal.decideUpdate(
      { status: "RUNNING", healthStatus: "HEALTHY", consecutiveHealthFailures: 0 },
      { kind: "degraded", reason: "plugin-errors" },
      NOW,
    );
    expect(u.healthStatus).toBe("DEGRADED");
    expect(u.consecutiveHealthFailures).toBe(0);
    expect(u.lastHealthCheck).toEqual(new Date(NOW));
  });

  it("no-agents: counter unchanged (0), healthStatus=DEGRADED, lastHealthCheck=now", () => {
    const u = __internal.decideUpdate(
      { status: "RUNNING", healthStatus: "HEALTHY", consecutiveHealthFailures: 0 },
      { kind: "degraded", reason: "no-agents" },
      NOW,
    );
    expect(u.healthStatus).toBe("DEGRADED");
    expect(u.consecutiveHealthFailures).toBe(0);
    expect(u.lastHealthCheck).toEqual(new Date(NOW));
  });

  // PR-4: 4xx config drift no longer escalates. The container's HTTP server
  // answered (401/404) → it's alive. counter resets to 0, lastHealthCheck=now.
  it("bad-token (4xx config drift): counter=0, DEGRADED, lastHealthCheck=now, NO escalate", () => {
    const u = __internal.decideUpdate(
      { status: "RUNNING", healthStatus: "HEALTHY", consecutiveHealthFailures: 4 },
      { kind: "degraded", reason: "bad-token" },
      NOW,
    );
    expect(u.healthStatus).toBe("DEGRADED");
    expect(u.consecutiveHealthFailures).toBe(0);
    expect(u.lastHealthCheck).toEqual(new Date(NOW));
    expect(u.status).toBe("RUNNING");
    expect(u.lastHealthReason).toBe("bad-token");
  });

  it("plugin-not-loaded (4xx config drift): counter=0, DEGRADED, lastHealthCheck=now, NO escalate", () => {
    const u = __internal.decideUpdate(
      { status: "RUNNING", healthStatus: "HEALTHY", consecutiveHealthFailures: 4 },
      { kind: "degraded", reason: "plugin-not-loaded" },
      NOW,
    );
    expect(u.healthStatus).toBe("DEGRADED");
    expect(u.consecutiveHealthFailures).toBe(0);
    expect(u.lastHealthCheck).toEqual(new Date(NOW));
    expect(u.status).toBe("RUNNING");
    expect(u.lastHealthReason).toBe("plugin-not-loaded");
  });

  it("writes lastHealthReason for every degraded reason", () => {
    for (const reason of ["plugin-errors", "no-agents", "bad-token", "plugin-not-loaded"] as const) {
      const u = __internal.decideUpdate(
        { status: "RUNNING", healthStatus: "HEALTHY", consecutiveHealthFailures: 0 },
        { kind: "degraded", reason },
        NOW,
      );
      expect(u.lastHealthReason).toBe(reason);
    }
  });
});

// ─── PR-4: bulk-reclassify-on-next-pass (config-drift self-heal) ──────────

describe("PR-4 bulk-reclassify: ERROR+UNHEALTHY + any degraded response → RUNNING (symmetric)", () => {
  it("MUTATION-anchored: a stuck ERROR row returning plugin-not-loaded resets to RUNNING", () => {
    const u = __internal.decideUpdate(
      { status: "ERROR", healthStatus: "UNHEALTHY", consecutiveHealthFailures: 7 },
      { kind: "degraded", reason: "plugin-not-loaded" },
      NOW,
    );
    // If the reclassify guard is broken (status left as ws.status), this
    // fails: status would stay "ERROR" - a wrongly-stuck row.
    expect(u.status).toBe("RUNNING");
    expect(u.healthStatus).toBe("DEGRADED");
    expect(u.consecutiveHealthFailures).toBe(0);
    expect(u.lastHealthCheck).toEqual(new Date(NOW));
    expect(u.lastHealthReason).toBe("plugin-not-loaded");
  });

  it("bad-token also self-heals a stuck ERROR row", () => {
    const u = __internal.decideUpdate(
      { status: "ERROR", healthStatus: "UNHEALTHY", consecutiveHealthFailures: 5 },
      { kind: "degraded", reason: "bad-token" },
      NOW,
    );
    expect(u.status).toBe("RUNNING");
    expect(u.healthStatus).toBe("DEGRADED");
  });

  it("ALSO reclassifies a 200-degraded (plugin-errors) ERROR row - symmetric rule", () => {
    const u = __internal.decideUpdate(
      { status: "ERROR", healthStatus: "UNHEALTHY", consecutiveHealthFailures: 6 },
      { kind: "degraded", reason: "plugin-errors" },
      NOW,
    );
    // Symmetry rule (Q2.1 audit-correction): a 200-degraded response is MORE
    // definitively "alive" than a 404 - it would be perverse to heal the 404
    // case and not this one. Any degraded result heals a stuck ERROR row.
    expect(u.status).toBe("RUNNING");
    expect(u.healthStatus).toBe("DEGRADED");
  });

  it("ALSO reclassifies a 200-degraded (no-agents) ERROR row - symmetric rule", () => {
    const u = __internal.decideUpdate(
      { status: "ERROR", healthStatus: "UNHEALTHY", consecutiveHealthFailures: 6 },
      { kind: "degraded", reason: "no-agents" },
      NOW,
    );
    expect(u.status).toBe("RUNNING");
    expect(u.healthStatus).toBe("DEGRADED");
  });

  it("does NOT reclassify a RUNNING+DEGRADED row (only ERROR+UNHEALTHY is the stuck shape)", () => {
    const u = __internal.decideUpdate(
      { status: "RUNNING", healthStatus: "DEGRADED", consecutiveHealthFailures: 0 },
      { kind: "degraded", reason: "plugin-not-loaded" },
      NOW,
    );
    expect(u.status).toBe("RUNNING");
  });

  it("does NOT reclassify when a failure (5xx/timeout) hits a stuck ERROR row", () => {
    const u = __internal.decideUpdate(
      { status: "ERROR", healthStatus: "UNHEALTHY", consecutiveHealthFailures: 7 },
      { kind: "failure", reason: "http-5xx" },
      NOW,
    );
    // Genuinely failing → stays ERROR, counter keeps climbing.
    expect(u.status).toBe("ERROR");
    expect(u.consecutiveHealthFailures).toBe(8);
  });
});

describe("decideUpdate: failure paths (no answer)", () => {
  it("first failure (counter 0→1): healthStatus unchanged, lastHealthCheck preserved", () => {
    const u = __internal.decideUpdate(
      { status: "RUNNING", healthStatus: "HEALTHY", consecutiveHealthFailures: 0 },
      { kind: "failure", reason: "timeout" },
      NOW,
    );
    expect(u.status).toBe("RUNNING");
    expect(u.healthStatus).toBe("HEALTHY");
    expect(u.consecutiveHealthFailures).toBe(1);
    expect(u.lastHealthCheck).toBeNull();
  });

  it("no-container failure: same debounce path as network (Q5: one code path)", () => {
    const u = __internal.decideUpdate(
      { status: "RUNNING", healthStatus: "HEALTHY", consecutiveHealthFailures: 0 },
      { kind: "failure", reason: "no-container" },
      NOW,
    );
    // NOT insta-ERROR - same path as everything else.
    expect(u.status).toBe("RUNNING");
    expect(u.healthStatus).toBe("HEALTHY");
    expect(u.consecutiveHealthFailures).toBe(1);
  });
});

// ─── Escalation thresholds - MUTATION ANCHORS ─────────────────────────

describe("MUTATION-anchored UNHEALTHY threshold (>=2 escalates)", () => {
  it("counter 0→1 (first failure): healthStatus stays HEALTHY (must NOT escalate)", () => {
    const u = __internal.decideUpdate(
      { status: "RUNNING", healthStatus: "HEALTHY", consecutiveHealthFailures: 0 },
      { kind: "failure", reason: "network" },
      NOW,
    );
    // If UNHEALTHY_THRESHOLD is mutated from 2 → 1, this fails:
    //   counter becomes 1, 1 >= 1 → would flip UNHEALTHY.
    expect(u.healthStatus).toBe("HEALTHY");
    expect(u.consecutiveHealthFailures).toBe(1);
  });

  it("counter 1→2 (second failure): healthStatus flips UNHEALTHY", () => {
    const u = __internal.decideUpdate(
      { status: "RUNNING", healthStatus: "HEALTHY", consecutiveHealthFailures: 1 },
      { kind: "failure", reason: "network" },
      NOW,
    );
    expect(u.healthStatus).toBe("UNHEALTHY");
    expect(u.consecutiveHealthFailures).toBe(2);
    expect(u.status).toBe("RUNNING");
  });
});

describe("MUTATION-anchored ERROR threshold (>=5 escalates)", () => {
  it("counter 3→4: status stays RUNNING (must NOT escalate)", () => {
    const u = __internal.decideUpdate(
      { status: "RUNNING", healthStatus: "UNHEALTHY", consecutiveHealthFailures: 3 },
      { kind: "failure", reason: "network" },
      NOW,
    );
    // If ERROR_THRESHOLD is mutated from 5 → 4, this fails:
    //   counter becomes 4, 4 >= 4 → would flip ERROR.
    expect(u.status).toBe("RUNNING");
    expect(u.consecutiveHealthFailures).toBe(4);
    expect(u.healthStatus).toBe("UNHEALTHY");
  });

  it("counter 4→5: status flips ERROR + healthStatus=UNHEALTHY", () => {
    const u = __internal.decideUpdate(
      { status: "RUNNING", healthStatus: "UNHEALTHY", consecutiveHealthFailures: 4 },
      { kind: "failure", reason: "network" },
      NOW,
    );
    expect(u.status).toBe("ERROR");
    expect(u.healthStatus).toBe("UNHEALTHY");
    expect(u.consecutiveHealthFailures).toBe(5);
  });
});

// ─── Full route end-to-end: writes and counters ───────────────────────

describe("GET end-to-end", () => {
  it("writes status/healthStatus/counter/lastHealthCheck for each workspace", async () => {
    (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeWs({ id: "ws-a" }),
      makeWs({ id: "ws-b", consecutiveHealthFailures: 1, healthStatus: "HEALTHY" }),
    ]);
    (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({} as never);

    // ws-a: healthy success
    // ws-b: network failure
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      call++;
      if (call === 1) return jsonResponse(HEALTHY_PAYLOAD);
      throw new TypeError("fetch failed");
    });

    const res = await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.workspacesProbed).toBe(2);
    expect(body.data.healthy).toBe(1);
    expect(body.data.failed).toBe(1);
    expect(body.data.escalatedUnhealthy).toBe(1); // ws-b went 1→2

    const updates = (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mock.calls;
    expect(updates).toHaveLength(2);
    const wsA = updates.find((c) => c[0].where.id === "ws-a")![0];
    expect(wsA.data.status).toBe("RUNNING");
    expect(wsA.data.healthStatus).toBe("HEALTHY");
    expect(wsA.data.consecutiveHealthFailures).toBe(0);
    expect(wsA.data.lastHealthCheck).toBeInstanceOf(Date);

    const wsB = updates.find((c) => c[0].where.id === "ws-b")![0];
    expect(wsB.data.status).toBe("RUNNING"); // still <5 failures
    expect(wsB.data.healthStatus).toBe("UNHEALTHY"); // >=2 failures
    expect(wsB.data.consecutiveHealthFailures).toBe(2);
    expect(wsB.data.lastHealthCheck).toBeUndefined();
  });

  it("zombie (RUNNING + containerId=null) hits debounce path, not insta-ERROR", async () => {
    (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeWs({ id: "ws-zombie", containerId: null, containerHost: null }),
    ]);
    (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({} as never);

    const res = await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(200);
    const update = (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(update.data.status).toBe("RUNNING");
    expect(update.data.consecutiveHealthFailures).toBe(1);
    // healthStatus unchanged at counter=1
    expect(update.data.healthStatus).toBe("HEALTHY");
    // PR-4: every write now records the probe reason.
    expect(update.data.lastHealthReason).toBe("no-container");
  });

  it("sets heartbeatMissedAt + ERROR ActivityLog when cron window missed (Watchtower)", async () => {
    const cron = JSON.stringify([
      { schedule: { kind: "cron", expr: "0 8 * * *", tz: "UTC" } },
    ]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T08:15:00.000Z"));
    try {
      (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockImplementation(
        (args: { where?: { status?: unknown } }) => {
          if (args?.where?.status === "HIBERNATED") return Promise.resolve([]);
          return Promise.resolve([
            makeWs({
              id: "ws-miss",
              heartbeatMissedAt: null,
              containerState: {
                runtimeStateUpdatedAt: new Date(),
                containerPhase: "RUNNING",
                heartbeatCronExpressions: cron,
              },
            }),
          ]);
        },
      );
      (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({} as never);
      (prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({} as never);
      vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(HEALTHY_PAYLOAD));

      const res = await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }));
      expect(res.status).toBe(200);

      const update = (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(update.data.heartbeatMissedAt).toBeInstanceOf(Date);
      expect(prismaMock.activityLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actionType: "ERROR",
            action: "Heartbeat missed",
          }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("D6 regression: fresh deploy of a past-today cron does NOT instant-flag Heartbeat missed", async () => {
    // 2026-08-22 incident: first deploy completed 14:44:47Z carrying
    // "0 19 * * *"; the 14:44:48Z monitor pass back-projected
    // expectedAt=Aug-21T19:00Z and flagged a miss for a window in which no
    // container existed. The activation guard must suppress it.
    const cron = JSON.stringify([
      { schedule: { kind: "cron", expr: "0 19 * * *", tz: "UTC" } },
    ]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T14:44:48.000Z"));
    try {
      (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockImplementation(
        (args: { where?: { status?: unknown; containerState?: unknown } }) => {
          if (args?.where?.status === "HIBERNATED") return Promise.resolve([]);
          if (args?.where && "containerState" in args.where && !("status" in args.where)) {
            return Promise.resolve([]);
          }
          return Promise.resolve([
            makeWs({
              id: "ws-fresh-deploy",
              heartbeatMissedAt: null,
              containerState: {
                runtimeStateUpdatedAt: new Date(),
                containerPhase: "RUNNING",
                heartbeatCronExpressions: cron,
              },
              deployments: [{ completedAt: new Date("2026-08-22T14:44:47.000Z") }],
            }),
          ]);
        },
      );
      (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({} as never);
      (prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({} as never);
      vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(HEALTHY_PAYLOAD));

      const res = await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }));
      expect(res.status).toBe(200);

      const update = (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
      // MUTATION: route stops passing deployments[0].completedAt into
      // decideHeartbeatMissed → heartbeatMissedAt lands in this write and the
      // ERROR row below appears.
      expect(update.data).not.toHaveProperty("heartbeatMissedAt");
      expect(prismaMock.activityLog.create).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: "Heartbeat missed" }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("P2.1 missed-wake: HIBERNATED past nextHeartbeatAt + no boot → flag + ERROR", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T08:20:00.000Z"));
    try {
      const nextHeartbeatAt = new Date("2026-07-20T08:00:00.000Z");
      (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockImplementation(
        (args: { where?: { status?: unknown; containerState?: unknown } }) => {
          if (args?.where?.status === "HIBERNATED") {
            return Promise.resolve([
              {
                id: "ws-fixture-july",
                status: "HIBERNATED",
                heartbeatMissedAt: null,
                containerState: { nextHeartbeatAt },
              },
            ]);
          }
          // Woke-late cron-armed pass: empty (no double ledger with missed-wake).
          if (args?.where && "containerState" in args.where && !("status" in args.where)) {
            return Promise.resolve([]);
          }
          return Promise.resolve([]);
        },
      );
      (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({} as never);
      (prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({} as never);

      const res = await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.missedWakeFlagged).toBe(1);
      expect(body.data.wokeLateNeverBeatFlagged).toBe(0);

      expect(prismaMock.workspace.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "ws-fixture-july" },
          data: { heartbeatMissedAt: expect.any(Date) },
        }),
      );
      expect(prismaMock.activityLog.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.activityLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actionType: "ERROR",
            action: "Heartbeat missed",
            metadata: expect.stringContaining("heartbeat_missed_wake"),
          }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("WOKE-LATE: post-cron boot + no beat by boot+grace′ → flag + heartbeat_woke_late_never_beat", async () => {
    const cron = JSON.stringify([
      { schedule: { kind: "cron", expr: "0 8 * * *", tz: "UTC" } },
    ]);
    const bootAt = new Date("2026-07-24T08:20:02.000Z");
    vi.useFakeTimers();
    // boot + 5m grace′
    vi.setSystemTime(new Date("2026-07-24T08:25:02.000Z"));
    try {
      (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockImplementation(
        (args: { where?: { status?: unknown; containerState?: unknown } }) => {
          if (args?.where?.status === "HIBERNATED") return Promise.resolve([]);
          if (args?.where && "containerState" in args.where && !("status" in args.where)) {
            return Promise.resolve([
              {
                id: "ws-woke-late",
                heartbeatMissedAt: null,
                containerState: { heartbeatCronExpressions: cron },
              },
            ]);
          }
          return Promise.resolve([]);
        },
      );
      (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({} as never);
      (prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ timestamp: bootAt } as never) // boot
        .mockResolvedValueOnce(null); // no beat
      (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({} as never);

      const res = await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.wokeLateNeverBeatFlagged).toBe(1);

      expect(prismaMock.workspace.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "ws-woke-late" },
          data: { heartbeatMissedAt: expect.any(Date) },
        }),
      );
      expect(prismaMock.activityLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actionType: "ERROR",
            metadata: expect.stringContaining("heartbeat_woke_late_never_beat"),
          }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("WOKE-LATE: post-cron boot + catch-up beat within grace′ → no flag", async () => {
    const cron = JSON.stringify([
      { schedule: { kind: "cron", expr: "0 8 * * *", tz: "UTC" } },
    ]);
    const bootAt = new Date("2026-07-24T08:20:02.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T08:25:02.000Z"));
    try {
      (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockImplementation(
        (args: { where?: { status?: unknown; containerState?: unknown } }) => {
          if (args?.where?.status === "HIBERNATED") return Promise.resolve([]);
          if (args?.where && "containerState" in args.where && !("status" in args.where)) {
            return Promise.resolve([
              {
                id: "ws-catchup-ok",
                heartbeatMissedAt: null,
                containerState: { heartbeatCronExpressions: cron },
              },
            ]);
          }
          return Promise.resolve([]);
        },
      );
      (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({} as never);
      (prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ timestamp: bootAt } as never)
        .mockResolvedValueOnce({ id: "beat-1" } as never);
      (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({} as never);

      const res = await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.wokeLateNeverBeatFlagged).toBe(0);
      expect(prismaMock.activityLog.create).not.toHaveBeenCalled();
      const wokeUpdates = (
        prismaMock.workspace.update as ReturnType<typeof vi.fn>
      ).mock.calls.filter(
        (c) => (c[0] as { where?: { id?: string } }).where?.id === "ws-catchup-ok",
      );
      expect(wokeUpdates).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("WOKE-LATE: pre-cron boot + in-window beat → untouched", async () => {
    const cron = JSON.stringify([
      { schedule: { kind: "cron", expr: "0 8 * * *", tz: "UTC" } },
    ]);
    // Boot before expected - detector must ignore (boot lookup still returns it
    // if gte expected is false... we only query gte expected, so pre-cron boot
    // is not returned → no flag).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T08:10:00.000Z"));
    try {
      (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockImplementation(
        (args: { where?: { status?: unknown; containerState?: unknown } }) => {
          if (args?.where?.status === "HIBERNATED") return Promise.resolve([]);
          if (args?.where && "containerState" in args.where && !("status" in args.where)) {
            return Promise.resolve([
              {
                id: "ws-pre-cron",
                heartbeatMissedAt: null,
                containerState: { heartbeatCronExpressions: cron },
              },
            ]);
          }
          return Promise.resolve([]);
        },
      );
      (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({} as never);
      // No boot since expected (pre-cron boot excluded by gte expected query).
      (prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({} as never);

      const res = await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.wokeLateNeverBeatFlagged).toBe(0);
      expect(prismaMock.activityLog.create).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sets activitySilenceDetectedAt for healthy heartbeat-enabled workspace with stale activity", async () => {
    (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeWs({
        id: "ws-silent",
        agents: [{ heartbeatFrequency: "hourly" }],
        activitySilenceDetectedAt: null,
      }),
    ]);
    (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({} as never);
    (prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000),
    } as never);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(HEALTHY_PAYLOAD));

    const res = await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(200);

    const update = (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(update.data.healthStatus).toBe("HEALTHY");
    expect(update.data.activitySilenceDetectedAt).toBeInstanceOf(Date);
  });

  // PR-C #13: cry-wolf guard - the FIRST stale probe must only bump the
  // consecutive counter, not set the flag.
  it("increments stateSyncStaleConsecutive (no flag yet) on the first stale probe", async () => {
    (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeWs({
        id: "ws-stale-sync",
        containerState: { runtimeStateUpdatedAt: new Date(Date.now() - 20 * 60 * 1000) },
        deployments: [{ completedAt: new Date(Date.now() - 30 * 60 * 1000) }],
        stateSyncStaleDetectedAt: null,
        stateSyncStaleConsecutive: 0,
      }),
    ]);
    (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({} as never);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(HEALTHY_PAYLOAD));

    const res = await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(200);

    const update = (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(update.data.healthStatus).toBe("HEALTHY");
    expect(update.data.stateSyncStaleDetectedAt).toBeUndefined();
    expect(update.data.stateSyncStaleConsecutive).toBe(1);
  });

  it("sets stateSyncStaleDetectedAt on the SECOND consecutive stale probe", async () => {
    (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeWs({
        id: "ws-stale-sync",
        containerState: { runtimeStateUpdatedAt: new Date(Date.now() - 20 * 60 * 1000) },
        deployments: [{ completedAt: new Date(Date.now() - 30 * 60 * 1000) }],
        stateSyncStaleDetectedAt: null,
        stateSyncStaleConsecutive: 1,
      }),
    ]);
    (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({} as never);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(HEALTHY_PAYLOAD));

    const res = await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(200);

    const update = (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(update.data.healthStatus).toBe("HEALTHY");
    expect(update.data.stateSyncStaleDetectedAt).toBeInstanceOf(Date);
    expect(update.data.stateSyncStaleConsecutive).toBe(2);
    expect(mockHealRunning).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-stale-sync", consecutive: 2 }),
    );
  });

  it("stale-sync heal success clears the flag (no customer page)", async () => {
    mockHealRunning.mockResolvedValue({ cleared: true, alert: false, synced: true });
    (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeWs({
        id: "ws-stale-healed",
        containerState: { runtimeStateUpdatedAt: new Date(Date.now() - 20 * 60 * 1000) },
        deployments: [{ completedAt: new Date(Date.now() - 30 * 60 * 1000) }],
        stateSyncStaleDetectedAt: null,
        stateSyncStaleConsecutive: 1,
      }),
    ]);
    (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({} as never);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(HEALTHY_PAYLOAD));

    const res = await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(200);
    const update = (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(update.data.stateSyncStaleDetectedAt).toBeNull();
    expect(update.data.stateSyncStaleConsecutive).toBe(0);
  });

  it("MUTATION: health-monitor must heal stale-sync before any customer page", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/cron/health-monitor/route.ts"),
      "utf8",
    );
    expect(src).toContain("healRunningStaleSync");
    expect(src).toContain("clearParkedStaleSyncFlags");
    expect(src).toContain("heal.alert");
  });

  it("sets stateSyncStaleDetectedAt for healthy workspace missing ContainerState row, after 2 consecutive probes", async () => {
    (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeWs({
        id: "ws-missing-state",
        containerState: null,
        deployments: [{ completedAt: new Date(Date.now() - 30 * 60 * 1000) }],
        stateSyncStaleDetectedAt: null,
        stateSyncStaleConsecutive: 1,
      }),
    ]);
    (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({} as never);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(HEALTHY_PAYLOAD));

    const res = await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(200);

    const update = (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(update.data.stateSyncStaleDetectedAt).toBeInstanceOf(Date);
  });

  it("clears stateSyncStaleDetectedAt and stateSyncStaleConsecutive when runtime snapshot is fresh", async () => {
    (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeWs({
        id: "ws-sync-recovered",
        containerState: { runtimeStateUpdatedAt: new Date() },
        deployments: [{ completedAt: new Date(Date.now() - 30 * 60 * 1000) }],
        stateSyncStaleDetectedAt: new Date(Date.now() - 60 * 60 * 1000),
        stateSyncStaleConsecutive: 2,
      }),
    ]);
    (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({} as never);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(HEALTHY_PAYLOAD));

    const res = await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(200);

    const update = (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(update.data.stateSyncStaleDetectedAt).toBeNull();
    expect(update.data.stateSyncStaleConsecutive).toBe(0);
  });

  it("clears activitySilenceDetectedAt when newer activity appears", async () => {
    (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeWs({
        id: "ws-speaking",
        agents: [{ heartbeatFrequency: "hourly" }],
        activitySilenceDetectedAt: new Date(Date.now() - 60 * 60 * 1000),
      }),
    ]);
    (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({} as never);
    (prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      timestamp: new Date(),
    } as never);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(HEALTHY_PAYLOAD));

    const res = await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(200);

    const update = (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(update.data.activitySilenceDetectedAt).toBeNull();
  });

  it("PR-4: a stuck ERROR workspace returning 404 self-heals to RUNNING + reports reclassified", async () => {
    (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeWs({ id: "ws-stuck", status: "ERROR", healthStatus: "UNHEALTHY", consecutiveHealthFailures: 6 }),
    ]);
    (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({} as never);
    // 404 = admin-http-rpc plugin not enabled in this (pre-upgrade) container.
    // PR-4b: the gated 404 path now also fires /healthz to confirm liveness;
    // mock both so the heal still fires.
    mockProbeFetch({
      adminRpc: textResponse("Not Found", 404),
      healthz: jsonResponse({ ok: true, status: "live" }, 200),
    });

    const res = await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.reclassified).toBe(1);
    expect(body.data.degraded).toBe(1);

    const update = (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(update.data.status).toBe("RUNNING");
    expect(update.data.healthStatus).toBe("DEGRADED");
    expect(update.data.consecutiveHealthFailures).toBe(0);
    expect(update.data.lastHealthReason).toBe("plugin-not-loaded");
    expect(update.data.lastHealthCheck).toBeInstanceOf(Date);
  });

  // PR-4a REGRESSION LOCK - the testing blind spot that hid the unreachable
  // reclassify: the candidate query MUST include ERROR, or stuck ERROR rows
  // are never re-probed and can never self-heal. This asserts the real
  // `findMany` where-clause (the prior tests mocked findMany and so never
  // exercised the actual query). Mutation-tested: reverting the candidate
  // query to `{ status: "RUNNING" }` makes this fail.
  it("PR-4a: candidate query includes ERROR workspaces (so they can self-heal)", async () => {
    (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }));
    const call = (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call?.where).toEqual({ status: { in: ["RUNNING", "ERROR"] } });
    const statuses = call?.where?.status?.in as string[];
    expect(statuses).toContain("ERROR");
    expect(statuses).toContain("RUNNING");
  });

  it("PR-4a: a stuck ERROR workspace returning HEALTHY self-heals to RUNNING (full recovery)", async () => {
    (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeWs({ id: "ws-recovered", status: "ERROR", healthStatus: "UNHEALTHY", consecutiveHealthFailures: 6 }),
    ]);
    (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({} as never);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(HEALTHY_PAYLOAD));

    const res = await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.reclassified).toBe(1);
    expect(body.data.healthy).toBe(1);

    const update = (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(update.data.status).toBe("RUNNING");
    expect(update.data.healthStatus).toBe("HEALTHY");
    expect(update.data.consecutiveHealthFailures).toBe(0);
    expect(update.data.lastHealthReason).toBeNull();
    expect(update.data.lastHealthCheck).toBeInstanceOf(Date);
  });

  it("continues past update failures so one bad row doesn't poison the loop", async () => {
    (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeWs({ id: "ws-1" }),
      makeWs({ id: "ws-2" }),
    ]);
    (prismaMock.workspace.update as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("db boom"))
      .mockResolvedValueOnce({} as never);

    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(HEALTHY_PAYLOAD));

    const res = await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.workspacesProbed).toBe(2);
    expect(body.data.errorCount).toBe(1);
  });
});

// PR-3 — tests for /api/cron/health-monitor.
//
// This route owns workspace.healthStatus / lastHealthCheck / status /
// consecutiveHealthFailures. The mapping table from the audit
// (src/app/api/cron/health-monitor/route.ts top-of-file) is the spec
// — these tests are the contract.
//
// MUTATION-anchored cases below double as regression locks:
//   - "MUTATION-anchored UNHEALTHY threshold": breaking
//     UNHEALTHY_THRESHOLD from 2 to 1 must make a specific test fail.
//   - "MUTATION-anchored ERROR threshold": breaking ERROR_THRESHOLD
//     from 5 to 4 must make a specific test fail.
// Verified by deliberately patching the source and re-running — see
// the PR description.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock } from "@/test/helpers/mock-prisma";
import { createMockRequest } from "@/test/helpers/mock-request";

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/encryption", () => ({
  decrypt: vi.fn((s: string) => `decrypted:${s}`),
}));

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

beforeEach(() => {
  process.env.CRON_SECRET = CRON_SECRET;
  vi.restoreAllMocks();
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
  it("only iterates workspaces with status=RUNNING (deliberate-off skipped)", async () => {
    (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await GET(makeReq({ auth: `Bearer ${CRON_SECRET}` }));
    const call = (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call?.where).toEqual({ status: "RUNNING" });
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

  it("HTTP 401 → degraded/bad-token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: false }, 401));
    const result = await __internal.probeWorkspace(makeWs() as never);
    expect(result.result.kind).toBe("degraded");
    if (result.result.kind === "degraded") expect(result.result.reason).toBe("bad-token");
    expect(result.httpStatus).toBe(401);
  });

  it("HTTP 404 → degraded/plugin-not-loaded", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: false }, 404));
    const result = await __internal.probeWorkspace(makeWs() as never);
    expect(result.result.kind).toBe("degraded");
    if (result.result.kind === "degraded") expect(result.result.reason).toBe("plugin-not-loaded");
    expect(result.httpStatus).toBe(404);
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
  });

  it("status=ERROR is NOT downgraded on recovery (intentional: operator clears)", () => {
    const u = __internal.decideUpdate(
      { status: "ERROR", healthStatus: "UNHEALTHY", consecutiveHealthFailures: 6 },
      { kind: "healthy" },
      NOW,
    );
    expect(u.status).toBe("ERROR");
    expect(u.healthStatus).toBe("HEALTHY");
    expect(u.consecutiveHealthFailures).toBe(0);
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

  it("bad-token: counter++, healthStatus=DEGRADED, lastHealthCheck preserved", () => {
    const u = __internal.decideUpdate(
      { status: "RUNNING", healthStatus: "HEALTHY", consecutiveHealthFailures: 0 },
      { kind: "degraded", reason: "bad-token" },
      NOW,
    );
    expect(u.healthStatus).toBe("DEGRADED");
    expect(u.consecutiveHealthFailures).toBe(1);
    expect(u.lastHealthCheck).toBeNull();
  });

  it("plugin-not-loaded: counter++, healthStatus=DEGRADED, lastHealthCheck preserved", () => {
    const u = __internal.decideUpdate(
      { status: "RUNNING", healthStatus: "HEALTHY", consecutiveHealthFailures: 0 },
      { kind: "degraded", reason: "plugin-not-loaded" },
      NOW,
    );
    expect(u.healthStatus).toBe("DEGRADED");
    expect(u.consecutiveHealthFailures).toBe(1);
    expect(u.lastHealthCheck).toBeNull();
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
    // NOT insta-ERROR — same path as everything else.
    expect(u.status).toBe("RUNNING");
    expect(u.healthStatus).toBe("HEALTHY");
    expect(u.consecutiveHealthFailures).toBe(1);
  });
});

// ─── Escalation thresholds — MUTATION ANCHORS ─────────────────────────

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

// PR-2: tests for POST /api/internal/activity/[workspaceId].
//
// This route is the only path that writes container-sourced ActivityLog
// rows. The critical contracts under test:
//   1. Auth: X-Activity-Secret must match; unset env fails closed.
//   2. Validation: rejects unknown / out-of-subset actionTypes (esp.
//      SYSTEM / HUMAN_* — those are user-action sources, not container).
//   3. Workspace scoping: workspaceId comes from URL path, never body.
//   4. agentSlug resolution: server joins Agent rows by agentSlug + workspaceId.
//   5. Batch shape: 1..50 events, atomic-validate.
//
// MUTATION TEST: temporarily breaking the "secret unset → 401" branch
// re-runs and confirms a specific test fails. Documented in the test
// labeled "MUTATION-anchored:". See the verification step at the end of
// Phase B for the deliberate-break re-run.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prismaMock } from "@/test/helpers/mock-prisma";
import { createMockRequest } from "@/test/helpers/mock-request";

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { POST, __internal } from "@/app/api/internal/activity/[workspaceId]/route";

const SECRET = "test_activity_secret_pr2";
const WORKSPACE_ID = "ws-fixture-1";

function makeEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    type: "TASK_START",
    timestamp: "2026-05-25T00:00:00.000Z",
    agentId: "orchestrator",
    runId: "run-abc",
    sessionKey: "agent:main:main",
    channelId: "discord:123",
    action: "Task started: test prompt",
    metadata: { promptPreview: "test prompt" },
    ...overrides,
  };
}

async function callRoute(body: unknown, opts: { secret?: string; workspaceId?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.secret !== undefined) headers["X-Activity-Secret"] = opts.secret;
  const wsId = opts.workspaceId ?? WORKSPACE_ID;
  const req = createMockRequest(`http://localhost:3000/api/internal/activity/${wsId}`, {
    method: "POST",
    headers,
    body,
  });
  return POST(req, { params: Promise.resolve({ workspaceId: wsId }) });
}

function defaultMocks() {
  (prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: WORKSPACE_ID,
  });
  (prismaMock.agent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: "agent-cuid-1", agentSlug: "orchestrator", name: "Orchestrator" },
  ]);
  (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
}

describe("POST /api/internal/activity/[workspaceId]", () => {
  let prevSecret: string | undefined;

  beforeEach(() => {
    prevSecret = process.env.ACTIVITY_PIPELINE_SECRET;
    process.env.ACTIVITY_PIPELINE_SECRET = SECRET;
  });

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.ACTIVITY_PIPELINE_SECRET;
    else process.env.ACTIVITY_PIPELINE_SECRET = prevSecret;
  });

  // ─── Auth gate ────────────────────────────────────────────────────────

  describe("auth gate", () => {
    it("returns 401 when X-Activity-Secret header is missing", async () => {
      defaultMocks();
      const res = await callRoute({ events: [makeEvent()] });
      expect(res.status).toBe(401);
    });

    it("returns 401 when X-Activity-Secret does not match env", async () => {
      defaultMocks();
      const res = await callRoute({ events: [makeEvent()] }, { secret: "wrong" });
      expect(res.status).toBe(401);
    });

    // MUTATION-anchored: this test fails if the "unset env → 401" branch
    // is removed or weakened (e.g., compared to a literal empty string
    // instead of failing closed). The fail-closed posture is the
    // difference between "secret rotation breaks auth" (good — visible
    // incident) and "secret rotation accidentally allows any header"
    // (catastrophic — silent forgery).
    it("MUTATION-anchored: fail-closed when ACTIVITY_PIPELINE_SECRET env is unset", async () => {
      defaultMocks();
      delete process.env.ACTIVITY_PIPELINE_SECRET;
      // Even the "correct" prior secret cannot authorize a server that
      // has the env unset.
      const res = await callRoute({ events: [makeEvent()] }, { secret: SECRET });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("ACTIVITY_SECRET_UNCONFIGURED");
    });

    it("accepts the correct secret + valid batch", async () => {
      defaultMocks();
      const res = await callRoute({ events: [makeEvent()] }, { secret: SECRET });
      expect(res.status).toBe(200);
    });
  });

  // ─── Workspace existence ──────────────────────────────────────────────

  describe("workspace check", () => {
    it("returns 404 when the workspace does not exist", async () => {
      (prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const res = await callRoute({ events: [makeEvent()] }, { secret: SECRET });
      expect(res.status).toBe(404);
    });
  });

  // ─── Validation ───────────────────────────────────────────────────────

  describe("validation", () => {
    beforeEach(() => {
      defaultMocks();
    });

    it("rejects malformed body (non-JSON)", async () => {
      const req = createMockRequest(`http://localhost:3000/api/internal/activity/${WORKSPACE_ID}`, {
        method: "POST",
        headers: { "X-Activity-Secret": SECRET },
        // no body — req.json() throws
      });
      const res = await POST(req, { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) });
      expect(res.status).toBe(400);
    });

    it("rejects events that is not an array", async () => {
      const res = await callRoute({ events: { notAnArray: true } }, { secret: SECRET });
      expect(res.status).toBe(400);
    });

    it("rejects empty events array (must contain at least 1)", async () => {
      const res = await callRoute({ events: [] }, { secret: SECRET });
      expect(res.status).toBe(400);
    });

    it("rejects more than 50 events in a batch", async () => {
      const events = Array.from({ length: 51 }, () => makeEvent());
      const res = await callRoute({ events }, { secret: SECRET });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("50");
    });

    // The 8 allowed types
    for (const type of [
      "TASK_START",
      "TASK_COMPLETE",
      "TASK_FAILED",
      "MESSAGE_RECEIVED",
      "MESSAGE_SENT",
      "SKILL_INVOKED",
      "HEARTBEAT",
      "ERROR",
    ]) {
      it(`accepts allowed actionType "${type}"`, async () => {
        const res = await callRoute({ events: [makeEvent({ type })] }, { secret: SECRET });
        expect(res.status).toBe(200);
      });
    }

    // The disallowed types — these are user-action / template-internal
    // sources that the container has no business forging.
    for (const type of [
      "SYSTEM",
      "HUMAN_APPROVE",
      "HUMAN_REJECT",
      "HUMAN_REQUEST",
      "REVIEW_PASS",
      "REVIEW_REJECT",
      "COST_ALERT",
      "TRADE_SIGNAL",
      "TRADE_EXECUTED",
      "CIRCUIT_BREAKER",
    ]) {
      it(`rejects disallowed actionType "${type}" (container cannot forge user-action / template-only events)`, async () => {
        const res = await callRoute({ events: [makeEvent({ type })] }, { secret: SECRET });
        expect(res.status).toBe(400);
      });
    }

    it("rejects bogus actionType strings", async () => {
      const res = await callRoute(
        { events: [makeEvent({ type: "MADE_UP" })] },
        { secret: SECRET },
      );
      expect(res.status).toBe(400);
    });

    it("rejects events with non-ISO timestamp", async () => {
      const res = await callRoute(
        { events: [makeEvent({ timestamp: "not-a-date" })] },
        { secret: SECRET },
      );
      expect(res.status).toBe(400);
    });

    it("rejects events with non-string action", async () => {
      const res = await callRoute(
        { events: [makeEvent({ action: 123 })] },
        { secret: SECRET },
      );
      expect(res.status).toBe(400);
    });

    it("rejects events with action exceeding 1024 chars", async () => {
      const res = await callRoute(
        { events: [makeEvent({ action: "x".repeat(1025) })] },
        { secret: SECRET },
      );
      expect(res.status).toBe(400);
    });

    it("rejects when ANY event in the batch is invalid (atomic validate)", async () => {
      const res = await callRoute(
        {
          events: [
            makeEvent(),
            makeEvent({ type: "SYSTEM" }), // disallowed → whole batch rejected
            makeEvent(),
          ],
        },
        { secret: SECRET },
      );
      expect(res.status).toBe(400);
      // None of the inserts should have happened.
      expect(prismaMock.activityLog.create).not.toHaveBeenCalled();
    });
  });

  // ─── agentSlug resolution ─────────────────────────────────────────────

  describe("agentSlug resolution", () => {
    it("resolves agentId → agentName from the Agent table scoped to this workspace", async () => {
      (prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: WORKSPACE_ID,
      });
      (prismaMock.agent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "cuid-orch", agentSlug: "orchestrator", name: "Orchestrator" },
        { id: "cuid-scout", agentSlug: "trend-scout", name: "Trend Scout" },
      ]);
      (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const res = await callRoute(
        {
          events: [
            makeEvent({ agentId: "orchestrator" }),
            makeEvent({ agentId: "trend-scout", type: "MESSAGE_SENT" }),
          ],
        },
        { secret: SECRET },
      );
      expect(res.status).toBe(200);

      // Both inserts happened with the resolved agentName.
      const calls = (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBe(2);
      expect(calls[0][0].data.agentSlug).toBe("orchestrator");
      expect(calls[0][0].data.agentName).toBe("Orchestrator");
      expect(calls[1][0].data.agentSlug).toBe("trend-scout");
      expect(calls[1][0].data.agentName).toBe("Trend Scout");

      // Single batch query, scoped by workspaceId — proves no cross-tenant leak.
      const findManyCall = (prismaMock.agent.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(findManyCall.where.workspaceId).toBe(WORKSPACE_ID);
      expect(findManyCall.where.agentSlug.in).toEqual(["orchestrator", "trend-scout"]);
    });

    it("still writes the row when agentSlug doesn't match any Agent (with sourceAgentId in metadata)", async () => {
      (prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: WORKSPACE_ID,
      });
      (prismaMock.agent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]); // empty — slug doesn't match
      (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({});

      await callRoute(
        { events: [makeEvent({ agentId: "ghost-agent" })] },
        { secret: SECRET },
      );

      const call = (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.data.agentName).toBe(null);
      // We persist the unresolved slug so the row is still attributable.
      expect(call.data.agentSlug).toBe("ghost-agent");
      const meta = JSON.parse(call.data.metadata);
      expect(meta.sourceAgentId).toBe("ghost-agent");
    });

    it("handles events with no agentId at all (HEARTBEAT shape)", async () => {
      defaultMocks();
      await callRoute(
        {
          events: [
            makeEvent({ type: "HEARTBEAT", agentId: null, action: "Heartbeat tick" }),
          ],
        },
        { secret: SECRET },
      );
      const call = (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.data.agentSlug).toBe(null);
      expect(call.data.agentName).toBe(null);
    });
  });

  // ─── Workspace scoping (security) ─────────────────────────────────────

  describe("workspace scoping", () => {
    it("writes workspaceId from URL path, never from body (forge attempt)", async () => {
      defaultMocks();
      await callRoute(
        {
          events: [makeEvent()],
          // Even if a future schema accepts a body workspaceId, the route
          // ignores it. URL path is authoritative.
          workspaceId: "other-tenant-workspace",
        } as unknown,
        { secret: SECRET, workspaceId: WORKSPACE_ID },
      );

      const call = (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.data.workspaceId).toBe(WORKSPACE_ID);
    });
  });

  // ─── apiCost not set ──────────────────────────────────────────────────

  describe("PR-2 scope guard", () => {
    it("never writes apiCost (deferred to PR-2b)", async () => {
      defaultMocks();
      await callRoute(
        {
          events: [
            // Try to inject apiCost via metadata or top-level.
            makeEvent({ apiCost: 0.01, metadata: { apiCost: 0.01 } }),
          ],
        },
        { secret: SECRET },
      );
      const call = (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.data.apiCost).toBe(null);
    });
  });

  // ─── Response shape ───────────────────────────────────────────────────

  describe("response", () => {
    it("returns processed/received counts on success", async () => {
      defaultMocks();
      const res = await callRoute(
        { events: [makeEvent(), makeEvent({ type: "TASK_COMPLETE" })] },
        { secret: SECRET },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.received).toBe(2);
      expect(body.data.processed).toBe(2);
      expect(body.data.rowFailures).toBe(0);
    });
  });

  // ─── PR-4: optional `detail` field ──────────────────────────────────────

  describe("detail field", () => {
    it("persists a provided detail to ActivityLog.detail", async () => {
      defaultMocks();
      const res = await callRoute(
        { events: [makeEvent({ detail: "[cron:heartbeat-x] full raw prompt here" })] },
        { secret: SECRET },
      );
      expect(res.status).toBe(200);
      const createArg = (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(createArg.data.detail).toBe("[cron:heartbeat-x] full raw prompt here");
    });

    it("persists null detail when absent", async () => {
      defaultMocks();
      const res = await callRoute({ events: [makeEvent()] }, { secret: SECRET });
      expect(res.status).toBe(200);
      const createArg = (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(createArg.data.detail).toBeNull();
    });

    it("rejects a non-string detail with 400", async () => {
      defaultMocks();
      const res = await callRoute({ events: [makeEvent({ detail: 123 })] }, { secret: SECRET });
      expect(res.status).toBe(400);
    });

    it("rejects a detail over 4096 chars with 400", async () => {
      defaultMocks();
      const res = await callRoute(
        { events: [makeEvent({ detail: "x".repeat(4097) })] },
        { secret: SECRET },
      );
      expect(res.status).toBe(400);
    });
  });

  describe("reactive Composio no-active-connection marking", () => {
    it("extracts only the high-signal Tool Router no-active-connection format", () => {
      expect(
        __internal.extractNoActiveConnectionToolkit(
          "ToolRouterV2_NoActiveConnection: No Active connection for toolkit=googlecalendar",
        ),
      ).toBe("googlecalendar");
      expect(__internal.extractNoActiveConnectionToolkit("401 unauthorized from provider")).toBeNull();
    });

    it("marks the matching ToolConnection EXPIRED using catalog toolkit passthrough", async () => {
      defaultMocks();
      (prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "tc-calendar", toolSlug: "google_calendar" },
      ]);

      const res = await callRoute(
        {
          events: [
            makeEvent({
              type: "TASK_FAILED",
              detail:
                "ToolRouterV2_NoActiveConnection: No Active connection for toolkit=googlecalendar",
            }),
          ],
        },
        { secret: SECRET },
      );

      expect(res.status).toBe(200);
      const update = (prismaMock.toolConnection.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(update.where).toEqual({ id: "tc-calendar" });
      expect(update.data.status).toBe("EXPIRED");
      expect(update.data.lastConnectionCheckResult).toBe("EXPIRED");
      expect(update.data.lastError).toContain("toolkit=googlecalendar");
    });

    it("keeps activity ingestion successful if the reactive marker update fails", async () => {
      defaultMocks();
      (prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: "tc-calendar", toolSlug: "google_calendar" },
      ]);
      (prismaMock.toolConnection.update as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db down"));

      const res = await callRoute(
        {
          events: [
            makeEvent({
              type: "ERROR",
              detail:
                "ToolRouterV2_NoActiveConnection: No Active connection for toolkit=googlecalendar",
            }),
          ],
        },
        { secret: SECRET },
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.processed).toBe(1);
      expect(body.data.rowFailures).toBe(0);
    });

    it("ignores non-matching ERROR/TASK_FAILED text without querying connections", async () => {
      defaultMocks();

      const res = await callRoute(
        {
          events: [
            makeEvent({
              type: "ERROR",
              detail: "Random provider timeout with no Composio no-active-connection marker",
            }),
          ],
        },
        { secret: SECRET },
      );

      expect(res.status).toBe(200);
      expect(prismaMock.toolConnection.findMany).not.toHaveBeenCalled();
      expect(prismaMock.toolConnection.update).not.toHaveBeenCalled();
    });
  });
});

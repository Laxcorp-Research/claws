// DIGEST HONESTY: activity-wire reclassification of known-transient ERROR
// events (routine heartbeat catch-up skips, agents_wait / sessions_yield
// hiccups) into SYSTEM "recovered" rows, plus the bounded storm gate that
// pages the owner instead of surfacing per-occurrence user errors.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prismaMock } from "@/test/helpers/mock-prisma";
import { createMockRequest } from "@/test/helpers/mock-request";

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/healing/spend-limit", () => ({
  applyWorkspaceApiCost: vi.fn().mockResolvedValue({ enforced: false, resolved: false }),
}));
vi.mock("@/lib/alerts/customer-nudge", () => ({
  sendCustomerNudge: vi.fn().mockResolvedValue({ sent: false, channel: "skipped" }),
}));
vi.mock("@/lib/artifacts/nudge-sync-now", () => ({
  nudgeDeliverableSyncNow: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/healing/runtime-heals", () => ({
  scheduleThinkingSignatureHeal: vi.fn(),
}));
vi.mock("@/lib/artifacts/approval-command", () => ({
  applyInboundApprovalCommand: vi.fn().mockResolvedValue({ applied: false }),
}));
const mockSendCriticalAlert = vi.fn().mockResolvedValue({ sent: true, channel: "telegram" });
vi.mock("@/lib/alerts/critical-alert-push", () => ({
  sendCriticalAlert: (...args: unknown[]) => mockSendCriticalAlert(...args),
}));

import { POST } from "@/app/api/internal/activity/[workspaceId]/route";
import {
  TOOL_TRANSIENT_RECOVERED_EVENT_KIND,
  TRANSIENT_STORM_THRESHOLD,
} from "@/lib/digest/error-classes";

const SECRET = "test_activity_secret_reclass";
const WORKSPACE_ID = "ws-reclass-1";

async function callRoute(events: unknown[]) {
  const req = createMockRequest(
    `http://localhost:3000/api/internal/activity/${WORKSPACE_ID}`,
    {
      method: "POST",
      headers: { "X-Activity-Secret": SECRET },
      body: { events },
    },
  );
  return POST(req, { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) });
}

function baseEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    type: "ERROR",
    timestamp: "2026-09-16T00:00:00.000Z",
    agentId: "orchestrator",
    action: "Tool agents_wait failed: {",
    metadata: { toolName: "agents_wait", error: "{" },
    ...overrides,
  };
}

describe("activity-wire transient reclassification", () => {
  let prevSecret: string | undefined;

  beforeEach(() => {
    prevSecret = process.env.ACTIVITY_PIPELINE_SECRET;
    process.env.ACTIVITY_PIPELINE_SECRET = SECRET;
    mockSendCriticalAlert.mockClear();
    (prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: WORKSPACE_ID,
    });
    (prismaMock.agent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prismaMock.activityLog.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    (prismaMock.workspace.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });
    (prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prismaMock.containerState.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  });

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.ACTIVITY_PIPELINE_SECRET;
    else process.env.ACTIVITY_PIPELINE_SECRET = prevSecret;
  });

  it("agents_wait ERROR is stored as SYSTEM tool_transient_recovered (never a user error)", async () => {
    const res = await callRoute([baseEvent()]);
    expect(res.status).toBe(200);

    const create = (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(create.data.actionType).toBe("SYSTEM");
    const meta = JSON.parse(create.data.metadata);
    expect(meta.eventKind).toBe(TOOL_TRANSIENT_RECOVERED_EVENT_KIND);
    expect(meta.transientClass).toBe("session-plumbing");
    expect(meta.reclassifiedFrom).toBe("ERROR");
  });

  it("routine catch-up skip (beyond-grace) is stored as SYSTEM keeping its eventKind", async () => {
    const res = await callRoute([
      baseEvent({
        action: "Heartbeat catch-up skipped: beyond-grace",
        detail: "marker=catchup-v13 reason=beyond-grace",
        metadata: { eventKind: "heartbeat_catchup_skip", reason: "beyond-grace" },
      }),
    ]);
    expect(res.status).toBe(200);
    const create = (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(create.data.actionType).toBe("SYSTEM");
    const meta = JSON.parse(create.data.metadata);
    expect(meta.eventKind).toBe("heartbeat_catchup_skip");
    expect(meta.transientClass).toBe("catchup-skip");
  });

  it("alarming catch-up skip (rpc-fail) STAYS an ERROR row", async () => {
    const res = await callRoute([
      baseEvent({
        action: "Heartbeat catch-up skipped: rpc-fail",
        metadata: { eventKind: "heartbeat_catchup_skip", reason: "rpc-fail" },
      }),
    ]);
    expect(res.status).toBe(200);
    const create = (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(create.data.actionType).toBe("ERROR");
  });

  it("real tool errors (web_fetch 404) are NOT reclassified", async () => {
    const res = await callRoute([
      baseEvent({
        action: "Tool web_fetch failed: Web fetch failed (404)",
        metadata: { toolName: "web_fetch" },
      }),
    ]);
    expect(res.status).toBe(200);
    const create = (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(create.data.actionType).toBe("ERROR");
    expect(mockSendCriticalAlert).not.toHaveBeenCalled();
  });

  it("storm gate: below threshold no page; at threshold pages owner ONCE via tool-transient-storm", async () => {
    (prismaMock.activityLog.count as ReturnType<typeof vi.fn>).mockResolvedValue(
      TRANSIENT_STORM_THRESHOLD - 1,
    );
    await callRoute([baseEvent()]);
    expect(mockSendCriticalAlert).not.toHaveBeenCalled();

    (prismaMock.activityLog.count as ReturnType<typeof vi.fn>).mockResolvedValue(
      TRANSIENT_STORM_THRESHOLD,
    );
    await callRoute([baseEvent()]);
    expect(mockSendCriticalAlert).toHaveBeenCalledTimes(1);
    expect(mockSendCriticalAlert.mock.calls[0][0]).toMatchObject({
      workspaceId: WORKSPACE_ID,
      alertKey: "tool-transient-storm",
    });
  });
});

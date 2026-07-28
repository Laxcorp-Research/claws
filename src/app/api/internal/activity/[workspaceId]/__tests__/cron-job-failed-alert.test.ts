// PR-B smoke test: cron-job-failed wiring in the activity route.
//
// checkCronJobFailedAndAlert counts recent matching MESSAGE_SENT rows for
// the same job name (including the row just written by the caller) and
// pushes a critical alert once the count crosses the 2-failure threshold.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { prismaMock } from "@/test/helpers/mock-prisma";

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockSendCriticalAlert = vi.hoisted(() => vi.fn());
vi.mock("@/lib/alerts/critical-alert-push", () => ({
  sendCriticalAlert: (...args: unknown[]) => mockSendCriticalAlert(...args),
}));

import { __internal } from "@/app/api/internal/activity/[workspaceId]/route";

const WORKSPACE_ID = "ws-cron-fail-1";

function messageSentEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    type: "MESSAGE_SENT" as const,
    timestamp: new Date("2026-07-28T00:00:00.000Z"),
    agentId: null,
    runId: null,
    sessionKey: null,
    channelId: null,
    action: 'Sent to telegram: Cron job "orchestrator-heartbeat-md-0-12-16-20" failed: LLM request rejected',
    detail: null,
    metadata: {},
    ...overrides,
  };
}

beforeEach(() => {
  mockSendCriticalAlert.mockReset();
  mockSendCriticalAlert.mockResolvedValue({ sent: true, channel: "telegram" });
});

describe("checkCronJobFailedAndAlert", () => {
  it("does not push on the first failure (count=1, below threshold)", async () => {
    (prismaMock.activityLog.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);

    await __internal.checkCronJobFailedAndAlert(WORKSPACE_ID, messageSentEvent());

    expect(mockSendCriticalAlert).not.toHaveBeenCalled();
  });

  it("pushes cron-job-failed once the same job has 2+ failures in-window", async () => {
    (prismaMock.activityLog.count as ReturnType<typeof vi.fn>).mockResolvedValue(2);

    await __internal.checkCronJobFailedAndAlert(WORKSPACE_ID, messageSentEvent());

    expect(mockSendCriticalAlert).toHaveBeenCalledTimes(1);
    expect(mockSendCriticalAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        alertKey: "cron-job-failed",
        detail: expect.stringContaining("orchestrator-heartbeat-md-0-12-16-20"),
      }),
    );
  });

  it("scopes the count query to the extracted job name", async () => {
    (prismaMock.activityLog.count as ReturnType<typeof vi.fn>).mockResolvedValue(2);

    await __internal.checkCronJobFailedAndAlert(WORKSPACE_ID, messageSentEvent());

    expect(prismaMock.activityLog.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: WORKSPACE_ID,
          actionType: "MESSAGE_SENT",
          action: { contains: 'Cron job "orchestrator-heartbeat-md-0-12-16-20"' },
        }),
      }),
    );
  });

  it("ignores non-cron-fail MESSAGE_SENT events without querying", async () => {
    await __internal.checkCronJobFailedAndAlert(
      WORKSPACE_ID,
      messageSentEvent({ action: "Sent to telegram: heartbeat OK" }),
    );

    expect(prismaMock.activityLog.count).not.toHaveBeenCalled();
    expect(mockSendCriticalAlert).not.toHaveBeenCalled();
  });

  it("ignores non-MESSAGE_SENT types even with matching text", async () => {
    await __internal.checkCronJobFailedAndAlert(
      WORKSPACE_ID,
      messageSentEvent({ type: "ERROR", action: 'Cron job "x" failed: boom' }),
    );

    expect(prismaMock.activityLog.count).not.toHaveBeenCalled();
    expect(mockSendCriticalAlert).not.toHaveBeenCalled();
  });

  it("does not throw when sendCriticalAlert rejects (fire-and-forget)", async () => {
    (prismaMock.activityLog.count as ReturnType<typeof vi.fn>).mockResolvedValue(3);
    mockSendCriticalAlert.mockRejectedValue(new Error("telegram down"));

    await expect(
      __internal.checkCronJobFailedAndAlert(WORKSPACE_ID, messageSentEvent()),
    ).resolves.toBeUndefined();
  });
});

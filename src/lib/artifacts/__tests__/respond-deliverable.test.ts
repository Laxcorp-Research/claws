import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

import { readFileSync } from "node:fs"
import { join } from "node:path"

const mockApply = vi.hoisted(() => vi.fn())
const mockFind = vi.hoisted(() => vi.fn())
const mockPush = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/artifacts/apply-decision", () => ({
  applyFileVersionDecision: (...args: unknown[]) => mockApply(...args),
}))
vi.mock("@/lib/artifacts/decision-push", () => ({
  pushDecisionToClaw: (...args: unknown[]) => mockPush(...args),
}))
vi.mock("@/lib/openclaw/pending-approval", () => ({
  findDeliverableApprovalRequest: (...args: unknown[]) => mockFind(...args),
}))
const mockResolveNudge = vi.hoisted(() => vi.fn())
vi.mock("@/lib/alerts/customer-nudge", () => ({
  resolveCustomerNudge: (...args: unknown[]) => mockResolveNudge(...args),
}))

import {
  findLatestPendingDeliverableApproval,
  respondToDeliverable,
} from "@/lib/artifacts/respond-deliverable"

const pendingRow = {
  id: "hr-1",
  action: "Approval needed: x-content-cycle",
  agentName: "Commander",
  agentSlug: "twitter-commander",
  metadata: JSON.stringify({
    eventKind: "deliverable_approval_request",
    fileVersionId: "fv-1",
    logicalPath: "shared/deliverables/x-content-cycle.md",
  }),
}

describe("findLatestPendingDeliverableApproval", () => {
  beforeEach(() => {
    mockApply.mockReset()
    mockFind.mockReset()
    ;(prismaMock.fileVersion.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "fv-1",
        logicalPath: "shared/deliverables/x-content-cycle.md",
        version: 1,
        createdAt: new Date("2026-09-01T12:00:00.000Z"),
        decision: "NONE",
      },
    ])
  })

  it("returns the newest unanswered HUMAN_REQUEST", async () => {
    ;(prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([pendingRow])
    ;(prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const found = await findLatestPendingDeliverableApproval({ workspaceId: "ws-1" })
    expect(found).toEqual({ id: "hr-1", fileVersionId: "fv-1" })
  })

  it("skips a request that already has HUMAN_APPROVE", async () => {
    ;(prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([pendingRow])
    ;(prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "ha-old" })
    expect(await findLatestPendingDeliverableApproval({ workspaceId: "ws-1" })).toBeNull()
  })

  it("honors a path hint", async () => {
    ;(prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        ...pendingRow,
        id: "hr-other",
        action: "Approval needed: other-plan",
        metadata: JSON.stringify({
          eventKind: "deliverable_approval_request",
          fileVersionId: "fv-2",
          logicalPath: "shared/deliverables/other-plan.md",
        }),
      },
      pendingRow,
    ])
    ;(prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const found = await findLatestPendingDeliverableApproval({
      workspaceId: "ws-1",
      hint: "x-content-cycle",
    })
    expect(found).toEqual({ id: "hr-1", fileVersionId: "fv-1" })
  })
})

describe("respondToDeliverable", () => {
  beforeEach(() => {
    mockApply.mockReset()
    mockFind.mockReset()
    mockResolveNudge.mockReset()
    mockResolveNudge.mockResolvedValue({ sent: false, reason: "no-open-nudge" })
    mockPush.mockReset()
    mockPush.mockResolvedValue({ runId: "push-1", held: false, pushed: true })
    mockApply.mockResolvedValue({
      fileVersionId: "fv-1",
      decision: "APPROVED",
      sidecarPath: "shared/deliverables/x-content-cycle.md.status.json",
      liveWriteOk: true,
      logicalPath: "shared/deliverables/x-content-cycle.md",
      version: 2,
    })
    ;(prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { where?: { actionType?: unknown } }) => {
        if (args.where?.actionType === "HUMAN_REQUEST") return pendingRow
        return null
      },
    )
    ;(prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "ha-1" })
    ;(prismaMock.fileVersion.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "fv-1",
        logicalPath: "shared/deliverables/x-content-cycle.md",
        version: 1,
        createdAt: new Date("2026-09-01T12:00:00.000Z"),
        decision: "NONE",
      },
    ])
  })

  it("writes HUMAN_APPROVE and applies the FileVersion decision", async () => {
    const result = await respondToDeliverable({
      workspaceId: "ws-1",
      activityLogId: "hr-1",
      action: "approve",
      respondedBy: "founder@test.com",
    })
    expect(result).toMatchObject({
      ok: true,
      originalRequestId: "hr-1",
      fileVersionId: "fv-1",
      liveWriteOk: true,
    })
    expect(prismaMock.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actionType: "HUMAN_APPROVE",
      }),
    })
    expect(mockApply).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        fileVersionId: "fv-1",
        decision: "APPROVED",
      }),
    )
    expect(mockResolveNudge).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      condition: "pending-approval-unactioned",
    })
    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        logicalPath: "shared/deliverables/x-content-cycle.md",
        version: 2,
        decision: "APPROVED",
      }),
    )
  })

  it("approves an HTTP ACTION by issuing a one-shot permit (no FileVersion)", async () => {
    const httpRow = {
      id: "hr-http",
      action: "HTTP ACTION: POST paper-api.alpaca.markets/v2/orders",
      agentName: "Quant",
      agentSlug: "quant-commander",
      metadata: JSON.stringify({
        eventKind: "http_action",
        bodyHash: "abc123",
        card: {
          skill: "alpaca-trading",
          method: "POST",
          host: "paper-api.alpaca.markets",
          path: "/v2/orders",
          bodyPlain: "BUY 166 MU @ $1,017 stop $1,005",
        },
      }),
    }
    ;(prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { where?: { actionType?: unknown } }) => {
        if (args.where?.actionType === "HUMAN_REQUEST") return httpRow
        return null
      },
    )
    const result = await respondToDeliverable({
      workspaceId: "ws-1",
      activityLogId: "hr-http",
      action: "approve",
      respondedBy: "founder@test.com",
    })
    expect(result).toMatchObject({
      ok: true,
      originalRequestId: "hr-http",
      fileVersionId: null,
    })
    expect(prismaMock.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actionType: "HUMAN_APPROVE",
          metadata: expect.stringContaining("http_permit"),
        }),
      }),
    )
    expect(mockApply).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it("MUTATION: sidecar write without push leaves the agent unaware", async () => {
    await respondToDeliverable({
      workspaceId: "ws-1",
      activityLogId: "hr-1",
      action: "approve",
      respondedBy: "founder@test.com",
    })
    expect(mockApply).toHaveBeenCalled()
    // Sidecar-only is not delivery. Drop this call → agent never sees the decision.
    expect(mockPush).toHaveBeenCalledTimes(1)
    const src = readFileSync(join(process.cwd(), "src/lib/artifacts/respond-deliverable.ts"), "utf8")
    expect(src).toContain("pushDecisionToClaw")
  })

  it("409 when already responded", async () => {
    ;(prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { where?: { actionType?: unknown } }) => {
        if (args.where?.actionType === "HUMAN_REQUEST") return pendingRow
        return { id: "existing" }
      },
    )
    const result = await respondToDeliverable({
      workspaceId: "ws-1",
      activityLogId: "hr-1",
      action: "reject",
      respondedBy: "telegram:1",
    })
    expect(result).toEqual({
      ok: false,
      error: "already_approved",
      message: "already approved",
      status: 409,
    })
    expect(mockApply).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it("refuses an older version as superseded; approve latest applies sidecar", async () => {
    ;(prismaMock.fileVersion.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "fv-1",
        logicalPath: "shared/deliverables/x-content-cycle.md",
        version: 1,
        createdAt: new Date("2026-09-01T12:00:00.000Z"),
        decision: "NONE",
      },
      {
        id: "fv-2",
        logicalPath: "shared/deliverables/x-content-cycle.md",
        version: 2,
        createdAt: new Date("2026-09-02T12:00:00.000Z"),
        decision: "NONE",
      },
    ])
    const stale = await respondToDeliverable({
      workspaceId: "ws-1",
      activityLogId: "hr-1",
      fileVersionId: "fv-1",
      action: "approve",
      respondedBy: "founder@test.com",
    })
    expect(stale).toEqual({
      ok: false,
      error: "superseded",
      message: "superseded by the Sep 2 version - open latest",
      status: 409,
    })
    expect(mockApply).not.toHaveBeenCalled()

    const latestRow = {
      ...pendingRow,
      id: "hr-2",
      metadata: JSON.stringify({
        eventKind: "deliverable_approval_request",
        fileVersionId: "fv-2",
        logicalPath: "shared/deliverables/x-content-cycle.md",
      }),
    }
    ;(prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { where?: { actionType?: unknown } }) => {
        if (args.where?.actionType === "HUMAN_REQUEST") return latestRow
        return null
      },
    )
    mockApply.mockResolvedValue({
      fileVersionId: "fv-2",
      decision: "APPROVED",
      sidecarPath: "shared/deliverables/x-content-cycle.md.status.json",
      liveWriteOk: true,
      logicalPath: "shared/deliverables/x-content-cycle.md",
      version: 2,
    })
    const latest = await respondToDeliverable({
      workspaceId: "ws-1",
      activityLogId: "hr-2",
      fileVersionId: "fv-2",
      action: "approve",
      respondedBy: "founder@test.com",
    })
    expect(latest).toMatchObject({ ok: true, fileVersionId: "fv-2", liveWriteOk: true })
    expect(mockApply).toHaveBeenCalledWith(
      expect.objectContaining({ fileVersionId: "fv-2", decision: "APPROVED" }),
    )
  })
})

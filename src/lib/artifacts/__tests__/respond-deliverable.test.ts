import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

const mockApply = vi.hoisted(() => vi.fn())
const mockFind = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/artifacts/apply-decision", () => ({
  applyFileVersionDecision: (...args: unknown[]) => mockApply(...args),
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
    mockApply.mockResolvedValue({
      fileVersionId: "fv-1",
      decision: "APPROVED",
      sidecarPath: "shared/deliverables/x-content-cycle.md.status.json",
      liveWriteOk: true,
    })
    ;(prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { where?: { actionType?: unknown } }) => {
        if (args.where?.actionType === "HUMAN_REQUEST") return pendingRow
        return null
      },
    )
    ;(prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "ha-1" })
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
    expect(result).toEqual({ ok: false, error: "already_responded", status: 409 })
    expect(mockApply).not.toHaveBeenCalled()
  })
})

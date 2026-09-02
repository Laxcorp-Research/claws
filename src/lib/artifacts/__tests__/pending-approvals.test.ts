import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/encryption", () => ({ decrypt: (v: string) => v }))
vi.mock("@/lib/logger", () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))
const mockSendNudge = vi.fn()
vi.mock("@/lib/alerts/customer-nudge", () => ({
  sendCustomerNudge: (...args: unknown[]) => mockSendNudge(...args),
}))
vi.mock("@/lib/channels/send-as-claw", () => ({
  hasLaunchChannel: (config: { telegram?: { botToken?: string } }) =>
    Boolean(config.telegram?.botToken),
}))
vi.mock("@/lib/openclaw/channel-config", () => ({
  parseChannelConfigBlob: (blob: string | null) => {
    if (!blob) return {}
    return JSON.parse(blob) as { telegram?: { botToken?: string } }
  },
}))

import {
  countPendingApprovalsByWorkspace,
  hydratePendingApprovals,
  nudgeStaleWebChatPendingApprovals,
  PENDING_APPROVAL_NUDGE_AFTER_MS,
  respondedRequestIds,
} from "@/lib/artifacts/pending-approvals"

const fvMeta = JSON.stringify({
  eventKind: "deliverable_approval_request",
  fileVersionId: "fv-1",
  logicalPath: "shared/deliverables/x-content-cycle.md",
})

describe("respondedRequestIds", () => {
  it("reads originalRequestId from HUMAN_APPROVE metadata", () => {
    expect(
      respondedRequestIds([
        { metadata: JSON.stringify({ originalRequestId: "hr-1" }) },
        { metadata: "{" },
      ]).has("hr-1"),
    ).toBe(true)
  })
})

describe("hydratePendingApprovals", () => {
  beforeEach(() => {
    ;(prismaMock.fileVersion.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "fv-1",
        logicalPath: "shared/deliverables/x-content-cycle.md",
        content: "# Cycle\n\nDraft A for the human.",
      },
    ])
  })

  it("joins FileVersion title and preview; never Unknown", async () => {
    const views = await hydratePendingApprovals([
      {
        id: "hr-1",
        timestamp: new Date("2026-09-01T12:00:00.000Z"),
        action: "Approval needed: x-content-cycle",
        metadata: fvMeta,
      },
    ])
    expect(views).toEqual([
      expect.objectContaining({
        id: "hr-1",
        fileVersionId: "fv-1",
        title: "x-content-cycle",
        logicalPath: "shared/deliverables/x-content-cycle.md",
        deliverableKind: "decision",
        humanRequestId: "hr-1",
      }),
    ])
    expect(views[0]?.preview).toContain("Draft A")
    expect(JSON.stringify(views)).not.toMatch(/Unknown/)
  })

  it("drops HUMAN_REQUEST rows with no fileVersionId", async () => {
    const views = await hydratePendingApprovals([
      {
        id: "hr-legacy",
        timestamp: new Date("2026-09-01T12:00:00.000Z"),
        action: "Please approve",
        metadata: "{}",
      },
    ])
    expect(views).toEqual([])
    expect(prismaMock.fileVersion.findMany).not.toHaveBeenCalled()
  })
})

describe("countPendingApprovalsByWorkspace", () => {
  it("counts unanswered FileVersion-keyed requests only", async () => {
    ;(prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        { id: "hr-1", workspaceId: "ws-1", metadata: fvMeta },
        { id: "hr-2", workspaceId: "ws-1", metadata: fvMeta },
        { id: "hr-3", workspaceId: "ws-2", metadata: "{}" },
      ])
      .mockResolvedValueOnce([{ metadata: JSON.stringify({ originalRequestId: "hr-2" }) }])

    const counts = await countPendingApprovalsByWorkspace(["ws-1", "ws-2"])
    expect(counts.get("ws-1")).toBe(1)
    expect(counts.get("ws-2")).toBeUndefined()
  })
})

describe("nudgeStaleWebChatPendingApprovals", () => {
  beforeEach(() => {
    mockSendNudge.mockReset()
    mockSendNudge.mockResolvedValue({ sent: true, channel: "email" })
  })

  it("emails web-chat-only stale approvals and skips channel-connected claws", async () => {
    const staleAt = new Date(Date.now() - PENDING_APPROVAL_NUDGE_AFTER_MS - 1000)
    ;(prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { where?: { workspaceId?: string } }) => {
        if (args.where?.workspaceId === "ws-web") return []
        if (args.where?.workspaceId === "ws-tg") return []
        return [
          {
            id: "hr-web",
            workspaceId: "ws-web",
            metadata: fvMeta,
            workspace: { channelConfigEncrypted: null },
          },
          {
            id: "hr-tg",
            workspaceId: "ws-tg",
            metadata: fvMeta,
            workspace: { channelConfigEncrypted: JSON.stringify({ telegram: { botToken: "x" } }) },
          },
        ]
      },
    )

    const out = await nudgeStaleWebChatPendingApprovals(new Date())
    expect(out.nudged).toBe(1)
    expect(out.skippedChannel).toBe(1)
    expect(mockSendNudge).toHaveBeenCalledTimes(1)
    expect(mockSendNudge).toHaveBeenCalledWith({
      workspaceId: "ws-web",
      condition: "pending-approval-unactioned",
    })
  })
})

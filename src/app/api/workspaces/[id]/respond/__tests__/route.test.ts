import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest, parseResponse } from "@/test/helpers/mock-request"

const mockApply = vi.hoisted(() => vi.fn())
const mockFind = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/api/auth", () => ({
  getSessionUser: vi.fn().mockResolvedValue({ id: "user-1", email: "founder@test.com" }),
}))
vi.mock("@/lib/artifacts/apply-decision", () => ({
  applyFileVersionDecision: (...args: unknown[]) => mockApply(...args),
}))
vi.mock("@/lib/openclaw/pending-approval", () => ({
  findDeliverableApprovalRequest: (...args: unknown[]) => mockFind(...args),
}))

import { POST } from "@/app/api/workspaces/[id]/respond/route"
import { getSessionUser } from "@/lib/api/auth"

const params = { params: Promise.resolve({ id: "ws-1" }) }

function post(body: Record<string, unknown>) {
  return POST(
    createMockRequest("http://localhost/api/workspaces/ws-1/respond", {
      method: "POST",
      body,
    }),
    params,
  )
}

describe("POST /api/workspaces/[id]/respond", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApply.mockReset()
    mockFind.mockReset()
    ;(getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-1",
      email: "founder@test.com",
    })
    ;(prismaMock.workspace.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "ws-1" })
    ;(prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { where?: { actionType?: unknown } }) => {
        if (args.where?.actionType === "HUMAN_REQUEST") {
          return {
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
        }
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
    mockApply.mockResolvedValue({
      fileVersionId: "fv-1",
      decision: "APPROVED",
      sidecarPath: "shared/deliverables/x-content-cycle.md.status.json",
      liveWriteOk: true,
    })
  })

  it("approves from fileVersionId and writes the sidecar decision", async () => {
    mockFind.mockResolvedValue({ id: "hr-1" })
    const { status, data } = await parseResponse(await post({ fileVersionId: "fv-1", action: "approve" }))
    expect(status).toBe(200)
    expect(data.data.originalRequestId).toBe("hr-1")
    expect(data.data.fileVersionId).toBe("fv-1")
    expect(mockApply).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        fileVersionId: "fv-1",
        decision: "APPROVED",
      }),
    )
  })

  it("409 when already responded", async () => {
    ;(prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { where?: { actionType?: unknown } }) => {
        if (args.where?.actionType === "HUMAN_REQUEST") {
          return { id: "hr-1", action: "Approval needed", metadata: "{}" }
        }
        return { id: "existing" }
      },
    )
    const { status } = await parseResponse(await post({ activityLogId: "hr-1", action: "approve" }))
    expect(status).toBe(409)
    expect(mockApply).not.toHaveBeenCalled()
  })

  it("MUTATION: route must call respondToDeliverable (same path as Telegram)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/workspaces/[id]/respond/route.ts"),
      "utf8",
    )
    expect(src).toContain("respondToDeliverable")
    expect(src).not.toContain("createPendingApprovalFromOutbound")
  })
})

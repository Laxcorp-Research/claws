import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockFind = vi.hoisted(() => vi.fn())
const mockRespond = vi.hoisted(() => vi.fn())

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/artifacts/respond-deliverable", () => ({
  findLatestPendingDeliverableApproval: (...args: unknown[]) => mockFind(...args),
  respondToDeliverable: (...args: unknown[]) => mockRespond(...args),
}))

import {
  applyInboundApprovalCommand,
  parseApprovalCommand,
} from "@/lib/artifacts/approval-command"

describe("parseApprovalCommand", () => {
  it("matches exact APPROVE / REJECT and slash forms", () => {
    expect(parseApprovalCommand("APPROVE")).toEqual({ action: "approve", hint: null })
    expect(parseApprovalCommand("REJECT")).toEqual({ action: "reject", hint: null })
    expect(parseApprovalCommand("/approve")).toEqual({ action: "approve", hint: null })
    expect(parseApprovalCommand("/reject")).toEqual({ action: "reject", hint: null })
    expect(parseApprovalCommand("  approve  ")).toEqual({ action: "approve", hint: null })
  })

  it("captures an optional path or title hint", () => {
    expect(parseApprovalCommand("APPROVE x-content-cycle")).toEqual({
      action: "approve",
      hint: "x-content-cycle",
    })
    expect(parseApprovalCommand("/reject shared/deliverables/plan.md")).toEqual({
      action: "reject",
      hint: "shared/deliverables/plan.md",
    })
  })

  it("does not match prose that merely mentions approve", () => {
    expect(parseApprovalCommand("please approve this")).toBeNull()
    expect(parseApprovalCommand("I approve the plan")).toBeNull()
    expect(parseApprovalCommand("approved")).toBeNull()
    expect(parseApprovalCommand("")).toBeNull()
  })
})

describe("applyInboundApprovalCommand", () => {
  beforeEach(() => {
    mockFind.mockReset()
    mockRespond.mockReset()
  })

  it("no-ops when the text is not a command", async () => {
    const result = await applyInboundApprovalCommand({
      workspaceId: "ws-1",
      text: "please approve this",
      respondedBy: "telegram:1",
    })
    expect(result).toEqual({ applied: false })
    expect(mockFind).not.toHaveBeenCalled()
    expect(mockRespond).not.toHaveBeenCalled()
  })

  it("returns no_pending when there is no HUMAN_REQUEST", async () => {
    mockFind.mockResolvedValue(null)
    const result = await applyInboundApprovalCommand({
      workspaceId: "ws-1",
      text: "APPROVE",
      respondedBy: "telegram:1",
    })
    expect(result).toEqual({ applied: false, error: "no_pending" })
    expect(mockRespond).not.toHaveBeenCalled()
  })

  it("calls the same respond() path as the card", async () => {
    mockFind.mockResolvedValue({ id: "hr-1", fileVersionId: "fv-1" })
    mockRespond.mockResolvedValue({
      ok: true,
      id: "ha-1",
      action: "approve",
      originalRequestId: "hr-1",
      fileVersionId: "fv-1",
      liveWriteOk: true,
    })
    const result = await applyInboundApprovalCommand({
      workspaceId: "ws-1",
      text: "APPROVE x-content-cycle",
      respondedBy: "telegram:1",
    })
    expect(result).toEqual({ applied: true })
    expect(mockFind).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      hint: "x-content-cycle",
    })
    expect(mockRespond).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      activityLogId: "hr-1",
      fileVersionId: "fv-1",
      action: "approve",
      respondedBy: "telegram:1",
    })
  })
})

describe("MUTATION: activity ingest wires inbound commands", () => {
  it("MESSAGE_RECEIVED must call applyInboundApprovalCommand", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/internal/activity/[workspaceId]/route.ts"),
      "utf8",
    )
    expect(src).toContain("applyInboundApprovalCommand")
    expect(src).toMatch(/MESSAGE_RECEIVED[\s\S]{0,200}applyInboundApprovalCommand/)
    expect(src).not.toContain("createPendingApprovalFromOutbound")
  })
})

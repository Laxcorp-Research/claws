import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

const mockWrite = vi.hoisted(() => vi.fn())
vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/artifacts/live-write", () => ({
  writeWorkspaceSharedFile: (...args: unknown[]) => mockWrite(...args),
}))

import { applyFileVersionDecision } from "@/lib/artifacts/apply-decision"

describe("applyFileVersionDecision", () => {
  beforeEach(() => {
    mockWrite.mockReset()
    mockWrite.mockResolvedValue({ ok: true, fileVersionId: "fv-side", version: 1, unchanged: false, bytes: 10 })
    ;(prismaMock.fileVersion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "fv-1",
      logicalPath: "shared/deliverables/x-content-cycle.md",
    })
    ;(prismaMock.fileVersion.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "fv-1",
      decision: "APPROVED",
    })
  })

  it("updates FileVersion.decision and live-writes the sidecar", async () => {
    const result = await applyFileVersionDecision({
      workspaceId: "ws-1",
      fileVersionId: "fv-1",
      decision: "APPROVED",
      reason: null,
      decidedBy: "founder@test.com",
    })
    expect(result).toMatchObject({
      fileVersionId: "fv-1",
      decision: "APPROVED",
      sidecarPath: "shared/deliverables/x-content-cycle.md.status.json",
      liveWriteOk: true,
    })
    expect(prismaMock.fileVersion.update).toHaveBeenCalledWith({
      where: { id: "fv-1" },
      data: { decision: "APPROVED", decisionReason: null },
    })
    expect(mockWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        logicalPath: "shared/deliverables/x-content-cycle.md.status.json",
        createdBy: "founder@test.com",
        trigger: "EDIT",
      }),
    )
    const content = (mockWrite.mock.calls[0][0] as { content: string }).content
    expect(content).toContain("\"decision\": \"APPROVED\"")
    expect(content).toContain("fv-1")
  })

  it("404 when the FileVersion is missing", async () => {
    ;(prismaMock.fileVersion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const result = await applyFileVersionDecision({
      workspaceId: "ws-1",
      fileVersionId: "missing",
      decision: "REJECTED",
      reason: "no",
      decidedBy: "u",
    })
    expect(result).toEqual({ error: "file_version_not_found", status: 404 })
    expect(mockWrite).not.toHaveBeenCalled()
  })
})

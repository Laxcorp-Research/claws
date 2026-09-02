import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest, parseResponse } from "@/test/helpers/mock-request"

const mockWrite = vi.hoisted(() => vi.fn())
vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/api/auth", () => ({
  getSessionUser: vi.fn().mockResolvedValue({ id: "user-1", email: "founder@test.com" }),
}))
vi.mock("@/lib/api/ownership", () => ({
  verifyWorkspaceOwnership: vi.fn().mockResolvedValue({ error: null, workspace: { id: "ws-1" } }),
}))
vi.mock("@/lib/artifacts/live-write", () => ({
  writeWorkspaceSharedFile: (...args: unknown[]) => mockWrite(...args),
}))

import { GET, PATCH } from "@/app/api/workspaces/[id]/file-versions/[fileVersionId]/route"
import { getSessionUser } from "@/lib/api/auth"

const params = { params: Promise.resolve({ id: "ws-1", fileVersionId: "fv-1" }) }

describe("file-versions route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWrite.mockReset()
    ;(getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-1",
      email: "founder@test.com",
    })
    ;(prismaMock.fileVersion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "fv-1",
      workspaceId: "ws-1",
      logicalPath: "shared/deliverables/x-content-cycle.md",
      version: 2,
      content: "# Cycle",
      decision: "NONE",
      trigger: "MISSION",
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      createdBy: "system",
    })
    ;(prismaMock.fileVersion.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "fv-1",
        logicalPath: "shared/deliverables/x-content-cycle.md",
        version: 2,
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
        decision: "NONE",
      },
    ])
  })

  it("GET returns file content for the owner", async () => {
    const { status, data } = await parseResponse(
      await GET(createMockRequest("http://localhost/x", { method: "GET" }), params),
    )
    expect(status).toBe(200)
    expect(data.data).toMatchObject({
      id: "fv-1",
      content: "# Cycle",
      logicalPath: "shared/deliverables/x-content-cycle.md",
      decision: "NONE",
      isLatest: true,
    })
  })

  it("PATCH live-writes an edit", async () => {
    mockWrite.mockResolvedValue({ ok: true, fileVersionId: "fv-2", version: 3, unchanged: false, bytes: 8 })
    const { status, data } = await parseResponse(
      await PATCH(
        createMockRequest("http://localhost/x", { method: "PATCH", body: { content: "# Edited" } }),
        params,
      ),
    )
    expect(status).toBe(200)
    expect(mockWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        logicalPath: "shared/deliverables/x-content-cycle.md",
        content: "# Edited",
        trigger: "EDIT",
      }),
    )
    expect(data.data.fileVersionId).toBe("fv-2")
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"
import { createMockRequest, parseResponse } from "@/test/helpers/mock-request"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const mockCatalog = vi.hoisted(() => vi.fn())
const mockDetail = vi.hoisted(() => vi.fn())
const mockRestore = vi.hoisted(() => vi.fn())
const mockWrite = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db", () => ({ prisma: {} }))
vi.mock("@/lib/api/auth", () => ({
  getSessionUser: vi.fn().mockResolvedValue({ id: "user-1", email: "founder@test.com" }),
}))
vi.mock("@/lib/api/ownership", () => ({
  verifyWorkspaceOwnership: vi.fn().mockResolvedValue({ error: null, workspace: { id: "ws-1" } }),
}))
vi.mock("@/lib/artifacts/load-workspace-files", () => ({
  loadWorkspaceFileCatalog: (...args: unknown[]) => mockCatalog(...args),
  loadWorkspaceFileDetail: (...args: unknown[]) => mockDetail(...args),
  restoreWorkspaceFileVersion: (...args: unknown[]) => mockRestore(...args),
}))
vi.mock("@/lib/artifacts/live-write", () => ({
  writeWorkspaceSharedFile: (...args: unknown[]) => mockWrite(...args),
}))

import { GET, POST } from "@/app/api/workspaces/[id]/files/route"
import { GET as GET_CONTENT } from "@/app/api/workspaces/[id]/files/content/route"
import { POST as POST_RESTORE } from "@/app/api/workspaces/[id]/files/restore/route"
import { getSessionUser } from "@/lib/api/auth"

const params = { params: Promise.resolve({ id: "ws-1" }) }

describe("workspace files API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCatalog.mockReset()
    mockDetail.mockReset()
    mockRestore.mockReset()
    mockWrite.mockReset()
    ;(getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-1",
      email: "founder@test.com",
    })
  })

  it("GET lists the catalog for the owner", async () => {
    mockCatalog.mockResolvedValue({
      files: [
        {
          logicalPath: "shared/USER.md",
          owner: "human",
          editable: true,
          source: "seed",
          bytes: 12,
          updatedAt: null,
          latestVersion: null,
          latestFileVersionId: null,
          createdBy: null,
        },
      ],
      snapshotAsOf: null,
    })
    const { status, data } = await parseResponse(
      await GET(createMockRequest("http://localhost/api/workspaces/ws-1/files"), params),
    )
    expect(status).toBe(200)
    expect(data.data.files[0].logicalPath).toBe("shared/USER.md")
    expect(mockCatalog).toHaveBeenCalledWith("ws-1")
  })

  it("POST live-writes a human-owned shared path", async () => {
    mockWrite.mockResolvedValue({
      ok: true,
      fileVersionId: "fv-2",
      version: 2,
      unchanged: false,
      bytes: 8,
    })
    const { status, data } = await parseResponse(
      await POST(
        createMockRequest("http://localhost/api/workspaces/ws-1/files", {
          method: "POST",
          body: { path: "shared/USER.md", content: "# Me" },
        }),
        params,
      ),
    )
    expect(status).toBe(200)
    expect(data.data.fileVersionId).toBe("fv-2")
    expect(mockWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        logicalPath: "shared/USER.md",
        content: "# Me",
        trigger: "EDIT",
      }),
    )
  })

  it("POST rejects agent memory writes (403, no live-write)", async () => {
    const { status } = await parseResponse(
      await POST(
        createMockRequest("http://localhost/api/workspaces/ws-1/files", {
          method: "POST",
          body: { path: "workspace-scout/memory/MEMORY.md", content: "nope" },
        }),
        params,
      ),
    )
    expect(status).toBe(403)
    expect(mockWrite).not.toHaveBeenCalled()
  })

  it("GET content returns history for a catalog path", async () => {
    mockDetail.mockResolvedValue({
      logicalPath: "shared/USER.md",
      content: "# Me",
      bytes: 4,
      source: "versioned",
      owner: "human",
      editable: true,
      latestVersion: 2,
      latestFileVersionId: "fv-2",
      history: [{ id: "fv-2", version: 2, trigger: "EDIT", createdAt: "2026-09-01T00:00:00.000Z", createdBy: "u", decision: "NONE" }],
    })
    const { status, data } = await parseResponse(
      await GET_CONTENT(
        createMockRequest("http://localhost/api/workspaces/ws-1/files/content?path=shared/USER.md"),
        params,
      ),
    )
    expect(status).toBe(200)
    expect(data.data.content).toBe("# Me")
    expect(mockDetail).toHaveBeenCalledWith("ws-1", "shared/USER.md")
  })

  it("POST restore copies an old FileVersion via live-write", async () => {
    mockRestore.mockResolvedValue({
      ok: true,
      fileVersionId: "fv-9",
      version: 9,
      unchanged: false,
      bytes: 4,
    })
    const { status, data } = await parseResponse(
      await POST_RESTORE(
        createMockRequest("http://localhost/api/workspaces/ws-1/files/restore", {
          method: "POST",
          body: { fileVersionId: "fv-1" },
        }),
        params,
      ),
    )
    expect(status).toBe(200)
    expect(data.data.trigger).toBe("RESTORE")
    expect(mockRestore).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      fileVersionId: "fv-1",
      restoredBy: "founder@test.com",
    })
  })
})

describe("MUTATION: files routes never write agent memory", () => {
  it("POST handler gates on isSharedWritePath before live-write", () => {
    const src = readFileSync(resolve("src/app/api/workspaces/[id]/files/route.ts"), "utf8")
    expect(src).toContain("isSharedWritePath")
    expect(src).toContain("trigger: \"EDIT\"")
    expect(src).not.toContain("isAgentMemoryPath")
    expect(src).not.toContain("trigger: \"MISSION\"")
  })
})

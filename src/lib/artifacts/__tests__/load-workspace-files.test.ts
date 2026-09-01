import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { buildRuntimeStateGzipFixture } from "@/lib/openclaw/snapshot-conversations"

const mockWrite = vi.hoisted(() => vi.fn())
vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/artifacts/live-write", () => ({
  writeWorkspaceSharedFile: (...args: unknown[]) => mockWrite(...args),
}))

import {
  loadWorkspaceFileCatalog,
  loadWorkspaceFileDetail,
  restoreWorkspaceFileVersion,
} from "@/lib/artifacts/load-workspace-files"

describe("loadWorkspaceFileCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWrite.mockReset()
  })

  it("merges seed + snapshot + FileVersion and keeps memory read-only", async () => {
    const gzip = buildRuntimeStateGzipFixture({
      "shared/USER.md": "# live user",
      "workspace-scout/memory/MEMORY.md": "# agent notes",
      "workspace-scout/SOUL.md": "ignore me",
      "openclaw.json": "{}",
    })
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      seedFiles: [
        { path: "shared/VOICE.md", content: "# voice seed" },
        { path: "memory/MEMORY.md", content: "# memory seed" },
      ],
      agents: [{ name: "Scout" }],
      containerState: {
        runtimeStateSnapshot: new Uint8Array(gzip),
        runtimeStateUpdatedAt: new Date("2026-09-01T12:00:00.000Z"),
      },
    })
    ;(prismaMock.fileVersion.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "fv-2",
        logicalPath: "shared/USER.md",
        version: 2,
        content: "# edited user",
        createdAt: new Date("2026-09-01T13:00:00.000Z"),
        createdBy: "founder@test.com",
      },
    ])

    const { files, snapshotAsOf } = await loadWorkspaceFileCatalog("ws-1")
    expect(snapshotAsOf).toBe("2026-09-01T12:00:00.000Z")
    const user = files.find((f) => f.logicalPath === "shared/USER.md")
    const voice = files.find((f) => f.logicalPath === "shared/VOICE.md")
    const memory = files.find((f) => f.logicalPath === "workspace-scout/memory/MEMORY.md")
    expect(user).toMatchObject({
      source: "versioned",
      editable: true,
      latestFileVersionId: "fv-2",
    })
    expect(voice).toMatchObject({ source: "seed", editable: true })
    expect(memory).toMatchObject({ source: "snapshot", editable: false, owner: "agent" })
    expect(files.some((f) => f.logicalPath.endsWith("SOUL.md"))).toBe(false)
    expect(files.some((f) => f.logicalPath === "openclaw.json")).toBe(false)
  })

  it("reads FileVersion content first, then snapshot", async () => {
    ;(prismaMock.fileVersion.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "fv-1",
        logicalPath: "shared/USER.md",
        version: 1,
        trigger: "EDIT",
        createdAt: new Date("2026-09-01T13:00:00.000Z"),
        createdBy: "founder@test.com",
        decision: "NONE",
        content: "# versioned",
      },
    ])
    const detail = await loadWorkspaceFileDetail("ws-1", "shared/USER.md")
    expect(detail).toMatchObject({
      content: "# versioned",
      source: "versioned",
      editable: true,
      latestVersion: 1,
    })
  })

  it("restore live-writes prior content with RESTORE trigger", async () => {
    ;(prismaMock.fileVersion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "fv-1",
      workspaceId: "ws-1",
      logicalPath: "shared/USER.md",
      content: "# old",
    })
    mockWrite.mockResolvedValue({ ok: true, fileVersionId: "fv-3", version: 3, unchanged: false })
    const result = await restoreWorkspaceFileVersion({
      workspaceId: "ws-1",
      fileVersionId: "fv-1",
      restoredBy: "founder@test.com",
    })
    expect(result.ok).toBe(true)
    expect(mockWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        logicalPath: "shared/USER.md",
        content: "# old",
        trigger: "RESTORE",
      }),
    )
  })

  it("restore refuses agent memory FileVersion ids", async () => {
    ;(prismaMock.fileVersion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "fv-m",
      workspaceId: "ws-1",
      logicalPath: "workspace-scout/memory/MEMORY.md",
      content: "secret",
    })
    const result = await restoreWorkspaceFileVersion({
      workspaceId: "ws-1",
      fileVersionId: "fv-m",
      restoredBy: "founder@test.com",
    })
    expect(result).toEqual({ ok: false, error: "path_not_allowed", status: 403 })
    expect(mockWrite).not.toHaveBeenCalled()
  })
})

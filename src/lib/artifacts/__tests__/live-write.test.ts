import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { hashFileContent } from "@/lib/artifacts/extract-deliverables"
import { WORKSPACE_FILE_WRITTEN_EVENT_KIND } from "@/lib/artifacts/live-write"

const mockGetGw = vi.hoisted(() => vi.fn())
const mockTrySyncNow = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/openclaw/deployer", () => ({
  getGatewayConnectionInfo: (...args: unknown[]) => mockGetGw(...args),
}))
vi.mock("@/lib/openclaw/sync-now", () => ({
  DEFAULT_SYNC_TIMEOUT_MS: 18_000,
  trySyncNow: (...args: unknown[]) => mockTrySyncNow(...args),
}))

import { writeWorkspaceSharedFile } from "@/lib/artifacts/live-write"

const TOKEN = "gw-token-live-write"
const HOST = "claw-ws-1.up.railway.app"

function okFetch(bytes = 12): typeof fetch {
  return vi.fn().mockResolvedValue({
    status: 200,
    json: async () => ({ ok: true, path: "shared/USER.md", bytes }),
  }) as unknown as typeof fetch
}

describe("writeWorkspaceSharedFile", () => {
  beforeEach(() => {
    mockGetGw.mockReset()
    mockTrySyncNow.mockReset()
    mockTrySyncNow.mockResolvedValue({ synced: true })
    mockGetGw.mockResolvedValue({ wsUrl: `wss://${HOST}`, token: TOKEN })
    ;(prismaMock.fileVersion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(prismaMock.fileVersion.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "fv-1",
    })
    ;(prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "log-1" })
  })

  it("PUTs with Bearer gateway token then inserts FileVersion + ActivityLog", async () => {
    const fetchImpl = okFetch()
    const result = await writeWorkspaceSharedFile({
      workspaceId: "ws-1",
      logicalPath: "shared/USER.md",
      content: "# User\nhello",
      createdBy: "user-1",
      fetchImpl,
    })
    expect(result).toEqual({
      ok: true,
      fileVersionId: "fv-1",
      version: 1,
      unchanged: false,
      bytes: Buffer.byteLength("# User\nhello", "utf8"),
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://${HOST}/internal/workspace-files`,
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          Authorization: `Bearer ${TOKEN}`,
        }),
      }),
    )
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ]
    expect(init.headers["X-Metering-Secret"]).toBeUndefined()
    expect(prismaMock.fileVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "ws-1",
        logicalPath: "shared/USER.md",
        version: 1,
        trigger: "EDIT",
        createdBy: "user-1",
        contentHash: hashFileContent("# User\nhello"),
      }),
    })
    expect(prismaMock.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actionType: "SYSTEM",
        metadata: expect.stringContaining(WORKSPACE_FILE_WRITTEN_EVENT_KIND),
      }),
    })
    expect(mockTrySyncNow).toHaveBeenCalledWith(HOST, 18_000, undefined, "ws-1")
  })

  it("does not PUT or ledger when the path is outside shared/**", async () => {
    const fetchImpl = okFetch()
    const result = await writeWorkspaceSharedFile({
      workspaceId: "ws-1",
      logicalPath: "agents/main/agent/MEMORY.md",
      content: "secret",
      createdBy: "user-1",
      fetchImpl,
    })
    expect(result).toMatchObject({ ok: false, status: 403, error: "path_not_allowed" })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(prismaMock.fileVersion.create).not.toHaveBeenCalled()
  })

  it("does not ledger when the overlay rejects the PUT", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 401,
      json: async () => ({ ok: false, error: "unauthorized" }),
    }) as unknown as typeof fetch
    const result = await writeWorkspaceSharedFile({
      workspaceId: "ws-1",
      logicalPath: "shared/USER.md",
      content: "x",
      createdBy: "user-1",
      fetchImpl,
    })
    expect(result).toMatchObject({ ok: false, status: 401 })
    expect(prismaMock.fileVersion.create).not.toHaveBeenCalled()
  })

  it("skips a new FileVersion when contentHash already matches latest", async () => {
    const body = "# same"
    ;(prismaMock.fileVersion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "fv-existing",
      version: 3,
      contentHash: hashFileContent(body),
    })
    const result = await writeWorkspaceSharedFile({
      workspaceId: "ws-1",
      logicalPath: "shared/USER.md",
      content: body,
      createdBy: "user-1",
      fetchImpl: okFetch(),
    })
    expect(result).toMatchObject({
      ok: true,
      fileVersionId: "fv-existing",
      version: 3,
      unchanged: true,
    })
    expect(prismaMock.fileVersion.create).not.toHaveBeenCalled()
  })

  it("returns ledger_failed with diskWritten when FileVersion insert throws after 200", async () => {
    ;(prismaMock.fileVersion.create as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db down"))
    const result = await writeWorkspaceSharedFile({
      workspaceId: "ws-1",
      logicalPath: "shared/USER.md",
      content: "new",
      createdBy: "user-1",
      fetchImpl: okFetch(),
    })
    expect(result).toEqual({ ok: false, error: "ledger_failed", status: 500, diskWritten: true })
  })

  it("503 when the workspace has no gateway connection", async () => {
    mockGetGw.mockResolvedValue(null)
    const fetchImpl = okFetch()
    const result = await writeWorkspaceSharedFile({
      workspaceId: "ws-1",
      logicalPath: "shared/USER.md",
      content: "x",
      createdBy: "user-1",
      fetchImpl,
    })
    expect(result).toMatchObject({ ok: false, status: 503, error: "no_gateway" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe("MUTATION: live-write contract", () => {
  it("must PUT /internal/workspace-files with Bearer then FileVersion + ActivityLog", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/artifacts/live-write.ts"), "utf8")
    expect(src).toContain("/internal/workspace-files")
    expect(src).toContain("Authorization")
    expect(src).toContain("Bearer")
    expect(src).toContain("fileVersion.create")
    expect(src).toContain("activityLog.create")
    expect(src).not.toContain("X-Metering-Secret")
    expect(src).not.toContain("METERING_MASTER_SECRET")
  })
})
